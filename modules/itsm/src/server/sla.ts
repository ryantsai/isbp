/**
 * SLA timers: attach on create, pause/resume on status changes, re-target on priority changes, meet on
 * first response / resolution, and the once-a-minute monitor that warns and breaches. Timers are rows
 * (`itsm.ticket_slas`) scanned on partial indexes — idempotent and safe to re-run.
 */
import { groupMembers } from '@isbp/db/schema';
import { type Db, evaluateCondition, type ModuleContext } from '@isbp/sdk/server';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { TicketStatus } from '../contracts';
import {
  type CalendarSpec,
  MINUTE_MS,
  type SlaClock,
  slaDueAt,
  slaElapsedRatio,
  slaResume,
  slaWarnAt,
} from './business-time';
import { activePolicies, calendarMap, categoryMap, type PolicyRow } from './lookups';
import { isDone, refOf, SOLVED_STATUSES, ticketHref } from './rules';
import { type SlaMetric, slaPolicies, type SlaStatus, ticketActivities, tickets, ticketSlas } from './schema';

type TicketRow = typeof tickets.$inferSelect;
type SlaRow = typeof ticketSlas.$inferSelect;

const METRICS: SlaMetric[] = ['response', 'resolution'];
const ALWAYS_OPEN: CalendarSpec = {
  timezone: 'UTC',
  hours: { days: [[], [], [], [], [], [], []] },
  alwaysOpen: true,
};

export const clockOf = (r: SlaRow): SlaClock => ({
  startedAt: r.startedAt,
  targetMinutes: r.targetMinutes,
  pausedMs: r.pausedMs,
  pausedAt: r.pausedAt,
  stoppedAt: r.stoppedAt,
});

/**
 * Facts an SLA policy condition is evaluated against. `categoryKeys` is the category's key and its ancestors' keys
 * (nearest first), so "category is Hardware" on `ticket.categoryKeys` also matches Hardware › Laptop.
 */
export function slaFacts(
  t: TicketRow,
  categoryKey: string | null,
  categoryKeys: readonly string[] = categoryKey ? [categoryKey] : [],
) {
  return {
    ticket: {
      type: t.type,
      priority: t.priority,
      impact: t.impact,
      urgency: t.urgency,
      categoryKey,
      categoryKeys: [...categoryKeys],
      major: t.major,
      channel: t.channel,
    },
  };
}

/** The category's key and its ancestors' keys, nearest first. */
async function categoryKeysOf(db: Db, categoryId: string | null) {
  if (!categoryId) return { key: null, keys: [] as string[] };
  const cats = await categoryMap(db);
  const c = cats.get(categoryId);
  if (!c) return { key: null, keys: [] as string[] };
  const ancestors = [...c.ancestors].reverse().map((a) => cats.get(a.id)?.key);
  return { key: c.key, keys: [c.key, ...ancestors.filter((k): k is string => Boolean(k))] };
}

/** First active policy (by sort order) for the ticket's type whose condition holds. */
export function matchPolicy(policies: readonly PolicyRow[], facts: ReturnType<typeof slaFacts>) {
  return (
    policies.find(
      (p) => p.ticketTypes.includes(facts.ticket.type) && evaluateCondition(p.condition, facts),
    ) ?? null
  );
}

function targetMinutes(policy: PolicyRow, priority: number, metric: SlaMetric): number | null {
  const t = policy.targets[String(priority)];
  if (!t) return null;
  return metric === 'response' ? t.responseMinutes : t.resolutionMinutes;
}

export class SlaService {
  constructor(private readonly ctx: ModuleContext) {}

  private async calendarFor(policy: Pick<PolicyRow, 'calendarId'>): Promise<CalendarSpec> {
    return (await calendarMap(this.ctx.db)).get(policy.calendarId)?.spec ?? ALWAYS_OPEN;
  }

  private async policyOf(id: string): Promise<PolicyRow | null> {
    const active = (await activePolicies(this.ctx.db)).find((p) => p.id === id);
    if (active) return active;
    const [row] = await this.ctx.db.select().from(slaPolicies).where(eq(slaPolicies.id, id));
    return row ?? null;
  }

  /** Starts response and resolution timers from the first matching policy. */
  async attach(tx: Db, t: TicketRow, now = new Date()): Promise<void> {
    const category = await categoryKeysOf(this.ctx.db, t.categoryId);
    const policy = matchPolicy(await activePolicies(this.ctx.db), slaFacts(t, category.key, category.keys));
    if (!policy) return;
    const cal = await this.calendarFor(policy);
    const paused = policy.pauseStatuses.includes(t.status);
    const rows = [];
    for (const metric of METRICS) {
      const minutes = targetMinutes(policy, t.priority, metric);
      if (!minutes) continue;
      const clock: SlaClock = {
        startedAt: now,
        targetMinutes: minutes,
        pausedMs: 0,
        pausedAt: paused ? now : null,
        stoppedAt: null,
      };
      rows.push({
        ticketId: t.id,
        policyId: policy.id,
        metric,
        status: (paused ? 'paused' : 'running') as SlaStatus,
        targetMinutes: minutes,
        startedAt: now,
        dueAt: slaDueAt(clock, cal),
        warnAt: slaWarnAt(clock, policy.warnAt, cal),
        pausedAt: clock.pausedAt,
      });
    }
    if (rows.length) await tx.insert(ticketSlas).values(rows).onConflictDoNothing();
  }

  private async rows(tx: Db, ticketId: string) {
    return tx
      .select()
      .from(ticketSlas)
      .where(eq(ticketSlas.ticketId, ticketId))
      .orderBy(asc(ticketSlas.metric));
  }

  private async save(tx: Db, id: string, set: Partial<SlaRow>) {
    await tx.update(ticketSlas).set(set).where(eq(ticketSlas.id, id));
  }

  /** Recomputes the deadline and warning instant of a (resumed or re-targeted) timer. */
  private async reschedule(tx: Db, row: SlaRow, clock: SlaClock, now: Date, extra: Partial<SlaRow> = {}) {
    const policy = await this.policyOf(row.policyId);
    if (!policy) return;
    const cal = await this.calendarFor(policy);
    const warnAt = slaWarnAt(clock, policy.warnAt, cal);
    await this.save(tx, row.id, {
      targetMinutes: clock.targetMinutes,
      pausedMs: clock.pausedMs,
      pausedAt: clock.pausedAt,
      stoppedAt: clock.stoppedAt,
      dueAt: slaDueAt(clock, cal),
      warnAt,
      // A later threshold re-arms the warning.
      warnedAt: warnAt > now ? null : row.warnedAt,
      ...extra,
    });
  }

  /** Meets the response timer (first public reply by someone other than the requester, or work started). */
  async meetResponse(tx: Db, ticketId: string, now = new Date()) {
    await this.stop(tx, ticketId, ['response'], 'met', now);
  }

  private async stop(tx: Db, ticketId: string, metrics: SlaMetric[], status: 'met' | 'cancelled', now: Date) {
    for (const row of await this.rows(tx, ticketId)) {
      if (!metrics.includes(row.metric) || (row.status !== 'running' && row.status !== 'paused')) continue;
      let clock = clockOf(row);
      if (clock.pausedAt) {
        const policy = await this.policyOf(row.policyId);
        clock = slaResume(clock, policy ? await this.calendarFor(policy) : ALWAYS_OPEN, now);
      }
      // A running timer already past its deadline was breached, whether or not the monitor saw it yet.
      const late = status === 'met' && row.status === 'running' && row.dueAt <= now;
      await this.save(tx, row.id, {
        status: late ? 'breached' : status,
        stoppedAt: late ? row.dueAt : now,
        pausedAt: null,
        pausedMs: clock.pausedMs,
      });
    }
  }

  /** Applies a status change to the ticket's timers. */
  async onStatusChange(tx: Db, ticketId: string, from: TicketStatus, to: TicketStatus, now = new Date()) {
    if (to === 'cancelled' || to === 'rejected') return this.stop(tx, ticketId, METRICS, 'cancelled', now);
    if (isDone(to)) return this.stop(tx, ticketId, METRICS, 'met', now);
    if (to === 'in_progress') await this.meetResponse(tx, ticketId, now);
    const reopened = SOLVED_STATUSES.includes(from);
    for (const row of await this.rows(tx, ticketId)) {
      const policy = await this.policyOf(row.policyId);
      if (!policy) continue;
      const cal = await this.calendarFor(policy);
      const pause = policy.pauseStatuses.includes(to);
      if (reopened && row.metric === 'resolution' && row.status === 'met' && row.stoppedAt) {
        // Reopened: the time it sat resolved does not count; the clock picks up where it stopped.
        const clock = slaResume({ ...clockOf(row), pausedAt: row.stoppedAt, stoppedAt: null }, cal, now);
        await this.reschedule(tx, row, pause ? { ...clock, pausedAt: now } : clock, now, {
          status: pause ? 'paused' : 'running',
        });
      } else if (row.status === 'running' && pause) {
        if (row.dueAt <= now) continue; // already late: the monitor breaches it
        await this.save(tx, row.id, { status: 'paused', pausedAt: now });
      } else if (row.status === 'paused' && !pause) {
        await this.reschedule(tx, row, slaResume(clockOf(row), cal, now), now, { status: 'running' });
      }
    }
  }

  /** Priority changed: running and paused timers move to the policy's target for the new priority. */
  async retarget(tx: Db, ticketId: string, priority: number, now = new Date()) {
    for (const row of await this.rows(tx, ticketId)) {
      if (row.status !== 'running' && row.status !== 'paused') continue;
      const policy = await this.policyOf(row.policyId);
      const minutes = policy ? targetMinutes(policy, priority, row.metric) : null;
      if (!minutes || minutes === row.targetMinutes) continue;
      await this.reschedule(tx, row, { ...clockOf(row), targetMinutes: minutes }, now);
    }
  }

  /* ───────────────────────────── DTOs ───────────────────────────── */

  /** Elapsed ratio for display; breached timers keep counting until the ticket is done. */
  async ratio(row: SlaRow, now: Date, ticketDoneAt: Date | null): Promise<number> {
    const policy = await this.policyOf(row.policyId);
    const cal = policy ? await this.calendarFor(policy) : ALWAYS_OPEN;
    const clock = clockOf(row);
    if (row.status === 'breached') clock.stoppedAt = ticketDoneAt ?? now;
    return slaElapsedRatio(clock, cal, now);
  }

  /* ───────────────────────────── monitor ───────────────────────────── */

  private async recipients(t: TicketRow): Promise<string[]> {
    if (t.assigneeId) return [t.assigneeId];
    if (!t.assignmentGroupId) return [];
    const rows = await this.ctx.db
      .select({ id: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, t.assignmentGroupId))
      .limit(50);
    return rows.map((r) => r.id);
  }

  /**
   * Warns running timers past their threshold (once) and breaches timers past their deadline.
   * Each timer is claimed with a conditional update, so concurrent or repeated runs never double-fire.
   */
  async monitor(now = new Date(), batch = 500): Promise<{ warned: number; breached: number }> {
    const db = this.ctx.db;
    let warned = 0;
    let breached = 0;

    const late = await db
      .select({ id: ticketSlas.id })
      .from(ticketSlas)
      .where(and(eq(ticketSlas.status, 'running'), lte(ticketSlas.dueAt, now)))
      .orderBy(asc(ticketSlas.dueAt))
      .limit(batch);
    for (const { id } of late) {
      const done = await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .update(ticketSlas)
          .set({ status: 'breached', stoppedAt: sql`${ticketSlas.dueAt}` })
          .where(and(eq(ticketSlas.id, id), eq(ticketSlas.status, 'running')))
          .returning();
        if (!row) return false;
        const [t] = await tx.select().from(tickets).where(eq(tickets.id, row.ticketId));
        if (!t) return false;
        const reference = refOf(t);
        await tx.insert(ticketActivities).values({
          ticketId: t.id,
          kind: 'sla',
          public: false,
          data: { event: 'breached', metric: row.metric, dueAt: row.dueAt.toISOString() },
        });
        const payload = {
          ticketId: t.id,
          reference,
          type: t.type,
          title: t.title,
          metric: row.metric,
          dueAt: row.dueAt.toISOString(),
        };
        await this.ctx.events.publish('itsm.sla.breached', payload, { tx });
        await this.ctx.notifications.notify(
          {
            type: 'itsm.sla.breached',
            recipients: await this.recipients(t),
            params: { reference, title: t.title, metric: row.metric, dueAt: row.dueAt, priority: t.priority },
            href: ticketHref(reference),
          },
          { tx },
        );
        return true;
      });
      if (done) breached++;
    }

    const due = await db
      .select({ id: ticketSlas.id })
      .from(ticketSlas)
      .where(
        and(
          eq(ticketSlas.status, 'running'),
          sql`${ticketSlas.warnedAt} is null`,
          lte(ticketSlas.warnAt, now),
          sql`${ticketSlas.dueAt} > ${now}`,
        ),
      )
      .orderBy(asc(ticketSlas.warnAt))
      .limit(batch);
    for (const { id } of due) {
      const done = await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .update(ticketSlas)
          .set({ warnedAt: now })
          .where(
            and(eq(ticketSlas.id, id), eq(ticketSlas.status, 'running'), sql`${ticketSlas.warnedAt} is null`),
          )
          .returning();
        if (!row) return false;
        const [t] = await tx.select().from(tickets).where(eq(tickets.id, row.ticketId));
        if (!t) return false;
        const reference = refOf(t);
        const payload = {
          ticketId: t.id,
          reference,
          type: t.type,
          title: t.title,
          metric: row.metric,
          dueAt: row.dueAt.toISOString(),
        };
        await this.ctx.events.publish('itsm.sla.warning', payload, { tx });
        await this.ctx.notifications.notify(
          {
            type: 'itsm.sla.warning',
            recipients: await this.recipients(t),
            params: {
              reference,
              title: t.title,
              metric: row.metric,
              dueAt: row.dueAt,
              minutes: Math.max(1, Math.round((row.dueAt.getTime() - now.getTime()) / MINUTE_MS)),
            },
            href: ticketHref(reference),
          },
          { tx },
        );
        return true;
      });
      if (done) warned++;
    }
    return { warned, breached };
  }

  /** SLA rows of many tickets (list badges). */
  async forTickets(ticketIds: string[]): Promise<SlaRow[]> {
    if (!ticketIds.length) return [];
    return this.ctx.db.select().from(ticketSlas).where(inArray(ticketSlas.ticketId, ticketIds));
  }
}
