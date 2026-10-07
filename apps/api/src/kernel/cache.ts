import type { CacheService } from '@isbp/sdk/server';
import type { Redis } from 'ioredis';

const KEY_RE = /^[\w:.@/+=-]{1,400}$/;

function checkKey(key: string) {
  if (!KEY_RE.test(key)) throw new Error(`Invalid cache key: ${key.slice(0, 80)}`);
}

/** `ctx.cache`: JSON values in Redis under `isbp:m:<module>:`. */
export function createCacheService(redis: Redis, moduleId: string): CacheService {
  const prefix = `isbp:m:${moduleId}:`;
  return {
    async get<T>(key: string) {
      checkKey(key);
      const raw = await redis.get(prefix + key);
      return raw === null ? null : (JSON.parse(raw) as T);
    },
    async set(key, value, ttlSeconds) {
      checkKey(key);
      await redis.set(prefix + key, JSON.stringify(value), 'EX', Math.max(1, Math.ceil(ttlSeconds)));
    },
    async delete(key) {
      checkKey(key);
      await redis.del(prefix + key);
    },
    async increment(key, ttlSeconds) {
      checkKey(key);
      const k = prefix + key;
      const [[, n]] = (await redis.multi().incr(k).expire(k, Math.max(1, ttlSeconds), 'NX').exec()) as [
        [Error | null, number],
        [Error | null, number],
      ];
      return n;
    },
    async rateLimit(key, limit, windowSeconds) {
      checkKey(key);
      const window = Math.max(1, Math.floor(windowSeconds));
      const now = Math.floor(Date.now() / 1000);
      const start = now - (now % window);
      const k = `${prefix}rl:${key}:${start}`;
      const [[, n]] = (await redis
        .multi()
        .incr(k)
        .expire(k, window + 1, 'NX')
        .exec()) as [[Error | null, number], [Error | null, number]];
      return { allowed: n <= limit, remaining: Math.max(0, limit - n), resetSeconds: start + window - now };
    },
  };
}
