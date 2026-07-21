import Redis from "ioredis";
import { env } from "./env";

/**
 * Shared ioredis connection singleton for rate limiting and (later) SSE pub/sub.
 * BullMQ requires its own connections with `maxRetriesPerRequest: null`, so the
 * queue module creates dedicated connections rather than reusing this one.
 */
const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
