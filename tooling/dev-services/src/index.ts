/**
 * Docker-free local infrastructure: a persistent embedded PostgreSQL, a Redis server, and the integration
 * mocks (on-premises ServiceDesk Plus and Azure DevOps Server stand-ins for the demo connections).
 *   pnpm dev:services        (Ctrl+C to stop)
 * Data lives in `.dev-data/` at the repo root. Ports: DEV_PG_PORT (5432), DEV_REDIS_PORT (6379),
 * DEV_MOCKS_PORT (4100).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockServer } from '@isbp/integration-mocks';
import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dataDir = join(root, '.dev-data');
const pgDir = join(dataDir, 'postgres');
const pgPort = Number(process.env.DEV_PG_PORT ?? 5432);
const redisPort = Number(process.env.DEV_REDIS_PORT ?? 6379);
const mocksPort = Number(process.env.DEV_MOCKS_PORT ?? 4100);

// Fail before starting anything: embedded-postgres rejects with undefined when its process exits early,
// including when a second dev-services session tries to start the same cluster.
async function assertPortAvailable(service: string, port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `${service} port ${port} is already in use. If pnpm dev:services is running in another terminal, ` +
                'keep using that session or stop it with Ctrl+C before restarting.'
            : `Cannot start ${service} on port ${port}: ${error.message}`,
          { cause: error },
        ),
      );
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

await assertPortAvailable('PostgreSQL', pgPort);
await assertPortAvailable('Redis', redisPort);
await assertPortAvailable('Integration mocks', mocksPort);

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

const mocks = await createMockServer({ dataFile: join(dataDir, 'integration-mocks.json') });
await mocks.listen({ port: mocksPort, host: '127.0.0.1' });

console.warn(`
  ✓ PostgreSQL  postgres://isbp:isbp@localhost:${pgPort}/isbp   (tests: /isbp_test)
  ✓ Redis       redis://${redisHost}:${await redis.getPort()}
  ✓ Mocks       http://localhost:${mocksPort}   (ServiceDesk Plus /sdp, Azure DevOps Server /ado, scripted chat model /llm/v1)

  Ctrl+C to stop. Data persists in .dev-data/ (delete it to start fresh).
`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.warn('\n• stopping dev services …');
  await Promise.allSettled([pg.stop(), redis.stop(), mocks.close()]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
