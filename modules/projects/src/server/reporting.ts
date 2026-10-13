/**
 * The organisation's status reporting schedule (Phase 11, `docs/architecture.md` §17.1): one schedule set by the PMO,
 * the periods it makes, the updates people owe for the open period (rows the job keeps in step), reminders, and
 * the compliance list ("who sent theirs").
 */
import { groupMembers, groups, users } from '@isbp/db/schema';
import {
  addDays as addLocalDays,
  endOfLocalDay,
  formatLocalDate,
  localDateOf,
  parseLocalDate,
  zonedInstant,
} from '@isbp/contracts';
import { type AuthContext, type Db, likePattern, type ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, desc, eq, gt, ilike, inArray, lt, lte, ne, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { complianceQuerySchema, statusScheduleInputSchema } from '../contracts';
import {
  type Cadence,
  PERMISSIONS,
  periodFromKey,
  periodOf,
  type ReportingPeriod,
  shiftPeriod,
  type UpdateStanding,
} from '../model';
import { isAdmin, seesAll, visibleProjects } from './access';
import { members, projects, type StatusScheduleRow, statusSchedule, statusUpdates } from './schema';
import { actorOf, forbidden, invalid, peopleByIds, personRef, projectHref } from './shared';

type ScheduleInput = z.output<typeof statusScheduleInputSchema>;
type ComplianceQuery = z.output<typeof complianceQuerySchema>;

/** The schedule before anyone set one: weekly, due Friday, managers report, switched off. */
export const DEFAULT_SCHEDULE = {
  enabled: false,
  cadence: 'weekly' as Cadence,
  dueWeekday: 5,
  timeZone: 'Asia/Taipei',
  managers: true,
  groupKey: null as string | null,
  remindDaysBefore: 1,
  updatedBy: null as string | null,
  updatedAt: null as Date | null,
};
export type Schedule = typeof DEFAULT_SCHEDULE;

/** A period with its instants in the schedule's time zone. */
export interface TimedPeriod extends ReportingPeriod {
  /** End of the due day. */
  dueAt: Date;
  /** Start of the day after the period: a pending update is missed from then on. */
  closesAt: Date;
  /** Start of the period's first day. */
  startsAt: Date;
}

const local = (value: string) => parseLocalDate(value)!;
const nextDay = (value: string) => {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function timed(period: ReportingPeriod, timeZone: string): TimedPeriod {
  return {
    ...period,
    dueAt: endOfLocalDay(local(period.due), timeZone),
    closesAt: zonedInstant({ ...local(nextDay(period.end)), hour: 0 }, timeZone),
    startsAt: zonedInstant({ ...local(period.start), hour: 0 }, timeZone),
  };
}

/** The calendar date at `now` in a time zone. */
export const todayAt = (now: Date, timeZone: string) => formatLocalDate(localDateOf(now, timeZone));

/** Who may see who sent their update: the PMO, portfolio readers and administrators. */
export const seesCompliance = (auth: AuthContext) => seesAll(auth) || auth.can(PERMISSIONS.reporting);

/**
 * SQL: the member `m` of project `p` owes an update under the schedule (active project, active person, a manager
 * when managers report, or a manager/member in the reporters' group).
 */
function owesUpdate(s: Schedule): SQL {
  const byGroup = s.groupKey
    ? sql`(${members.role} in ('manager', 'member') and exists (
        select 1 from ${groupMembers} gm join ${groups} g on g.id = gm.group_id
         where g.key = ${s.groupKey} and gm.user_id = ${members.userId}))`
    : sql`false`;
  const byRole = s.managers ? sql`${members.role} = 'manager'` : sql`false`;
  return sql`(${projects.status} = 'active' and ${projects.archivedAt} is null and ${users.status} = 'active'
    and (${byRole} or ${byGroup}))`;
}

export class ReportingService {
  constructor(private readonly ctx: ModuleContext) {}

  /* ───────────── the schedule ───────────── */

  async schedule(db: Db = this.ctx.db): Promise<Schedule> {
    const [row] = await db.select().from(statusSchedule).where(eq(statusSchedule.id, 'default'));
    return row ? this.fromRow(row) : { ...DEFAULT_SCHEDULE };
  }

  private fromRow(row: StatusScheduleRow): Schedule {
    return {
      enabled: row.enabled,
      cadence: row.cadence,
      dueWeekday: row.dueWeekday,
      timeZone: row.timeZone,
      managers: row.managers,
      groupKey: row.groupKey,
      remindDaysBefore: row.remindDaysBefore,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }

  /** The value as the admin page and the customisation kind write it. */
  valueOf(s: Schedule): ScheduleInput {
    return {
      enabled: s.enabled,
      cadence: s.cadence,
      dueWeekday: s.dueWeekday,
      timeZone: s.timeZone,
      managers: s.managers,
      groupKey: s.groupKey,
      remindDaysBefore: s.remindDaysBefore,
    };
  }

  /** The period open at `now` (also without a schedule: then weekly periods). */
  periodAt(s: Schedule, now: Date = new Date()): TimedPeriod {
    return timed(periodOf(todayAt(now, s.timeZone), s.cadence, s.dueWeekday), s.timeZone);
  }

  /** A period by key, or 400 when the key is not a period of the schedule's cadence. */
  periodByKey(s: Schedule, key: string): TimedPeriod {
    const p = periodFromKey(key, s.cadence, s.dueWeekday);
    if (!p) throw invalid('period', `"${key}" is not a ${s.cadence} reporting period`);
    return timed(p, s.timeZone);
  }

  shift(s: Schedule, p: ReportingPeriod, n: number): TimedPeriod {
    return timed(shiftPeriod(p, n, s.dueWeekday), s.timeZone);
  }

  async dto(auth: AuthContext) {
    const s = await this.schedule();
    const current = this.periodAt(s);
    const [group] = s.groupKey
      ? await this.ctx.db
          .select({ id: groups.id, key: groups.key, name: groups.name })
          .from(groups)
          .where(eq(groups.key, s.groupKey))
      : [];
    const people = await peopleByIds(this.ctx.db, [s.updatedBy]);
    return {
      ...this.valueOf(s),
      group: group ?? null,
      current,
      next: this.shift(s, current, 1),
      updatedAt: s.updatedAt,
      updatedBy: personRef(s.updatedBy ? people.get(s.updatedBy) : null),
      canManage: auth.can(PERMISSIONS.reporting) || isAdmin(auth),
    };
  }

  /** 400 when the reporters' group doesn't exist. */
  async checkGroup(groupKey: string | null, db: Db = this.ctx.db) {
    if (!groupKey) return;
    const [g] = await db.select({ id: groups.id }).from(groups).where(eq(groups.key, groupKey));
    if (!g)
      throw invalid('groupKey', `There is no group with the key ${groupKey}`, { code: 'unknown_group' });
  }

  /**
   * Saves the schedule (PMO). Runs in `ctx.transaction` — inside a change set that is the set's transaction — and
   * leaves queueing the job to the caller, after commit.
   */
  async updateSchedule(input: ScheduleInput, auth: AuthContext) {
    if (!auth.can(PERMISSIONS.reporting) && !isAdmin(auth))
      throw forbidden('Only the PMO can change the status reporting schedule');
    return this.ctx.transaction(async (tx) => {
      await this.checkGroup(input.groupKey, tx);
      const before = await this.schedule(tx);
      const values = { ...input, updatedBy: actorOf(auth) };
      await tx
        .insert(statusSchedule)
        .values({ id: 'default', ...values })
        .onConflictDoUpdate({ target: statusSchedule.id, set: { ...values, updatedAt: new Date() } });
      const after = await this.schedule(tx);
      const changes = this.ctx.audit.diff(this.valueOf(before), this.valueOf(after));
      await this.ctx.audit.record(
        {
          action: 'projects.status-schedule.updated',
          entityType: 'projects.status-schedule',
          entityId: 'default',
          entityLabel: 'Status reporting schedule',
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'projects.status-schedule.updated',
        { enabled: after.enabled, cadence: after.cadence, changes: Object.keys(changes) },
        { tx },
      );
      return after;
    });
  }

  /** Asks the worker to bring the open period's expected updates in step now (after a schedule change). */
  async refreshSoon() {
    try {
      await this.ctx.jobs.enqueue('status-updates', {}, { jobId: `status-updates-${Date.now()}` });
    } catch (err) {
      // The next scheduled run does the same; a missing queue (tests without a worker) is not an error here.
      this.ctx.logger.warn({ err }, 'could not queue status-updates');
    }
  }

  /* ───────────── the job: expected updates and reminders ───────────── */

  /**
   * Brings the open period's expected updates in step with the schedule (adds what people owe, drops what nobody
   * owes any more, never anything with content) and sends the reminders that are due. Safe to run concurrently and
   * repeatedly: inserts are `on conflict do nothing` and reminders claim rows with a conditional update.
   */
  async run(now: Date = new Date()) {
    const s = await this.schedule();
    const period = this.periodAt(s, now);
    const removed = await this.ctx.db
      .delete(statusUpdates)
      .where(
        and(
          eq(statusUpdates.state, 'pending'),
          gt(statusUpdates.closesAt, now),
          s.enabled
            ? or(
                ne(statusUpdates.periodKey, period.key),
                ne(statusUpdates.cadence, s.cadence),
                sql`not exists (
                  select 1 from ${members}
                    join ${projects} on ${projects.id} = ${members.projectId}
                    join ${users} on ${users.id} = ${members.userId}
                   where ${members.projectId} = ${statusUpdates.projectId}
                     and ${members.userId} = ${statusUpdates.authorId}
                     and ${owesUpdate(s)})`,
              )
            : undefined,
        ),
      )
      .returning({ id: statusUpdates.id });
    if (!s.enabled) return { opened: 0, removed: removed.length, dueSoon: 0, overdue: 0 };

    const owed = await this.ctx.db
      .select({ projectId: members.projectId, userId: members.userId })
      .from(members)
      .innerJoin(projects, eq(projects.id, members.projectId))
      .innerJoin(users, eq(users.id, members.userId))
      .where(owesUpdate(s));
    let opened = 0;
    for (let i = 0; i < owed.length; i += 500) {
      const rows = await this.ctx.db
        .insert(statusUpdates)
        .values(
          owed.slice(i, i + 500).map((o) => ({
            projectId: o.projectId,
            authorId: o.userId,
            periodKey: period.key,
            cadence: period.cadence,
            periodStart: period.start,
            periodEnd: period.end,
            dueAt: period.dueAt,
            closesAt: period.closesAt,
            state: 'pending' as const,
            expected: true,
          })),
        )
        .onConflictDoUpdate({
          target: [statusUpdates.projectId, statusUpdates.authorId, statusUpdates.periodKey],
          // An update posted before the job noticed it was owed now counts as the owed one.
          set: { expected: true },
          setWhere: eq(statusUpdates.expected, false),
        })
        .returning({ id: statusUpdates.id });
      opened += rows.length;
    }

    const overdue = await this.remindOverdue(s, now);
    const dueSoon = await this.remindDueSoon(s, period, now);
    return { opened, removed: removed.length, dueSoon, overdue };
  }

  /** "Due soon" on the morning `remindDaysBefore` days before the due day, once per update. */
  private async remindDueSoon(s: Schedule, period: TimedPeriod, now: Date) {
    const remindAt = zonedInstant(
      { ...addLocalDays(local(period.due), -s.remindDaysBefore), hour: 9 },
      s.timeZone,
    );
    if (now < remindAt || now > period.dueAt) return 0;
    return this.ctx.transaction(async (tx) => {
      const claimed = await tx
        .update(statusUpdates)
        .set({ reminderStage: 1 })
        .where(
          and(
            eq(statusUpdates.periodKey, period.key),
            eq(statusUpdates.state, 'pending'),
            eq(statusUpdates.reminderStage, 0),
            gt(statusUpdates.dueAt, now),
          ),
        )
        .returning();
      const byId = await this.projectNames(
        tx,
        claimed.map((c) => c.projectId),
      );
      for (const u of claimed) {
        const p = byId.get(u.projectId);
        if (!p) continue;
        await this.ctx.notifications.notify(
          {
            type: 'projects.status-update.due',
            recipients: [u.authorId],
            params: { key: p.key, name: p.name, due: period.due },
            href: composeHref(p.key),
          },
          { tx },
        );
      }
      return claimed.length;
    });
  }

  /** Past the due time: the reporter once, and the project's managers once with everyone still missing. */
  private async remindOverdue(s: Schedule, now: Date) {
    return this.ctx.transaction(async (tx) => {
      const claimed = await tx
        .update(statusUpdates)
        .set({ reminderStage: 2 })
        .where(
          and(
            eq(statusUpdates.state, 'pending'),
            lt(statusUpdates.reminderStage, 2),
            lt(statusUpdates.dueAt, now),
            gt(statusUpdates.closesAt, now),
          ),
        )
        .returning();
      if (!claimed.length) return 0;
      const projectIds = [...new Set(claimed.map((c) => c.projectId))];
      // One query at a time: a transaction is one connection.
      const byId = await this.projectNames(tx, projectIds);
      const people = await peopleByIds(
        tx,
        claimed.map((c) => c.authorId),
      );
      const managerRows = await tx
        .select({ projectId: members.projectId, userId: members.userId })
        .from(members)
        .where(and(inArray(members.projectId, projectIds), eq(members.role, 'manager')));
      for (const u of claimed) {
        const p = byId.get(u.projectId);
        if (!p) continue;
        await this.ctx.notifications.notify(
          {
            type: 'projects.status-update.overdue',
            recipients: [u.authorId],
            params: { key: p.key, name: p.name, due: formatLocalDate(localDateOf(u.dueAt, s.timeZone)) },
            href: composeHref(p.key),
          },
          { tx },
        );
      }
      for (const projectId of projectIds) {
        const p = byId.get(projectId);
        if (!p) continue;
        const missing = claimed.filter((c) => c.projectId === projectId);
        const missingIds = new Set(missing.map((m) => m.authorId));
        const managers = managerRows
          .filter((m) => m.projectId === projectId && !missingIds.has(m.userId))
          .map((m) => m.userId);
        if (!managers.length) continue;
        await this.ctx.notifications.notify(
          {
            type: 'projects.status-update.missing',
            recipients: managers,
            params: {
              key: p.key,
              name: p.name,
              count: missing.length,
              people: missing
                .map((m) => (m.authorId ? people.get(m.authorId)?.displayName : null))
                .filter(Boolean)
                .join(', '),
            },
            href: `${projectHref(p.key)}?view=updates`,
          },
          { tx },
        );
      }
      return claimed.length;
    });
  }

  private async projectNames(db: Db, ids: string[]) {
    if (!ids.length) return new Map<string, { key: string; name: string }>();
    const rows = await db
      .select({ id: projects.id, key: projects.key, name: projects.name })
      .from(projects)
      .where(inArray(projects.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /* ───────────── compliance ───────────── */

  /** SQL for an update's standing at `now`. */
  static standingWhere(standing: UpdateStanding, now: Date): SQL {
    const t = statusUpdates;
    switch (standing) {
      case 'submitted':
        return and(eq(t.state, 'submitted'), lte(t.submittedAt, t.dueAt))!;
      case 'late':
        return and(eq(t.state, 'submitted'), gt(t.submittedAt, t.dueAt))!;
      case 'due':
        return and(eq(t.state, 'pending'), gt(t.dueAt, now))!;
      case 'overdue':
        return and(eq(t.state, 'pending'), lte(t.dueAt, now), gt(t.closesAt, now))!;
      case 'missed':
        return and(eq(t.state, 'pending'), lte(t.closesAt, now))!;
    }
  }

  /** Who sent their update for a period, with counts per standing (PMO, portfolio readers, administrators). */
  async compliance(q: ComplianceQuery, auth: AuthContext, now: Date = new Date()) {
    if (!seesCompliance(auth)) throw forbidden('Only the PMO and portfolio readers can see this');
    const s = await this.schedule();
    const period = q.period ? this.periodByKey(s, q.period) : this.periodAt(s, now);
    const base = and(
      eq(statusUpdates.periodKey, period.key),
      visibleProjects(auth),
      q.project ? eq(projects.key, q.project.toUpperCase()) : undefined,
      q.q
        ? or(
            ilike(projects.name, likePattern(q.q)),
            ilike(projects.key, likePattern(q.q)),
            sql`exists (select 1 from ${users} u where u.id = ${statusUpdates.authorId}
              and u.display_name ilike ${likePattern(q.q)})`,
          )
        : undefined,
    );
    const where = and(base, q.standing ? ReportingService.standingWhere(q.standing, now) : undefined);
    const f = (st: UpdateStanding) =>
      sql<number>`count(*) filter (where ${ReportingService.standingWhere(st, now)})`;
    const [[counts], [total], rows] = await Promise.all([
      this.ctx.db
        .select({
          expected: sql<number>`count(*) filter (where ${statusUpdates.expected})`.mapWith(Number),
          submitted: f('submitted').mapWith(Number),
          late: f('late').mapWith(Number),
          due: f('due').mapWith(Number),
          overdue: f('overdue').mapWith(Number),
          missed: f('missed').mapWith(Number),
        })
        .from(statusUpdates)
        .innerJoin(projects, eq(projects.id, statusUpdates.projectId))
        .where(base),
      this.ctx.db
        .select({ n: count() })
        .from(statusUpdates)
        .innerJoin(projects, eq(projects.id, statusUpdates.projectId))
        .where(where),
      this.ctx.db
        .select({ update: statusUpdates, project: projects })
        .from(statusUpdates)
        .innerJoin(projects, eq(projects.id, statusUpdates.projectId))
        .where(where)
        .orderBy(
          sql`case when ${statusUpdates.state} = 'pending' then 0 else 1 end`,
          asc(projects.key),
          desc(statusUpdates.submittedAt),
        )
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
    ]);
    const current = this.periodAt(s, now);
    return {
      period,
      previousKey: this.shift(s, period, -1).key,
      nextKey: period.key === current.key ? null : this.shift(s, period, 1).key,
      counts: counts!,
      rows,
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}

/** Where a reporter writes their update: the project's Updates tab with the form open. */
export const composeHref = (key: string) => `${projectHref(key)}?view=updates&compose=1`;
