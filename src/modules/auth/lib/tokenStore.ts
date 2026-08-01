import { getRedis } from "../../../lib/cache/redis/client.js";
import { getEnvConfig } from "../../../config/env.js";
import {
  constantTimeEqual,
  hmacSha256,
  randomToken,
} from "../../../shared/utils/crypto.js";

/**
 * Every token this application mints, in one place.
 *
 * Two FORMATS live here, and the naming is the contract:
 *
 *   sign*   a JWT. Self-contained and tamper-evident — verification checks a
 *           signature, so nothing has to be looked up. Pure: no I/O.
 *   issue*  an opaque token. A random string with no signature and no claims;
 *           verification is a lookup, so the credential can be deleted. Always
 *           writes to a store.
 *
 * Which one a caller reaches for is decided by WHO VERIFIES:
 *
 *   first-party portals  ->  issue*  (only this process ever verifies, and it is
 *                            already making a Redis round trip, so a signature
 *                            buys nothing a lookup does not)
 *   OAuth / MCP access   ->  sign*   (exists precisely so a resource server can
 *                            verify WITHOUT reaching our datastore — the one
 *                            case a JWT is actually for)
 *
 * Both formats live here on purpose. Splitting them into two files would put the
 * one decision that matters — which format a token should be — across a file
 * boundary, where a reader has to open both to see the choice.
 */

/* ────────────────────────────────────────────────────────────────────────────
   shared types
   ──────────────────────────────────────────────────────────────────────────── */

/** What a sign* function returns. Opaque issue* functions return a bare string. */
export interface IssuedToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

/* ────────────────────────────────────────────────────────────────────────────
   OPAQUE · access token

   nf_at_<sessionId>.<secret>

   The session id is the PUBLIC routing component (the same idea as the team id
   inside a Slack xoxb- token); the secret is the only part that proves anything.
   Reading that id BEFORE any lookup is the whole design: it lets the Redis key BE
   the session id, so "sign this device out" addresses one key directly. Keying by
   a hash of the token instead reads just as well — right up until revoke-all,
   where all we hold is a list of session ids, and a key derived from a token we
   never kept is unreachable.
   ──────────────────────────────────────────────────────────────────────────── */

export interface AccessTokenRecord {
  userId: string;
  sessionId: string;
  // No audience: there is exactly one recipient for a first-party token — this
  // API — so naming it would add a field nobody can act on. `aud` stays a JWT
  // concept, used where it is actually load-bearing: the MCP resource indicator
  // (RFC 8707), which stops a token minted for our MCP endpoint being accepted
  // by a different resource server.
  scopes: string[];
  /**
   * Unix seconds, mirroring the Redis TTL. Present only because callers still
   * need an expiry to read — the WS layer closes sockets whose token has aged
   * out — and an opaque token has no `exp` claim to hand them.
   */
  exp: number;
}

/** What is actually stored: the record plus the proof. */
interface StoredAccessRecord extends AccessTokenRecord {
  tokenHash: string;
}

function accessKeyFor(sessionId: string): string {
  return `${getEnvConfig().redis.keys.accessToken}${sessionId}`;
}

/**
 * Splits a presented token WITHOUT touching Redis.
 *
 * indexOf rather than split("."): a token with extra dots is malformed and has
 * to be rejected as such, not quietly parsed into whichever two segments happen
 * to come first.
 */
function parseAccessToken(
  token: string,
): { sessionId: string; secret: string } | null {
  const { accessPrefix } = getEnvConfig().tokens;
  if (!token.startsWith(accessPrefix)) return null;

  const body = token.slice(accessPrefix.length);
  const dot = body.indexOf(".");
  if (dot <= 0 || dot === body.length - 1) return null;

  const secret = body.slice(dot + 1);
  if (secret.includes(".")) return null;

  return { sessionId: body.slice(0, dot), secret };
}

/**
 * Mints an access token for a session and writes its record.
 *
 * One live access token per session, by construction — this overwrites. That
 * matches what the codebase already does, since rotation retires the access
 * token paired with the spent refresh token, so a rotated-away credential stops
 * working at once instead of lingering to its expiry.
 */
export async function issueAccessToken(
  record: AccessTokenRecord,
): Promise<string> {
  const { tokens } = getEnvConfig();
  const token = `${tokens.accessPrefix}${record.sessionId}.${randomToken(32)}`;

  // Only the HMAC is stored. A Redis dump then yields session ids (not secret)
  // and digests (not usable). HMAC rather than a bare sha256 so the pepper —
  // which lives in config, never in Redis — is also needed to verify a guess
  // offline.
  //
  // A deliberately slow hash would be wrong here: unlike a password there is
  // nothing to brute-force behind 256 bits of entropy, so argon2 would buy
  // nothing and cost milliseconds on every single request.
  const stored: StoredAccessRecord = {
    ...record,
    tokenHash: hmacSha256(tokens.pepper, token),
  };

  await getRedis().set(
    accessKeyFor(record.sessionId),
    JSON.stringify(stored),
    "EX",
    tokens.accessExpiry, // replaces the `exp` claim — Redis expires the record for us
  );

  return token; // the plaintext exists here and nowhere else
}

/**
 * Resolves a presented access token to its record, or null.
 *
 * `verify`, not `read`: the HMAC comparison below IS the authentication step, and
 * calling this a read invites someone to reach past it to the record directly.
 *
 * Returns null rather than throwing, unlike verifyJwtAccessToken — and the
 * asymmetry is deliberate. A JWT can tell expired from bad-signature from
 * revoked, and the API answers differently for each. Here all four failure modes
 * (malformed, unknown, expired, revoked) are the same observation: no usable
 * record. Redis simply has no key, and inventing a reason would be a lie.
 */
export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenRecord | null> {
  const parsed = parseAccessToken(token);
  if (!parsed) return null;

  const raw = await getRedis().get(accessKeyFor(parsed.sessionId));
  if (!raw) return null;

  let stored: StoredAccessRecord;
  try {
    stored = JSON.parse(raw) as StoredAccessRecord;
  } catch {
    // We wrote this value, so a parse failure is corruption rather than an
    // attack. Reject instead of throwing a 500 at the caller.
    return null;
  }

  const { tokens } = getEnvConfig();

  // The session id in the token is public, so holding it proves nothing. THIS is
  // the authentication step.
  //
  // Constant-time here is habit rather than load-bearing: leaking bytes of an
  // HMAC digest does not help forge a token, since that would need the digest
  // inverted. It costs nothing, and it keeps the comparison correct if this
  // record ever holds something that IS sensitive.
  const presented = hmacSha256(tokens.pepper, token);
  if (!constantTimeEqual(presented, stored.tokenHash, "hex")) return null;

  const { tokenHash: _proof, ...record } = stored;
  return record;
}

/** Revokes one device's access token. Idempotent — deleting an absent key is a no-op. */
export async function revokeAccessToken(sessionId: string): Promise<void> {
  await getRedis().del(accessKeyFor(sessionId));
}

/**
 * Revokes many devices' access tokens in one round trip.
 *
 * The empty guard is not defensive padding: DEL with no keys is a syntax error
 * rather than a no-op, so a user with no sessions would otherwise throw.
 */
export async function revokeAccessTokens(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await getRedis().del(...sessionIds.map(accessKeyFor));
}
