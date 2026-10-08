import { createDb, type MigrationSet, runMigrations } from '@isbp/db';
import coreMigrations from '@isbp/db/migrations';
import { users } from '@isbp/db/schema';
import type { AuthContext, Db, ModuleContext, RbacReader, SearchHit, ServerModule } from '@isbp/sdk/server';
import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { Redis } from 'ioredis';
import type { Config } from '../config';
import { AiGateway } from './ai/gateway';
import { McpServer } from './ai/mcp';
import { ApiClientAuth } from './api-clients';
import { createAuditService } from './audit';
import { createCacheService } from './cache';
import { currentPrincipal } from './context';
import { buildAuthContext } from './http/auth';
import { SecretBox } from './crypto';
import { DatabaseManager } from './databases';
import { createEventPublisher } from './events';
import { CustomFieldRegistry } from './fields';
import { ClamdScanner } from './files/scanner';
import { type BlobStorage, LocalStorage, S3Storage } from './files/storage';
import { FileStore } from './files/store';
import { ModuleRegistry } from './modules';
import { NotificationHub } from './notifications/hub';
import { NotificationCenter } from './notifications/service';
import { OutboundHttp } from './outbound';
import { createFormsService, createPortalService } from './portal';
import { QueueFactory } from './queues';
import { RbacService } from './rbac';
import { RecordRegistry } from './records';
import { Sandbox } from './sandbox';
import { SessionService, toSessionUser } from './sessions';
import { SettingsService } from './settings';
import { CustomizationRegistry } from './customizations';
import { ConnectorRegistry, SyncRegistry } from './integrations';
import { TaskTypeRegistry } from './task-types';
import { installDefaultWorkflows } from './workflow/defaults';
import { WorkflowEngine } from './workflow/engine';

export type Kernel = Awaited<ReturnType<typeof createKernel>>;

/** Version reported by the OpenAPI document and the MCP server. */
export const API_VERSION = '1.0.0';

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

  let coreContext: ModuleContext | undefined;
  const core = () => (coreContext ??= registry.context('core'));
  const notifications = new NotificationCenter({
    db,
    box,
    settings,
    registry,
    redis,
    config,
    logger,
    coreEvents: () => core().events,
  });
  const hub = new NotificationHub(redis, logger);
  const fields = new CustomFieldRegistry(db, registry);
  const workflows = new WorkflowEngine({ db, registry, notifications, logger, core });
  const apiClients = new ApiClientAuth(db, redis, config.OAUTH_TOKEN_TTL_SECONDS);
  const ai = new AiGateway({
    db,
    settings,
    registry,
    logger: logger.child({ component: 'ai' }),
    coreManifest: () => registry.get('core')!.manifest,
  });

  const storage: BlobStorage =
    config.FILES_STORAGE === 's3'
      ? new S3Storage({
          bucket: config.S3_BUCKET!,
          region: config.S3_REGION,
          endpoint: config.S3_ENDPOINT,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
          accessKeyId: config.S3_ACCESS_KEY_ID,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          prefix: config.S3_PREFIX,
          sse: config.S3_SSE,
        })
      : new LocalStorage(config.filesDir);
  const files = new FileStore({
    db,
    storage,
    scanner: config.CLAMAV_HOST ? new ClamdScanner(config.CLAMAV_HOST, config.CLAMAV_PORT) : null,
    core,
    logger: logger.child({ component: 'files' }),
  });
  const records = new RecordRegistry({
    db,
    registry,
    logger: logger.child({ component: 'records' }),
    core,
    forgetFiles: (ref, tx) => files.forgetRecord(ref, tx),
  });
  const secrets = {
    seal: (plain: string) => box.encrypt(plain),
    open: (sealed: string) => box.decrypt(sealed),
  };
  const databases = new DatabaseManager({ db, box, logger: logger.child({ component: 'databases' }) });
  const databasesService = databases.service();
  const taskTypes = new TaskTypeRegistry(registry);
  const taskTypesService = taskTypes.service();
  const outbound = new OutboundHttp(config.allowPrivateWebhooks);
  const httpClient = outbound.client();
  const sandbox = Sandbox.fromConfig(config);
  const sandboxService = sandbox.service();
  const sync = new SyncRegistry(registry);
  const syncService = sync.service();
  const connectorsService = new ConnectorRegistry(registry, httpClient, redis).service();
  const customizations = new CustomizationRegistry(registry).service();
  // One MCP surface: the HTTP endpoint for outside agents and in-process sessions for the platform's own.
  const mcp = new McpServer({
    tools: ai.tools,
    customizations,
    version: API_VERSION,
    publicUrl: config.PUBLIC_URL,
  });
  ai.attachMcp(mcp);

  const rbacReader: RbacReader = {
    permissionsFor: (userId) => rbac.permissionsFor(userId),
    authFor: async (userId) => {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.status !== 'active') return null;
      return buildAuthContext(
        { type: 'user', id: user.id, name: user.displayName },
        toSessionUser(user),
        null,
        await rbac.permissionsFor(user.id),
      );
    },
  };

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
      jobs: queues.forModule(id, (name) => m.jobs?.[name]),
      settings: settings.reader(m.manifest),
      rbac: rbacReader,
      workflows: workflows.forModule(id),
      notifications: notifications.forModule(m.manifest),
      fields: fields.service(),
      ai: ai.forModule(m.manifest),
      portal: createPortalService(db, m.manifest),
      forms: createFormsService(db, m.manifest),
      records: records.service(),
      files: files.service(),
      secrets,
      databases: databasesService,
      taskTypes: taskTypesService,
      http: httpClient,
      cache: createCacheService(redis, id),
      sandbox: sandboxService,
      sync: syncService,
      connectors: connectorsService,
      customizations,
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
    await installDefaultWorkflows(db, workflows);
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
    await hub.close();
    await databases.close();
    await outbound.close();
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
    notifications,
    hub,
    fields,
    workflows,
    apiClients,
    ai,
    records,
    files,
    databases,
    sandbox,
    sync,
    customizations,
    mcp,
    migrate,
    ready,
    search,
    close,
  };
}
