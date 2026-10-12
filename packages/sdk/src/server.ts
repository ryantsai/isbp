import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import type { Locale } from '@isbp/i18n';
import type {
  Catalog,
  CatalogProcedure,
  DbEngine,
  ExecOptions,
  SqlResult,
  SqlValue,
  StreamBatch,
  StreamOptions,
  TableWriter,
  WriteMode,
} from '@isbp/sql';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { FastifyBaseLogger, FastifyInstance, RawServerDefault } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import type { LocalizedText } from './conditions';
import type { FieldDef, FormSchema, ProcessActionOutcome } from './fields';
import type {
  ConnectorHandler,
  ConnectorsService,
  SyncAdapter,
  SyncChange,
  SyncService,
} from './integrations';
import type { ChangeSetPackage, CustomizationHandler, CustomizationsService } from './customizations';
import type { ModuleManifest, NavEntry } from './manifest';
import type { PermissionReach, PermissionSet, ResourceScope } from './permissions';

export * from './index';
export * from './integrations';
export type {
  Catalog,
  CatalogColumn,
  CatalogParameter,
  CatalogProcedure,
  CatalogTable,
  DbEngine,
  ExecOptions,
  SqlColumn,
  SqlParamType,
  SqlResult,
  SqlRow,
  SqlScalar,
  SqlValue,
  StreamBatch,
  StreamOptions,
  TableWriter,
  WriteMode,
} from '@isbp/sql';

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
  /**
   * An `AuthContext` for an active user, as if they had signed in (null for unknown or inactive users). For work
   * done later on a person's behalf with their own permissions, e.g. applying a change set when they approve it.
   */
  authFor(userId: string): Promise<AuthContext | null>;
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
  /** The approver whose decision completed the instance (null for SLA auto-decisions and cancellations). */
  decidedBy?: { id: string; name: string } | null;
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
  /** Whether the user has (or had) an approval task on one of this module's instances — to show them the subject. */
  isApprover(instanceId: string, userId: string): Promise<boolean>;
  /**
   * Who would decide, without starting anything: the steps of the workflow `start()` would run for these facts
   * (assuming every step approves), with their approvers resolved. `null` when no workflow would run.
   */
  preview(triggerKey: string, input: Omit<StartWorkflowInput, 'subject'>): Promise<WorkflowPreview | null>;
}

export interface WorkflowPreviewStep {
  id: string;
  name: LocalizedText;
  type: 'approval' | 'notify';
  /** `ask` people; `skipped` by a condition; nobody matched and the step is skipped (`no-approver`) or rejects. */
  outcome: 'ask' | 'skipped' | 'no-approver' | 'reject';
  people: { id: string; displayName: string }[];
}

export interface WorkflowPreview {
  definition: { id: string; name: string };
  /** Steps in the order they would run (parallel branches flattened). */
  steps: WorkflowPreviewStep[];
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
   * fields are kept). Throws 400 `VALIDATION_FAILED` with `details.issues` on invalid input.
   * Records picked in `record` fields must be readable by `auth` — by default the caller of the current request or
   * AI tool call; in system work (sync, jobs) they only have to exist — and match the field's `where`.
   */
  validate(
    entityType: string,
    input: Record<string, unknown>,
    existing?: Record<string, unknown>,
    auth?: AuthContext | null,
  ): Promise<Record<string, unknown>>;
  /**
   * Workflow facts for an entity's custom fields: `{ attributes: { <key>: value }, records: { <key>: <facts> } }`,
   * where `records` holds the facts of records picked in `record` custom fields (see `RecordsService.facts`).
   * Spread into `start({ facts })` for triggers that declare `customFieldEntity`.
   */
  facts(
    entityType: string,
    attributes: Record<string, unknown> | null | undefined,
  ): Promise<{ attributes: Record<string, unknown>; records: Record<string, unknown> }>;
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
  /** The hit's place comes from the configured reranker (then `score` is the reranker's relevance). */
  reranked?: boolean;
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
  readOnly: boolean;
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
  /**
   * An in-process session on the platform's MCP server, as `auth`: the same tools (and names, schemas and
   * annotations) and resources outside agents get over `POST /api/v1/mcp`. With `includeDestructive`, destructive
   * tools are listed too, and calling one without `confirmed` returns `confirmationRequired` instead of running it —
   * for agents inside the platform, where the person can confirm.
   */
  mcp(auth: AuthContext, opts?: { includeDestructive?: boolean; via?: string }): McpSession;
}

/** A tool as `tools/list` describes it. `name` is the wire name (`itsm__find_tickets`), `title` the registry name. */
export interface McpToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

/** A `tools/call` result. Tool errors are results (`isError`), with the platform error code in the text. */
export interface McpToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: unknown;
  isError: boolean;
  /** A destructive tool that needs a person's confirmation first (nothing ran). */
  confirmationRequired?: boolean;
}

export interface McpSession {
  listTools(): McpToolDef[];
  /** `name` is a wire or registry name. */
  callTool(name: string, args: unknown, opts?: { confirmed?: boolean }): Promise<McpToolResult>;
  listResources(): { uri: string; name: string; title: string; description: string; mimeType: string }[];
  /** Null when the resource doesn't exist or the caller may not read it. */
  readResource(uri: string): Promise<{ uri: string; mimeType: string; text: string } | null>;
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

/* ───────────────────────────── records: links & attachments ───────────────────────────── */

/** Points at one record: `{ type: 'itsm.ticket', id }`. String form `itsm.ticket:<id>` (see `formatRecordRef`). */
export interface RecordRef {
  /** `<module>.<type>` as declared in the owning module's `manifest.records.types`. */
  type: string;
  id: string;
}

/** What a module's resolver tells the platform about one record, for one caller. */
export interface RecordSummary {
  id: string;
  /** Human reference such as `INC-00042` or `AST-00007`. */
  reference?: string | null;
  title: string;
  subtitle?: string | null;
  /** i18n key of the status label in the module catalog (e.g. `itsm.status.in_progress`) and its tone. */
  status?: { key: string; tone: StatusTone } | null;
  /** Absolute web path of the record's page. */
  href: string;
  /** The caller may add and remove this record's links and attachments. */
  editable: boolean;
}

export interface ResolvedRecord extends RecordSummary {
  type: string;
  moduleId: string;
  icon: string | null;
  reference: string | null;
  subtitle: string | null;
  status: { key: string; tone: StatusTone } | null;
}

/**
 * Declared per record type in `defineServerModule({ records })`. Both methods must return only what
 * `auth` may read (the same rules as the module's own pages); omitted ids are treated as hidden.
 */
export interface RecordResolver {
  resolve(ids: readonly string[], ctx: ModuleContext, auth: AuthContext): Promise<RecordSummary[]>;
  /** For pickers: records whose reference or title matches `query`, most relevant first. */
  search(query: string, ctx: ModuleContext, auth: AuthContext, limit: number): Promise<RecordSummary[]>;
  /**
   * The record type's approval facts (shape: `RecordTypeDef.facts`) for workflows and record-field filters, by id.
   * Not permission-filtered: facts route approvals and are never shown to the requester.
   */
  facts?(ids: readonly string[], ctx: ModuleContext): Promise<Map<string, Record<string, unknown>>>;
}

export interface RecordLinkInfo {
  id: string;
  ref: RecordRef;
  /** `null` when the caller may not see the other record or its module is disabled (see `hidden`). */
  record: ResolvedRecord | null;
  hidden: 'forbidden' | 'unavailable' | null;
  createdAt: Date;
  createdBy: { id: string; name: string } | null;
}

/**
 * `ctx.records`: the platform's record registry. Links are symmetric and stored once in `core.record_links`;
 * they are how modules relate their records without depending on each other (a project task ↔ an
 * incident, a release ↔ a change). `link`/`unlink`/`forget` do no permission checks: check first.
 */
export interface RecordsService {
  /** Records `auth` may read, keyed by `type:id`. Unknown types and disabled modules are skipped. */
  resolve(refs: readonly RecordRef[], auth: AuthContext): Promise<Map<string, ResolvedRecord>>;
  get(ref: RecordRef, auth: AuthContext): Promise<ResolvedRecord | null>;
  search(
    query: string,
    opts: { auth: AuthContext; types?: readonly string[]; limit?: number },
  ): Promise<ResolvedRecord[]>;
  /** Idempotent. Audited as `core.record.linked`, publishes `core.record.linked`. */
  link(a: RecordRef, b: RecordRef, opts?: { tx?: Db }): Promise<{ id: string; created: boolean }>;
  unlink(a: RecordRef, b: RecordRef, opts?: { tx?: Db }): Promise<boolean>;
  /** The record's links, the other side resolved for `auth`. */
  links(ref: RecordRef, opts: { auth: AuthContext; types?: readonly string[] }): Promise<RecordLinkInfo[]>;
  /** Linked refs without permission filtering, for module logic ("changes linked to this release"). */
  linked(ref: RecordRef, opts?: { types?: readonly string[]; tx?: Db }): Promise<RecordRef[]>;
  /** Number of links per record (keyed by `type:id`), e.g. for a link badge on list rows or cards. */
  counts(refs: readonly RecordRef[]): Promise<Map<string, number>>;
  /**
   * Drops the links and attachments of a record being deleted. Call it in the deleting transaction: it first refuses
   * with `IN_USE` (details `{ references, more }`) while open work or live settings still use the record
   * (`references` finders of every module, e.g. a request awaiting approval whose form names it).
   */
  forget(ref: RecordRef, opts?: { tx?: Db }): Promise<void>;
  /** Approval facts of records (types whose resolver has `facts`), keyed by `type:id`; unknown ones are skipped. */
  facts(refs: readonly RecordRef[]): Promise<Map<string, Record<string, unknown>>>;
}

export interface FileInfo {
  id: string;
  record: RecordRef;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
  uploadedBy: { id: string; name: string } | null;
  createdAt: Date;
  /** Download URL (`/api/v1/files/<id>`); the caller must be able to read the record. */
  href: string;
}

/** `ctx.files`: attachments on records, in the configured storage (local disk or S3-compatible). */
export interface FilesService {
  list(ref: RecordRef): Promise<FileInfo[]>;
  /**
   * Stores a file on a record. Enforces the size limit and blocked types, sniffs the real content type and
   * runs the malware scanner when one is configured (422 `FILE_REJECTED`). Audited.
   */
  attach(
    ref: RecordRef,
    file: { name: string; contentType?: string; data: Buffer | Readable },
  ): Promise<FileInfo>;
  get(id: string): Promise<FileInfo | null>;
  open(id: string): Promise<Readable>;
  remove(id: string): Promise<boolean>;
}

/** `ctx.secrets`: seal values at rest with the platform master key (AES-256-GCM, key rotation aware). */
export interface SecretsService {
  seal(plain: string): string;
  open(sealed: string): string;
}

/* ───────────────────────────── external databases (Phase 4) ───────────────────────────── */

/** What a module may use a connection for: `data` (ETL, Data APIs, SQL jobs) or `admin` (account administration). */
export type DbPurpose = 'data' | 'admin';

export interface DbConnectionInfo {
  id: string;
  key: string;
  name: string;
  engine: DbEngine;
  host: string;
  port: number | null;
  database: string | null;
  username: string;
  purposes: DbPurpose[];
  readOnly: boolean;
  enabled: boolean;
  status: 'unknown' | 'ok' | 'error';
  serverVersion: string | null;
  /** Statement timeout and row cap of the connection (module options are clamped to them). */
  timeoutMs: number;
  maxRows: number;
}

/**
 * `ctx.databases`: the external databases administrators registered (Administration → Database
 * connections). Statements use `:name` placeholders bound by the driver; identifiers must come from
 * `catalog()`. Every call names a `purpose` the connection allows (403 `CONNECTION_PURPOSE`); unknown
 * connections are 404, disabled ones 409 `CONNECTION_DISABLED`. Database failures are `HttpError` 422
 * `DATABASE_ERROR` with `details: DatabaseErrorInfo` (the server's code and message, never credentials).
 */
export interface DatabasesService {
  list(opts?: { purpose?: DbPurpose; enabledOnly?: boolean }): Promise<DbConnectionInfo[]>;
  get(id: string): Promise<DbConnectionInfo | null>;
  query(id: string, sql: string, opts: ExecOptions & { purpose: DbPurpose }): Promise<SqlResult>;
  call(
    id: string,
    procedure: CatalogProcedure,
    args: Record<string, SqlValue | undefined>,
    opts: Omit<ExecOptions, 'params' | 'types'> & { purpose: DbPurpose },
  ): Promise<SqlResult>;
  stream(id: string, sql: string, opts: StreamOptions & { purpose: DbPurpose }): AsyncIterable<StreamBatch>;
  /** A transactional load into a catalog table (refused on read-only connections). */
  writer(
    id: string,
    table: { schema?: string | null; name: string },
    opts: {
      purpose: DbPurpose;
      columns: string[];
      mode: WriteMode;
      keys?: string[];
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<TableWriter>;
  /** Tables, views and routines the connection's login can see (cached for 5 minutes). */
  catalog(id: string, opts: { purpose: DbPurpose; refresh?: boolean }): Promise<Catalog>;
}

/** A database failure: `kind` (`auth`, `timeout`, `syntax`, `permission`, …) plus the server's code and message. */
export interface DatabaseErrorInfo {
  kind: string;
  dbCode: string | null;
  message: string;
}

/* ───────────────────────────── task types (Phase 4) ───────────────────────────── */

/** One execution of a task: what Scheduled Jobs passes to a task type's handler. */
export interface TaskContext {
  runId: string;
  jobId: string;
  /** 1-based attempt number (retries increase it). */
  attempt: number;
  /** Attempts the job allows, retries included: `attempt === maxAttempts` is the last one. */
  maxAttempts?: number;
  /**
   * People the job itself alerts when this run fails for good (its owner and owner-group members, when its failure
   * alerts are on). A task type that sends its own failure notices leaves them out, so nobody hears twice.
   */
  failureRecipients?: readonly string[];
  scheduledFor: Date;
  /**
   * The job's IANA time zone (its cron trigger's; `UTC` unless set), for work that depends on the local date —
   * e.g. which month a run belongs to.
   */
  timeZone?: string;
  /** End of the job's last successful run, e.g. for incremental loads. */
  lastSuccessAt: Date | null;
  /** The job's timeout; `signal` fires when it is reached (pass it on, e.g. as a statement timeout). */
  timeoutMs?: number;
  /** Fires on timeout or when someone cancels the run: stop promptly. */
  signal: AbortSignal;
  /** Appends a line to the run's live log. */
  log(message: string, level?: 'info' | 'warn' | 'error'): void;
}

export interface TaskOutcome {
  /**
   * One line for run lists: an i18n key in the module's catalog (`etl.results.pipeline`, shown in the reader's
   * language with `summaryParams`), or short plain text ("31 rows written").
   */
  summary?: string;
  /** Values of the summary's ICU arguments (`{ written: 31, read: 31 }`). */
  summaryParams?: Record<string, string | number> | null;
  metrics?: Record<string, number>;
  /** Web path with more detail (e.g. the pipeline run). */
  href?: string | null;
}

/**
 * A task type's `run` throws `HttpError` (or any error) to fail the attempt. Scheduled jobs explains the failure from
 * its code (`runProblemOf`); a task that knows better — which database connection, which host — puts a `RunProblem`
 * in `details.problem`.
 */
export interface TaskTypeHandler<C = unknown> {
  /** Checks what `config` refers to as the job's editor (exists, they may use it). Throw `HttpError` to refuse. */
  validate?(config: C, ctx: ModuleContext, auth: AuthContext): Promise<void>;
  /**
   * A label for job lists ("Pipeline: Orders → warehouse") and a link to the configured object, in `opts.locale` (the
   * reader's language) when given.
   */
  describe?(
    config: C,
    ctx: ModuleContext,
    opts?: { locale?: Locale },
  ): Promise<{ label: string; href?: string | null }>;
  run(config: C, task: TaskContext, ctx: ModuleContext): Promise<TaskOutcome | void>;
}

export interface TaskTypeInfo {
  /** `<module>.<type>`. */
  type: string;
  moduleId: string;
  name: string;
  description: string | null;
  icon: string | null;
  permission: string;
  /** JSON Schema of the config, for generic editors. */
  configSchema: unknown;
}

/** `ctx.taskTypes`: the work enabled modules let Scheduled Jobs run. */
export interface TaskTypesService {
  /** Types of enabled modules whose `permission` the caller holds (all types without `auth`). */
  list(auth?: AuthContext): TaskTypeInfo[];
  /**
   * Parses `config` with the type's schema and runs its `validate` as `auth` (400/403/404 on failure). Pass `db` to
   * read through the caller's transaction (a change set validating a job that names a pipeline created in it).
   */
  validate(type: string, config: unknown, auth: AuthContext, opts?: { db?: Db }): Promise<unknown>;
  /** The job list's label of a configured task, in `opts.locale` when given (the reader's language). */
  describe(
    type: string,
    config: unknown,
    opts?: { db?: Db; locale?: Locale },
  ): Promise<{ label: string; href: string | null }>;
  /** Runs the handler in its own module's context (409 `MODULE_DISABLED` when that module is off). */
  run(type: string, config: unknown, task: TaskContext): Promise<TaskOutcome>;
}

/* ───────────────────────────── outbound HTTP, cache, sandbox (Phase 4) ───────────────────────────── */

export interface OutboundRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | null;
  /** Default 30 s. */
  timeoutMs?: number;
  /** Response bytes kept (default 1 MiB); the rest is discarded and `truncated` is set. */
  maxBytes?: number;
  /** Host names (exact or `*.suffix`) that may resolve to private addresses (an admin setting). */
  allowHosts?: readonly string[];
  signal?: AbortSignal;
}

export interface OutboundResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
  durationMs: number;
}

/**
 * `ctx.http`: the only way modules call out over HTTP. Every resolved address is checked when the socket
 * connects (no DNS-rebinding bypass); private, loopback and link-local targets are refused unless allowed.
 * Redirects are not followed. Throws `HttpError` 422 `TARGET_BLOCKED`, or 502 `UPSTREAM_FAILED` with
 * `details.reason` `timeout | network | cancelled`. Any HTTP status is a response, not an error.
 */
export interface HttpClient {
  request(url: string, opts?: OutboundRequest): Promise<OutboundResponse>;
}

/** `ctx.cache`: Redis, namespaced per module. */
export interface CacheService {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  increment(key: string, ttlSeconds: number): Promise<number>;
  /** Fixed-window limiter: `limit` hits per `windowSeconds` per key. */
  rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; resetSeconds: number }>;
}

export type SandboxRunner = 'none' | 'local' | 'docker' | 'kubernetes';

export interface SandboxRequest {
  /** One of the allowed images (`ctx.sandbox.status().images`). */
  image: string;
  language: 'python' | 'node' | 'powershell' | 'shell';
  script: string;
  env?: Record<string, string>;
  timeoutMs: number;
  cpu?: number;
  memoryMb?: number;
  /** `none` (default) or `egress` (outbound network allowed). */
  network?: 'none' | 'egress';
  /** Labels for the container/pod (job id, run id). */
  labels?: Record<string, string>;
  signal?: AbortSignal;
  onLog?: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface SandboxResult {
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
}

/** `ctx.sandbox`: runs untrusted scripts in an isolated container (never in the API/worker process). */
export interface SandboxService {
  status(): { runner: SandboxRunner; isolated: boolean; images: string[] };
  /** Throws when no runner is configured or the image is not allowed. */
  run(req: SandboxRequest): Promise<SandboxResult>;
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
  readonly records: RecordsService;
  readonly files: FilesService;
  readonly secrets: SecretsService;
  readonly databases: DatabasesService;
  readonly taskTypes: TaskTypesService;
  readonly http: HttpClient;
  readonly cache: CacheService;
  readonly sandbox: SandboxService;
  /** Sync adapters of enabled modules (Phase 5; used by the Integrations Hub). */
  readonly sync: SyncService;
  /** Connector types of enabled modules (Phase 5; used by the Integrations Hub). */
  readonly connectors: ConnectorsService;
  /** Customisation kinds of enabled modules (Phase 6; used by the AI agent's change sets). */
  readonly customizations: CustomizationsService;
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
  /** Tries per run, scheduled or enqueued (default: 3 scheduled, 5 enqueued); exponential backoff from `backoffMs`. */
  attempts?: number;
  backoffMs?: number;
  timeoutMs?: number;
  handler(job: JobRun<T>, ctx: ModuleContext): Promise<unknown>;
}

export interface SearchHit {
  id: string;
  /** What it is (`ticket`, `article`, `request`): the palette shows the translated `shell.commandPalette.types.<type>`. */
  type: string;
  title: string;
  /** Plain text (a reference, a summary); never a status code — use `status`. */
  subtitle?: string | null;
  href: string;
  icon?: string;
  /** Status as an i18n key in the module's catalog (`itsm.status.in_progress`), shown translated. */
  status?: string | null;
  /** Hits sharing a `group` are one thing in several languages: the viewer sees the one in their `locale`. */
  group?: string | null;
  locale?: string | null;
  /** An exact reference match (`REQ-01020`): listed first. */
  exact?: boolean;
}

export type SearchProvider = (
  query: string,
  ctx: ModuleContext,
  auth: AuthContext,
  limit: number,
) => Promise<SearchHit[]>;

/** One thing waiting for a person (a row on My work). */
export interface WorkItem {
  /** Unique within the source. */
  id: string;
  /** Plain text in the viewer's language: what to do or decide ("Q4 database access review"). */
  title: string;
  /** Plain text: the reference or who asked ("REV-0003", "林雅婷"). */
  subtitle?: string | null;
  /**
   * Translated text after the subtitle: an i18n key in the module's catalog with its ICU values
   * (`{ key: 'isms.work.toCheck', params: { count: 4 } }` → "4 to check").
   */
  detail?: { key: string; params?: Record<string, string | number> } | null;
  /** Opens the item itself (the decision, the form, the review filtered to the person's part). */
  href: string;
  /** When it is due (overdue items are shown first and marked). */
  due?: Date | string | null;
  /** When it arrived. */
  since?: Date | string | null;
}

export interface WorkResult {
  /** Everything waiting for the person in this source (items may be fewer: `limit`). */
  count: number;
  items: WorkItem[];
}

/**
 * Returns what waits for the person in `auth` (never anyone else's work), soonest due first. `limit` 0 asks for the
 * count only (the sidebar badge): skip loading items then. Keep it to one or two indexed queries.
 */
export type WorkProvider = (
  auth: AuthContext,
  ctx: ModuleContext,
  opts: { limit: number; locale: string },
) => Promise<WorkResult>;

/** What a delete is checked against: a record (`cmdb.ci`, …) or another referenced thing (`core.group`). */
export interface ReferenceTarget {
  type: string;
  id: string;
  /** Its key, for things settings may name by key as well as by id (groups). */
  key?: string | null;
}

/**
 * Something a delete would leave broken. `request`, `approval`, `todo` and `work` are open work (a request still in
 * approval or with actions to run, an approval in progress, an open to-do, a ticket or check in progress); `setting`
 * is live configuration whose next use would fail (a published form's action, a scheduled job). Report only what an
 * administrator can resolve (finish, reassign, cancel or archive).
 */
export interface Reference {
  kind: 'request' | 'approval' | 'todo' | 'work' | 'setting';
  /** How people know it: a reference and a name ("REQ-01039 · New laptop"), with no other words. */
  label: string | LocalizedText;
  /** Where to resolve it. */
  href?: string | null;
}

/**
 * A `jsonb_path_match` predicate that is true when a settings document names the group: its id anywhere, or its key
 * where settings name groups by key (`groupKey`, `groups`, `groupKeys`). A select option that reads like the key
 * doesn't count. Bind the variables with {@link groupPathVars}:
 * `sql\`jsonb_path_match(${col}, ${GROUP_JSONPATH}::jsonpath, ${groupPathVars(t)}::jsonb)\``.
 */
export const GROUP_JSONPATH =
  'exists($.** ? (@ == $id)) || exists($.**.groupKey ? (@ == $key)) || exists($.**.groupKeys ? (@ == $key)) || exists($.**.groups ? (@ == $key))';

export const groupPathVars = (t: ReferenceTarget) => JSON.stringify({ id: t.id, key: t.key ?? t.id });

/**
 * Lists what in this module still uses `target`, read in the deleting transaction `tx` (at most `limit`). Deletes are
 * refused with `IN_USE` while anything does (`docs/ai/recipes.md`). Report only what would break or be orphaned:
 * closed work and history never block a delete. Keep it to one or two indexed queries.
 */
export type ReferenceFinder = (
  target: ReferenceTarget,
  ctx: ModuleContext,
  opts: { tx: Db; limit: number },
) => Promise<Reference[]>;

/** Decides whether a navigation entry marked `check: true` is shown to this person (after its permission). */
export type NavigationCheck = (auth: AuthContext, ctx: ModuleContext) => Promise<boolean>;

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
  /** Providers for `manifest.work`, keyed by source (without the module prefix). */
  work?: Record<string, WorkProvider>;
  /** Visibility checks for `manifest.navigation` entries marked `check: true`, keyed by entry id. */
  navigation?: Record<string, NavigationCheck>;
  /** Resolvers for `manifest.records.types`, keyed by type (without the module prefix). */
  records?: Record<string, RecordResolver>;
  /**
   * What in this module still uses another module's record or thing, keyed by the referenced type **with** its module
   * prefix (`core.group`, `cmdb.ci`); `*` answers for every record type. Asked before a group is deleted and by
   * `ctx.records.forget`, which refuses the delete with `IN_USE` listing them.
   */
  references?: Record<string, ReferenceFinder>;
  /** Handlers for `manifest.taskTypes`, keyed by type (without the module prefix). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskTypes?: Record<string, TaskTypeHandler<any>>;
  /** Adapters for `manifest.syncEntities`, keyed by entity (without the module prefix). */
  sync?: Record<string, SyncAdapter>;
  /** Handlers for `manifest.connectors`, keyed by type (without the module prefix). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connectors?: Record<string, ConnectorHandler<any, any>>;
  /**
   * Called (in the worker) for every event an enabled module's sync entity lists in `events` or
   * `commentEvents`, with the record id resolved. The Integrations Hub pushes local changes from here.
   */
  onSyncChange?: (change: SyncChange, ctx: ModuleContext) => Promise<void>;
  /** Handlers for `manifest.processActions`, keyed by action (without the module prefix). */
  processActions?: Record<string, ProcessActionHandler>;
  /** Handlers for `manifest.customizations`, keyed by kind (without the module prefix). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customizations?: Record<string, CustomizationHandler<any>>;
  /**
   * Content of `manifest.customizationPackages`, keyed by package key: returns the package (static data, built or
   * read when someone lists or installs it). Installing creates a draft change set (`docs/ai/recipes.md`). It is
   * built for the installer's `locale` (the viewer's when listing; English for API clients): values the kinds keep
   * as plain text — group and job names, reminder titles — are written in that language. Built once per locale.
   */
  customizationPackages?: Record<
    string,
    (opts: { locale: Locale }) => ChangeSetPackage | Promise<ChangeSetPackage>
  >;
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
  const recordTypes = new Set(manifest.records?.types.map((r) => r.type) ?? []);
  for (const type of recordTypes) {
    if (!options.records?.[type])
      throw new Error(`[${manifest.id}] record type "${type}" has no resolver in records`);
  }
  for (const type of Object.keys(options.records ?? {})) {
    if (!recordTypes.has(type))
      throw new Error(`[${manifest.id}] records resolver "${type}" is not declared in manifest.records`);
  }
  const taskTypes = new Set(manifest.taskTypes?.map((t) => t.type) ?? []);
  for (const type of taskTypes) {
    if (!options.taskTypes?.[type])
      throw new Error(`[${manifest.id}] task type "${type}" has no handler in taskTypes`);
  }
  for (const type of Object.keys(options.taskTypes ?? {})) {
    if (!taskTypes.has(type))
      throw new Error(`[${manifest.id}] task type handler "${type}" is not declared in manifest.taskTypes`);
  }
  const syncEntities = new Map(manifest.syncEntities?.map((e) => [e.entity, e]) ?? []);
  for (const [entity, def] of syncEntities) {
    const adapter = options.sync?.[entity];
    if (!adapter) throw new Error(`[${manifest.id}] sync entity "${entity}" has no adapter in sync`);
    if (def.commentEvents?.length && !adapter.comments)
      throw new Error(
        `[${manifest.id}] sync entity "${entity}" lists commentEvents but its adapter has no comments`,
      );
  }
  for (const entity of Object.keys(options.sync ?? {})) {
    if (!syncEntities.has(entity))
      throw new Error(`[${manifest.id}] sync adapter "${entity}" is not declared in manifest.syncEntities`);
  }
  const connectorTypes = new Set(manifest.connectors?.map((c) => c.type) ?? []);
  for (const type of connectorTypes) {
    if (!options.connectors?.[type])
      throw new Error(`[${manifest.id}] connector "${type}" has no handler in connectors`);
  }
  for (const type of Object.keys(options.connectors ?? {})) {
    if (!connectorTypes.has(type))
      throw new Error(`[${manifest.id}] connector handler "${type}" is not declared in manifest.connectors`);
  }
  const kinds = new Set(manifest.customizations?.map((k) => k.kind) ?? []);
  for (const kind of kinds) {
    if (!options.customizations?.[kind])
      throw new Error(`[${manifest.id}] customisation kind "${kind}" has no handler in customizations`);
  }
  for (const kind of Object.keys(options.customizations ?? {})) {
    if (!kinds.has(kind))
      throw new Error(
        `[${manifest.id}] customisation handler "${kind}" is not declared in manifest.customizations`,
      );
  }
  const packages = new Set(manifest.customizationPackages?.map((p) => p.key) ?? []);
  for (const key of packages) {
    if (typeof options.customizationPackages?.[key] !== 'function')
      throw new Error(`[${manifest.id}] package "${key}" has no content in customizationPackages`);
  }
  for (const key of Object.keys(options.customizationPackages ?? {})) {
    if (!packages.has(key))
      throw new Error(
        `[${manifest.id}] package content "${key}" is not declared in manifest.customizationPackages`,
      );
  }
  const actions = new Set(manifest.processActions?.map((a) => a.action) ?? []);
  for (const action of actions) {
    if (!options.processActions?.[action])
      throw new Error(`[${manifest.id}] process action "${action}" has no handler in processActions`);
  }
  for (const action of Object.keys(options.processActions ?? {})) {
    if (!actions.has(action))
      throw new Error(
        `[${manifest.id}] process action handler "${action}" is not declared in manifest.processActions`,
      );
  }
  const workSources = new Set(manifest.work?.map((w) => w.key) ?? []);
  for (const key of workSources) {
    if (typeof options.work?.[key] !== 'function')
      throw new Error(`[${manifest.id}] work source "${key}" has no provider in work`);
  }
  for (const key of Object.keys(options.work ?? {})) {
    if (!workSources.has(key))
      throw new Error(`[${manifest.id}] work provider "${key}" is not declared in manifest.work`);
  }
  const checked = new Set<string>();
  const walk = (entries: NavEntry[] | undefined): void =>
    entries?.forEach((e) => {
      if (e.check) checked.add(e.id);
      walk(e.children);
      walk(e.tabs);
    });
  walk(manifest.navigation);
  for (const id of checked) {
    if (typeof options.navigation?.[id] !== 'function')
      throw new Error(`[${manifest.id}] navigation entry "${id}" has check: true but no check in navigation`);
  }
  for (const id of Object.keys(options.navigation ?? {})) {
    if (!checked.has(id))
      throw new Error(`[${manifest.id}] navigation check "${id}" is not an entry marked check: true`);
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

/* ───────────────────────────── process actions ───────────────────────────── */

/** The request a process action runs for (a form submission), with its answers. */
export interface ProcessActionRequest {
  id: string;
  /** `REQ-01042`. */
  reference: string;
  href: string;
  form: { key: string; name: LocalizedText };
  outcome: ProcessActionOutcome;
  /** Cleaned answers by field key (`record` fields hold refs `type:id`). */
  data: Record<string, unknown>;
  /** Approval facts of the records picked in `record` fields, by field key (a list for multi-pick fields). */
  records: Record<string, unknown>;
  /**
   * What approvers filled in with their decisions (`ApprovalStep.fields`), by step id then field key, e.g.
   * `steps.review.wipeDate`; with several approvers on a step, the latest decision's value of each field.
   */
  steps: Record<string, Record<string, unknown>>;
  requester: { id: string; displayName: string; email: string; departmentId: string | null } | null;
  /** Who made the final decision (approved / rejected outcomes). */
  decidedBy: { id: string; displayName: string } | null;
}

export interface ProcessActionInput {
  /**
   * The action's configuration, validated against its fields, with `{{…}}` templates already rendered in `text` and
   * `textarea` fields (other values — URLs, choices, people — are used exactly as configured). Values of the
   * handler's `secrets` arrive opened (plain text): never log or return them.
   */
  config: Record<string, unknown>;
  request: ProcessActionRequest;
  /**
   * This run's id: the same on every attempt and retry, so use it to make `run` idempotent (e.g. store it on the
   * record you create and return that record when it already exists).
   */
  runId: string;
  /** 1 for the first attempt. */
  attempt: number;
  /**
   * Who the action acts as: a system principal holding the providing module's own permissions, named after the
   * form; audit entries carry the request and the approver.
   */
  auth: AuthContext;
}

export interface ProcessActionResult {
  /** What it created or changed, e.g. `CHG-00042`, shown on the request. */
  reference?: string | null;
  href?: string | null;
  /** An i18n key in the module's catalog (`itsm.processActions.createChange.submitted`), or short plain text. */
  summary?: string | null;
  /**
   * Values of the summary's ICU arguments (`{ date: '2026-11-01T01:00:00.000Z' }` for "Reminder set for {date, date,
   * long}"): strings and numbers; ISO dates and date-times are passed to the message as dates.
   */
  summaryParams?: Record<string, string | number> | null;
  /** A record to link to the request's records (e.g. the change it created). */
  record?: RecordRef | null;
}

/**
 * A process action (`manifest.processActions`): `fields` describe its configuration in the form builder (the
 * shared FieldDef model; text fields accept templates), `run` does the work in the worker after commit. Throw
 * `HttpError` for a permanent failure (no retry); other errors are retried with backoff.
 */
export interface ProcessActionHandler {
  /**
   * The configuration fields. Options may come from live data and from the form's own fields (`form`, e.g. "the
   * person in field …"). `auth` is the administrator configuring the form when there is one (to narrow choices to
   * what they may hand out); without it (validating a saved form) return every valid choice.
   */
  fields(
    ctx: ModuleContext,
    opts: { form: FormSchema | null; locale: string; auth?: AuthContext },
  ): Promise<FieldDef[]> | FieldDef[];
  /**
   * Checks beyond the fields, for the administrator who adds or changes the action (e.g. "may they grant this
   * role?", "is this host allowed?"). Throw `HttpError` to refuse: 400 `VALIDATION_FAILED` with
   * `details.issues: [{ path: '<config key>', message }]`, or 403.
   */
  validate?(
    config: Record<string, unknown>,
    ctx: ModuleContext,
    opts: { form: FormSchema; auth: AuthContext },
  ): Promise<void>;
  /**
   * Config keys (text fields) that hold secrets, such as a header value: sealed when the form is saved, never
   * returned to the browser (it sees `{ set: true }`) and opened only for `run`.
   */
  secrets?: readonly string[];
  /**
   * Config keys whose templates are rendered with JSON string escaping, for text that becomes a JSON document
   * (`{"title": "{{data.title}}"}` stays valid whatever the answer holds).
   */
  jsonTemplates?: readonly string[];
  run(input: ProcessActionInput, ctx: ModuleContext): Promise<ProcessActionResult>;
}
