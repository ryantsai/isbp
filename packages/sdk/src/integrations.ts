/**
 * Phase 5 extension points for the Integrations Hub.
 *
 * - **Sync adapters** belong to the module that owns the data (`itsm.ticket`, `projects.task`). They describe
 *   the entity's fields and read and write records with the module's own rules. Declared in
 *   `manifest.syncEntities`, implemented in `defineServerModule({ sync })`, reached through `ctx.sync`.
 * - **Connectors** belong to the module that knows an outside system (ServiceDesk Plus, Azure DevOps). They
 *   read and write remote objects. Declared in `manifest.connectors`, implemented in
 *   `defineServerModule({ connectors })`, reached through `ctx.connectors`.
 *
 * The hub (module `integrations`) owns connections, sync profiles, field mappings, links between local and
 * remote records, runs and conflicts. Neither side knows about the other: the hub maps fields between them.
 */
import type { AuthContext, CacheService, Db, DomainEvent, HttpClient, ModuleContext } from './server';

/* ───────────────────────────── shared field model ───────────────────────────── */

/**
 * Field types both sides use. The hub converts between them where it makes sense (html ↔ markdown/text,
 * user ↔ email, choice ↔ choice through a value map, parent ↔ parent through the link table).
 *
 * Value shapes: `string`/`text`/`markdown`/`html` → string; `number` → number; `boolean` → boolean;
 * `date` → `YYYY-MM-DD`; `datetime` → ISO 8601; `choice` → string (a choice value); `tags` → string[];
 * `user` → local: user id, remote: {@link RemoteUser}; `parent` → a record id on the same side;
 * `json` → any JSON. Empty is `null`.
 */
export type SyncFieldType =
  | 'string'
  | 'text'
  | 'markdown'
  | 'html'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'choice'
  | 'tags'
  | 'user'
  | 'parent'
  | 'json';

/** A label: an i18n key of the owning module, or literal text per locale (custom fields, remote names). */
export type SyncLabel = string | Record<string, string>;

export interface SyncChoice {
  value: string;
  label: SyncLabel;
}

export interface SyncFieldDef {
  key: string;
  label: SyncLabel;
  type: SyncFieldType;
  /** For `choice`: the allowed values. */
  choices?: SyncChoice[];
  /** Must have a value to create a record. */
  required?: boolean;
  /** Read for pushing, never written by a sync (references, computed values). */
  readOnly?: boolean;
  /** Can be set when creating but not changed later (a ticket's type). */
  createOnly?: boolean;
  maxLength?: number;
}

/* ───────────────────────────── sync adapters (data modules) ───────────────────────────── */

export interface SyncRecord {
  id: string;
  /** Human reference (`INC-00042`, `NET-12`) and title, for lists and the conflict queue. */
  ref?: string | null;
  title: string;
  /** Web path of the record page. */
  href: string;
  /** ISO 8601. */
  updatedAt: string;
  containerId?: string | null;
  /** Field key → value, for every field in the catalogue. */
  values: Record<string, unknown>;
}

/** Where a sync write comes from: shown in the record's history and the audit log. */
export interface SyncSource {
  connectionId: string;
  connectionName: string;
  /** `<module>.<type>` of the connector. */
  connector: string;
  /** The remote record's reference ("#1234", "Bug 812") and web URL. */
  remoteRef: string;
  remoteUrl?: string | null;
}

export interface SyncWriteInput {
  /** Omit to create. */
  id?: string;
  /** Required to create a record of an entity with a `container`. */
  containerId?: string | null;
  /** Only the fields to change. On create, fields left out get the module's defaults. */
  values: Record<string, unknown>;
}

export interface SyncWriteOptions {
  /** Who writes: the hub's agent identity. The kernel has checked the entity's `permission`. */
  auth: AuthContext;
  /** Write, audit and publish in this transaction (the hub updates its link in the same one). */
  tx: Db;
  source: SyncSource;
}

export interface SyncComment {
  id: string;
  /** Markdown or plain text. */
  body: string;
  authorName: string;
  authorEmail?: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** Internal notes (agents only) vs comments the requester sees. */
  internal?: boolean;
}

export interface SyncCommentInput {
  body: string;
  authorName: string;
  authorEmail?: string | null;
  createdAt?: string;
  internal?: boolean;
}

/**
 * `defineServerModule({ sync: { [entity]: adapter } })`. Runs in the owning module's context. Throw
 * `HttpError` (usually 422 `VALIDATION_FAILED` or 409 `INVALID_TRANSITION`) to refuse a write; the hub records
 * it on the item and carries on with the rest.
 */
export interface SyncAdapter {
  /** The field catalogue. `containerId` narrows container-specific choices (a project's milestones). */
  fields(ctx: ModuleContext, opts?: { containerId?: string | null }): Promise<SyncFieldDef[]>;
  /** One record, or null when it no longer exists. */
  read(id: string, ctx: ModuleContext): Promise<SyncRecord | null>;
  /** Several records; missing ids are left out. */
  readMany(ids: string[], ctx: ModuleContext): Promise<SyncRecord[]>;
  /**
   * Records in update order (oldest first), for a first push and for matching existing records. `after` is
   * the opaque cursor a previous page returned.
   */
  list(
    opts: { containerId?: string | null; since?: string | null; after?: string | null; limit: number },
    ctx: ModuleContext,
  ): Promise<{ items: SyncRecord[]; next: string | null }>;
  /**
   * Finds an existing record by a natural key (a serial number, a repository URL, a title), so a first sync
   * links records both sides already have instead of duplicating them. Return null when none or ambiguous.
   */
  findBy?(
    field: string,
    value: unknown,
    opts: { containerId?: string | null },
    ctx: ModuleContext,
  ): Promise<SyncRecord | null>;
  /** Field keys `findBy` supports. */
  matchKeys?: string[];
  write(input: SyncWriteInput, opts: SyncWriteOptions, ctx: ModuleContext): Promise<{ id: string }>;
  /** The record an event (from `events` or `commentEvents`) is about. */
  idFromEvent(event: DomainEvent): string | null;
  /** When the entity syncs comments (declare `commentEvents`). */
  comments?: {
    list(id: string, ctx: ModuleContext): Promise<SyncComment[]>;
    add(
      id: string,
      comment: SyncCommentInput,
      opts: SyncWriteOptions,
      ctx: ModuleContext,
    ): Promise<{ id: string }>;
  };
}

export interface SyncEntityInfo {
  /** `<module>.<entity>`. */
  entity: string;
  moduleId: string;
  name: string;
  icon: string | null;
  permission: string;
  container: string | null;
  comments: boolean;
  /** It is also a record type (`ctx.records` resolves its titles for a caller). */
  recordType: boolean;
  /** Field keys existing records can be matched on (`findBy`). */
  matchKeys: string[];
}

/** A local change the hub may push: from an entity's `events` or `commentEvents`. */
export interface SyncChange {
  entity: string;
  id: string;
  kind: 'record' | 'comment';
  event: DomainEvent;
}

/** `ctx.sync`: the sync adapters of enabled modules. */
export interface SyncService {
  /** Entities of enabled modules; with `auth`, only those whose `permission` it holds. */
  entities(auth?: AuthContext): SyncEntityInfo[];
  fields(entity: string, opts?: { containerId?: string | null }): Promise<SyncFieldDef[]>;
  read(entity: string, id: string): Promise<SyncRecord | null>;
  readMany(entity: string, ids: string[]): Promise<SyncRecord[]>;
  list(
    entity: string,
    opts: { containerId?: string | null; since?: string | null; after?: string | null; limit: number },
  ): Promise<{ items: SyncRecord[]; next: string | null }>;
  /**
   * Checks the entity's `permission` for `opts.auth` (403), drops nothing silently: unknown, read-only and
   * (on update) create-only fields and invalid choice values are refused with 422 `VALIDATION_FAILED`.
   * Returns the record as stored, read in the same transaction: the module may have normalized what was
   * written (defaults, a status named for the record's type), and that is what both sides now agree on.
   */
  write(
    entity: string,
    input: SyncWriteInput,
    opts: SyncWriteOptions,
  ): Promise<{ id: string; record: SyncRecord | null }>;
  /** null when the adapter can't match on `field` or nothing (or more than one record) matches. */
  findBy(
    entity: string,
    field: string,
    value: unknown,
    opts?: { containerId?: string | null },
  ): Promise<SyncRecord | null>;
  comments: {
    list(entity: string, id: string): Promise<SyncComment[]>;
    add(
      entity: string,
      id: string,
      comment: SyncCommentInput,
      opts: SyncWriteOptions,
    ): Promise<{ id: string }>;
  };
}

/* ───────────────────────────── connectors (outside systems) ───────────────────────────── */

/** A person in an outside system; the hub matches them to local users by email. */
export interface RemoteUser {
  email: string | null;
  name: string;
  /** The remote system's own id, when it has one. */
  id?: string | null;
}

export interface RemoteFieldDef {
  key: string;
  /** The remote system's own label (not translated). */
  label: string;
  type: SyncFieldType;
  choices?: { value: string; label: string }[];
  required?: boolean;
  readOnly?: boolean;
  createOnly?: boolean;
}

export interface RemoteRecord {
  id: string;
  /** "#1234", "Bug 812". */
  ref: string;
  title: string;
  /** The record's page in the outside system. */
  url: string | null;
  /** Opaque version for optimistic concurrency (Azure DevOps `rev`, ServiceDesk Plus last-updated time). */
  version: string;
  /** ISO 8601. */
  updatedAt: string;
  /** The parent's remote id, for objects with `hierarchy`. */
  parentId?: string | null;
  /** The remote scope it lives in, for `scoped` objects. */
  scope?: string | null;
  /** The remote system reports it deleted (or moved out of reach). */
  deleted?: boolean;
  /** Remote field key → value, in the shapes of {@link SyncFieldType} (users as {@link RemoteUser}). */
  values: Record<string, unknown>;
}

export interface RemoteComment {
  id: string;
  body: string;
  format: 'html' | 'text' | 'markdown';
  author: RemoteUser;
  /** ISO 8601. */
  createdAt: string;
  internal?: boolean;
}

export interface RemoteChangesPage {
  items: RemoteRecord[];
  /** Pass back to continue; persisted by the hub between runs. */
  cursor: string | null;
  hasMore: boolean;
}

/** Everything a connector call gets: the connection's settings and opened secrets, and safe I/O. */
export interface ConnectorContext<C = unknown, S = unknown> {
  connectionId: string;
  config: C;
  secrets: S;
  /**
   * `ctx.http` limited to the hosts `hosts(config)` returned (other hosts: 422 `TARGET_BLOCKED`). Private
   * addresses are allowed for them, because on-premises servers live there; link-local and metadata never.
   * Plain `http://` is refused (422 `INSECURE_HTTP`) unless the connection allows insecure HTTP, except for
   * loopback hosts (the development stand-ins). Connector config schemas accept both schemes; this enforces it.
   */
  http: HttpClient;
  /** Redis scoped to this connection (OAuth access tokens). */
  cache: CacheService;
  signal?: AbortSignal;
}

export interface RemoteScope {
  id: string;
  name: string;
}

export interface RemoteWriteOptions {
  scope?: string | null;
  parentId?: string | null;
  /** Refuse with 409 `REMOTE_CONFLICT` when the remote version differs. */
  expectedVersion?: string | null;
}

/** A mapping a connector suggests for one of its objects and a sync entity. */
export interface FieldMappingSuggestion {
  local: string;
  remote: string;
  direction: 'both' | 'pull' | 'push';
  /**
   * Value map for choices. A row's `direction` (default `both`) says which way it applies, so several remote
   * values can become one local value (pull rows) and one local value can go out as one remote value (a
   * single push-capable row per local value, a single pull-capable row per remote value).
   */
  values?: { remote: string; local: string; direction?: 'both' | 'pull' | 'push' }[];
}

/**
 * `defineServerModule({ connectors: { [type]: handler } })`. Remote failures throw `HttpError`:
 * 502 `REMOTE_AUTH_FAILED` (credentials refused), 429 `REMOTE_RATE_LIMITED` (`details.retryAfterSeconds`),
 * 409 `REMOTE_CONFLICT` (version mismatch), 422 `REMOTE_REJECTED` (`details.message` from the remote system),
 * 502 `UPSTREAM_FAILED` (anything else). A missing record is `null` from `get`, not an error.
 */
export interface ConnectorHandler<C = unknown, S = unknown> {
  /** Host names this connection may call (from its config). */
  hosts(config: C): string[];
  /** Signs in and reads something cheap. `account` describes who/where ("Contoso portal as svc-isbp"). */
  test(conn: ConnectorContext<C, S>): Promise<{ ok: boolean; message?: string; account?: string }>;
  /** Remote scopes to choose from, for `scoped` objects (Azure DevOps team projects). */
  scopes?(conn: ConnectorContext<C, S>, objectType: string): Promise<RemoteScope[]>;
  fields(conn: ConnectorContext<C, S>, objectType: string, scope?: string | null): Promise<RemoteFieldDef[]>;
  /** One page of records changed after `cursor` (null: from the beginning), oldest first. */
  changes(
    conn: ConnectorContext<C, S>,
    objectType: string,
    opts: { scope?: string | null; cursor: string | null; limit: number },
  ): Promise<RemoteChangesPage>;
  get(
    conn: ConnectorContext<C, S>,
    objectType: string,
    id: string,
    opts?: { scope?: string | null },
  ): Promise<RemoteRecord | null>;
  create?(
    conn: ConnectorContext<C, S>,
    objectType: string,
    values: Record<string, unknown>,
    opts: RemoteWriteOptions,
  ): Promise<RemoteRecord>;
  update?(
    conn: ConnectorContext<C, S>,
    objectType: string,
    id: string,
    values: Record<string, unknown>,
    opts: RemoteWriteOptions,
  ): Promise<RemoteRecord>;
  comments?: {
    list(
      conn: ConnectorContext<C, S>,
      objectType: string,
      id: string,
      opts?: { scope?: string | null },
    ): Promise<RemoteComment[]>;
    add(
      conn: ConnectorContext<C, S>,
      objectType: string,
      id: string,
      comment: { body: string; format: 'html' | 'text' | 'markdown'; internal?: boolean },
      opts?: { scope?: string | null },
    ): Promise<RemoteComment>;
  };
  /**
   * Reads an inbound webhook (the hub has already checked its secret) and says which records changed. The hub
   * fetches them with `get`: a webhook body is never trusted for data.
   */
  webhook?(
    conn: ConnectorContext<C, S>,
    req: { headers: Record<string, string>; body: unknown },
  ): Promise<{ objectType: string; id: string; scope?: string | null }[]>;
  /** Default field mapping between one of its objects and a sync entity (validated against both catalogues). */
  defaultMapping?(objectType: string, entity: string): FieldMappingSuggestion[];
}

export interface ConnectorInfo {
  /** `<module>.<type>`. */
  type: string;
  moduleId: string;
  name: string;
  description: string | null;
  icon: string | null;
  /** JSON Schemas, for generic editors. */
  configSchema: unknown;
  secretsSchema: unknown;
  /** Keys of the secrets object. */
  secretKeys: string[];
  objects: {
    type: string;
    name: string;
    entities: string[];
    capabilities: {
      create: boolean;
      update: boolean;
      comments: boolean;
      webhooks: boolean;
      hierarchy: boolean;
    };
    scoped: boolean;
  }[];
}

/** A connection opened for calls: the handler with its context bound. */
export interface OpenConnector {
  info: ConnectorInfo;
  hosts(): string[];
  test(): Promise<{ ok: boolean; message?: string; account?: string }>;
  scopes(objectType: string): Promise<RemoteScope[]>;
  fields(objectType: string, scope?: string | null): Promise<RemoteFieldDef[]>;
  changes(
    objectType: string,
    opts: { scope?: string | null; cursor: string | null; limit: number },
  ): Promise<RemoteChangesPage>;
  get(objectType: string, id: string, opts?: { scope?: string | null }): Promise<RemoteRecord | null>;
  /** 409 `NOT_SUPPORTED` when the object can't be created or updated. */
  create(
    objectType: string,
    values: Record<string, unknown>,
    opts: RemoteWriteOptions,
  ): Promise<RemoteRecord>;
  update(
    objectType: string,
    id: string,
    values: Record<string, unknown>,
    opts: RemoteWriteOptions,
  ): Promise<RemoteRecord>;
  comments: {
    list(objectType: string, id: string, opts?: { scope?: string | null }): Promise<RemoteComment[]>;
    add(
      objectType: string,
      id: string,
      comment: { body: string; format: 'html' | 'text' | 'markdown'; internal?: boolean },
      opts?: { scope?: string | null },
    ): Promise<RemoteComment>;
  };
  webhook(req: {
    headers: Record<string, string>;
    body: unknown;
  }): Promise<{ objectType: string; id: string; scope?: string | null }[]>;
  defaultMapping(objectType: string, entity: string): FieldMappingSuggestion[];
}

/** `ctx.connectors`: the connector types of enabled modules. */
export interface ConnectorsService {
  list(): ConnectorInfo[];
  /** Parses settings with the connector's schemas (400 `VALIDATION_FAILED` with `issues`). */
  validate(type: string, config: unknown, secrets: unknown): { config: unknown; secrets: unknown };
  /**
   * Binds a connection. `secrets` are the opened (plain) values; they stay in memory for the call. 404 for
   * an unknown type, 409 `MODULE_DISABLED` when its module is off.
   */
  open(
    type: string,
    connection: {
      id: string;
      config: unknown;
      secrets: unknown;
      signal?: AbortSignal;
      /**
       * The connection's explicit "Allow insecure HTTP" switch. Without it, `conn.http` refuses `http://` URLs
       * (except loopback hosts) with 422 `INSECURE_HTTP`, so credentials never cross the network in clear text.
       */
      allowInsecureHttp?: boolean;
    },
  ): OpenConnector;
}
