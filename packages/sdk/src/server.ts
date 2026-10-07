import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Locale } from '@isbp/i18n';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { FastifyBaseLogger, FastifyInstance, RawServerDefault } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import type { LocalizedText } from './conditions';
import type { FieldDef, FormSchema } from './fields';
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
  /** Set when an API client (service principal) authenticated with an API key or OAuth token. */
  client?: { id: string; clientId: string; name: string };
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

/* ───────────────────────────── workflows ───────────────────────────── */

export interface WorkflowSubject {
  /** Entity type, e.g. `post` (the trigger's `subject`). */
  type: string;
  id: string;
  /** Shown in approval inboxes, e.g. the post title — plain, or per locale. */
  label: string | LocalizedText;
  /** Web path of the subject, e.g. `/announcements/…`. */
  href?: string | null;
}

export interface StartWorkflowInput {
  subject: WorkflowSubject;
  /** Data for conditions and "approver from fact" rules; must match the trigger's `facts` schema. */
  facts?: Record<string, unknown>;
  /** Who asked (excluded from approving unless a step allows self-approval). */
  requesterId: string | null;
  /** The person the request is about — manager rules resolve from them (default: the requester). */
  subjectUserId?: string | null;
  /** Use this definition instead of the trigger's default (forms, per-role overrides). */
  definitionId?: string | null;
}

export interface WorkflowStartResult {
  instanceId: string;
  status: 'running' | 'approved' | 'rejected';
}

export interface WorkflowCompletion {
  instanceId: string;
  triggerKey: string;
  subjectType: string;
  subjectId: string;
  outcome: 'approved' | 'rejected' | 'cancelled';
  requesterId: string | null;
  /** Comment of the deciding approver (rejections), if any. */
  comment: string | null;
}

export interface WorkflowService {
  /**
   * Starts the workflow bound to one of this module's triggers. Returns `null` when no workflow is
   * bound and the trigger is not `required` (approval is opt-in). Pass `tx` to start atomically.
   */
  start(
    triggerKey: string,
    input: StartWorkflowInput,
    opts?: { tx?: Db },
  ): Promise<WorkflowStartResult | null>;
  /** Cancels a running instance (e.g. the request was withdrawn); pending tasks are closed. */
  cancel(instanceId: string, reason?: string | null, opts?: { tx?: Db }): Promise<void>;
}

/* ───────────────────────────── notifications ───────────────────────────── */

/** ICU parameter: dates are formatted in the recipient's locale and time zone; localized text is picked per locale. */
export type NotificationParam = string | number | Date | null | LocalizedText;

export interface NotifyInput {
  /** One of this module's `manifest.notifications` types. */
  type: string;
  /** User ids; preferences decide the channels. Duplicates and inactive users are dropped. */
  recipients: readonly (string | null | undefined)[];
  /** ICU parameters for the catalog's `title` / `body`. */
  params?: Record<string, NotificationParam>;
  /** Web path opened from the notification. */
  href?: string | null;
  data?: Record<string, unknown>;
}

export interface NotificationService {
  /** In-app rows commit with `tx`; email/Teams/Slack delivery happens in the worker after commit. */
  notify(input: NotifyInput, opts?: { tx?: Db }): Promise<void>;
  /** Posts only to the organisation's subscribed channels (Teams, Slack, webhooks). */
  broadcast(input: Omit<NotifyInput, 'recipients'>, opts?: { tx?: Db }): Promise<void>;
}

/* ───────────────────────────── custom fields ───────────────────────────── */

export interface CustomFieldService {
  /** Active custom field definitions of an entity type (e.g. `core.user`), in display order. */
  definitions(entityType: string): Promise<FieldDef[]>;
  /**
   * Validates submitted custom-field values and merges them over `existing` (values of retired
   * fields are kept). Throws 400 `VALIDATION_FAILED` with `details.fields` on invalid input.
   */
  validate(
    entityType: string,
    input: Record<string, unknown>,
    existing?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

/* ───────────────────────────── AI gateway ───────────────────────────── */

export interface AiToolCall {
  id: string;
  /** Registry name, e.g. `itsm.create_ticket`. */
  name: string;
  input: unknown;
}

/**
 * Provider-neutral conversation message. Assistant turns keep the provider's native content so a
 * conversation continued on the same provider and model is replayed unchanged (append-only history).
 */
export interface AiMessage {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  /** Assistant: tools the model asked to call. */
  toolCalls?: AiToolCall[];
  /** Tool result: the call it answers. */
  toolCallId?: string;
  isError?: boolean;
  native?: { provider: string; model: string; content: unknown };
}

export type AiEffort = 'low' | 'medium' | 'high';

export interface AiChatRequest<T = unknown> {
  /** Stable key for usage reports, e.g. `helpdesk-ai.triage`. */
  feature: string;
  system?: string;
  messages: AiMessage[];
  /** Registry tools the model may call (names); schemas come from the manifests. */
  tools?: string[];
  /** Structured output: the final answer must match this schema (parsed into `output`). */
  schema?: z.ZodType<T>;
  effort?: AiEffort;
  maxTokens?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AiChatResult<T = unknown> {
  text: string;
  /** Parsed structured output (when `schema` was given and the reply matched). */
  output: T | null;
  toolCalls: AiToolCall[];
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal';
  /** Append to the conversation to continue it. */
  message: AiMessage;
  usage: AiUsage;
  provider: string;
  model: string;
}

export type AiStreamEvent<T = unknown> =
  { type: 'text'; delta: string } | { type: 'done'; result: AiChatResult<T> };

export interface AiStatus {
  /** A generative model is configured; otherwise features use their builtin (retrieval/extractive) mode. */
  chat: { available: boolean; provider: 'none' | 'anthropic' | 'openai-compatible'; model: string | null };
  embeddings: { provider: 'builtin' | 'openai-compatible'; model: string; dimensions: number };
  vectorStore: 'pgvector' | 'portable';
}

/** Who may retrieve an indexed document: the permission (at `scope`), or any listed user. */
export interface AiIndexAcl {
  permission: string;
  scope?: ResourceScope;
  users?: string[];
}

export interface AiIndexDocument {
  /** `<module>.<entity>`, e.g. `kb.article`. */
  type: string;
  id: string;
  title: string;
  /** Plain text or Markdown; chunked by heading/paragraph. */
  text: string;
  locale?: string | null;
  href?: string | null;
  acl: AiIndexAcl;
  /** Filterable with `search({ filter })` (JSON containment), returned with hits. */
  metadata?: Record<string, unknown>;
}

export interface AiSearchHit {
  type: string;
  id: string;
  title: string;
  href: string | null;
  locale: string | null;
  /** The best-matching chunk of the document. */
  snippet: string;
  /** Fused relevance (vector + keyword ranks), 0–1, for ordering. */
  score: number;
  /** Cosine similarity of the best chunk to the query, 0–1 — use it for "is this relevant at all" thresholds. */
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface AiSearchOptions {
  types: string[];
  /** Results are filtered by this caller's permissions (chunk ACLs). */
  auth: AuthContext;
  limit?: number;
  filter?: Record<string, unknown>;
  /** Exclude documents, e.g. the ticket you are finding neighbours for. */
  excludeIds?: string[];
}

export interface AiToolInfo {
  name: string;
  description: string;
  moduleId: string;
  permission: string;
  destructive: boolean;
}

export interface AiService {
  status(): Promise<AiStatus>;
  /** Throws 409 `AI_NOT_CONFIGURED` when no chat model is configured — check `status()` first. */
  chat<T = unknown>(req: AiChatRequest<T>, opts?: { auth?: AuthContext }): Promise<AiChatResult<T>>;
  /** Streams text deltas, then one `done` event with the full result. */
  stream<T = unknown>(req: AiChatRequest<T>, opts?: { auth?: AuthContext }): AsyncIterable<AiStreamEvent<T>>;
  /** Unit-length embeddings from the configured embedder (builtin works offline). */
  embed(texts: string[], opts: { feature: string }): Promise<number[][]>;
  index: {
    /** Re-chunks and re-embeds the document. Call after commit (e.g. from your own event handler). */
    upsert(doc: AiIndexDocument): Promise<void>;
    remove(type: string, id: string): Promise<void>;
    /** Hybrid (vector + keyword) search, filtered by the caller's permissions. */
    search(query: string, opts: AiSearchOptions): Promise<AiSearchHit[]>;
  };
  tools: {
    /** Tools of enabled modules the principal may call. */
    list(auth: AuthContext): AiToolInfo[];
    /**
     * Runs a registry tool as `auth`: validates the input, requires the tool's permission, refuses
     * `destructive` tools unless `confirmed` (409 `CONFIRMATION_REQUIRED`), and audits the call.
     */
    invoke<T = unknown>(
      name: string,
      input: unknown,
      opts: { auth: AuthContext; confirmed?: boolean },
    ): Promise<T>;
  };
  /** This module's agent identity (`manifest.ai.agent`); throws if the module declares none. */
  agent(): AuthContext;
}

/* ───────────────────────────── request portal ───────────────────────────── */

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** A module record listed in the request portal's "My requests" (e.g. an incident someone reported). */
export interface PortalItem {
  /** `<module>.<entity>`, e.g. `itsm.ticket`. */
  kind: string;
  id: string;
  /** Human reference, e.g. `INC-00042`. */
  reference: string;
  title: string | LocalizedText;
  /** `open` while something is still happening; `closed` when done. */
  state: 'open' | 'closed';
  /** i18n key of the status label in the module catalog, e.g. `itsm.status.in_progress`. */
  statusKey: string;
  tone?: StatusTone;
  href: string;
  /** lucide icon name. */
  icon?: string;
  /** People who see it under "My requests" (requester, requested-for). */
  people: readonly (string | null | undefined)[];
  createdAt?: Date;
}

export interface PortalService {
  /** Creates or updates the item (idempotent on `kind` + `id`). */
  track(item: PortalItem, opts?: { tx?: Db }): Promise<void>;
  untrack(kind: string, id: string, opts?: { tx?: Db }): Promise<void>;
}

/* ───────────────────────────── forms (Phase 1) ───────────────────────────── */

export interface FormSubmissionInfo {
  id: string;
  number: number;
  /** `REQ-00042`. */
  reference: string;
  form: { id: string; key: string; name: LocalizedText; icon: string; category: string | null };
  version: number;
  /** The schema the answers were given with. */
  schema: FormSchema;
  data: Record<string, unknown>;
  submittedBy: string | null;
  status: 'submitted' | 'pending' | 'approved' | 'rejected' | 'cancelled';
  createdAt: Date;
}

/** A module's progress on a submission (e.g. the ITSM ticket fulfilling it), shown to the requester. */
export interface Fulfilment {
  reference: string;
  href: string;
  state: 'open' | 'done' | 'cancelled';
  /** i18n key of the status label in the module catalog. */
  statusKey: string;
  tone?: StatusTone;
}

export interface FormsService {
  submission(id: string): Promise<FormSubmissionInfo | null>;
  /** Published, active forms (for catalog configuration screens). */
  published(): Promise<
    { key: string; name: LocalizedText; icon: string; category: string | null; hasApproval: boolean }[]
  >;
  setFulfilment(submissionId: string, fulfilment: Fulfilment | null, opts?: { tx?: Db }): Promise<void>;
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
  readonly workflows: WorkflowService;
  readonly notifications: NotificationService;
  readonly fields: CustomFieldService;
  readonly ai: AiService;
  readonly portal: PortalService;
  readonly forms: FormsService;
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

export interface WorkflowTriggerHandler {
  /** Called once per instance when it completes (delivered through the outbox, retried on failure). */
  onCompleted(result: WorkflowCompletion, ctx: ModuleContext): Promise<void>;
}

export interface ServerModuleOptions {
  migrations?: Migration[];
  routes?: (app: ModuleRouter, ctx: ModuleContext) => void | Promise<void>;
  events?: Record<string, EventHandler>;
  jobs?: Record<string, JobDefinition>;
  ai?: Record<string, AiToolHandler>;
  /** Completion handlers for this module's `manifest.workflows` triggers. */
  workflows?: Record<string, WorkflowTriggerHandler>;
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
  const tools = new Set(manifest.ai?.tools?.map((t) => t.name) ?? []);
  for (const name of Object.keys(options.ai ?? {})) {
    if (!tools.has(name))
      throw new Error(`[${manifest.id}] AI handler "${name}" is not declared in manifest.ai.tools`);
  }
  for (const name of tools) {
    if (!options.ai?.[name]) throw new Error(`[${manifest.id}] AI tool "${name}" has no handler`);
  }
  const triggers = new Set(manifest.workflows?.map((w) => w.key) ?? []);
  for (const key of Object.keys(options.workflows ?? {})) {
    if (!triggers.has(key))
      throw new Error(`[${manifest.id}] workflow handler "${key}" is not declared in manifest.workflows`);
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
