import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { getEnvConfig } from "../../../config/env.js";
import { parseInput } from "../../../shared/utils/parseInput.js";
import { setAuthCookies } from "../../../shared/utils/cookies.js";
import { SCOPES } from "../../../shared/constants/scopes.js";
import { HttpError } from "../../../shared/errors/HttpError.js";
import { getPublicJwks } from "../../../shared/utils/jose.js";
import { getClientIp } from "../../../utils/getClientIp.js";
import { loginWithPassword, verifySessionToken } from "../../auth/index.js";

import type { AuthSession } from "../../auth/index.js";

import {
  authorizeInput,
  refreshTokenInput,
  registerClientInput,
  tokenInput,
} from "../schemas.js";
import {
  AuthorizeRedirectError,
  InvalidRedirectUriError,
  TokenRequestError,
  UnknownClientError,
} from "../errors.js";
import {
  attachUser,
  consumePending,
  createPending,
  readPending,
} from "../infra/pendingAuthStore.js";
import {
  resolveGrant,
  validateAuthorizeRequest,
} from "../services/authorizeRequest.js";
import { completeAuthorization } from "../services/completeAuthorization.js";
import { exchangeCode } from "../services/exchangeCode.js";
import { refreshGrantTokens } from "../services/refreshGrantTokens.js";
import { registerClient } from "../services/registerClient.js";

function redirectWithCode(
  res: Response,
  redirectUri: string,
  state: string | null,
  code: string,
): void {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
}

function redirectWithError(
  res: Response,
  redirectUri: string,
  state: string | null,
  error: string,
  description: string,
): void {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
}

async function resolveSession(req: Request): Promise<AuthSession | null> {
  const token = req.cookies?.access_token as string | undefined;
  if (!token) return null;

  const record = await verifySessionToken(token);
  if (!record) return null;
  return record;
}

export function getAuthServerMetadata(_req: Request, res: Response): void {
  const { oauth } = getEnvConfig();

  res.json({
    issuer: oauth.oauthServerUrl,
    authorization_endpoint: `${oauth.oauthServerUrl}${oauth.authorizePath}`,
    token_endpoint: `${oauth.oauthServerUrl}${oauth.tokenPath}`,
    registration_endpoint: `${oauth.oauthServerUrl}${oauth.registerPath}`,
    scopes_supported: Object.values(SCOPES),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}

export function getJwks(_req: Request, res: Response): void {
  const { jwt } = getEnvConfig();

  res.set("Cache-Control", `public, max-age=${jwt.jwksCacheMaxAgeSec}`);
  res.json(getPublicJwks());
}

export async function postRegister(req: Request, res: Response): Promise<void> {
  const client = await registerClient(
    parseInput(registerClientInput, req.body),
  );

  // RFC 7591 §3.2.1: client_id is required, and the server echoes back the
  // metadata it actually registered — which may differ from what was requested.
  res.status(StatusCodes.CREATED).json({
    client_id: client.id,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
  });
}

export async function getAuthorize(req: Request, res: Response): Promise<void> {
  const input = parseInput(authorizeInput, req.query);
  try {
    const oAuthRequest = await validateAuthorizeRequest(input);
    const session = await resolveSession(req);

    if (!session) {
      // storing in flight is the only way to get back here after login,
      const ticket = await createPending(JSON.stringify(oAuthRequest));
      res
        .status(StatusCodes.UNAUTHORIZED)
        .json({ ticket, message: "ShowLoginScreen" });
      return;
    }

    const decision = await resolveGrant({
      userId: session.userId,
      clientId: oAuthRequest.client.id,
      requestedScopes: oAuthRequest.scopes,
    });

    if (!decision.needsConsent) {
      const code = await completeAuthorization({
        userId: session.userId,
        clientId: oAuthRequest.client.id,
        redirectUri: oAuthRequest.redirectUri,
        scopes: oAuthRequest.scopes,
        codeChallenge: oAuthRequest.codeChallenge,
        codeChallengeMethod: oAuthRequest.codeChallengeMethod,
        resource: oAuthRequest.resource,
      });
      redirectWithCode(res, oAuthRequest.redirectUri, oAuthRequest.state, code);
      return;
    }

    // storing in flight is the only way to get back here after login,
    const ticket = await createPending(
      JSON.stringify({ ...oAuthRequest, session: session }),
    );
    res.status(StatusCodes.UNAUTHORIZED).json({
      ticket,
      clientName: oAuthRequest.client.clientName,
      message: "ShowConsentScreen",
      requiredGrants: decision.requiredGrants,
    });
    return;
  } catch (err) {
    // A redirect error is only thrown AFTER the redirect URI has been matched
    // against the client's registered list, so sending the user there is safe by
    // construction. input.redirect_uri is the verified value.
    if (err instanceof AuthorizeRedirectError) {
      redirectWithError(
        res,
        input.redirect_uri,
        input.state ?? null,
        err.code,
        err.message,
      );

      return;
    }

    // The two errors that must NOT redirect. The user is in a browser, so they
    // get a readable page rather than the API's JSON envelope.
    if (
      err instanceof UnknownClientError ||
      err instanceof InvalidRedirectUriError
    ) {
      res.status(StatusCodes.BAD_REQUEST).json({
        message: "Cannot continue",
        error: err.message,
      });
      return;
    }

    throw err;
  }
}

export async function postAuthorize(
  req: Request,
  res: Response,
): Promise<void> {
  const { oauth } = getEnvConfig();
  const { ticket, decision, email, password, captchaToken } =
    req.body as Record<string, string | undefined>;

  if (!ticket) {
    res.status(StatusCodes.BAD_REQUEST).json({
      message: "Something went wrong",
      error: "Missing form token. Start again from the app.",
    });
    return;
  }

  const pending = await readPending(ticket);
  if (!pending) {
    res.status(StatusCodes.BAD_REQUEST).json({
      message: "This request expired",
      error:
        "Authorization requests are short-lived. Start again from the app.",
    });
    return;
  }

  // ── login stage ───────────────────────────────────────────────────────────
  if (pending.session === null) {
    if (!email || !password) {
      res.status(StatusCodes.BAD_REQUEST).json({
        message: "Enter your email and password.",
      });
      return;
    }

    let session: AuthSession | null;
    try {
      const { credentials } = await loginWithPassword({
        email,
        password,
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
        captchaToken,
      });

      // The browser session is established for real, not just for this hop — so
      // the next app, or this one again, skips the login step entirely.
      setAuthCookies(res, credentials.accessToken, credentials.refreshToken);

      const record = await verifySessionToken(credentials.accessToken);

      session = record;
      pending.session = record;
    } catch (err) {
      // Wrong credentials, lockout and the CAPTCHA gate all land here. The
      // message is whatever the auth module already decided is safe to show.
      res.status(StatusCodes.UNAUTHORIZED).json({
        clientName: pending.client.clientName,
        ticket,
        formAction: oauth.authorizePath,
        message: err instanceof HttpError ? err.message : "Sign in failed.",
      });

      return;
    }

    const decision = await resolveGrant({
      userId: session!.userId,
      clientId: pending.client.id,
      requestedScopes: pending.scopes,
    });

    if (!decision.needsConsent) {
      // An earlier grant already covers everything asked for — no second screen.
      const consumed = await consumePending(ticket);
      if (!consumed) {
        res.status(StatusCodes.BAD_REQUEST).json({
          message: "This request expired",
          error: "Start again from the app.",
        });
        return;
      }

      const code = await completeAuthorization({
        userId: session!.userId,
        clientId: consumed.client.id,
        redirectUri: consumed.redirectUri,
        scopes: consumed.scopes,
        codeChallenge: consumed.codeChallenge,
        codeChallengeMethod: consumed.codeChallengeMethod,
        resource: consumed.resource,
      });
      redirectWithCode(res, consumed.redirectUri, consumed.state, code);
      return;
    }

    await attachUser(ticket, JSON.stringify({ ...pending, session: session }));
    res.status(StatusCodes.UNAUTHORIZED).json({
      ticket,
      clientName: pending.client.clientName,
      message: "ShowConsentScreen",
      requiredGrants: decision.requiredGrants,
    });

    return;
  }

  // ── consent stage ─────────────────────────────────────────────────────────
  const consumed = await consumePending(ticket);
  if (!consumed) {
    res.status(StatusCodes.BAD_REQUEST).json({
      message: "This request expired",
      error: "Start again from the app.",
    });
    return;
  }

  if (decision !== "allow") {
    // Deny goes BACK to the client rather than to an error page: the redirect URI
    // is verified by now, and the app is entitled to know it was refused.
    redirectWithError(
      res,
      consumed.redirectUri,
      consumed.state,
      "access_denied",
      "The user denied the request",
    );
    return;
  }

  const code = await completeAuthorization({
    userId: consumed.session!.userId,
    clientId: consumed.client.id,
    redirectUri: consumed.redirectUri,
    scopes: consumed.scopes,
    codeChallenge: consumed.codeChallenge,
    codeChallengeMethod: consumed.codeChallengeMethod,
    resource: consumed.resource,
  });
  redirectWithCode(res, consumed.redirectUri, consumed.state, code);
  return;
}

export async function postToken(req: Request, res: Response): Promise<void> {
  const grantType = (req.body as Record<string, unknown> | undefined)
    ?.grant_type;

  if (grantType === "refresh_token") {
    const input = parseInput(refreshTokenInput, req.body);
    const refreshed = await refreshGrantTokens({
      refreshToken: input.refresh_token,
      clientId: input.client_id,
      requestedScope: input.scope,
      resource: input.resource,
    });
    res.set("Cache-Control", "no-store").status(StatusCodes.OK).json(refreshed);
    return;
  }

  // RFC 6749 §5.2 separates these: a missing required parameter is
  // invalid_request, while a grant type we simply do not implement is
  // unsupported_grant_type. Collapsing them tells a client to stop asking when
  // the real fix was to send the field.
  if (grantType === undefined) {
    throw new TokenRequestError("invalid_request", "grant_type is required");
  }

  if (grantType !== "authorization_code") {
    throw new TokenRequestError(
      "unsupported_grant_type",
      `Unsupported grant_type: ${String(grantType)}`,
    );
  }

  const input = parseInput(tokenInput, req.body);

  const tokens = await exchangeCode({
    code: input.code,
    codeVerifier: input.code_verifier,
    clientId: input.client_id,
    redirectUri: input.redirect_uri,
    resource: input.resource,
  });

  // Spec MUST: a token response is never cached.
  res.set("Cache-Control", "no-store").status(StatusCodes.OK).json(tokens);
}
