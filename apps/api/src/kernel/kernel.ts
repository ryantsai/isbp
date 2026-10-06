import { createDb, type MigrationSet, runMigrations } from '@isbp/db';
import coreMigrations from '@isbp/db/migrations';
import type { AuthContext, Db, ModuleContext, SearchHit, ServerModule } from '@isbp/sdk/server';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { Redis } from 'ioredis';
import type { Config } from '../config';
import { createAuditService } from './audit';
import { currentPrincipal } from './context';
import { SecretBox } from './crypto';
import { createEventPublisher } from './events';
import { ModuleRegistry } from './modules';
import { QueueFactory } from './queues';
import { RbacService } from './rbac';
import { SessionService } from './sessions';
import { SettingsService } from './settings';

export type Kernel = Awaited<ReturnType<typeof createKernel>>;

/**
 * Wires shared services once per process. API and worker both build a kernel; only the worker starts
 * consumers. Everything a module touches goes through its ModuleContext.
 */
export async function createKernel(
  config: Config,
  logger: FastifyBaseLogger,
  installed: readonly ServerModule[],
) {
  const { db: drizzleDb, pool } = createDb(config.DATABASE_URL, {
    max: config.DATABASE_POOL_MAX,
    applicationName: 'isbp',
  });
  const db = drizzleDb as unknown as Db;
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });
  redis.on('error', (err) => logger.error({ err }, 'redis error'));

  const box = new SecretBox(config.masterKey, config.ISBP_MASTER_KEY_PREVIOUS);
  if (config.usingDevMasterKey && !config.isTest) {
    logger.warn('ISBP_MASTER_KEY not set — using the built-in development key. Never do this in production.');
  }

  const registry = new ModuleRegistry(installed, db, logger);
  const rbac = new RbacService(db, redis);
  const sessions = new SessionService(db, config);
  const settings = new SettingsService(db, box);
  const queues = new QueueFactory(config);
  const audit = createAuditService(db);

  const contexts = new Map<string, ModuleContext>();
  for (const m of registry.modules) {
    const id = m.manifest.id;
    const log = logger.child({ module: id });
    contexts.set(id, {
      module: m.manifest,
      db,
      logger: log,
      audit: createAuditService(db, id),
      events: createEventPublisher(db, m.manifest, log),
      jobs: queues.forModule(id),
      settings: settings.reader(m.manifest),
      rbac,
      transaction: (fn) => db.transaction((tx) => fn(tx as unknown as Db)),
      principal: currentPrincipal,
      isEnabled: () => registry.isEnabled(id),
    });
  }
  registry.setContexts(contexts);

  async function migrate() {
    const sets: MigrationSet[] = [{ moduleId: 'core', migrations: coreMigrations }];
    for (const m of registry.modules) {
      if (m.manifest.id !== 'core' && m.migrations?.length)
        sets.push({ moduleId: m.manifest.id, migrations: m.migrations });
    }
    const { applied } = await runMigrations(pool, sets, {
      info: (msg) => logger.info(msg),
      warn: (msg) => logger.warn(msg),
    });
    await registry.sync();
    return applied;
  }

  async function ready(): Promise<boolean> {
    await db.execute(sql`select 1`);
    return (await redis.ping()) === 'PONG';
  }

  /** Federated search across enabled modules (each provider capped at 1.5s). */
  async function search(query: string, auth: AuthContext, limit = 8) {
    const providers = registry.enabledModules().filter((m) => m.search);
    const results = await Promise.all(
      providers.map(async (m) => {
        try {
          const hits = await Promise.race([
            m.search!(query, registry.context(m.manifest.id), auth, limit),
            new Promise<SearchHit[]>((resolve) => setTimeout(() => resolve([]), 1_500)),
          ]);
          return hits.map((h) => ({ ...h, moduleId: m.manifest.id }));
        } catch (err) {
          logger.warn({ err, module: m.manifest.id }, 'search provider failed');
          return [];
        }
      }),
    );
    return results.flat();
  }

  async function close() {
    await registry.close();
    await queues.close();
    redis.disconnect();
    await pool.end();
  }

  return {
    config,
    logger,
    db,
    pool,
    redis,
    box,
    registry,
    rbac,
    sessions,
    settings,
    queues,
    audit,
    migrate,
    ready,
    search,
    close,
  };
}
