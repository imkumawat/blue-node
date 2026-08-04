import { StatusCodes } from "http-status-codes";

import {
  redirectWithAuthorizationCode,
  redirectWithAuthorizationError,
} from "../../../utils/redirectWith.js";
import { getEnvConfig } from "../../../config/env.js";
import { parseInput } from "../../../shared/utils/parseInput.js";
import { setAuthCookies } from "../../../shared/utils/cookies.js";
import { SCOPES } from "../../../shared/constants/scopes.js";
import { HttpError } from "../../../shared/errors/HttpError.js";
import { getPublicJwks } from "../../../shared/utils/jose.js";
import { getClientIp } from "../../../utils/getClientIp.js";
import {
  getUserById,
  loginWithPassword,
  verifySessionToken,
} from "../../auth/index.js";
import { sendFormPage, sendPage } from "./sendPage.js";
import { renderConsentPage } from "../views/consentPage.js";
import { renderLoginPage } from "../views/loginPage.js";
import { renderMessagePage } from "../views/messagePage.js";

import { authorizeInput, refreshTokenInput, tokenInput } from "../schemas.js";
import {
  AuthorizeRedirectError,
  InvalidRedirectUriError,
  TokenRequestError,
  UnknownClientError,
} from "../errors.js";

import {
  createPendingAuthorizationRequest,
  readPendingAuthorizationRequest,
  updatePendingAuthorizationRequest,
  consumePendingAuthorizationRequest,
} from "../infra/oauthTokenStore.js";
import {
  resolveGrant,
  validateAuthorizeRequest,
} from "../services/authorizeRequest.js";
import { completeAuthorization } from "../services/completeAuthorization.js";
import { exchangeCode } from "../services/exchangeCode.js";
import { refreshGrantTokens } from "../services/refreshGrantTokens.js";
import { registerClient } from "../services/registerClient.js";
import { resolveSession } from "../services/resolveSession.js";

import type { Request, Response } from "express";
import type { RegisterClientInput } from "../schemas.js";
import type { Scope } from "../../../shared/constants/scopes.js";
import type { AuthSession } from "../../auth/index.js";

/* ────────────────────────────────────────────────────────────────────────────
   Rendering the three screens

   Each of these is reached from more than one branch, so they live here rather
   than being inlined: the login page from three places, the consent page from
   two, the message page from five.

   The choice of sender is the load-bearing part. Login and consent carry a form
   whose POST ends in a redirect to the client, so they MUST go out through
   sendFormPage — sendPage's `form-action 'self'` would let the form submit and
   then silently block the 302 that completes the flow. The message page carries
   no form, so it takes the tighter policy.
   ──────────────────────────────────────────────────────────────────────────── */

function sendLoginPage(
  res: Response,
  args: {
    clientName: string;
    /** Already matched against the client's registered list. */
    redirectUri: string;
    ticket: string;
    error?: string;
  },
): void {
  sendFormPage(res, {
    page: renderLoginPage({
      clientName: args.clientName,
      ticket: args.ticket,
      error: args.error,
    }),
    redirectUri: args.redirectUri,
    // 401 for a failed attempt, 200 for the first sight of the form. A browser
    // renders both; the status is for logs and for anything watching the flow.
    status: args.error ? StatusCodes.UNAUTHORIZED : StatusCodes.OK,
  });
}

/**
 * The consent screen.
 *
 * Shows the FULL requested set, not `decision.requiredGrants`. The delta is what
 * is new, but the full set is what the app ends up holding and what
 * completeAuthorization records — and a screen that displays less than it grants
 * is a user consenting to something they were never shown. Re-showing an
 * already-granted line costs nothing; the alternative once cost this codebase a
 * real bug.
 *
 * The email is fetched rather than read off the session: AuthSession carries only
 * ids and scopes, and putting an address in a token to save a query here would be
 * the wrong trade. One extra read per authorization is nothing.
 */
async function sendConsentPage(
  res: Response,
  args: {
    userId: string;
    clientName: string;
    redirectUri: string;
    scopes: Scope[];
    ticket: string;
  },
): Promise<void> {
  const user = await getUserById(args.userId);

  sendFormPage(res, {
    page: renderConsentPage({
      clientName: args.clientName,
      userEmail: user.email,
      scopes: args.scopes,
      ticket: args.ticket,
    }),
    redirectUri: args.redirectUri,
  });
}

/** A dead end. No form, so nowhere for this page to submit or redirect to. */
function sendMessage(
  res: Response,
  title: string,
  message: string,
  status: number = StatusCodes.BAD_REQUEST,
): void {
  sendPage(
    res,
    renderMessagePage({ title, message, status: statusLabel(status) }),
    status,
  );
}

function statusLabel(status: number): string {
  return status === StatusCodes.UNAUTHORIZED
    ? "401 UNAUTHORIZED"
    : "400 BAD REQUEST";
}

export function getAuthServerMetadata(_req: Request, res: Response): void {
  const { oauth, jwt } = getEnvConfig();

  res.json({
    issuer: oauth.oauthServerUrl,
    authorization_endpoint: `${oauth.oauthServerUrl}${oauth.authorizePath}`,
    token_endpoint: `${oauth.oauthServerUrl}${oauth.tokenPath}`,
    registration_endpoint: `${oauth.oauthServerUrl}${oauth.registerPath}`,
    // Only honest to advertise now that access tokens are actually RS256 and the
    // public half is served. While they were HS256 this line would have sent a
    // client to fetch a key that could not verify anything it was given.
    jwks_uri: `${oauth.oauthServerUrl}${jwt.jwksPath}`,
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
  const client = await registerClient(req.body as RegisterClientInput);

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
    const authSession = await resolveSession(req);

    if (!authSession) {
      // Held server-side because the form cannot carry the request: nothing about
      // the client, the scopes or the redirect URI travels through the browser,
      // so nothing about it can be tampered with between here and the POST.
      const ticket = await createPendingAuthorizationRequest({
        ...oAuthRequest,
        authSession: null,
      });

      sendLoginPage(res, {
        clientName: oAuthRequest.client.clientName,
        redirectUri: oAuthRequest.redirectUri,
        ticket,
      });
      return;
    }

    const decision = await resolveGrant({
      userId: authSession.userId,
      clientId: oAuthRequest.client.id,
      requestedScopes: oAuthRequest.scopes,
    });

    if (!decision.needsConsent) {
      const code = await completeAuthorization({
        userId: authSession.userId,
        clientId: oAuthRequest.client.id,
        redirectUri: oAuthRequest.redirectUri,
        scopes: oAuthRequest.scopes,
        codeChallenge: oAuthRequest.codeChallenge,
        codeChallengeMethod: oAuthRequest.codeChallengeMethod,
        resource: oAuthRequest.resource,
      });

      redirectWithAuthorizationCode(res, oAuthRequest.redirectUri, {
        state: oAuthRequest.state,
        code,
      });
      return;
    }

    const ticket = await createPendingAuthorizationRequest({
      ...oAuthRequest,
      authSession: authSession,
    });

    await sendConsentPage(res, {
      userId: authSession.userId,
      clientName: oAuthRequest.client.clientName,
      redirectUri: oAuthRequest.redirectUri,
      scopes: oAuthRequest.scopes,
      ticket,
    });
    return;
  } catch (err) {
    // A redirect error is only thrown AFTER the redirect URI has been matched
    // against the client's registered list, so sending the user there is safe by
    // construction. input.redirect_uri is the verified value.
    if (err instanceof AuthorizeRedirectError) {
      redirectWithAuthorizationError(res, input.redirect_uri, {
        state: input.state ?? null,
        error: err.code,
        error_description: err.message,
      });

      return;
    }

    // The two errors that must NOT redirect. There is no URI here we have any
    // business sending a user to — an unregistered client, or one claiming a
    // callback it never registered — so the flow stops in a page a person reads.
    if (
      err instanceof UnknownClientError ||
      err instanceof InvalidRedirectUriError
    ) {
      sendMessage(res, "Cannot continue", err.message);
      return;
    }

    throw err;
  }
}

export async function postAuthorize(
  req: Request,
  res: Response,
): Promise<void> {
  const currentAuthSession = await resolveSession(req);
  const { ticket, decision, email, password, captchaToken } =
    req.body as Record<string, string | undefined>;

  // No ticket and no pending record means there is no verified redirect URI to
  // hand back to, so both of these are dead ends by necessity rather than choice.
  if (!ticket) {
    sendMessage(
      res,
      "Something went wrong",
      "The form was submitted without its token. Start again from the app.",
    );
    return;
  }

  const pending = await readPendingAuthorizationRequest(ticket);
  if (!pending) {
    sendMessage(
      res,
      "This request expired",
      "Authorization requests are short-lived. Start again from the app.",
    );
    return;
  }

  // ── login stage ───────────────────────────────────────────────────────────
  if (pending.authSession === null) {
    // Held in a local rather than read back off `pending`: the property is typed
    // nullable and stays that way, so every later use would need an assertion to
    // silence it. Narrowing once here means the rest of the branch has a session
    // the compiler can see — and definite-assignment analysis proves it is set
    // before any read, since every path that fails to set it returns.
    let authSession: AuthSession;

    if (!email || !password) {
      sendLoginPage(res, {
        clientName: pending.client.clientName,
        redirectUri: pending.redirectUri,
        ticket,
        error: "Enter your email and password.",
      });
      return;
    }

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

      const signedIn = await verifySessionToken(credentials.accessToken);

      // The token was minted a moment ago by loginWithPassword, so null here is
      // not a sign-in failure — it means the session store lost the record
      // between issuing and reading it. Saying "sign in failed" would blame the
      // user for our problem, so this gets its own message.
      if (!signedIn) {
        sendMessage(
          res,
          "Something went wrong",
          "Your session could not be established. Start again from the app.",
        );
        return;
      }

      authSession = signedIn;
      pending.authSession = signedIn;
    } catch (err) {
      // Wrong credentials, lockout, an unverified email and a suspended account
      // all land here. The message is whatever the auth module already decided is
      // safe to show — which of those may be revealed is its call, not this
      // page's. Anything that is not an HttpError gets a generic line rather than
      // an internal message.
      sendLoginPage(res, {
        clientName: pending.client.clientName,
        redirectUri: pending.redirectUri,
        ticket,
        error: err instanceof HttpError ? err.message : "Sign in failed.",
      });
      return;
    }

    const decision = await resolveGrant({
      userId: authSession.userId,
      clientId: pending.client.id,
      requestedScopes: pending.scopes,
    });

    if (!decision.needsConsent) {
      // An earlier grant already covers everything asked for — no second screen.
      const consumed = await consumePendingAuthorizationRequest(ticket);
      if (!consumed) {
        sendMessage(res, "This request expired", "Start again from the app.");
        return;
      }

      const code = await completeAuthorization({
        userId: authSession.userId,
        clientId: consumed.client.id,
        redirectUri: consumed.redirectUri,
        scopes: consumed.scopes,
        codeChallenge: consumed.codeChallenge,
        codeChallengeMethod: consumed.codeChallengeMethod,
        resource: consumed.resource,
      });
      redirectWithAuthorizationCode(res, consumed.redirectUri, {
        state: consumed.state,
        code,
      });
      return;
    }

    // The session is written back so the consent POST knows who signed in — the
    // ticket is the only thing that survives the round trip.
    await updatePendingAuthorizationRequest(ticket, { ...pending });

    await sendConsentPage(res, {
      userId: authSession.userId,
      clientName: pending.client.clientName,
      redirectUri: pending.redirectUri,
      scopes: pending.scopes,
      ticket,
    });
    return;
  }

  // ── consent stage ─────────────────────────────────────────────────────────
  const consumed = await consumePendingAuthorizationRequest(ticket);
  if (!consumed) {
    sendMessage(res, "This request expired", "Start again from the app.");
    return;
  }

  // The browser signed in as somebody else between seeing the consent screen and
  // submitting it — a second tab, or a shared machine. Granting on the strength of
  // the ticket alone would attach the app to the wrong account, so the flow stops
  // rather than guessing which of the two the user meant.
  if (
    currentAuthSession &&
    currentAuthSession.userId !== consumed.authSession!.userId
  ) {
    sendMessage(
      res,
      "Account mismatch",
      "You signed in as a different account after this request began. Start again from the app.",
    );
    return;
  }

  if (decision !== "allow") {
    // Deny goes BACK to the client rather than to an error page: the redirect URI
    // is verified by now, and the app is entitled to know it was refused.

    redirectWithAuthorizationError(res, consumed.redirectUri, {
      state: consumed.state,
      error: "access_denied",
      error_description: "The user denied the request",
    });
    return;
  }

  const code = await completeAuthorization({
    userId: consumed.authSession!.userId,
    clientId: consumed.client.id,
    redirectUri: consumed.redirectUri,
    scopes: consumed.scopes,
    codeChallenge: consumed.codeChallenge,
    codeChallengeMethod: consumed.codeChallengeMethod,
    resource: consumed.resource,
  });
  redirectWithAuthorizationCode(res, consumed.redirectUri, {
    state: consumed.state,
    code,
  });
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
