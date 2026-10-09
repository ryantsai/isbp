import type { auditQuerySchema, AuditRef } from '@isbp/contracts';
import {
  applications,
  auditLogs,
  departments,
  groups,
  roles,
  users,
  workflowDefinitions,
} from '@isbp/db/schema';
import { isLocale, type Locale, type Messages } from '@isbp/i18n';
import { deepMerge, loadCoreMessages } from '@isbp/i18n/messages';
import type { Db } from '@isbp/sdk/server';
import { and, eq, gte, ilike, inArray, lte, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { PLATFORM_APP_KEY } from '../../kernel/rbac';
import { moduleMessages } from '../../generated/module-messages';
import { likePattern } from '../util';

type AuditRow = typeof auditLogs.$inferSelect;
type AuditQuery = z.output<typeof auditQuerySchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/* ───────────────────────── searching by the labels the UI shows ───────────────────────── */

/**
 * Action labels per locale as `[normalised action, lower-case label]`. The normalised form is the action with dots
 * as underscores (`core.user.created` → `core_user_created`), which is how the catalogs key them: core's under
 * `audit.actions`, a module's under `<module>.audit.<rest>` (the same lookup as the web's `useActionLabel`).
 */
const labelCache = new Map<Locale, Promise<[string, string][]>>();

async function loadLabels(locale: Locale): Promise<[string, string][]> {
  const out: [string, string][] = [];
  const core = (await loadCoreMessages(locale)).audit as Messages | undefined;
  const actions = core?.actions;
  if (actions && typeof actions === 'object')
    for (const [k, v] of Object.entries(actions)) if (typeof v === 'string') out.push([k, v.toLowerCase()]);
  for (const [moduleId, loaders] of Object.entries(moduleMessages)) {
    try {
      const en = (await loaders.en()).default;
      const messages = locale === 'en' ? en : deepMerge(en, (await loaders[locale]()).default);
      const audit = messages.audit;
      if (!audit || typeof audit !== 'object') continue;
      for (const [k, v] of Object.entries(audit))
        if (typeof v === 'string') out.push([`${moduleId}_${k}`, v.toLowerCase()]);
    } catch {
      // A module without catalogs simply has no labels to search.
    }
  }
  return out;
}

function labels(locale: Locale) {
  let hit = labelCache.get(locale);
  if (!hit) {
    hit = loadLabels(locale).catch(() => []);
    labelCache.set(locale, hit);
  }
  return hit;
}

/** Normalised actions whose label — in the viewer's language or in English — contains `q`. */
export async function actionsLabelled(q: string, locale: string | null | undefined): Promise<string[]> {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const wanted: Locale[] = isLocale(locale) && locale !== 'en' ? [locale, 'en'] : ['en'];
  const keys = new Set<string>();
  for (const l of wanted)
    for (const [key, label] of await labels(l)) if (label.includes(needle)) keys.add(key);
  return [...keys];
}

/* ───────────────────────── filters ───────────────────────── */

export async function auditWhere(
  db: Db,
  q: AuditQuery,
  locale: string | null | undefined,
): Promise<SQL | undefined> {
  const prefixOr = (patterns: string[]) =>
    or(
      ...patterns.map((a) =>
        a.endsWith('*') ? ilike(auditLogs.action, `${escapeLike(a.slice(0, -1))}%`) : eq(auditLogs.action, a),
      ),
    );
  let search: SQL | undefined;
  if (q.q) {
    const labelled = await actionsLabelled(q.q, locale);
    search = or(
      ilike(auditLogs.actorName, likePattern(q.q)),
      ilike(auditLogs.entityLabel, likePattern(q.q)),
      ilike(auditLogs.action, likePattern(q.q)),
      labelled.length ? inArray(sql`replace(${auditLogs.action}, '.', '_')`, labelled) : undefined,
    );
  }
  let role: SQL | undefined;
  if (q.roleId) {
    const [r] = await db
      .select({ key: roles.key, platform: sql<boolean>`${applications.key} = ${PLATFORM_APP_KEY}` })
      .from(roles)
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .where(eq(roles.id, q.roleId));
    role = or(
      and(eq(auditLogs.entityType, 'role'), eq(auditLogs.entityId, q.roleId)),
      and(
        ilike(auditLogs.action, 'core.role-assignment.%'),
        or(
          sql`${auditLogs.metadata}->>'roleId' = ${q.roleId}`,
          // Older grants name the role by its key only (platform roles' keys are unique).
          r?.platform
            ? sql`(${auditLogs.metadata}->>'roleId' is null and ${auditLogs.metadata}->>'role' = ${r.key})`
            : undefined,
        ),
      ),
    );
  }
  return and(
    q.actorId ? eq(auditLogs.actorId, q.actorId) : undefined,
    q.action ? prefixOr([q.action]) : undefined,
    q.actions?.length ? prefixOr(q.actions) : undefined,
    q.moduleId ? eq(auditLogs.moduleId, q.moduleId) : undefined,
    q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
    q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
    q.userId
      ? and(
          or(
            and(eq(auditLogs.entityType, 'user'), eq(auditLogs.entityId, q.userId)),
            sql`coalesce(${auditLogs.metadata}->'userIds', '[]'::jsonb) @> ${JSON.stringify([q.userId])}::jsonb`,
          ),
          // Parts of a bigger change (a transfer's group and role changes) are summed up by its own entry.
          sql`${auditLogs.metadata}->>'via' is null`,
        )
      : undefined,
    role,
    q.outcome ? eq(auditLogs.outcome, q.outcome) : undefined,
    q.category ? eq(auditLogs.category, q.category) : undefined,
    q.from ? gte(auditLogs.occurredAt, new Date(q.from)) : undefined,
    q.to ? lte(auditLogs.occurredAt, new Date(q.to)) : undefined,
    search,
  );
}

/* ───────────────────────── names for the ids a record mentions ───────────────────────── */

const ENTITY_TYPES = new Set(['user', 'group', 'department', 'role', 'workflow_definition', 'application']);

function collect(value: unknown, into: Set<string>, depth = 0) {
  if (isUuid(value)) into.add(value.toLowerCase());
  else if (Array.isArray(value) && depth < 2) for (const v of value.slice(0, 50)) collect(v, into, depth + 1);
}

/**
 * Current names for the ids in a page of audit records (target ids without a label, ids in `changes` and in the
 * top level of `metadata`) and for role keys (`metadata.role`, keyed `role:<key>`). Only names: whoever may read the
 * audit log sees who and what each entry is about anyway.
 */
export async function resolveRefs(db: Db, rows: AuditRow[]): Promise<Map<string, AuditRef>> {
  const ids = new Set<string>();
  const roleKeys = new Set<string>();
  for (const r of rows) {
    if (r.entityType && ENTITY_TYPES.has(r.entityType) && isUuid(r.entityId))
      ids.add(r.entityId.toLowerCase());
    for (const [before, after] of Object.values(r.changes ?? {})) {
      collect(before, ids);
      collect(after, ids);
    }
    for (const [k, v] of Object.entries(r.metadata ?? {})) {
      collect(v, ids);
      if (k === 'role' && typeof v === 'string' && r.action.startsWith('core.role-assignment.'))
        roleKeys.add(v);
    }
  }
  const refs = new Map<string, AuditRef>();
  if (!ids.size && !roleKeys.size) return refs;
  const list = [...ids].slice(0, 500);
  const plain = (type: string, name: string): AuditRef => ({ type, name, key: null, moduleId: null });
  const roleRef = (r: { key: string; name: string; moduleId: string | null }): AuditRef => ({
    type: 'role',
    name: r.name,
    key: r.key,
    moduleId: r.moduleId,
  });
  const [people, groupRows, deptRows, roleRows, workflowRows, appRows, keyedRoles] = await Promise.all([
    list.length
      ? db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, list))
      : [],
    list.length
      ? db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, list))
      : [],
    list.length
      ? db
          .select({ id: departments.id, name: departments.name })
          .from(departments)
          .where(inArray(departments.id, list))
      : [],
    list.length
      ? db
          .select({ id: roles.id, key: roles.key, name: roles.name, moduleId: roles.moduleId })
          .from(roles)
          .where(inArray(roles.id, list))
      : [],
    list.length
      ? db
          .select({ id: workflowDefinitions.id, name: workflowDefinitions.name })
          .from(workflowDefinitions)
          .where(inArray(workflowDefinitions.id, list))
      : [],
    list.length
      ? db
          .select({ id: applications.id, name: applications.name })
          .from(applications)
          .where(inArray(applications.id, list))
      : [],
    roleKeys.size
      ? db
          .select({ key: roles.key, name: roles.name, moduleId: roles.moduleId })
          .from(roles)
          .innerJoin(applications, eq(applications.id, roles.applicationId))
          .where(and(inArray(roles.key, [...roleKeys]), eq(applications.key, PLATFORM_APP_KEY)))
      : [],
  ]);
  for (const p of people) refs.set(p.id, plain('user', p.name));
  for (const g of groupRows) refs.set(g.id, plain('group', g.name));
  for (const d of deptRows) refs.set(d.id, plain('department', d.name));
  for (const r of roleRows) refs.set(r.id, roleRef(r));
  for (const w of workflowRows) refs.set(w.id, plain('workflow_definition', w.name));
  for (const a of appRows) refs.set(a.id, plain('application', a.name));
  for (const r of keyedRoles) refs.set(`role:${r.key}`, roleRef(r));
  return refs;
}

/** The refs one record needs, or nothing. */
export function refsFor(row: AuditRow, all: Map<string, AuditRef>): Record<string, AuditRef> | undefined {
  if (!all.size) return undefined;
  const ids = new Set<string>();
  if (isUuid(row.entityId)) ids.add(row.entityId.toLowerCase());
  for (const [before, after] of Object.values(row.changes ?? {})) {
    collect(before, ids);
    collect(after, ids);
  }
  for (const [k, v] of Object.entries(row.metadata ?? {})) {
    collect(v, ids);
    if (k === 'role' && typeof v === 'string') ids.add(`role:${v}`);
  }
  const out: Record<string, AuditRef> = {};
  for (const id of ids) {
    const ref = all.get(id);
    if (ref) out[id] = ref;
  }
  return Object.keys(out).length ? out : undefined;
}
