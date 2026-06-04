import crypto from "node:crypto";

/**
 * SHA-256 hex digest of a string.
 * Use for: hashing API keys before Redis storage, content hashing, etc.
 */
export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * HMAC-SHA256 hex digest. Use for: webhook signatures, signed URLs, CSRF tokens.
 */
export function hmacSha256(secret: string, message: string): string {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * Cryptographically-random URL-safe string.
 * Use for: API keys, invite codes, password reset tokens, idempotency keys.
 */
export function randomToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Cryptographically-random N-digit numeric code (zero-padded) — for email
 * verification / OTP codes. Uses crypto.randomInt (unbiased), never Math.random.
 * padStart keeps leading-zero codes (e.g. "000042") a valid N digits.
 */
export function randomNumericCode(digits: number = 6): string {
  const max = 10 ** digits;
  return crypto.randomInt(0, max).toString().padStart(digits, "0");
}

/**
 * Constant-time string compare — prevents timing attacks when comparing
 * secrets/tokens. ALWAYS use this for token equality, never `===`.
 *
 * For HMAC hex signatures pass "hex"; for base64-encoded tokens pass "base64".
 * Explicit encoding decodes to a smaller buffer and documents intent.
 *
 * Returns false on length mismatch (also constant-time at API level).
 * Length comparison happens at BYTE level so multi-byte UTF-8 chars are safe.
 */
export function constantTimeEqual(
  a: string,
  b: string,
  encoding: BufferEncoding = "utf8",
): boolean {
  const bufA = Buffer.from(a, encoding);
  const bufB = Buffer.from(b, encoding);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify an HMAC-SHA256 signature in constant time.
 * Use for: incoming webhook verification (Shopify, Stripe, GitHub),
 * signed cookie verification, link-token verification.
 *
 *   const ok = verifyHmac(SHOPIFY_SECRET, sortedQueryString, receivedSignature);
 *   if (!ok) return res.status(401).json({ error: "Invalid signature" });
 *
 * Returns false (never throws) on length mismatch or invalid signature.
 * Always uses hex encoding because `hmacSha256` produces hex output.
 */
export function verifyHmac(
  secret: string,
  message: string,
  signature: string,
): boolean {
  const expected = hmacSha256(secret, message);
  return constantTimeEqual(expected, signature, "hex");
}
