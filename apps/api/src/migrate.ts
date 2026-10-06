/**
 * Applies core + module migrations and reconciles manifests (modules, permissions, system roles).
 * `--reset` drops every ISBP schema first (development only).
 */
import { sql } from 'drizzle-orm';
import { bootstrap } from './bootstrap';

const reset = process.argv.includes('--reset');
const { config, kernel } = await bootstrap('isbp-migrate');

try {
  if (reset) {
    if (config.isProd) throw new Error('Refusing to --reset in production');
    const schemas = [
      'core',
      ...kernel.registry.modules.map((m) => m.manifest.id).filter((id) => id !== 'core'),
    ];
    for (const schema of schemas)
      await kernel.db.execute(sql.raw(`drop schema if exists "${schema}" cascade`));
    await kernel.db.execute(sql`drop table if exists public.isbp_migrations`);
    await kernel.redis.flushdb();
    kernel.logger.warn({ schemas }, 'database reset');
  }
  const applied = await kernel.migrate();
  kernel.logger.info({ applied: applied.length ? applied : 'none' }, 'migrations complete');
} finally {
  await kernel.close();
}
