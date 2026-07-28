import { StatusCodes } from "http-status-codes";
import { HttpError } from "../../shared/errors/HttpError.js";

/**
 * OAuth error codes are a wire format — lowercase snake_case, defined by the
 * RFCs and branched on by clients. They deliberately do not follow this
 * codebase's SCREAMING_CASE convention, because the value goes out to a
 * third-party client that is matching against the spec, not against us.
 */

/** RFC 7591 §3.2.2 */
export class InvalidRedirectUriError extends HttpError {
  constructor(message = "redirect_uris must be HTTPS or a loopback address") {
    super("invalid_redirect_uri", StatusCodes.BAD_REQUEST, message);
  }
}

/** RFC 7591 §3.2.2 */
export class InvalidClientMetadataError extends HttpError {
  constructor(message = "Invalid client metadata") {
    super("invalid_client_metadata", StatusCodes.BAD_REQUEST, message);
  }
}

/** RFC 6749 §5.2 — used by /authorize and /token for an unrecognised client. */
export class UnknownClientError extends HttpError {
  constructor() {
    super("invalid_client", StatusCodes.BAD_REQUEST, "Unknown client");
  }
}

/**
 * An /authorize failure that must be reported by REDIRECTING back to the client
 * with `error` and `error_description`, rather than rendered to the user.
 *
 * The split matters. A bad client_id or a redirect_uri that isn't registered are
 * the two errors that must NOT redirect: the whole point of the check is that we
 * don't trust that URI, so bouncing the user there would hand an attacker both a
 * redirect and a signal. Everything else — unsupported response_type, bad PKCE
 * method, unknown scope, wrong resource — goes back to the (verified) redirect
 * URI, which is what lets a client show a sensible message.
 *
 * `statusCode` is only a fallback for the case where one of these ever escapes
 * to the global error handler; on the normal path the handler turns it into a
 * 302 and the status is never used.
 */
export class AuthorizeRedirectError extends HttpError {
  constructor(code: string, description: string) {
    super(code, StatusCodes.BAD_REQUEST, description);
  }
}

/**
 * A /token failure. Rendered as the RFC 6749 §5.2 JSON body
 * ({ error, error_description }), not this codebase's standard envelope — OAuth
 * clients parse the spec shape.
 */
export class TokenRequestError extends HttpError {
  constructor(code: string, description: string) {
    super(code, StatusCodes.BAD_REQUEST, description);
  }
}
