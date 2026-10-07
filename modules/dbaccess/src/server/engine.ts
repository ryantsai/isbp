/**
 * Runs the statement builders of `ddl.ts` through `ctx.databases` (purpose `admin`) — the module never opens
 * a database connection itself. Errors keep the server's code and message (never values or credentials).
 */
import {
  type DatabaseErrorInfo,
  type DbConnectionInfo,
  ErrorCodes,
  HttpError,
  type ModuleContext,
} from '@isbp/sdk/server';
import { isManagedEngine, type ManagedEngine } from '../model';
import {
  accountQuery,
  grantorQuery,
  inventoryQueries,
  membershipQuery,
  mssqlDatabaseInventory,
  type Query,
  type RoleTarget,
  type Step,
} from './ddl';

/** Row keys lower-cased (Oracle reports `NAME`). */
const lowerKeys = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));

export const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 't' || v === 'true';

/** A one-line, credential-free description of a failure for grants and alerts. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpError) {
    const d = err.details as Partial<DatabaseErrorInfo> | undefined;
    if (err.code === ErrorCodes.DATABASE_ERROR && d?.message)
      return `${d.dbCode ? `${d.dbCode}: ` : ''}${d.message}`.slice(0, 1_000);
    return `${err.code}: ${err.message}`.slice(0, 1_000);
  }
  return String((err as Error)?.message ?? err).slice(0, 1_000);
}

export class DbExecutor {
  constructor(
    private readonly ctx: ModuleContext,
    readonly connection: DbConnectionInfo,
    private readonly opts: { signal?: AbortSignal; log?: (line: string) => void } = {},
  ) {}

  get engine(): ManagedEngine {
    const e = this.connection.engine;
    if (!isManagedEngine(e))
      throw new HttpError(409, ErrorCodes.INVALID_STATE, `${e} servers are not managed by Database access`);
    return e;
  }

  async query(q: Query, maxRows = 10_000): Promise<Record<string, unknown>[]> {
    const r = await this.ctx.databases.query(this.connection.id, q.sql, {
      purpose: 'admin',
      params: q.params,
      maxRows,
      signal: this.opts.signal,
    });
    return r.rows.map(lowerKeys);
  }

  async run(steps: Step[]): Promise<void> {
    for (const step of steps) {
      this.opts.log?.(step.label);
      const r = await this.ctx.databases.query(this.connection.id, step.sql, {
        purpose: 'admin',
        params: step.params,
        maxRows: 1,
        signal: this.opts.signal,
      });
      if (!step.generated) continue;
      const stmt = r.rows.map(lowerKeys)[0]?.stmt;
      if (typeof stmt !== 'string' || !stmt)
        throw new HttpError(422, ErrorCodes.DATABASE_ERROR, 'The server did not build the statement', {
          kind: 'other',
          dbCode: null,
          message: 'The server did not build the statement',
        } satisfies DatabaseErrorInfo);
      await this.ctx.databases.query(this.connection.id, stmt, {
        purpose: 'admin',
        maxRows: 1,
        signal: this.opts.signal,
      });
    }
  }

  /** `{ enabled }` when the account exists. */
  async account(login: string): Promise<{ enabled: boolean } | null> {
    const [row] = await this.query(accountQuery(this.engine, login), 1);
    return row ? { enabled: truthy(row.enabled) } : null;
  }

  async isMember(t: RoleTarget): Promise<boolean> {
    return (await this.query(membershipQuery(this.engine, t), 1)).length > 0;
  }

  /** PostgreSQL: who granted a membership (only the grantor or a superuser may revoke it, PostgreSQL 16+). */
  async grantors(t: RoleTarget): Promise<string[]> {
    const rows = await this.query(grantorQuery(t), 10);
    return rows.map((r) => String(r.grantor));
  }

  /** Accounts, roles and memberships as the server reports them. */
  async inventory(databases: readonly string[]): Promise<RawInventory> {
    const engine = this.engine;
    const queries = inventoryQueries(engine);
    if (engine === 'oracle') {
      try {
        return {
          accounts: await this.query(queries.accounts),
          roles: (await this.query(queries.roles)).map((r) => ({ ...r, database: '' })),
          memberships: (await this.query(queries.memberships)).map((m) => ({ ...m, database: '' })),
          limited: false,
        };
      } catch (err) {
        // ORA-00942: the login cannot read the DBA views — fall back to what every user may see.
        if (!(err instanceof HttpError) || !/ORA-00942|00942/.test(errorMessage(err))) throw err;
        this.opts.log?.('DBA views not readable: falling back to ALL_USERS');
        return {
          accounts: await this.query(queries.fallback!.accounts),
          roles: (await this.query(queries.fallback!.roles)).map((r) => ({ ...r, database: '' })),
          memberships: [],
          limited: true,
        };
      }
    }
    const accounts = await this.query(queries.accounts);
    if (engine === 'postgres') {
      return {
        accounts,
        roles: [],
        memberships: (await this.query(queries.memberships)).map((m) => ({ ...m, database: '' })),
        limited: false,
      };
    }
    const roles = (await this.query(queries.roles)).map((r) => ({ ...r, database: '' }));
    const memberships = (await this.query(queries.memberships)).map((m) => ({ ...m, database: '' }));
    for (const db of databases) {
      const q = mssqlDatabaseInventory(db);
      roles.push(...(await this.query(q.roles)).map((r) => ({ ...r, database: db })));
      memberships.push(...(await this.query(q.memberships)).map((m) => ({ ...m, database: db })));
    }
    return { accounts, roles, memberships, limited: false };
  }
}

export interface RawInventory {
  accounts: Record<string, unknown>[];
  roles: Record<string, unknown>[];
  memberships: Record<string, unknown>[];
  /** The login could not read everything (Oracle without DBA views). */
  limited: boolean;
}

/** The connection behind a server, or a 409 the UI can explain. */
export async function connectionOf(ctx: ModuleContext, connectionId: string): Promise<DbConnectionInfo> {
  const c = await ctx.databases.get(connectionId);
  if (!c)
    throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The database connection of this server was removed');
  if (!c.purposes.includes('admin'))
    throw new HttpError(403, ErrorCodes.CONNECTION_PURPOSE, `Connection ${c.name} is not for admin use`, {
      purpose: 'admin',
    });
  return c;
}
