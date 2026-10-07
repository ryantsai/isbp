import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { type DbConnectionOptions, type DbConnectionPurpose, dbConnections } from '@isbp/db/schema';
import {
  type Catalog,
  type ConnectionConfig,
  type DbEngine,
  SqlClient,
  SqlError,
  type SqlResult,
} from '@isbp/sql';
import {
  type DatabaseErrorInfo,
  type DatabasesService,
  type Db,
  type DbConnectionInfo,
  type DbPurpose,
  ErrorCodes,
  HttpError,
} from '@isbp/sdk/server';
import { asc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { Counter } from 'prom-client';
import type { SecretBox } from './crypto';
import { registry as metrics } from './metrics';

export type DbConnectionRow = typeof dbConnections.$inferSelect;

const statements = new Counter({
  name: 'isbp_db_statements_total',
  help: 'Statements run on external database connections',
  labelNames: ['engine', 'purpose', 'kind', 'outcome'] as const,
  registers: [metrics],
});

/** Link-local, metadata, "this network" and multicast ranges: never a database (one list per family). */
const blockedV4 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['169.254.0.0', 16],
  ['224.0.0.0', 4],
] as const)
  blockedV4.addSubnet(net, prefix, 'ipv4');
const blockedV6 = new BlockList();
for (const [net, prefix] of [
  ['fe80::', 10],
  ['ff00::', 8],
  ['fd00:ec2::', 32],
  ['::ffff:169.254.0.0', 112],
] as const)
  blockedV6.addSubnet(net, prefix, 'ipv6');

/** Refuses hosts that resolve to link-local/metadata addresses (private networks are fine: databases live there). */
export async function assertDatabaseHost(host: string): Promise<void> {
  const bare = host.replace(/^\[|\]$/g, '');
  let addresses: { address: string; family: number }[];
  try {
    addresses = isIP(bare) ? [{ address: bare, family: isIP(bare) }] : await lookup(bare, { all: true });
  } catch {
    return; // unresolvable now: the driver reports the connection error
  }
  for (const a of addresses) {
    if (a.family === 6 ? blockedV6.check(a.address, 'ipv6') : blockedV4.check(a.address, 'ipv4'))
      throw new HttpError(422, ErrorCodes.TARGET_BLOCKED, `${host} resolves to a blocked address range`, {
        host,
      });
  }
}

/** Maps driver failures to `422 DATABASE_ERROR` with the server's code and message. */
export function databaseError(err: unknown): never {
  if (err instanceof HttpError) throw err;
  const e = err instanceof SqlError ? err : new SqlError('other', String((err as Error)?.message ?? err));
  if (e.kind === 'parameter')
    throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, e.message, { kind: e.kind, message: e.message });
  const details: DatabaseErrorInfo = { kind: e.kind, dbCode: e.dbCode, message: e.message };
  throw new HttpError(422, ErrorCodes.DATABASE_ERROR, e.message, details);
}

export function toInfo(row: DbConnectionRow): DbConnectionInfo {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    engine: row.engine,
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    purposes: row.purposes,
    readOnly: row.readOnly,
    enabled: row.enabled,
    status: row.status,
    serverVersion: row.serverVersion,
    timeoutMs: row.timeoutMs,
    maxRows: row.maxRows,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROW_TTL_MS = 10_000;
const CATALOG_TTL_MS = 5 * 60_000;
const IDLE_CLOSE_MS = 10 * 60_000;

export interface ConnectionDraft {
  engine: DbEngine;
  host: string;
  port: number | null;
  database: string | null;
  username: string;
  password: string | null;
  options: DbConnectionOptions;
  poolMax: number;
}

/**
 * External database connections: one driver pool per connection and process (rebuilt when the row
 * changes, closed when idle), sealed credentials, purpose checks and limits. Modules get
 * `service()` as `ctx.databases`; the admin routes use the rest.
 */
export class DatabaseManager {
  private readonly rows = new Map<string, { at: number; row: DbConnectionRow }>();
  private readonly clients = new Map<string, { version: number; client: SqlClient; lastUsed: number }>();
  private readonly catalogs = new Map<string, { at: number; version: number; catalog: Catalog }>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly deps: { db: Db; box: SecretBox; logger: FastifyBaseLogger }) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  configFor(draft: ConnectionDraft): ConnectionConfig {
    return {
      engine: draft.engine,
      host: draft.host,
      port: draft.port,
      database: draft.database,
      user: draft.username,
      password: draft.password,
      options: draft.options,
      poolMax: draft.poolMax,
      applicationName: 'IS Big Platform',
      connectTimeoutMs: 10_000,
    };
  }

  openPassword(row: Pick<DbConnectionRow, 'passwordSealed'>): string | null {
    return row.passwordSealed ? this.deps.box.decrypt(row.passwordSealed) : null;
  }

  async row(id: string, fresh = false): Promise<DbConnectionRow | null> {
    if (!UUID.test(id)) return null;
    const cached = this.rows.get(id);
    if (!fresh && cached && Date.now() - cached.at < ROW_TTL_MS) return cached.row;
    const [row] = await this.deps.db.select().from(dbConnections).where(eq(dbConnections.id, id)).limit(1);
    if (row) this.rows.set(id, { at: Date.now(), row });
    else this.rows.delete(id);
    return row ?? null;
  }

  async all(): Promise<DbConnectionRow[]> {
    return this.deps.db.select().from(dbConnections).orderBy(asc(dbConnections.name));
  }

  /** Drops cached state after the row changed or was deleted (this process; others within 10 s). */
  forget(id: string) {
    this.rows.delete(id);
    this.catalogs.delete(id);
    const entry = this.clients.get(id);
    if (entry) {
      this.clients.delete(id);
      void entry.client.close();
    }
  }

  private async client(row: DbConnectionRow): Promise<SqlClient> {
    const version = row.updatedAt.getTime();
    const entry = this.clients.get(row.id);
    if (entry && entry.version === version) {
      entry.lastUsed = Date.now();
      return entry.client;
    }
    if (entry) void entry.client.close();
    await assertDatabaseHost(row.host);
    const client = new SqlClient(
      this.configFor({
        ...row,
        password: this.openPassword(row),
        options: { ...row.options, ca: row.options.ca ? this.deps.box.decrypt(row.options.ca) : null },
      }),
    );
    this.clients.set(row.id, { version, client, lastUsed: Date.now() });
    return client;
  }

  private sweep() {
    const now = Date.now();
    for (const [id, entry] of this.clients) {
      if (now - entry.lastUsed > IDLE_CLOSE_MS) {
        this.clients.delete(id);
        void entry.client.close();
      }
    }
  }

  private async use(id: string, purpose: DbPurpose) {
    const row = await this.row(id);
    if (!row) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Database connection not found');
    if (!row.enabled)
      throw new HttpError(409, ErrorCodes.CONNECTION_DISABLED, `Connection ${row.name} is disabled`);
    if (!row.purposes.includes(purpose as DbConnectionPurpose))
      throw new HttpError(
        403,
        ErrorCodes.CONNECTION_PURPOSE,
        `Connection ${row.name} is not for ${purpose} use`,
        {
          purpose,
        },
      );
    return { row, client: await this.client(row) };
  }

  private async measure<T>(row: DbConnectionRow, purpose: DbPurpose, kind: string, fn: () => Promise<T>) {
    try {
      const result = await fn();
      statements.inc({ engine: row.engine, purpose, kind, outcome: 'ok' });
      return result;
    } catch (err) {
      statements.inc({ engine: row.engine, purpose, kind, outcome: 'error' });
      databaseError(err);
    }
  }

  /** Runs `test()` against an unsaved draft (admin "Test connection" before saving). */
  async testDraft(draft: ConnectionDraft) {
    await assertDatabaseHost(draft.host);
    const client = new SqlClient(this.configFor({ ...draft, poolMax: 1 }));
    try {
      const info = await client.test();
      return { ok: true as const, version: info.version, latencyMs: info.latencyMs, error: null };
    } catch (err) {
      const e = err instanceof SqlError ? err : new SqlError('other', String(err));
      return {
        ok: false as const,
        version: null,
        latencyMs: null,
        error: { kind: e.kind, dbCode: e.dbCode, message: e.message },
      };
    } finally {
      await client.close();
    }
  }

  /** Tests a saved connection and records the outcome on its row. */
  async test(id: string) {
    const row = await this.row(id, true);
    if (!row) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Database connection not found');
    let result: Awaited<ReturnType<DatabaseManager['testDraft']>>;
    try {
      const client = await this.client(row);
      const info = await client.test();
      result = { ok: true, version: info.version, latencyMs: info.latencyMs, error: null };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const e = err instanceof SqlError ? err : new SqlError('other', String(err));
      result = {
        ok: false,
        version: null,
        latencyMs: null,
        error: { kind: e.kind, dbCode: e.dbCode, message: e.message },
      };
    }
    await this.deps.db
      .update(dbConnections)
      .set({
        status: result.ok ? 'ok' : 'error',
        serverVersion: result.version ?? row.serverVersion,
        lastCheckedAt: new Date(),
        lastLatencyMs: result.latencyMs,
        lastError: result.error
          ? `${result.error.dbCode ? `${result.error.dbCode}: ` : ''}${result.error.message}`
          : null,
        // Keep updatedAt: a health check must not rebuild the pool.
        updatedAt: row.updatedAt,
      })
      .where(eq(dbConnections.id, id));
    this.rows.delete(id);
    return result;
  }

  async catalog(id: string, opts: { refresh?: boolean } = {}): Promise<Catalog> {
    const row = await this.row(id);
    if (!row) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Database connection not found');
    const version = row.updatedAt.getTime();
    const cached = this.catalogs.get(id);
    if (!opts.refresh && cached && cached.version === version && Date.now() - cached.at < CATALOG_TTL_MS)
      return cached.catalog;
    const client = await this.client(row);
    const catalog = await this.measure(row, 'admin', 'catalog', () =>
      client.catalog(Math.max(row.timeoutMs, 60_000)),
    );
    this.catalogs.set(id, { at: Date.now(), version, catalog });
    return catalog;
  }

  service(): DatabasesService {
    const clamp = (row: DbConnectionRow, timeoutMs?: number, maxRows?: number) => ({
      timeoutMs: Math.min(timeoutMs ?? row.timeoutMs, row.timeoutMs),
      maxRows: Math.min(maxRows ?? 1_000, row.maxRows),
    });
    return {
      list: async (opts = {}) =>
        (await this.all())
          .filter((r) => !opts.purpose || r.purposes.includes(opts.purpose))
          .filter((r) => !opts.enabledOnly || r.enabled)
          .map(toInfo),
      get: async (id) => {
        const row = await this.row(id);
        return row ? toInfo(row) : null;
      },
      query: async (id, sql, opts): Promise<SqlResult> => {
        const { row, client } = await this.use(id, opts.purpose);
        return this.measure(row, opts.purpose, 'query', () =>
          client.query(sql, {
            ...opts,
            ...clamp(row, opts.timeoutMs, opts.maxRows),
            readOnly: opts.readOnly || row.readOnly,
          }),
        );
      },
      call: async (id, procedure, args, opts) => {
        const { row, client } = await this.use(id, opts.purpose);
        return this.measure(row, opts.purpose, 'call', () =>
          client.call(procedure, args, {
            ...opts,
            ...clamp(row, opts.timeoutMs, opts.maxRows),
            readOnly: opts.readOnly || row.readOnly,
          }),
        );
      },
      stream: (id, sql, opts) => {
        const use = (purpose: DbPurpose) => this.use(id, purpose);
        return {
          async *[Symbol.asyncIterator]() {
            const { row, client } = await use(opts.purpose);
            try {
              yield* client.stream(sql, { ...opts, readOnly: opts.readOnly || row.readOnly });
              statements.inc({ engine: row.engine, purpose: opts.purpose, kind: 'stream', outcome: 'ok' });
            } catch (err) {
              statements.inc({ engine: row.engine, purpose: opts.purpose, kind: 'stream', outcome: 'error' });
              databaseError(err);
            }
          },
        };
      },
      writer: async (id, table, opts) => {
        const { row, client } = await this.use(id, opts.purpose);
        if (row.readOnly)
          throw new HttpError(409, ErrorCodes.CONNECTION_READ_ONLY, `Connection ${row.name} is read-only`);
        const writer = await this.measure(row, opts.purpose, 'write', () => client.writer(table, opts));
        return {
          write: (rows) => this.measure(row, opts.purpose, 'write', () => writer.write(rows)),
          commit: () => this.measure(row, opts.purpose, 'commit', () => writer.commit()),
          rollback: () => writer.rollback(),
        };
      },
      catalog: async (id, opts) => {
        await this.use(id, opts.purpose);
        return this.catalog(id, { refresh: opts.refresh });
      },
    };
  }

  async close() {
    clearInterval(this.sweeper);
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(clients.map((c) => c.client.close()));
  }
}
