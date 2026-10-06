/**
 * Development convenience: API + worker in one process (`pnpm dev`). Production runs them as separate
 * deployments from the same image (`dist/main.js`, `dist/worker.js`).
 */
import { buildApp } from './app';
import { bootstrap, onShutdown } from './bootstrap';
import { startWorker } from './kernel/worker';

const { config, kernel } = await bootstrap('isbp-dev');

const applied = await kernel.migrate();
if (applied.length) kernel.logger.info({ applied }, 'migrations applied');
await kernel.registry.watch(kernel.redis);

const app = await buildApp(kernel);
const stopWorker = await startWorker(kernel);
await app.listen({ host: config.HOST, port: config.PORT });
kernel.logger.info(`API docs: http://localhost:${config.PORT}/api/docs`);

onShutdown(async () => {
  await app.close();
  await stopWorker();
  await kernel.close();
});
