/**
 * Docker-free local infrastructure: a persistent embedded PostgreSQL and a Redis server.
 *   pnpm dev:services        (Ctrl+C to stop)
 * Data lives in `.dev-data/` at the repo root. Ports: DEV_PG_PORT (5432), DEV_REDIS_PORT (6379).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dataDir = join(root, '.dev-data');
const pgDir = join(dataDir, 'postgres');
const pgPort = Number(process.env.DEV_PG_PORT ?? 5432);
const redisPort = Number(process.env.DEV_REDIS_PORT ?? 6379);

mkdirSync(dataDir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: pgDir,
  user: 'isbp',
  password: 'isbp',
  port: pgPort,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => undefined,
  onError: (e) => console.error('[postgres]', e),
});

if (!existsSync(join(pgDir, 'PG_VERSION'))) {
  console.warn('• initialising PostgreSQL cluster in .dev-data/postgres …');
  await pg.initialise();
}
await pg.start();
for (const name of ['isbp', 'isbp_test']) {
  await pg.createDatabase(name).catch(() => undefined); // already exists
}

const redis = await RedisMemoryServer.create({
  instance: { port: redisPort, args: ['--save', '', '--appendonly', 'no'] },
});
const redisHost = await redis.getHost();

console.warn(`
  ✓ PostgreSQL  postgres://isbp:isbp@localhost:${pgPort}/isbp   (tests: /isbp_test)
  ✓ Redis       redis://${redisHost}:${await redis.getPort()}

  Ctrl+C to stop. Data persists in .dev-data/ (delete it to start fresh).
`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.warn('\n• stopping dev services …');
  await Promise.allSettled([pg.stop(), redis.stop()]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
