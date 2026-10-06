import { buildApp } from './app';
import { bootstrap, onShutdown } from './bootstrap';
import { startMetricsServer } from './kernel/metrics';

const { config, kernel } = await bootstrap('isbp-api');

if (config.autoMigrate) {
  const applied = await kernel.migrate();
  if (applied.length) kernel.logger.info({ applied }, 'migrations applied');
} else {
  await kernel.registry.loadState();
}
await kernel.registry.watch(kernel.redis);

const app = await buildApp(kernel);
const metrics = startMetricsServer(config.METRICS_PORT, kernel.ready);
await app.listen({ host: config.HOST, port: config.PORT });

onShutdown(async () => {
  await app.close();
  metrics.close();
  await kernel.close();
});
