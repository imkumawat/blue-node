import { getRedis } from "../../lib/cache/redis/client.js";

/**
 * How long to tell an over-limit caller to wait.
 *
 * Shared by @rateLimit and @authRateLimit because both reach this point having
 * already decided to refuse the request — all that is left is the number.
 *
 * That ordering is why the store read is guarded. The refusal is settled; a Redis
 * failure while fetching the TTL must not be allowed to escape and turn a correct
 * 429 into a 500, which would both lose the reason and hand the caller a status
 * that invites an immediate retry. The window length is a sound upper bound: a
 * counter's TTL can never exceed the window it was created with, so the caller is
 * asked to wait at most slightly too long, never too little.
 */
export async function retryAfter(
  key: string,
  windowSec: number,
): Promise<number> {
  try {
    const ttl = await getRedis().ttl(key);
    return ttl > 0 ? ttl : windowSec;
  } catch {
    return windowSec;
  }
}
