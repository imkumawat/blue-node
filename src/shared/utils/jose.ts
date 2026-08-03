import {
  SignJWT,
  jwtVerify,
  importJWK,
  calculateJwkThumbprint,
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
} from "jose";
import type { JWK, JWTPayload, JSONWebKeySet } from "jose";

/**
 * Every JWT this service signs or verifies goes through here.
 *
 * Opaque first-party session tokens are NOT this module's business — those live
 * in the auth module's token store. This is for tokens a DIFFERENT party has to
 * verify: OAuth/MCP access tokens, service-to-service tokens, anything published
 * against our JWKS. That single fact drives the whole design — asymmetric keys,
 * a `kid` on every header, and a JWKS document we can serve.
 *
 * Configuration is passed in rather than read from getEnvConfig() here, so the
 * module stays a pure utility: a test can initialise it with a throwaway
 * generated key and never touch the app config.
 */

/**
 * Signing algorithms we allow. Asymmetric only: a shared secret cannot be handed
 * to a third-party verifier, which is the entire reason this module exists.
 */
export type SigningAlgorithm = "RS256" | "PS256" | "ES256" | "ES384" | "EdDSA";

/**
 * JWK members that must never leave this process. Stripped before a key is
 * published in the JWKS or used to derive a `kid`.
 */
const PRIVATE_JWK_MEMBERS = [
  "d",
  "p",
  "q",
  "dp",
  "dq",
  "qi",
  "k",
  "oth",
] as const satisfies readonly (keyof JWK)[];

/**
 * The key type importJWK hands back, derived from the function itself rather
 * than named directly: jose models keys as Web Crypto values, and deriving the
 * type means this never drifts from whatever the installed version returns.
 * Uint8Array is excluded because that is the symmetric case, rejected below.
 */
type AsymmetricKey = Exclude<Awaited<ReturnType<typeof importJWK>>, Uint8Array>;

interface LoadedKey {
  kid: string;
  alg: SigningAlgorithm;
  /** Present only on keys we can still sign with. Retired keys are verify-only. */
  privateKey?: AsymmetricKey;
  publicJwk: JWK;
}

let loadedKeys: LoadedKey[] | undefined;
let localJwks: ReturnType<typeof createLocalJWKSet> | undefined;

/**
 * Remote JWKS sets, memoised per URI. createRemoteJWKSet owns its own fetch
 * cache and cooldown, so building a new one per request would throw that away
 * and hit the network on every single verification.
 */
const remoteJwksByUri = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

function toPublicJwk(jwk: JWK): JWK {
  const publicJwk: JWK = { ...jwk };

  for (const member of PRIVATE_JWK_MEMBERS) {
    delete publicJwk[member];
  }

  return publicJwk;
}

function publicJwkSetFrom(keys: LoadedKey[]): JSONWebKeySet {
  return { keys: keys.map((key) => key.publicJwk) };
}

/**
 * Loads the signing keys. Call once during boot, before anything signs.
 *
 * The FIRST key in the array is the active signer; the rest are kept only so
 * tokens signed before the last rotation still verify. That ordering is the
 * whole rotation mechanism: prepend the new key, deploy, and once every token
 * signed by the old one has expired, drop it from the array.
 */
export async function initJoseKeys(
  privateJwks: JWK[],
  alg: SigningAlgorithm,
): Promise<void> {
  if (privateJwks.length === 0) {
    throw new Error("initJoseKeys: at least one signing key is required");
  }

  const keys: LoadedKey[] = [];

  for (const jwk of privateJwks) {
    const imported = await importJWK(jwk, alg);

    // importJWK returns a Uint8Array for symmetric keys. Reaching that branch
    // means an oct/HMAC key was configured — reject it loudly rather than sign
    // with a secret we would then have to hand to every verifier.
    if (imported instanceof Uint8Array) {
      throw new Error(
        "initJoseKeys: symmetric keys are not supported — configure an asymmetric JWK",
      );
    }

    const publicJwk = toPublicJwk(jwk);
    const kid = jwk.kid ?? (await calculateJwkThumbprint(publicJwk));

    keys.push({
      kid,
      alg,
      privateKey: imported,
      publicJwk: { ...publicJwk, kid, alg, use: "sig" },
    });
  }

  loadedKeys = keys;
  localJwks = createLocalJWKSet(publicJwkSetFrom(keys));
}

/** Drops the loaded keys. Exists so tests can re-initialise with another set. */
export function resetJoseKeys(): void {
  loadedKeys = undefined;
  localJwks = undefined;
}

function getKeys(): LoadedKey[] {
  if (!loadedKeys) {
    throw new Error("jose keys not initialized. Call initJoseKeys() first.");
  }

  return loadedKeys;
}

/**
 * The key we currently sign with. initJoseKeys rejects an empty array, so the
 * guard here is only there because the compiler cannot carry that guarantee
 * across the module boundary under noUncheckedIndexedAccess.
 */
function getActiveKey(): LoadedKey {
  const [activeKey] = getKeys();

  if (!activeKey) {
    throw new Error("jose: no signing key loaded");
  }

  return activeKey;
}

/** The document served at /.well-known/jwks.json. Public members only. */
export function getPublicJwks(): JSONWebKeySet {
  return publicJwkSetFrom(getKeys());
}

/** `kid` of the key currently signing. Useful for logging and for tests. */
export function getActiveKid(): string {
  return getActiveKey().kid;
}

export interface SignJwtInput {
  /** Claims beyond the registered ones set below (scope, gid, client_id, ...). */
  claims?: JWTPayload;
  issuer: string;
  audience: string | string[];
  subject: string;
  /** Seconds. Deliberately not jose's "15m" string form — see expiresAt below. */
  expiresInSec: number;
  jti: string;
  /**
   * RFC 9068 wants "at+jwt" on OAuth access tokens so a JWT meant as an access
   * token can never be mistaken for an id_token. Caller decides.
   */
  typ?: string;
  notBeforeSec?: number;
}

export interface SignedJwt {
  token: string;
  jti: string;
  kid: string;
  expiresAt: Date;
}

/**
 * Signs with the active key and stamps its `kid` into the header — without it a
 * verifier has no way to pick the right key out of the JWKS during a rotation.
 *
 * `exp` is computed here as an explicit epoch second rather than handed to jose
 * as a duration string, so the `expiresAt` we return to the caller is the exact
 * same instant that is inside the token. Callers persist that value, and a
 * one-second disagreement between the row and the claim is a debugging tarpit.
 */
export async function signJwt(input: SignJwtInput): Promise<SignedJwt> {
  const activeKey = getActiveKey();

  if (!activeKey.privateKey) {
    throw new Error("signJwt: the active key has no private half");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + input.expiresInSec;

  const signer = new SignJWT(input.claims ?? {})
    .setProtectedHeader({
      alg: activeKey.alg,
      kid: activeKey.kid,
      ...(input.typ ? { typ: input.typ } : {}),
    })
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setSubject(input.subject)
    .setJti(input.jti)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec);

  if (input.notBeforeSec !== undefined) {
    signer.setNotBefore(nowSec + input.notBeforeSec);
  }

  return {
    token: await signer.sign(activeKey.privateKey),
    jti: input.jti,
    kid: activeKey.kid,
    expiresAt: new Date(expSec * 1000),
  };
}

export interface VerifyJwtOptions {
  issuer: string | string[];
  audience: string | string[];
  /**
   * Enforce the header `typ` — pass "at+jwt" to reject an id_token replayed as
   * an access token.
   */
  typ?: string;
  subject?: string;
  requiredClaims?: string[];
  /** Seconds of clock skew tolerated. Real fleets drift; 0 causes flaky 401s. */
  clockToleranceSec?: number;
}

export interface VerifiedJwt<T extends JWTPayload = JWTPayload> {
  payload: T;
  kid?: string;
}

const DEFAULT_CLOCK_TOLERANCE_SEC = 5;

/**
 * Verifies a token WE issued. The local JWKS resolves the key by the header's
 * `kid`, so rotation needs no change here.
 *
 * `algorithms` is pinned on purpose and is not caller-configurable: leaving it
 * open is the alg-confusion hole, where an attacker re-signs with an algorithm
 * the verifier will still accept. The allowed set is exactly the one we sign with.
 */
export async function verifyJwt<T extends JWTPayload = JWTPayload>(
  token: string,
  options: VerifyJwtOptions,
): Promise<VerifiedJwt<T>> {
  if (!localJwks) {
    throw new Error("jose keys not initialized. Call initJoseKeys() first.");
  }

  const algorithms = [...new Set(getKeys().map((key) => key.alg))];

  const { payload, protectedHeader } = await jwtVerify<T>(token, localJwks, {
    algorithms,
    issuer: options.issuer,
    audience: options.audience,
    subject: options.subject,
    typ: options.typ,
    requiredClaims: options.requiredClaims,
    clockTolerance: options.clockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC,
  });

  return { payload, kid: protectedHeader.kid };
}

export interface VerifyRemoteJwtOptions extends VerifyJwtOptions {
  /** The issuer's published JWKS endpoint. */
  jwksUri: string;
  /** Must be stated explicitly — we are not the ones who chose their algorithm. */
  algorithms: SigningAlgorithm[];
}

/**
 * Verifies a token issued by SOMEBODY ELSE, against their published JWKS.
 *
 * The remote set is cached per URI because it carries jose's fetch cooldown and
 * max-age; a fresh one per call would re-fetch the JWKS on every request and
 * hand a third party a trivial way to rate-limit us.
 *
 * This is the one function here that performs network I/O.
 */
export async function verifyRemoteJwt<T extends JWTPayload = JWTPayload>(
  token: string,
  options: VerifyRemoteJwtOptions,
): Promise<VerifiedJwt<T>> {
  let remoteSet = remoteJwksByUri.get(options.jwksUri);

  if (!remoteSet) {
    remoteSet = createRemoteJWKSet(new URL(options.jwksUri));
    remoteJwksByUri.set(options.jwksUri, remoteSet);
  }

  const { payload, protectedHeader } = await jwtVerify<T>(token, remoteSet, {
    algorithms: options.algorithms,
    issuer: options.issuer,
    audience: options.audience,
    subject: options.subject,
    typ: options.typ,
    requiredClaims: options.requiredClaims,
    clockTolerance: options.clockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC,
  });

  return { payload, kid: protectedHeader.kid };
}

export type JwtFailure =
  | "expired"
  | "bad_signature"
  | "claim_mismatch"
  | "unknown_key"
  | "malformed"
  | "unknown";

/**
 * Normalises a jose failure into something a caller can map to its own error class.
 *
 * This module deliberately does not throw HttpErrors: it is a shared utility, and
 * reaching into a module's error classes would invert the dependency. Callers map
 * the returned value to whatever their layer uses.
 *
 * Matching on `code` rather than `instanceof` survives duplicate copies of jose in
 * the tree, and beats `err.name` matching, which is what made the old jsonwebtoken
 * error handling brittle.
 */
export function classifyJwtError(err: unknown): JwtFailure {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: unknown }).code
      : undefined;

  switch (code) {
    case "ERR_JWT_EXPIRED":
      return "expired";

    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
    case "ERR_JOSE_ALG_NOT_ALLOWED":
      return "bad_signature";

    case "ERR_JWT_CLAIM_VALIDATION_FAILED":
      return "claim_mismatch";

    case "ERR_JWKS_NO_MATCHING_KEY":
    case "ERR_JWKS_MULTIPLE_MATCHING_KEYS":
    case "ERR_JWKS_TIMEOUT":
      return "unknown_key";

    case "ERR_JWT_INVALID":
    case "ERR_JWS_INVALID":
      return "malformed";

    default:
      return "unknown";
  }
}

/**
 * Reads claims WITHOUT verifying. Only for logging, or for reading `kid`/`iss`
 * to decide which verifier to use — never for an authorization decision.
 */
export { decodeJwt, decodeProtectedHeader };
