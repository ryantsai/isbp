/**
 * Small shared helpers of the server side: the module's system principal (jobs, event handlers, process actions,
 * seed), the acting person, people and group lookups, settings, Postgres error mapping and the catalogs the server
 * reads text from (default taxonomy, CSV headers).
 */
import { departments, groupMembers, groups, users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  type LocalizedText,
  type ModuleContext,
  PermissionSet,
} from '@isbp/sdk/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';
import { COMPANY_TIME_ZONE, DEFAULT_REVIEW_MONTHS, todayIn } from '../model';

export type Catalog = typeof en;
export const CATALOGS: Record<'en' | 'zh-TW' | 'ja-JP', Catalog> = {
  en,
  'zh-TW': zh as Catalog,
  'ja-JP': ja as Catalog,
};
export const LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;

/** The same catalog text in the three languages. */
export const textOf = (pick: (c: Catalog) => string): LocalizedText => ({
  en: pick(CATALOGS.en),
  'zh-TW': pick(CATALOGS['zh-TW']),
  'ja-JP': pick(CATALOGS['ja-JP']),
});

/** Full access for the module's own background work (jobs, event handlers, seed). */
export function systemAuth(name = 'Information security'): AuthContext {
  const permissions = new PermissionSet([{ p: 'isms.*', s: 'g' }]);
  return {
    principal: { type: 'system', id: null, name },
    user: null,
    sessionId: null,
    permissions,
    can: (permission, resource) => permissions.can(permission, resource),
    require(permission, resource) {
      if (!permissions.can(permission, resource)) throw httpErrors.forbidden();
    },
    reach: (permission) => permissions.reach(permission),
  };
}

/** Who did something, for histories: a person (`actorId`) or a named service, agent or system. */
export interface Actor {
  actorId: string | null;
  actorName: string | null;
}

export function actorOf(auth: AuthContext): Actor {
  if (auth.principal.type === 'user' && auth.user) return { actorId: auth.user.id, actorName: null };
  const onBehalf = auth.principal.onBehalfOf;
  return onBehalf
    ? { actorId: onBehalf.id, actorName: auth.principal.name }
    : { actorId: null, actorName: auth.principal.name };
}

/** The person behind a request (people, or agents acting for one); null for services and the system. */
export const actingUserId = (auth: AuthContext) => auth.user?.id ?? auth.principal.onBehalfOf?.id ?? null;

/** Requires at least one of the permissions (at any scope); audits the denial like `auth.require`. */
export function requireAny(auth: AuthContext, permissions: readonly string[]) {
  if (permissions.some((p) => auth.permissions.hasAny(p))) return;
  auth.require(permissions[0]!);
}

export interface PersonInfo {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  username: string;
  departmentId: string | null;
  status: string;
}

export const personRef = (p: PersonInfo | undefined | null) =>
  p ? { id: p.id, displayName: p.displayName, avatarUrl: p.avatarUrl, email: p.email } : null;

/** People by id (one query). */
export async function peopleByIds(
  db: Db,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, PersonInfo>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Map();
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      email: users.email,
      username: users.username,
      departmentId: users.departmentId,
      status: users.status,
    })
    .from(users)
    .where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r]));
}

export interface GroupInfo {
  id: string;
  key: string;
  name: string;
}

export async function groupsByIds(db: Db, ids: readonly (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Map<string, GroupInfo>();
  const rows = await db
    .select({ id: groups.id, key: groups.key, name: groups.name })
    .from(groups)
    .where(inArray(groups.id, wanted));
  return new Map(rows.map((g) => [g.id, g]));
}

export async function departmentsByIds(db: Db, ids: readonly (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Map<string, { id: string; name: string }>();
  const rows = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(inArray(departments.id, wanted));
  return new Map(rows.map((d) => [d.id, d]));
}

/** Group ids the user is a member of. */
export async function groupIdsOf(db: Db, userId: string | null): Promise<string[]> {
  if (!userId) return [];
  const rows = await db
    .select({ id: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
  return rows.map((r) => r.id);
}

/** Active members of groups (one query). */
export async function membersOfGroups(db: Db, groupIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!groupIds.length) return out;
  const rows = await db
    .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
    .from(groupMembers)
    .innerJoin(users, and(eq(users.id, groupMembers.userId), eq(users.status, 'active')))
    .where(inArray(groupMembers.groupId, [...new Set(groupIds)]));
  for (const r of rows) out.set(r.groupId, [...(out.get(r.groupId) ?? []), r.userId]);
  return out;
}

/**
 * Active holders of one of this module's roles at global scope, directly or through a group (the same rule the
 * workflow engine uses for role approvers): security officers to tell about orphaned shared accounts.
 */
export async function roleHolders(db: Db, roleKeys: readonly string[]): Promise<string[]> {
  if (!roleKeys.length) return [];
  const res = await db.execute<{ id: string }>(sql`
    select distinct u.id
      from core.role_assignments ra
      join core.roles r on r.id = ra.role_id and r.key in (${sql.join(
        roleKeys.map((k) => sql`${k}`),
        sql`, `,
      )})
      join core.applications app on app.id = r.application_id and app.key = 'isbp'
      left join core.group_members gm on gm.group_id = ra.group_id
      join core.users u on u.id = coalesce(ra.user_id, gm.user_id)
     where ra.scope_type = 'global'
       and (ra.expires_at is null or ra.expires_at > now())
       and u.status = 'active'
     limit 200`);
  return res.rows.map((r) => r.id);
}

export interface IsmsConfig {
  reminderDays: number;
  reviewMonths: number;
}

const whole = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
};

export async function ismsConfig(ctx: ModuleContext): Promise<IsmsConfig> {
  const all = await ctx.settings.all();
  return {
    reminderDays: whole(all['reminders.daysBefore'], 0, 90, 7),
    reviewMonths: whole(all['accounts.reviewMonths'], 1, 60, DEFAULT_REVIEW_MONTHS),
  };
}

/** Today in the company's time zone (calendar date). */
export const companyToday = (now: Date = new Date()) => todayIn(COMPANY_TIME_ZONE, now);

/** The SQLSTATE of a (possibly wrapped) Postgres error. */
export function pgCode(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** The constraint a (possibly wrapped) Postgres error violated. */
export function pgConstraint(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    const c = (e as { constraint?: unknown }).constraint;
    if (typeof c === 'string') return c;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

export const UNIQUE_VIOLATION = '23505';

/** 400 `VALIDATION_FAILED` for one field (the forms show it next to the field). */
export function invalidField(path: string, message: string, code?: string) {
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, {
    issues: [{ path, message, ...(code ? { code } : {}) }],
  });
}

/** 409 `INVALID_STATE` with a reason the pages translate (`isms.errors.<reason>`). */
export function invalidState(message: string, reason: string, details: Record<string, unknown> = {}) {
  return new HttpError(409, ErrorCodes.INVALID_STATE, message, { reason, ...details });
}

/** Active people by id (refuses inactive or unknown ones with a field error). */
export async function activePeople(db: Db, ids: readonly string[], path: string): Promise<PersonInfo[]> {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return [];
  const found = await peopleByIds(db, wanted);
  for (const id of wanted) {
    const p = found.get(id);
    if (!p || p.status !== 'active') throw invalidField(path, 'Choose active people', 'inactivePerson');
  }
  return wanted.map((id) => found.get(id)!);
}
