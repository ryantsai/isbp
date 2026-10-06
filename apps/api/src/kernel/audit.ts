import { auditLogs, uuidv7 } from '@isbp/db/schema';
import type { AuditChanges, AuditEntry, AuditService, Db, Principal } from '@isbp/sdk/server';
import { canonicalJson, sha256Hex } from './crypto';
import { currentContext, currentTraceId, SYSTEM_PRINCIPAL } from './context';

const REDACTED_KEYS = /pass(word)?|secret|token|credential|private.?key/i;

type AuditRow = typeof auditLogs.$inferInsert;

/** Fields covered by the row hash — anything that would change the meaning of the record. */
export function auditHash(row: Omit<AuditRow, 'hash' | 'seq'>): string {
  return sha256Hex(
    canonicalJson({
      eventId: row.eventId,
      occurredAt: row.occurredAt,
      actorType: row.actorType,
      actorId: row.actorId,
      actorName: row.actorName,
      onBehalfOfId: row.onBehalfOfId,
      action: row.action,
      category: row.category,
      moduleId: row.moduleId,
      entityType: row.entityType,
      entityId: row.entityId,
      entityLabel: row.entityLabel,
      changes: row.changes,
      metadata: row.metadata,
      outcome: row.outcome,
      ip: row.ip,
      userAgent: row.userAgent,
      requestId: row.requestId,
    }),
  );
}

function redact(changes: AuditChanges | undefined): AuditChanges | undefined {
  if (!changes) return undefined;
  const out: AuditChanges = {};
  for (const [key, pair] of Object.entries(changes)) {
    out[key] = REDACTED_KEYS.test(key) ? ['[redacted]', '[redacted]'] : pair;
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (a instanceof Date ? a.toISOString() : a) === (b instanceof Date ? b.toISOString() : b);
  }
  return canonicalJson(a) === canonicalJson(b);
}

export function createAuditService(db: Db, defaultModuleId?: string): AuditService {
  return {
    async record(entry: AuditEntry, opts: { tx?: Db; principal?: Principal } = {}) {
      const ctx = currentContext();
      const principal = opts.principal ?? ctx?.principal ?? SYSTEM_PRINCIPAL;
      const row: Omit<AuditRow, 'hash' | 'seq'> = {
        eventId: uuidv7(),
        occurredAt: new Date(),
        actorType: principal.type,
        actorId: principal.id,
        actorName: principal.name,
        onBehalfOfId: principal.onBehalfOf?.id ?? null,
        action: entry.action,
        category: entry.category ?? 'data',
        moduleId: defaultModuleId ?? entry.action.split('.')[0] ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId == null ? null : String(entry.entityId),
        entityLabel: entry.entityLabel?.slice(0, 300) ?? null,
        changes: redact(entry.changes) ?? null,
        metadata: entry.metadata ?? null,
        outcome: entry.outcome ?? 'success',
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent?.slice(0, 500) ?? null,
        requestId: ctx?.requestId ?? null,
      };
      await (opts.tx ?? db)
        .insert(auditLogs)
        .values({ ...row, traceId: currentTraceId() ?? null, hash: auditHash(row) });
    },

    diff(before, after, fields) {
      const keys = (fields ?? (Object.keys(after) as (keyof typeof before)[])) as string[];
      const changes: AuditChanges = {};
      for (const key of keys) {
        if (!(key in after)) continue;
        const a = (before as Record<string, unknown>)[key];
        const b = (after as Record<string, unknown>)[key];
        if (b === undefined || same(a, b)) continue;
        changes[key] = [a ?? null, b ?? null];
      }
      return changes;
    },
  };
}
