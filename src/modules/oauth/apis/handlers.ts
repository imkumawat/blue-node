import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { getEnvConfig } from "../../../config/env.js";
import { parseInput } from "../../../shared/utils/parseInput.js";
import { setAuthCookies } from "../../../shared/utils/cookies.js";
import { SCOPES } from "../../../shared/constants/scopes.js";
import type { Scope } from "../../../shared/constants/scopes.js";
import { HttpError } from "../../../shared/errors/HttpError.js";
import { getClientIp } from "../../../utils/getClientIp.js";
import {
  getUserById,
  loginWithPassword,
  verifyToken,
} from "../../auth/index.js";

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
} from "../lib/pendingAuthStore.js";
import type { PendingAuthorization } from "../lib/pendingAuthStore.js";
import {
  resolveConsent,
  validateAuthorizeRequest,
} from "../services/authorizeRequest.js";
import type { ValidatedAuthorizeRequest } from "../services/authorizeRequest.js";
import { completeAuthorization } from "../services/completeAuthorization.js";
import { exchangeCode } from "../services/exchangeCode.js";
import { refreshGrantTokens } from "../services/refreshGrantTokens.js";
import { registerClient } from "../services/registerClient.js";
import {
  renderConsentPage,
  renderLoginPage,
  renderMessagePage,
} from "../views/pages.js";

interface Session {
  userId: string;
  userEmail: string;
  scopes: string[];
}

function sendHtml(
  res: Response,
  html: string,
  status: number = StatusCodes.OK,
): void {
  res.status(status).type("html").send(html);
}

/**
 * A CSP source expression for one redirect URI.
 *
 * Non-special schemes — the private-use callbacks native apps register, like
 * com.example.app:/cb — have no origin, so `new URL(...).origin` is the string
 * "null". CSP accepts a bare scheme as a source, which is the right granularity
 * there anyway.
 */
function cspSourceFor(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.origin === "null" ? url.protocol : url.origin;
}

/**
 * Sends a page that carries a form whose POST will end in a redirect to the
 * client.
 *
 * This needs its own CSP, and the reason is easy to miss: `form-action` governs
 * not only where a form may POST, but where that POST's response may REDIRECT to
 * — Chrome and Safari validate the whole redirect chain against it. The app-wide
 * policy is `form-action 'self'`, so the 302 that actually completes the OAuth
 * flow is blocked and the user is left looking at the page they just submitted,
 * with no error anywhere except the browser console.
 *
 * So the page naming the form also names the one extra source it must be allowed
 * to reach. Nothing is relaxed globally, and the allowance is exactly one origin
 * — one already matched against this client's registered redirect URIs.
 *
 * `script-src 'none'` because these pages genuinely have no script; it is tighter
 * than the global policy, not looser.
 */
function sendAuthPage(
  res: Response,
  redirectUri: string,
  html: string,
  status: number = StatusCodes.OK,
): void {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'none'",
      "style-src 'self' 'unsafe-inline'",
      `form-action 'self' ${cspSourceFor(redirectUri)}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  );
  sendHtml(res, html, status);
}

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

/**
 * Identifies the browser session behind an /authorize request.
 *
 * Reads the ordinary first-party access-token cookie, which is what lets an
 * already-signed-in user skip straight to consent. Any failure — no cookie, an
 * expired one, a user since deleted — is simply "no session"; none of them is an
 * error worth surfacing, because the answer in every case is "show the login
 * form".
 */
async function resolveSession(req: Request): Promise<Session | null> {
  const token = req.cookies?.access_token as string | undefined;
  if (!token) return null;

  try {
    const { jwt } = getEnvConfig();
    const authUser = await verifyToken(token, jwt.userAudience);
    const user = await getUserById(authUser.id);
    return {
      userId: authUser.id,
      userEmail: user.email,
      scopes: authUser.scopes,
    };
  } catch {
    return null;
  }
}

/**
 * `scopes` is passed in rather than taken from the request: before login the only
 * honest value is what the client asked for, but once a user is known it must be
 * the narrowed set, so that what the consent screen shows is exactly what gets
 * granted.
 */
function pendingFrom(
  request: ValidatedAuthorizeRequest,
  userId: string | null,
  userEmail: string | null,
  scopes: Scope[],
): PendingAuthorization {
  return {
    clientId: request.client.id,
    clientName: request.client.clientName,
    redirectUri: request.redirectUri,
    scopes,
    codeChallenge: request.codeChallenge,
    codeChallengeMethod: request.codeChallengeMethod,
    resource: request.resource,
    state: request.state,
    userId,
    userEmail,
  };
}

/**
 * GET /oauth/authorize — three outcomes, not one.
 *
 *   already approved  → 302 straight to the client with a code, no screen
 *   approved-but-new  → consent screen
 *   no session        → login screen, then consent
 *
 * The first is what makes a returning app feel instant, and it is only safe
 * because resolveConsent checks the request is fully covered by an existing
 * grant rather than merely that a grant exists.
 */
export async function getAuthorize(req: Request, res: Response): Promise<void> {
  const { oauth } = getEnvConfig();
  const input = parseInput(authorizeInput, req.query);

  try {
    const request = await validateAuthorizeRequest(input);
    const session = await resolveSession(req);

    if (!session) {
      const ticket = await createPending(
        pendingFrom(request, null, null, request.scopes),
      );
      sendAuthPage(
        res,
        request.redirectUri,
        renderLoginPage({
          clientName: request.client.clientName,
          ticket,
          formAction: oauth.authorizePath,
        }),
      );
      return;
    }

    const decision = await resolveConsent({
      userId: session.userId,
      userScopes: session.scopes,
      clientId: request.client.id,
      requestedScopes: request.scopes,
    });

    if (!decision.needsConsent) {
      const code = await completeAuthorization({
        userId: session.userId,
        clientId: request.client.id,
        redirectUri: request.redirectUri,
        scopes: decision.grantable,
        codeChallenge: request.codeChallenge,
        codeChallengeMethod: request.codeChallengeMethod,
        resource: request.resource,
      });
      redirectWithCode(res, request.redirectUri, request.state, code);
      return;
    }

    const ticket = await createPending(
      pendingFrom(
        request,
        session.userId,
        session.userEmail,
        decision.grantable,
      ),
    );
    sendAuthPage(
      res,
      request.redirectUri,
      renderConsentPage({
        clientName: request.client.clientName,
        scopes: decision.grantable,
        userEmail: session.userEmail,
        ticket,
        formAction: oauth.authorizePath,
      }),
    );
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
      sendHtml(
        res,
        renderMessagePage("Cannot continue", err.message),
        StatusCodes.BAD_REQUEST,
      );
      return;
    }

    throw err;
  }
}

/**
 * POST /oauth/authorize — two different forms arrive here.
 *
 * Which one is decided by the PENDING RECORD, never by the request body: a null
 * userId means login has not happened yet. Trusting the body to say which stage
 * we are in would let a submitted form claim to be past a step it never took.
 */
export async function postAuthorize(
  req: Request,
  res: Response,
): Promise<void> {
  const { oauth } = getEnvConfig();
  const { ticket, decision, email, password } = req.body as Record<
    string,
    string | undefined
  >;

  if (!ticket) {
    sendHtml(
      res,
      renderMessagePage(
        "Something went wrong",
        "Missing form token. Start again from the app.",
      ),
      StatusCodes.BAD_REQUEST,
    );
    return;
  }

  const pending = await readPending(ticket);
  if (!pending) {
    sendHtml(
      res,
      renderMessagePage(
        "This request expired",
        "Authorization requests are short-lived. Start again from the app.",
      ),
      StatusCodes.BAD_REQUEST,
    );
    return;
  }

  // ── login stage ───────────────────────────────────────────────────────────
  if (pending.userId === null) {
    if (!email || !password) {
      sendAuthPage(
        res,
        pending.redirectUri,
        renderLoginPage({
          clientName: pending.clientName,
          ticket,
          formAction: oauth.authorizePath,
          error: "Enter your email and password.",
        }),
      );
      return;
    }

    let session: Session;
    try {
      const { jwt } = getEnvConfig();
      const { user, credentials } = await loginWithPassword({
        email,
        password,
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });

      // The browser session is established for real, not just for this hop — so
      // the next app, or this one again, skips the login step entirely.
      setAuthCookies(res, credentials.accessToken, credentials.refreshToken);

      // Scopes come from the token just minted rather than a second permission
      // lookup: it is the authoritative statement of what this session carries.
      const authUser = await verifyToken(
        credentials.accessToken,
        jwt.userAudience,
      );
      session = {
        userId: user.id,
        userEmail: user.email,
        scopes: authUser.scopes,
      };
    } catch (err) {
      // Wrong credentials, lockout and the CAPTCHA gate all land here. The
      // message is whatever the auth module already decided is safe to show.
      sendAuthPage(
        res,
        pending.redirectUri,
        renderLoginPage({
          clientName: pending.clientName,
          ticket,
          formAction: oauth.authorizePath,
          error: err instanceof HttpError ? err.message : "Sign in failed.",
        }),
      );
      return;
    }

    // Consent has to be re-evaluated now that we know who the user is. Rendering
    // the screen unconditionally would ask for approval already given, and would
    // carry the scopes as REQUESTED rather than narrowed to the ones this user
    // actually holds.
    let decision;
    try {
      decision = await resolveConsent({
        userId: session.userId,
        userScopes: session.scopes,
        clientId: pending.clientId,
        requestedScopes: pending.scopes,
      });
    } catch (err) {
      // A pending record's redirect URI was validated before the record was
      // written, so sending the user there is safe.
      if (err instanceof AuthorizeRedirectError) {
        redirectWithError(
          res,
          pending.redirectUri,
          pending.state,
          err.code,
          err.message,
        );
        return;
      }
      throw err;
    }

    if (!decision.needsConsent) {
      // An earlier grant already covers everything asked for — no second screen.
      const consumed = await consumePending(ticket);
      if (!consumed) {
        sendHtml(
          res,
          renderMessagePage(
            "This request expired",
            "Start again from the app.",
          ),
          StatusCodes.BAD_REQUEST,
        );
        return;
      }

      const code = await completeAuthorization({
        userId: session.userId,
        clientId: consumed.clientId,
        redirectUri: consumed.redirectUri,
        scopes: decision.grantable,
        codeChallenge: consumed.codeChallenge,
        codeChallengeMethod: consumed.codeChallengeMethod,
        resource: consumed.resource,
      });
      redirectWithCode(res, consumed.redirectUri, consumed.state, code);
      return;
    }

    // Narrowed scopes are written back so the consent stage grants exactly what
    // this screen is about to display.
    await attachUser(
      ticket,
      session.userId,
      session.userEmail,
      decision.grantable,
    );

    sendAuthPage(
      res,
      pending.redirectUri,
      renderConsentPage({
        clientName: pending.clientName,
        scopes: decision.grantable,
        userEmail: session.userEmail,
        ticket,
        formAction: oauth.authorizePath,
      }),
    );
    return;
  }

  // ── consent stage ─────────────────────────────────────────────────────────
  const consumed = await consumePending(ticket);
  if (!consumed || consumed.userId === null) {
    sendHtml(
      res,
      renderMessagePage("This request expired", "Start again from the app."),
      StatusCodes.BAD_REQUEST,
    );
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
    userId: consumed.userId,
    clientId: consumed.clientId,
    redirectUri: consumed.redirectUri,
    scopes: consumed.scopes,
    codeChallenge: consumed.codeChallenge,
    codeChallengeMethod: consumed.codeChallengeMethod,
    resource: consumed.resource,
  });

  redirectWithCode(res, consumed.redirectUri, consumed.state, code);
}

/**
 * POST /oauth/token — dispatches on grant_type BEFORE validating the body.
 *
 * Order matters for the error a client sees. Each grant has a different required
 * shape, so parsing first would answer an unsupported grant with a schema
 * complaint about a missing `code` — leaving the client to guess. Branching first
 * lets an unknown grant come back as the OAuth error that actually names the
 * problem.
 */
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

/**
 * RFC 8414 authorization server metadata.
 *
 * `issuer` comes from JWT_ISSUER rather than API_BASE_URL so that it always
 * equals the `iss` claim in the tokens we mint — a client validating one against
 * the other must not find a mismatch. JWT_ISSUER therefore has to be this
 * server's public base URL.
 *
 * grant_types_supported lists both grants now that the refresh flow exists —
 * advertising one that isn't implemented is worse than omitting it.
 */
export function getAuthServerMetadata(_req: Request, res: Response): void {
  const { jwt, oauth } = getEnvConfig();

  res.json({
    issuer: jwt.issuer,
    authorization_endpoint: `${jwt.issuer}${oauth.authorizePath}`,
    token_endpoint: `${jwt.issuer}${oauth.tokenPath}`,
    registration_endpoint: `${jwt.issuer}${oauth.registerPath}`,
    scopes_supported: Object.values(SCOPES),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
