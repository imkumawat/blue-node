import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import {
  isAccessTokenDenied,
  verifyGrantAccessToken,
} from "../modules/oauth/index.js";
import { HttpError } from "../shared/errors/HttpError.js";
import { ERROR_MESSAGES } from "../shared/constants/errors.js";
import { getEnvConfig } from "../config/env.js";

/**
 * Bearer auth for the MCP endpoint.
 *
 * Mirrors shared/middlewares/authenticateMobile.ts — same Bearer extraction, same
 * next(err) hand-off — with one addition the whole connector flow rests on: every
 * 401 carries a WWW-Authenticate header pointing at this server's
 * protected-resource document. That header is how a client holding no token
 * discovers which authorization server to talk to (RFC 9728). Without it an MCP
 * client cannot begin the OAuth flow at all; it just sees a dead 401.
 *
 * Lives in mcp/ rather than shared/middlewares/ because exactly one route mounts
 * it — shared/ is for guards several modules reuse.
 *
 * Bearer only, no cookie fallback. A browser attaches cookies to cross-site
 * requests automatically, which is the same class of hole the WS layer needed an
 * Origin check to close. An MCP client always sends an explicit header.
 */
export function authenticateMcp(): RequestHandler {
  // Read and validate once at construction (buildApp), not per request. Failing
  // here is deliberate: without a resource id there is nothing to validate `aud`
  // against, and silently skipping that check is the bug this whole file exists
  // to prevent.
  const { mcp, apiBaseUrl } = getEnvConfig();

  const resourceUri = mcp.resourceUri;
  const metadataUrl = `${apiBaseUrl}${mcp.wellKnownPath}`;

  return async (req, res, next) => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

      if (!token) {
        // No token sent: challenge WITHOUT an error code. RFC 6750 reserves
        // error="invalid_token" for a token that was sent and rejected, and
        // clients read the difference as "authenticate" vs "my token went stale".
        res.set("WWW-Authenticate", challenge(metadataUrl, false));
        return next(
          new HttpError(
            "TOKEN_MISSING",
            StatusCodes.UNAUTHORIZED,
            ERROR_MESSAGES.TOKEN_MISSING,
          ),
        );
      }

      // Audience is the MCP resource id, NOT a portal audience. This is the RFC
      // 8707 binding: a token minted for a different resource must be rejected
      // here even when it is otherwise valid and unexpired.
      //
      // A result rather than a throw, so the reasons a token can fail — expired,
      // wrong signature, unknown key, wrong audience — all land in one branch.
      // The answer is the same 401 for every one of them; telling them apart in
      // the response would only help someone probing.
      const verified = await verifyGrantAccessToken(token, resourceUri);

      if (!verified.ok) {
        res.set("WWW-Authenticate", challenge(metadataUrl, true));
        return next(
          new HttpError(
            "INVALID_TOKEN",
            StatusCodes.UNAUTHORIZED,
            ERROR_MESSAGES.INVALID_TOKEN,
          ),
        );
      }

      // A signature only proves the token was minted by us; it says nothing about
      // whether it should still be honoured. Two things can retire one early —
      // its pair rotated away, or the user disconnected the app — and both are
      // answered in a single round trip here.
      const denied = await isAccessTokenDenied(
        verified.claims.jti,
        verified.claims.grantId,
      );

      if (denied) {
        res.set("WWW-Authenticate", challenge(metadataUrl, true));
        return next(
          new HttpError(
            "TOKEN_REVOKED",
            StatusCodes.UNAUTHORIZED,
            ERROR_MESSAGES.TOKEN_REVOKED,
          ),
        );
      }

      req.grant = verified.claims;
      next();
    } catch (err) {
      // Reached only by an infrastructure failure — the Redis lookup above, or a
      // key store that cannot answer. Deliberately WITHOUT the challenge header:
      // a 500 is not an invitation to re-authenticate, and dressing it up as one
      // sends the client into a pointless OAuth loop.
      next(err);
    }
  };
}

function challenge(metadataUrl: string, tokenWasRejected: boolean): string {
  const parts = [`Bearer resource_metadata="${metadataUrl}"`];
  if (tokenWasRejected) parts.push(`error="invalid_token"`);
  return parts.join(", ");
}
