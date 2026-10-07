/**
 * Small shared helpers of the server side: system principals for jobs and event handlers, the acting
 * person of a request, people and role-holder lookups, settings and Postgres error mapping.
 */
import { departments, users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  type ModuleContext,
  PermissionSet,
} from '@isbp/sdk/server';
import { eq, inArray, sql } from 'drizzle-orm';
import { COMPANY_TIME_ZONE, DEFAULT_UNDER_USED_PERCENT, todayIn } from '../model';

/** Full access for the module's own background work (jobs, event handlers, workflow callbacks, seed). */
export function systemAuth(name = 'Assets'): AuthContext {
  const permissions = new PermissionSet([{ p: 'itam.*', s: 'g' }]);
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

/** Who did something, for timelines: a person (`actorId`) or a named service, agent or system. */
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

/** The person behind a request (people, or agents acting for one); `null` for services and the system. */
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
  departmentId: string | null;
  departmentName: string | null;
  status: string;
  username: string;
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
      departmentId: users.departmentId,
      departmentName: departments.name,
      status: users.status,
      username: users.username,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Active holders of a platform role at global scope, directly or through a group — the same rule the
 * workflow engine uses for role approvers. Used to notify asset and contract managers.
 */
export async function roleHolders(db: Db, roleKey: string): Promise<string[]> {
  const res = await db.execute<{ id: string }>(sql`
    select distinct u.id
      from core.role_assignments ra
      join core.roles r on r.id = ra.role_id and r.key = ${roleKey}
      join core.applications app on app.id = r.application_id and app.key = 'isbp'
      left join core.group_members gm on gm.group_id = ra.group_id
      join core.users u on u.id = coalesce(ra.user_id, gm.user_id)
     where ra.scope_type = 'global'
       and (ra.expires_at is null or ra.expires_at > now())
       and u.status = 'active'
     limit 200`);
  return res.rows.map((r) => r.id);
}

export interface ItamConfig {
  currency: string;
  warrantyDays: number;
  underUsedPercent: number;
}

export async function itamConfig(ctx: ModuleContext): Promise<ItamConfig> {
  const all = await ctx.settings.all();
  const currency = String(all.currency ?? 'TWD').toUpperCase();
  const warrantyDays = Number(all['reminders.warrantyDays'] ?? 30);
  const underUsedPercent = Number(all['compliance.underUsedPercent'] ?? DEFAULT_UNDER_USED_PERCENT);
  return {
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'TWD',
    warrantyDays: Number.isFinite(warrantyDays) && warrantyDays > 0 ? Math.round(warrantyDays) : 30,
    underUsedPercent:
      Number.isFinite(underUsedPercent) && underUsedPercent >= 0 && underUsedPercent <= 100
        ? Math.round(underUsedPercent)
        : DEFAULT_UNDER_USED_PERCENT,
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

/** The unique constraint a (possibly wrapped) Postgres error violated. */
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
export function invalidField(path: string, message: string) {
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { issues: [{ path, message }] });
}
