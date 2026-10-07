import type {
  createDbConnectionSchema,
  testDbConnectionSchema,
  updateDbConnectionSchema,
} from '@isbp/contracts';
import { DEFAULT_DB_PORTS } from '@isbp/contracts';
import { type DbConnectionOptions, dbConnections } from '@isbp/db/schema';
import { type AuthContext, ErrorCodes, HttpError, httpErrors, type ModuleContext } from '@isbp/sdk/server';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { assertDatabaseHost, type DbConnectionRow } from '../../kernel/databases';
import { getKernel } from '../kernel-ref';
import { peopleById, ref } from './people';

type CreateInput = z.output<typeof createDbConnectionSchema>;
type UpdateInput = z.output<typeof updateDbConnectionSchema>;
type TestInput = z.output<typeof testDbConnectionSchema>;

const AUDITED = [
  'name',
  'description',
  'engine',
  'host',
  'port',
  'database',
  'username',
  'purposes',
  'readOnly',
  'enabled',
  'poolMax',
  'timeoutMs',
  'maxRows',
] as const;

/** Administration → Database connections: CRUD, tests and catalog browsing, audited. */
export class DatabaseAdminService {
  constructor(private readonly ctx: ModuleContext) {}

  private get manager() {
    return getKernel().databases;
  }

  private async dto(rows: DbConnectionRow[]) {
    const people = await peopleById(
      this.ctx.db,
      rows.flatMap((r) => [r.createdBy, r.updatedBy]),
    );
    const actor = (id: string | null) => {
      const p = ref(people, id);
      return p ? { id: p.id, name: p.displayName } : null;
    };
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      engine: r.engine,
      host: r.host,
      port: r.port,
      database: r.database,
      username: r.username,
      hasPassword: Boolean(r.passwordSealed),
      options: {
        tls: r.options.tls ?? 'require',
        hasCa: Boolean(r.options.ca),
        instanceName: r.options.instanceName ?? null,
        domain: r.options.domain ?? null,
      },
      purposes: r.purposes,
      readOnly: r.readOnly,
      enabled: r.enabled,
      poolMax: r.poolMax,
      timeoutMs: r.timeoutMs,
      maxRows: r.maxRows,
      status: r.status,
      serverVersion: r.serverVersion,
      lastCheckedAt: r.lastCheckedAt,
      lastLatencyMs: r.lastLatencyMs,
      lastError: r.lastError,
      createdBy: actor(r.createdBy),
      updatedBy: actor(r.updatedBy),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async list() {
    return { items: await this.dto(await this.manager.all()) };
  }

  async get(id: string) {
    const row = await this.manager.row(id, true);
    if (!row) throw httpErrors.notFound('Database connection not found');
    return (await this.dto([row]))[0]!;
  }

  async create(input: CreateInput, auth: AuthContext) {
    await assertDatabaseHost(input.host);
    const userId = auth.user?.id ?? null;
    const row = await this.ctx.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: dbConnections.id })
        .from(dbConnections)
        .where(eq(dbConnections.key, input.key));
      if (existing)
        throw new HttpError(409, ErrorCodes.CONFLICT, `A connection with key ${input.key} exists`, {
          field: 'key',
        });
      const [created] = await tx
        .insert(dbConnections)
        .values({
          key: input.key,
          name: input.name,
          description: input.description,
          engine: input.engine,
          host: input.host,
          port: input.port ?? DEFAULT_DB_PORTS[input.engine],
          database: input.database,
          username: input.username,
          passwordSealed: input.password ? this.ctx.secrets.seal(input.password) : null,
          options: sealOptions(this.ctx, input.options),
          purposes: [...new Set(input.purposes)],
          readOnly: input.readOnly,
          enabled: input.enabled,
          poolMax: input.poolMax,
          timeoutMs: input.timeoutMs,
          maxRows: input.maxRows,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'core.db-connection.created',
          entityType: 'db-connection',
          entityId: created!.id,
          entityLabel: created!.name,
          metadata: { engine: created!.engine, host: created!.host, purposes: created!.purposes },
          category: 'security',
        },
        { tx },
      );
      await this.ctx.events.publish('core.db-connection.created', { connectionId: created!.id }, { tx });
      return created!;
    });
    return (await this.dto([row]))[0]!;
  }

  async update(id: string, input: UpdateInput, auth: AuthContext) {
    const before = await this.manager.row(id, true);
    if (!before) throw httpErrors.notFound('Database connection not found');
    if (input.host) await assertDatabaseHost(input.host);
    const options: DbConnectionOptions = { ...before.options };
    if (input.options) {
      for (const k of ['tls', 'instanceName', 'domain'] as const)
        if (input.options[k] !== undefined) (options as Record<string, unknown>)[k] = input.options[k];
      if (input.options.ca !== undefined)
        options.ca = input.options.ca ? this.ctx.secrets.seal(input.options.ca) : null;
    }
    const patch: Partial<typeof dbConnections.$inferInsert> = {
      ...pick(input, AUDITED),
      options,
      updatedBy: auth.user?.id ?? null,
    };
    if (input.purposes) patch.purposes = [...new Set(input.purposes)];
    if (input.password !== undefined)
      patch.passwordSealed = input.password ? this.ctx.secrets.seal(input.password) : null;
    const row = await this.ctx.transaction(async (tx) => {
      const [updated] = await tx.update(dbConnections).set(patch).where(eq(dbConnections.id, id)).returning();
      const changes = this.ctx.audit.diff(
        before as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
        [...AUDITED],
      );
      if (input.password !== undefined) changes.password = ['•••', input.password ? '••• (changed)' : null];
      if (input.options?.ca !== undefined) changes.ca = ['•••', input.options.ca ? '••• (changed)' : null];
      await this.ctx.audit.record(
        {
          action: 'core.db-connection.updated',
          entityType: 'db-connection',
          entityId: id,
          entityLabel: updated!.name,
          changes,
          category: 'security',
        },
        { tx },
      );
      await this.ctx.events.publish('core.db-connection.updated', { connectionId: id }, { tx });
      return updated!;
    });
    this.manager.forget(id);
    return (await this.dto([row]))[0]!;
  }

  async remove(id: string) {
    const row = await this.manager.row(id, true);
    if (!row) throw httpErrors.notFound('Database connection not found');
    await this.ctx.transaction(async (tx) => {
      await tx.delete(dbConnections).where(eq(dbConnections.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.db-connection.deleted',
          entityType: 'db-connection',
          entityId: id,
          entityLabel: row.name,
          metadata: { key: row.key, engine: row.engine, host: row.host },
          category: 'security',
        },
        { tx },
      );
      await this.ctx.events.publish('core.db-connection.deleted', { connectionId: id, key: row.key }, { tx });
    });
    this.manager.forget(id);
  }

  async test(id: string) {
    const row = await this.manager.row(id, true);
    if (!row) throw httpErrors.notFound('Database connection not found');
    const result = await this.manager.test(id);
    await this.ctx.audit.record({
      action: 'core.db-connection.tested',
      entityType: 'db-connection',
      entityId: id,
      entityLabel: row.name,
      outcome: result.ok ? 'success' : 'failure',
      metadata: result.error
        ? { kind: result.error.kind, dbCode: result.error.dbCode }
        : { latencyMs: result.latencyMs },
      category: 'system',
    });
    return result;
  }

  /** Tests unsaved settings; with `id`, the stored password (and CA) fill in what was not re-entered. */
  async testDraft(input: TestInput) {
    let password = input.password ?? null;
    let ca = input.options.ca;
    if (input.id) {
      const row = await this.manager.row(input.id, true);
      if (!row) throw httpErrors.notFound('Database connection not found');
      if (input.password === undefined) password = this.manager.openPassword(row);
      if (ca === null && row.options.ca) ca = this.ctx.secrets.open(row.options.ca);
    }
    return this.manager.testDraft({
      engine: input.engine,
      host: input.host,
      port: input.port ?? DEFAULT_DB_PORTS[input.engine],
      database: input.database,
      username: input.username,
      password,
      options: { ...input.options, ca },
      poolMax: 1,
    });
  }

  async catalog(id: string, refresh: boolean) {
    return this.manager.catalog(id, { refresh });
  }

  /** Health check of every enabled connection (core job). */
  async checkAll() {
    const rows = (await this.manager.all()).filter((r) => r.enabled);
    let failed = 0;
    for (const row of rows) {
      const result = await this.manager.test(row.id).catch(() => ({ ok: false }));
      if (!result.ok) failed++;
    }
    return { checked: rows.length, failed };
  }
}

/** The CA bundle is sealed like the password (it can identify internal infrastructure). */
function sealOptions(ctx: ModuleContext, o: CreateInput['options']): DbConnectionOptions {
  return {
    tls: o.tls,
    ca: o.ca ? ctx.secrets.seal(o.ca) : null,
    instanceName: o.instanceName,
    domain: o.domain,
  };
}

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
