import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  type ModuleContext,
  type OpenConnector,
} from '@isbp/sdk/server';
import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type {
  ConnectionCreatedOut,
  ConnectionOut,
  CreateConnectionInput,
  TestDraftInput,
  TestResult,
  UpdateConnectionInput,
  WebhookSecretOut,
} from '../contracts';
import { ACTIVE_RUN_STATUSES, type RunStatus, webhookPath } from '../model';
import { MANAGE, personOf } from './access';
import { conflicts, connections, links, profiles, runs } from './schema';

export type ConnectionRow = typeof connections.$inferSelect;

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** A new webhook secret: 32 random bytes, base64url. Only its SHA-256 is stored. */
export function newWebhookSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: sha256(secret) };
}

/** Constant-time check of a presented webhook secret against the stored hash. */
export function webhookSecretMatches(
  presented: string | null | undefined,
  storedHash: string | null,
): boolean {
  if (!presented || !storedHash || storedHash.length !== 64) return false;
  const a = Buffer.from(sha256(presented), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The secret from `X-ISBP-Webhook-Secret`, or the password of HTTP Basic auth. */
export function presentedSecret(headers: Record<string, string | string[] | undefined>): string | null {
  const h = headers['x-isbp-webhook-secret'];
  const direct = Array.isArray(h) ? h[0] : h;
  if (direct) return direct.trim();
  const auth = headers.authorization;
  const value = Array.isArray(auth) ? auth[0] : auth;
  const m = value && /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(value);
  if (!m) return null;
  const decoded = Buffer.from(m[1]!, 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  return i >= 0 ? decoded.slice(i + 1) : null;
}

const errorInfo = (err: unknown) =>
  err instanceof HttpError
    ? { code: err.code, message: err.message }
    : { code: ErrorCodes.INTERNAL, message: err instanceof Error ? err.message : String(err) };

/**
 * URLs in a connector's settings must be http(s). Plain `http://` is refused when the connector calls it
 * (422 `INSECURE_HTTP`) unless the connection allows insecure HTTP (or the host is loopback: the mocks).
 */
function checkUrls(config: Record<string, unknown>) {
  const issues: { path: string; message: string }[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) continue;
    try {
      const u = new URL(value);
      if (u.protocol === 'https:' || u.protocol === 'http:') continue;
      issues.push({ path: `config.${key}`, message: 'Use an https:// URL' });
    } catch {
      issues.push({ path: `config.${key}`, message: 'Invalid URL' });
    }
  }
  if (issues.length)
    throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Invalid connection settings', { issues });
}

/** Only non-empty strings are secrets worth storing. */
function cleanSecrets(s: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(s).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== ''),
  );
}

export class ConnectionService {
  constructor(private readonly ctx: ModuleContext) {}

  async row(id: string): Promise<ConnectionRow> {
    const [row] = await this.ctx.db.select().from(connections).where(eq(connections.id, id));
    if (!row) throw httpErrors.notFound('Connection not found');
    return row;
  }

  /** The stored secrets, opened (in memory only, for one call). */
  openSecrets(row: Pick<ConnectionRow, 'secretsSealed'>): Record<string, string> {
    if (!row.secretsSealed) return {};
    try {
      return JSON.parse(this.ctx.secrets.open(row.secretsSealed)) as Record<string, string>;
    } catch {
      return {};
    }
  }

  /** Binds the connector to this connection's settings and secrets. */
  open(row: ConnectionRow, signal?: AbortSignal): OpenConnector {
    return this.ctx.connectors.open(row.type, {
      id: row.id,
      config: row.config,
      secrets: this.openSecrets(row),
      signal,
      allowInsecureHttp: row.allowInsecureHttp,
    });
  }

  /** "Allow insecure HTTP" is a security decision: audited on its own, both ways. */
  private async auditInsecureHttp(
    tx: Parameters<Parameters<ModuleContext['transaction']>[0]>[0],
    row: Pick<ConnectionRow, 'id' | 'name'>,
    before: boolean,
    after: boolean,
  ) {
    await this.ctx.audit.record(
      {
        action: 'integrations.connection.insecure_http_changed',
        entityType: 'integrations.connection',
        entityId: row.id,
        entityLabel: row.name,
        changes: { allowInsecureHttp: [before, after] },
        category: 'security',
      },
      { tx },
    );
  }

  /** Parses settings with the connector's schemas and the URL rule. */
  private validate(type: string, config: Record<string, unknown>, secrets: Record<string, string>) {
    const parsed = this.ctx.connectors.validate(type, config, secrets);
    const cfg = (parsed.config ?? {}) as Record<string, unknown>;
    checkUrls(cfg);
    return { config: cfg, secrets: cleanSecrets((parsed.secrets ?? {}) as Record<string, unknown>) };
  }

  private sealSecrets(secrets: Record<string, string>) {
    const keys = Object.keys(secrets).sort();
    return {
      secretsSealed: keys.length ? this.ctx.secrets.seal(JSON.stringify(secrets)) : null,
      secretKeys: keys,
    };
  }

  async list(): Promise<ConnectionOut[]> {
    const rows = await this.ctx.db.select().from(connections).orderBy(connections.name);
    return this.views(rows);
  }

  async get(id: string): Promise<ConnectionOut> {
    return (await this.views([await this.row(id)]))[0]!;
  }

  async views(rows: ConnectionRow[]): Promise<ConnectionOut[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [profileCounts, linkCounts, conflictCounts, lastRuns] = await Promise.all([
      this.ctx.db
        .select({ id: profiles.connectionId, n: count() })
        .from(profiles)
        .where(inArray(profiles.connectionId, ids))
        .groupBy(profiles.connectionId),
      this.ctx.db
        .select({
          id: links.connectionId,
          n: count(),
          errors: sql<number>`count(*) filter (where ${links.state} = 'error')::int`,
          last: max(links.lastSyncedAt),
        })
        .from(links)
        .where(inArray(links.connectionId, ids))
        .groupBy(links.connectionId),
      this.ctx.db
        .select({ id: conflicts.connectionId, n: count() })
        .from(conflicts)
        .where(and(inArray(conflicts.connectionId, ids), eq(conflicts.status, 'open')))
        .groupBy(conflicts.connectionId),
      this.ctx.db
        .selectDistinctOn([runs.connectionId], {
          id: runs.connectionId,
          status: runs.status,
          finishedAt: runs.finishedAt,
        })
        .from(runs)
        .where(
          and(inArray(runs.connectionId, ids), inArray(runs.kind, ['pull', 'export', 'webhook', 'resync'])),
        )
        .orderBy(runs.connectionId, desc(runs.createdAt)),
    ]);
    const p = new Map(profileCounts.map((r) => [r.id, r.n]));
    const l = new Map(linkCounts.map((r) => [r.id, r]));
    const c = new Map(conflictCounts.map((r) => [r.id, r.n]));
    const lr = new Map(lastRuns.map((r) => [r.id, r]));
    const infos = new Map(this.ctx.connectors.list().map((i) => [i.type, i]));
    return rows.map((row) => {
      const info = infos.get(row.type);
      const run = lr.get(row.id);
      const linkStats = l.get(row.id);
      const lastSync = [linkStats?.last ?? null, run?.finishedAt ?? null]
        .filter((d): d is Date => d instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        connector: {
          name: info?.name ?? row.type,
          icon: info?.icon ?? null,
          moduleId: info?.moduleId ?? row.type.split('.')[0]!,
          available: Boolean(info),
          webhooks: Boolean(info?.objects.some((o) => o.capabilities.webhooks)),
        },
        config: row.config,
        storedSecrets: row.secretKeys,
        enabled: row.enabled,
        allowInsecureHttp: row.allowInsecureHttp,
        health: row.health,
        healthMessage: row.healthMessage,
        account: row.account,
        lastCheckedAt: row.lastCheckedAt,
        webhook: {
          path: webhookPath(row.id),
          secretSet: Boolean(row.webhookSecretHash),
          rotatedAt: row.webhookRotatedAt,
        },
        stats: {
          profiles: p.get(row.id) ?? 0,
          links: linkStats?.n ?? 0,
          conflicts: c.get(row.id) ?? 0,
          errors: Number(linkStats?.errors ?? 0),
          lastSyncAt: lastSync ?? null,
          lastRunStatus: (run?.status as RunStatus | undefined) ?? null,
        },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async create(
    input: CreateConnectionInput & {
      config: Record<string, unknown>;
      secrets: Record<string, string>;
      enabled: boolean;
      allowInsecureHttp: boolean;
    },
    auth: AuthContext,
  ): Promise<ConnectionCreatedOut> {
    auth.require(MANAGE);
    const { config, secrets } = this.validate(input.type, input.config, cleanSecrets(input.secrets));
    const hook = newWebhookSecret();
    const row = await this.ctx.transaction(async (tx) => {
      const [dup] = await tx
        .select({ id: connections.id })
        .from(connections)
        .where(sql`lower(${connections.name}) = ${input.name.toLowerCase()}`);
      if (dup)
        throw new HttpError(409, ErrorCodes.CONFLICT, 'A connection with this name exists', {
          field: 'name',
        });
      const [created] = await tx
        .insert(connections)
        .values({
          name: input.name,
          type: input.type,
          config,
          ...this.sealSecrets(secrets),
          webhookSecretHash: hook.hash,
          webhookRotatedAt: new Date(),
          enabled: input.enabled,
          allowInsecureHttp: input.allowInsecureHttp,
          createdBy: personOf(auth),
          updatedBy: personOf(auth),
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'integrations.connection.created',
          entityType: 'integrations.connection',
          entityId: created!.id,
          entityLabel: created!.name,
          metadata: {
            type: created!.type,
            secrets: created!.secretKeys,
            allowInsecureHttp: created!.allowInsecureHttp,
          },
        },
        { tx },
      );
      if (created!.allowInsecureHttp) await this.auditInsecureHttp(tx, created!, false, true);
      await this.ctx.events.publish(
        'integrations.connection.created',
        { connectionId: created!.id, name: created!.name, type: created!.type },
        { tx },
      );
      return created!;
    });
    return { ...(await this.get(row.id)), webhookSecret: hook.secret };
  }

  async update(id: string, input: UpdateConnectionInput, auth: AuthContext): Promise<ConnectionOut> {
    auth.require(MANAGE);
    const before = await this.row(id);
    const stored = this.openSecrets(before);
    const merged: Record<string, string> = { ...stored, ...cleanSecrets(input.secrets ?? {}) };
    for (const k of input.removeSecrets ?? []) delete merged[k];
    const secretsChanged =
      Object.keys(cleanSecrets(input.secrets ?? {})).length > 0 ||
      (input.removeSecrets ?? []).some((k) => k in stored);
    const { config, secrets } = this.validate(before.type, input.config ?? before.config, merged);
    await this.ctx.transaction(async (tx) => {
      if (input.name && input.name.toLowerCase() !== before.name.toLowerCase()) {
        const [dup] = await tx
          .select({ id: connections.id })
          .from(connections)
          .where(sql`lower(${connections.name}) = ${input.name.toLowerCase()}`);
        if (dup)
          throw new HttpError(409, ErrorCodes.CONFLICT, 'A connection with this name exists', {
            field: 'name',
          });
      }
      const patch = {
        name: input.name ?? before.name,
        config,
        enabled: input.enabled ?? before.enabled,
        allowInsecureHttp: input.allowInsecureHttp ?? before.allowInsecureHttp,
        ...(secretsChanged ? this.sealSecrets(secrets) : {}),
        updatedBy: personOf(auth),
      };
      // New settings or credentials: the last health check no longer says anything.
      const insecureChanged = patch.allowInsecureHttp !== before.allowInsecureHttp;
      const reset =
        secretsChanged || insecureChanged || JSON.stringify(config) !== JSON.stringify(before.config)
          ? { health: 'unknown' as const, healthMessage: null, failingNotifiedAt: null }
          : {};
      await tx
        .update(connections)
        .set({ ...patch, ...reset })
        .where(eq(connections.id, id));
      const changes = this.ctx.audit.diff(
        { name: before.name, config: before.config, enabled: before.enabled },
        { name: patch.name, config: patch.config, enabled: patch.enabled },
      );
      const changed = Object.keys(changes);
      if (secretsChanged) changed.push('secrets');
      if (insecureChanged) {
        changed.push('allowInsecureHttp');
        await this.auditInsecureHttp(
          tx,
          { id, name: patch.name },
          before.allowInsecureHttp,
          patch.allowInsecureHttp,
        );
      }
      await this.ctx.audit.record(
        {
          action: 'integrations.connection.updated',
          entityType: 'integrations.connection',
          entityId: id,
          entityLabel: patch.name,
          changes,
          metadata: secretsChanged
            ? { secrets: 'changed', secretKeys: Object.keys(secrets).sort() }
            : undefined,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'integrations.connection.updated',
        { connectionId: id, name: patch.name, type: before.type, changes: changed },
        { tx },
      );
    });
    return this.get(id);
  }

  async remove(id: string, auth: AuthContext): Promise<void> {
    auth.require(MANAGE);
    const row = await this.row(id);
    await this.ctx.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.connectionId, id), inArray(runs.status, [...ACTIVE_RUN_STATUSES])))
        .limit(1);
      if (active) throw new HttpError(409, ErrorCodes.SYNC_RUNNING, 'A sync of this connection is running');
      await tx.delete(connections).where(eq(connections.id, id));
      await this.ctx.audit.record(
        {
          action: 'integrations.connection.deleted',
          entityType: 'integrations.connection',
          entityId: id,
          entityLabel: row.name,
          metadata: { type: row.type },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'integrations.connection.deleted',
        { connectionId: id, name: row.name, type: row.type },
        { tx },
      );
    });
  }

  /** Signs in and reads something cheap; records the health. Remote errors are a result, not a failure. */
  async test(id: string, auth: AuthContext): Promise<TestResult> {
    auth.require(MANAGE);
    const row = await this.row(id);
    const result = await this.runTest(() => this.open(row));
    await this.recordHealth(row, result);
    return result;
  }

  /** Tests unsaved settings; empty secrets of an existing connection reuse the stored ones. */
  async testDraft(
    input: TestDraftInput & { config: Record<string, unknown>; secrets: Record<string, string> },
    auth: AuthContext,
  ): Promise<TestResult> {
    auth.require(MANAGE);
    let secrets = cleanSecrets(input.secrets);
    let id = `draft-${randomBytes(8).toString('hex')}`;
    let allowInsecureHttp = input.allowInsecureHttp ?? false;
    if (input.id) {
      const row = await this.row(input.id);
      if (row.type !== input.type)
        throw httpErrors.badRequest('The connector type of a connection can’t change');
      secrets = { ...this.openSecrets(row), ...secrets };
      for (const k of input.removeSecrets ?? []) delete secrets[k];
      id = row.id;
      allowInsecureHttp = input.allowInsecureHttp ?? row.allowInsecureHttp;
    }
    const parsed = this.validate(input.type, input.config, secrets);
    return this.runTest(() =>
      this.ctx.connectors.open(input.type, {
        id,
        config: parsed.config,
        secrets: parsed.secrets,
        allowInsecureHttp,
      }),
    );
  }

  private async runTest(open: () => OpenConnector): Promise<TestResult> {
    const started = Date.now();
    try {
      const r = await open().test();
      return {
        ok: r.ok,
        message: r.message ?? null,
        account: r.account ?? null,
        code: r.ok ? null : ErrorCodes.REMOTE_AUTH_FAILED,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      const e = errorInfo(err);
      if (
        e.code === ErrorCodes.VALIDATION_FAILED ||
        e.code === ErrorCodes.NOT_FOUND ||
        e.code === ErrorCodes.MODULE_DISABLED
      )
        throw err;
      return { ok: false, message: e.message, account: null, code: e.code, durationMs: Date.now() - started };
    }
  }

  /** Health bookkeeping after a test or a check (not an admin change: not audited). */
  async recordHealth(
    row: ConnectionRow,
    result: { ok: boolean; message: string | null; account?: string | null },
  ) {
    await this.ctx.db
      .update(connections)
      .set({
        health: result.ok ? 'ok' : 'failing',
        healthMessage: result.ok ? null : (result.message ?? null),
        account: result.ok ? (result.account ?? row.account) : row.account,
        lastCheckedAt: new Date(),
        ...(result.ok ? { failingNotifiedAt: null } : {}),
        updatedAt: sql`${connections.updatedAt}`,
      })
      .where(eq(connections.id, row.id));
  }

  async rotateWebhookSecret(id: string, auth: AuthContext): Promise<WebhookSecretOut> {
    auth.require(MANAGE);
    const row = await this.row(id);
    const hook = newWebhookSecret();
    const rotatedAt = new Date();
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(connections)
        .set({ webhookSecretHash: hook.hash, webhookRotatedAt: rotatedAt, updatedBy: personOf(auth) })
        .where(eq(connections.id, id));
      await this.ctx.audit.record(
        {
          action: 'integrations.connection.secret_rotated',
          entityType: 'integrations.connection',
          entityId: id,
          entityLabel: row.name,
          category: 'security',
        },
        { tx },
      );
      await this.ctx.events.publish(
        'integrations.connection.updated',
        { connectionId: id, name: row.name, type: row.type, changes: ['webhookSecret'] },
        { tx },
      );
    });
    return { webhookSecret: hook.secret, rotatedAt };
  }
}
