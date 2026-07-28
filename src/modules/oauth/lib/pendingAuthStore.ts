import { getRedis } from "../../../lib/cache/redis/client.js";
import { getEnvConfig } from "../../../config/env.js";
import { randomToken, sha256 } from "../../../shared/utils/crypto.js";
import type { Scope } from "../../../shared/constants/scopes.js";

/**
 * An /authorize request held between the GET that rendered a page and the POST
 * that acts on it.
 *
 * This is what makes the POST trustworthy. Without it the form would have to
 * carry the OAuth parameters in hidden fields, and a malicious page could then
 * (a) submit it on a logged-in victim's behalf — classic CSRF, silently creating
 * a grant — or (b) submit DIFFERENT scopes from the ones the consent screen
 * actually showed. The ticket is the only thing the form carries; every
 * parameter is read back from here, never from the request.
 */
export interface PendingAuthorization {
  clientId: string;
  clientName: string;
  redirectUri: string;
  scopes: Scope[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  state: string | null;
  /** null until the login step completes — this is what marks the stage. */
  userId: string | null;
  userEmail: string | null;
}

function key(ticket: string): string {
  const { redis } = getEnvConfig();
  return `${redis.keys.oauthPending}${sha256(ticket)}`;
}

function parse(raw: string | null): PendingAuthorization | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingAuthorization;
  } catch {
    // Our own value, so a parse failure is corruption rather than an attack.
    return null;
  }
}

/** Returns the plaintext ticket; only its hash is stored. */
export async function createPending(
  pending: PendingAuthorization,
): Promise<string> {
  const { oauth } = getEnvConfig();
  const ticket = randomToken(32);

  await getRedis().set(
    key(ticket),
    JSON.stringify(pending),
    "EX",
    oauth.pendingAuthTtlSec,
  );

  return ticket;
}

/** Non-destructive — used to render a page without spending the ticket. */
export async function readPending(
  ticket: string,
): Promise<PendingAuthorization | null> {
  return parse(await getRedis().get(key(ticket)));
}

/**
 * Records who logged in, so consent can be re-rendered with the SAME ticket.
 *
 * `scopes` is rewritten, not just the user: until login the record holds the
 * scopes the client REQUESTED, because there was no user to narrow them against.
 * Once there is, it must hold the ones actually grantable — otherwise the consent
 * screen shows one set and the grant records another, and a user could be made to
 * delegate a permission they do not hold.
 *
 * KEEPTTL matters: without it this write would reset the expiry, and repeatedly
 * submitting the login form would keep a pending authorization alive forever.
 * The original deadline stands regardless of how many times this runs.
 */
export async function attachUser(
  ticket: string,
  userId: string,
  userEmail: string,
  scopes: Scope[],
): Promise<PendingAuthorization | null> {
  const pending = await readPending(ticket);
  if (!pending) return null;

  const updated: PendingAuthorization = {
    ...pending,
    userId,
    userEmail,
    scopes,
  };
  await getRedis().set(key(ticket), JSON.stringify(updated), "KEEPTTL");
  return updated;
}

/**
 * Reads and destroys in one atomic step, at the final decision.
 *
 * Single use is what stops an Allow from being replayed into a second
 * authorization code — the same reasoning as the authorization code itself.
 */
export async function consumePending(
  ticket: string,
): Promise<PendingAuthorization | null> {
  return parse(await getRedis().getdel(key(ticket)));
}
