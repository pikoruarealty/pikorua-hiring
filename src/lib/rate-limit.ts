import { redis } from "./redis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

/**
 * Fixed-window rate limiter backed by Redis. `key` should be namespaced by the
 * caller (e.g. `login:<ip>` or `exec:<userId>`). Allows up to `max` hits per
 * `windowSeconds`. Atomic via INCR; sets TTL on first hit of a window.
 */
export async function rateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, windowSeconds);
  }
  const ttl = await redis.ttl(redisKey);
  const resetSeconds = ttl >= 0 ? ttl : windowSeconds;
  return {
    allowed: count <= max,
    remaining: Math.max(0, max - count),
    resetSeconds,
  };
}
