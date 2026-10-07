/**
 * Runs the mocks on their own: `pnpm --filter @isbp/integration-mocks start` (port `DEV_MOCKS_PORT`, 4100).
 * `pnpm dev:services` starts them too. State persists in `.dev-data/integration-mocks.json`.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockServer } from './index';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.DEV_MOCKS_PORT ?? 4100);
const app = await createMockServer({
  dataFile: process.env.MOCKS_DATA_FILE ?? join(root, '.dev-data', 'integration-mocks.json'),
});
await app.listen({ port, host: '127.0.0.1' });
console.warn(`  ✓ Integration mocks http://localhost:${port} (ServiceDesk Plus: /sdp, Azure DevOps: /ado)`);

const stop = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
