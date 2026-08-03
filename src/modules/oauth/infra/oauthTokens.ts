import { generateId } from "../../../utils/generateId.js";
import type { JWTPayload } from "jose";

import { getEnvConfig } from "../../../config/env.js";
import { hmacSha256, randomToken } from "../../../shared/utils/crypto.js";
import {
  classifyJwtError,
  signJwt,
  verifyJwt,
} from "../../../shared/utils/jose.js";
import type { JwtFailure } from "../../../shared/utils/jose.js";

/**
 * The two credentials an OAuth client holds, and nothing else.
 *
 * Both formats live here on purpose, because the one decision worth seeing is
 * WHY they differ:
 *
 *   access   JWT      a resource server verifies it from our JWKS without
 *                     reaching our datastore. That is the only thing a JWT buys
 *                     and it is exactly this case.
 *   refresh  opaque   only ever comes back to our own /token endpoint, and the
 *                     row has to be read anyway to rotate it — so claims would
 *                     be a second copy of the row, and a signature would buy
 *                     nothing a lookup does not.
 *
 * No I/O here beyond jose's already-loaded keys: shaping and signing only. The
 * rows live in oauthGrantSessionQueries.
 */

/* ────────────────────────────────────────────────────────────────────────────
   OPAQUE · refresh token

   nf_grt_<grantSessionId>.<secret>

   The id is the PUBLIC routing component and the secret is the only part that
   proves anything. Reading the id before any lookup is the whole point: the
   redemption becomes a primary-key read, and that ONE read can say whether the
   presented secret is the live one, the spent one, or neither. Keying by a hash
   of the whole token reads just as well until the reuse check, which then needs
   a second query against a second index.
   ──────────────────────────────────────────────────────────────────────────── */

export interface MintedRefreshToken {
  /** Handed to the client. Exists in plaintext here and nowhere else. */
  token: string;
  /** Also the id of the row this token belongs to. */
  grantSessionId: string;
  /** What gets stored. */
  tokenHash: string;
}

export function mintRefreshToken(): MintedRefreshToken {
  const { oauth } = getEnvConfig();

  const grantSessionId = generateId();
  const token = `${oauth.refreshPrefix}${grantSessionId}.${randomToken(SECRET_BYTES)}`;

  return { token, grantSessionId, tokenHash: hashRefreshToken(token) };
}

/** Same width the first-party tokens use. */
const SECRET_BYTES = 32;

/**
 * Mints the replacement during a rotation.
 *
 * Separate from mintRefreshToken because the id must NOT change: the row is the
 * connection, and the client keeps talking to the same one across rotations.
 */
export function mintRotatedRefreshToken(grantSessionId: string): {
  token: string;
  tokenHash: string;
} {
  const { oauth } = getEnvConfig();
  const token = `${oauth.refreshPrefix}${grantSessionId}.${randomToken(SECRET_BYTES)}`;

  return { token, tokenHash: hashRefreshToken(token) };
}

/**
 * HMAC rather than a bare sha256, so the pepper — which lives in config and is
 * never written to the database — is also needed to test a guess offline. A
 * deliberately slow hash would be wrong here: there is nothing to brute-force
 * behind 256 bits of entropy, and it would cost milliseconds on every refresh.
 */
export function hashRefreshToken(token: string): string {
  return hmacSha256(getEnvConfig().tokens.pepper, token);
}

/**
 * Splits a presented refresh token WITHOUT touching the database.
 *
 * indexOf rather than split("."): a token carrying extra dots is malformed and
 * has to be rejected as such, not quietly parsed into whichever two segments
 * happen to come first.
 *
 * Returns null on anything that is not our shape — including a first-party
 * refresh token, which carries a different prefix. Two families that look alike
 * would otherwise be told apart only by a lookup coming back empty.
 */
export function parseRefreshToken(token: string): {
  grantSessionId: string;
} | null {
  const { oauth } = getEnvConfig();
  if (!token.startsWith(oauth.refreshPrefix)) return null;

  const body = token.slice(oauth.refreshPrefix.length);
  const dot = body.indexOf(".");
  if (dot <= 0 || dot === body.length - 1) return null;

  const secret = body.slice(dot + 1);
  if (secret.includes(".")) return null;

  return { grantSessionId: body.slice(0, dot) };
}

/* ────────────────────────────────────────────────────────────────────────────
   JWT · access token
   ──────────────────────────────────────────────────────────────────────────── */

export interface SignGrantAccessTokenInput {
  userId: string;
  clientId: string;
  grantId: string;
  scopes: string[];
  /** RFC 8707 resource indicator — becomes `aud`. */
  audience: string;
}

export interface SignedGrantAccessToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

/**
 * Signs an access token for a grant.
 *
 * `iss` comes from oauth.oauthServerUrl — the same field the authorization
 * server metadata publishes as its issuer. RFC 8414 requires the two to be
 * identical, and reading both from one place is what makes a mismatch
 * impossible rather than merely unlikely.
 *
 * Three details are RFC 9068 requirements that are easy to miss:
 *   typ: "at+jwt"  a header type, so an id_token can never be replayed here
 *   client_id      required — says WHICH app is acting, which `sub` does not
 *   scope          a space-delimited STRING. An array is the natural JS shape
 *                  and the wrong wire shape
 *
 * No `sid`. That claim only ever keyed a WebSocket channel, and no OAuth client
 * uses that transport; the grant is the anchor for everything else, and minting
 * a fresh session id per refresh — which the old path did — made the claim
 * actively misleading.
 */
export async function signGrantAccessToken(
  input: SignGrantAccessTokenInput,
): Promise<SignedGrantAccessToken> {
  const { oauth } = getEnvConfig();
  const jti = generateId();

  const signed = await signJwt({
    issuer: oauth.oauthServerUrl,
    audience: input.audience,
    subject: input.userId,
    jti,
    expiresInSec: oauth.accessTokenTtlSec,
    typ: "at+jwt",
    claims: {
      client_id: input.clientId,
      scope: input.scopes.join(" "),
      // The revocation anchor. Deleting a grant kills its refresh tokens through
      // the FK cascade at once; an access token is a stateless JWT, and this
      // claim is what lets a still-unexpired one be rejected in the same instant.
      gid: input.grantId,
    },
  });

  return { token: signed.token, jti, expiresAt: signed.expiresAt };
}

export interface GrantAccessClaims {
  userId: string;
  clientId: string;
  grantId: string;
  scopes: string[];
  jti: string;
  /** Unix seconds, straight off the `exp` claim. */
  exp: number;
}

export type VerifiedGrantAccessToken =
  | { ok: true; claims: GrantAccessClaims }
  | { ok: false; reason: JwtFailure };

/**
 * Verifies an access token we signed.
 *
 * Returns a result rather than throwing: this layer reports what the token is,
 * and the caller — a transport that knows which status code and which
 * WWW-Authenticate challenge it owes — decides what that means. Reaching into a
 * module's error classes from here would invert the dependency.
 *
 * `audience` is a parameter, not read from config, because the caller is the
 * resource server and it is the one that knows which resource it IS. Hardcoding
 * ours would silently accept a token minted for a different resource the day a
 * second one exists — the confused-deputy problem RFC 8707 exists to stop.
 */
export async function verifyGrantAccessToken(
  token: string,
  audience: string,
): Promise<VerifiedGrantAccessToken> {
  const { oauth, jwt } = getEnvConfig();

  try {
    const { payload } = await verifyJwt(token, {
      issuer: oauth.oauthServerUrl,
      audience,
      typ: "at+jwt",
      requiredClaims: ["sub", "jti", "exp", "client_id", "scope", "gid"],
      clockToleranceSec: jwt.clockToleranceSec,
    });

    const claims = readClaims(payload);

    // Signature and registered claims were fine, but a custom claim is not the
    // shape we sign. That is malformed, not merely unrecognised — and saying so
    // matters: this function's whole contract is to hand the caller a usable
    // reason, so one path collapsing into "unknown" would quietly undermine it
    // the day someone branches on it.
    if (!claims) return { ok: false, reason: "malformed" };

    return { ok: true, claims };
  } catch (err) {
    return { ok: false, reason: classifyJwtError(err) };
  }
}

/**
 * Reads the claims we sign, or null if any of them is not the shape we sign.
 *
 * Returns rather than throws, so the one function callers rely on to never throw
 * does not have control flow escaping through an exception it then has to catch
 * and misclassify.
 *
 * `requiredClaims` on the verify call proves a claim is PRESENT; it says nothing
 * about its type. A token whose client_id arrived as a number would otherwise
 * flow on as one.
 */
function readClaims(payload: JWTPayload): GrantAccessClaims | null {
  const userId = readString(payload, "sub");
  const clientId = readString(payload, "client_id");
  const grantId = readString(payload, "gid");
  const jti = readString(payload, "jti");
  const scope = readString(payload, "scope");

  if (!userId || !clientId || !grantId || !jti || !scope) return null;

  // jwtVerify rejects a token without exp and it is in requiredClaims, so this
  // holds in practice. The check is what narrows the type.
  if (typeof payload.exp !== "number") return null;

  return {
    userId,
    clientId,
    grantId,
    jti,
    scopes: scope.split(" ").filter(Boolean),
    exp: payload.exp,
  };
}

function readString(payload: JWTPayload, name: string): string | null {
  const value = payload[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}
