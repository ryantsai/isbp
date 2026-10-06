import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Locale } from '@isbp/i18n';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { FastifyBaseLogger, FastifyInstance, RawServerDefault } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleManifest } from './manifest';
import type { PermissionReach, PermissionSet, ResourceScope } from './permissions';

export * from './index';

/* ───────────────────────────── database ───────────────────────────── */

/** Drizzle database handle (or transaction) — both expose the same query builder. */
export type Db = PgDatabase<NodePgQueryResultHKT, Record<string, never>>;

/** Embedded SQL migration, produced by `pnpm db:generate`. */
export interface Migration {
  tag: string;
  hash: string;
  sql: string;
}

/* ───────────────────────────── identity ───────────────────────────── */

export type PrincipalType = 'user' | 'service' | 'system' | 'ai_agent';

export interface Principal {
  type: PrincipalType;
  id: string | null;
  name: string;
  /** For AI agents and services acting for a user. */
  onBehalfOf?: { id: string; name: string };
}

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  locale: Locale;
  timezone: string;
  departmentId: string | null;
  avatarUrl: string | null;
}

export interface AuthContext {
  principal: Principal;
  user: SessionUser | null;
  sessionId: string | null;
  permissions: PermissionSet;
  can(permission: string, resource?: ResourceScope): boolean;
  /** Throws 403 (and audits the denial) unless `can()` passes. */
  require(permission: string, resource?: ResourceScope): void;
  /** Where the caller holds a permission — use to filter list queries. */
  reach(permission: string): PermissionReach;
}

/* ───────────────────────────── services ───────────────────────────── */

export type AuditOutcome = 'success' | 'failure' | 'denied';
export type AuditCategory = 'data' | 'security' | 'system';
export type AuditChanges = Record<string, [before: unknown, after: unknown]>;

export interface AuditEntry {
  /** `<module>.<entity>.<verb>` — usually the same name as the domain event. */
  action: string;
  entityType?: string;
  entityId?: string | number | null;
  entityLabel?: string | null;
  changes?: AuditChanges;
  metadata?: Record<string, unknown>;
  outcome?: AuditOutcome;
  category?: AuditCategory;
}

export interface AuditService {
  /** Writes an immutable audit row. Pass `tx` to commit atomically with the change. */
  record(entry: AuditEntry, opts?: { tx?: Db; principal?: Principal }): Promise<void>;
  /** Field-level diff helper: only changed keys, `[before, after]`. */
  diff<T extends Record<string, unknown>>(before: T, after: Partial<T>, fields?: (keyof T)[]): AuditChanges;
}

export interface DomainEvent<T = unknown> {
  id: string;
  name: string;
  moduleId: string;
  payload: T;
  actor: Principal | null;
  occurredAt: string;
}

export interface EventPublisher {
  /** Adds the event to the transactional outbox (delivered at-least-once after commit). */
  publish<T>(name: string, payload: T, opts?: { tx?: Db }): Promise<void>;
}

export interface JobQueue {
  enqueue<T>(name: string, data: T, opts?: { delayMs?: number; jobId?: string }): Promise<string>;
}

export interface SettingsReader {
  get<T = unknown>(key: string): Promise<T>;
  all(): Promise<Record<string, unknown>>;
}

export interface RbacReader {
  /** Effective permissions of any user (cached). */
  permissionsFor(userId: string): Promise<PermissionSet>;
}

export interface ModuleContext {
  readonly module: ModuleManifest;
  readonly db: Db;
  readonly logger: FastifyBaseLogger;
  readonly audit: AuditService;
  readonly events: EventPublisher;
  readonly jobs: JobQueue;
  readonly settings: SettingsReader;
  readonly rbac: RbacReader;
  /** Runs `fn` in a DB transaction; pass `tx` to audit/events to keep them atomic. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** Principal of the current request, job or event (from async context). */
  principal(): Principal;
  isEnabled(): boolean;
}

/* ───────────────────────────── extension points ───────────────────────────── */

export type ModuleRouter = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  FastifyBaseLogger,
  ZodTypeProvider
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventHandler<T = any> = (event: DomainEvent<T>, ctx: ModuleContext) => Promise<void>;

export interface JobRun<T = unknown> {
  id: string;
  name: string;
  data: T;
  attempt: number;
  log(message: string): Promise<void>;
  updateProgress(progress: number): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface JobDefinition<T = any> {
  description?: string;
  /** Recurring schedule (cron is evaluated in `tz`, default UTC). */
  schedule?: { cron?: string; everyMs?: number; tz?: string };
  concurrency?: number;
  attempts?: number;
  backoffMs?: number;
  timeoutMs?: number;
  handler(job: JobRun<T>, ctx: ModuleContext): Promise<unknown>;
}

export interface SearchHit {
  id: string;
  type: string;
  title: string;
  subtitle?: string | null;
  href: string;
  icon?: string;
}

export type SearchProvider = (
  query: string,
  ctx: ModuleContext,
  auth: AuthContext,
  limit: number,
) => Promise<SearchHit[]>;

export type AiToolHandler = (input: unknown, ctx: ModuleContext, auth: AuthContext) => Promise<unknown>;

export interface ServerModuleOptions {
  migrations?: Migration[];
  routes?: (app: ModuleRouter, ctx: ModuleContext) => void | Promise<void>;
  events?: Record<string, EventHandler>;
  jobs?: Record<string, JobDefinition>;
  ai?: Record<string, AiToolHandler>;
  search?: SearchProvider;
  /** Demo data for `pnpm db:seed`. Must be idempotent. */
  seed?: (ctx: ModuleContext) => Promise<void>;
  onEnable?: (ctx: ModuleContext) => Promise<void>;
  onDisable?: (ctx: ModuleContext) => Promise<void>;
}

export interface ServerModule extends ServerModuleOptions {
  readonly manifest: ModuleManifest;
}

/**
 * Declares a module's server half. The kernel mounts `routes` at `/api/v1/<id>`, subscribes `events`,
 * schedules `jobs`, exposes `ai` tools through the AI gateway, and runs `migrations` in order.
 */
export function defineServerModule(manifest: ModuleManifest, options: ServerModuleOptions): ServerModule {
  const consumes = new Set(manifest.events?.consumes ?? []);
  for (const name of Object.keys(options.events ?? {})) {
    if (!consumes.has(name)) {
      throw new Error(
        `[${manifest.id}] handles event "${name}" but does not list it in manifest.events.consumes`,
      );
    }
  }
  const tools = new Set(manifest.ai?.tools.map((t) => t.name) ?? []);
  for (const name of Object.keys(options.ai ?? {})) {
    if (!tools.has(name))
      throw new Error(`[${manifest.id}] AI handler "${name}" is not declared in manifest.ai.tools`);
  }
  for (const name of tools) {
    if (!options.ai?.[name]) throw new Error(`[${manifest.id}] AI tool "${name}" has no handler`);
  }
  for (const name of Object.keys(options.jobs ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(name))
      throw new Error(`[${manifest.id}] job name "${name}" must be kebab-case`);
  }
  return Object.freeze({ manifest, ...options });
}

/* ───────────────────────────── Fastify augmentation ───────────────────────────── */

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
  interface FastifyContextConfig {
    /** Required permission(s). Without `scoped`, a **global** grant is required. */
    permission?: string | string[];
    /**
     * The handler performs its own scope check with `req.auth.require(perm, resource)` or filters with
     * `req.auth.reach(perm)`; the route guard then only requires the permission at any scope.
     */
    scoped?: boolean;
    /** No authentication required (login, health, SSO callbacks). */
    public?: boolean;
    /** Set `false` to skip the CSRF check (e.g. SAML POST bindings that carry their own proof). */
    csrf?: boolean;
  }
}
