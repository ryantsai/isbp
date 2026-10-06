import { bindKernel } from './core/kernel-ref';
import { installedModules } from './generated/modules';
import { createKernel, type Kernel } from './kernel/kernel';
import { createLogger } from './logger';
import { type Config, loadConfig } from './config';

/** Shared startup for every entrypoint (api, worker, migrate, seed). */
export async function bootstrap(
  name: string,
  overrides?: Partial<NodeJS.ProcessEnv>,
): Promise<{ config: Config; kernel: Kernel }> {
  const config = loadConfig({ ...process.env, ...overrides });
  const logger = createLogger(config, name);
  const kernel = await createKernel(config, logger, installedModules);
  bindKernel(kernel);
  return { config, kernel };
}

/** Runs `stop` once on SIGINT/SIGTERM, then exits. */
export function onShutdown(stop: () => Promise<void>) {
  let stopping = false;
  const handler = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.warn(`\n${signal} received — shutting down…`);
    stop()
      .catch((err) => console.error(err))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}
