import { bootstrap, onShutdown } from './bootstrap';
import { startMetricsServer } from './kernel/metrics';
import { startWorker } from './kernel/worker';

const { config, kernel } = await bootstrap('isbp-worker');

await kernel.registry.loadState();
await kernel.registry.watch(kernel.redis);
const stop = await startWorker(kernel);
const metrics = startMetricsServer(config.METRICS_PORT, kernel.ready);

onShutdown(async () => {
  await stop();
  metrics.close();
  await kernel.close();
});
