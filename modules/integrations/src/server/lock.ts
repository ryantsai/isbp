import { type CacheService, ErrorCodes, HttpError } from '@isbp/sdk/server';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A short Redis mutex (per linked record): pulls, pushes, webhooks and conflict resolution of the same
 * record take turns, so comments and snapshots are never written twice. Expires after `ttlSeconds` if its
 * holder dies. Throws 409 `SYNC_RUNNING` after `waitMs`.
 */
export async function withLock<T>(
  cache: CacheService,
  key: string,
  fn: () => Promise<T>,
  opts: { ttlSeconds?: number; waitMs?: number } = {},
): Promise<T> {
  const ttl = opts.ttlSeconds ?? 120;
  const deadline = Date.now() + (opts.waitMs ?? 60_000);
  for (;;) {
    if ((await cache.increment(key, ttl)) === 1) break;
    if (Date.now() > deadline)
      throw new HttpError(409, ErrorCodes.SYNC_RUNNING, 'This record is being synced; try again shortly');
    await sleep(80 + Math.floor(Math.random() * 120));
  }
  try {
    return await fn();
  } finally {
    await cache.delete(key).catch(() => undefined);
  }
}
