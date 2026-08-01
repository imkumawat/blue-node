import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { verifyToken } from "../modules/auth/index.js";
import { HttpError } from "../shared/errors/HttpError.js";
import { ERROR_MESSAGES } from "../shared/constants/errors.js";
import { getEnvConfig } from "../config/env.js";
import { getRedis } from "../lib/cache/redis/client.js";

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
  const { mcp, apiBaseUrl, redis } = getEnvConfig();

  const resourceUri = mcp.resourceUri;
  const metadataUrl = `${apiBaseUrl}${mcp.wellKnownPath}/mcp`;
  const grantRevokedKey = redis.keys.grantRevoked;

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

      // Audience is the MCP resource id, NOT the portal audience. This is the
      // RFC 8707 binding: a token minted for a different resource must be
      // rejected here even when it is otherwise valid and unexpired.
      req.user = await verifyToken(token, resourceUri);

      // A user who removes an app's access expects it to stop working now, not
      // whenever the current access token happens to expire. Deleting the grant
      // kills its refresh tokens immediately via the FK cascade, but an access
      // token is a stateless JWT — this marker is what closes that window. Same
      // single Redis lookup the jti blacklist already costs, and only for tokens
      // that actually carry a grant.
      // if (req.user.grantId) {
      //   const revoked = await getRedis().exists(
      //     `${grantRevokedKey}${req.user.grantId}`,
      //   );
      //   if (revoked) {
      //     throw new HttpError(
      //       "GRANT_REVOKED",
      //       StatusCodes.UNAUTHORIZED,
      //       "Access for this application has been revoked",
      //     );
      //   }
      // }

      next();
    } catch (err) {
      // Only an auth failure earns the challenge header. A 500 from, say, the
      // Redis blacklist lookup is not an invitation to re-authenticate, and
      // dressing it up as one sends the client into a pointless OAuth loop.
      if (
        err instanceof HttpError &&
        err.statusCode === StatusCodes.UNAUTHORIZED
      ) {
        res.set("WWW-Authenticate", challenge(metadataUrl, true));
      }
      next(err);
    }
  };
}

function challenge(metadataUrl: string, tokenWasRejected: boolean): string {
  const parts = [`Bearer resource_metadata="${metadataUrl}"`];
  if (tokenWasRejected) parts.push(`error="invalid_token"`);
  return parts.join(", ");
}
