/**
 * Demo status reporting (Phase 11): a weekly schedule (managers and the network team report, due Friday), four weeks
 * of updates for the active demo projects with a story that matches each project's health, and this week's updates
 * partly sent, so the report, My work and the compliance list look alive. Idempotent: skipped once a schedule exists.
 */
import { groups } from '@isbp/db/schema';
import type { ModuleContext } from '@isbp/sdk/server';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { addDays, type ProjectHealth, periodOf, todayIn } from '../model';
import { timed } from './reporting';
import { ensureTemplates } from './report-templates';
import { members, projects, statusSchedule, statusUpdates } from './schema';
import { services } from './services';
import { projectSignals } from './status-updates';

const TZ = 'Asia/Taipei';

/** What a week's update says, by the health the project is heading to. */
const STORY: Record<
  ProjectHealth,
  { summary: string; done: string; next: string; blockers: string | null; asks: string | null }[]
> = {
  on_track: [
    {
      summary:
        'Work is on plan. The team closed the items planned for the week and the next milestone is in reach.',
      done: '- Closed the planned tasks for the week\n- Reviewed the test results with the users',
      next: '- Start the next work package\n- Prepare the milestone review',
      blockers: null,
      asks: null,
    },
    {
      summary: 'Steady progress; no new risks this week.',
      done: '- Finished the configuration work\n- Updated the runbook',
      next: '- Pilot with the first group of users',
      blockers: null,
      asks: null,
    },
  ],
  at_risk: [
    {
      summary: 'Behind by a few days: a dependency arrived late and two tasks slipped into next week.',
      done: '- Completed the design review',
      next: '- Catch up on the slipped tasks\n- Confirm the new delivery date with the vendor',
      blockers: '- Vendor delivery is late\n- One engineer out sick this week',
      asks: '- Approve overtime for the weekend cutover window',
    },
  ],
  off_track: [
    {
      summary:
        'The milestone will be missed: data migration needs another two weeks after the test load failed.',
      done: '- Ran the first test load (failed on duplicate keys)',
      next: '- Clean the source data\n- Rerun the test load',
      blockers: '- Source data quality: duplicate customer keys\n- Key user not available for sign-off',
      asks: '- Decide whether to move the go-live or cut scope\n- Free the key user for two days',
    },
  ],
};

const at = (day: string, hour: number) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+08:00`);

export async function seedStatusReporting(ctx: ModuleContext) {
  const db = ctx.db;
  const [exists] = await db.select({ id: statusSchedule.id }).from(statusSchedule);
  if (exists) return;
  await ensureTemplates(ctx);
  const [team] = await db.select({ key: groups.key }).from(groups).where(eq(groups.key, 'network-team'));
  await db.insert(statusSchedule).values({
    id: 'default',
    enabled: true,
    cadence: 'weekly',
    dueWeekday: 5,
    timeZone: TZ,
    managers: true,
    groupKey: team?.key ?? null,
    remindDaysBefore: 1,
  });

  const active = await db
    .select()
    .from(projects)
    .where(and(eq(projects.status, 'active'), isNull(projects.archivedAt)))
    .orderBy(asc(projects.key));
  const today = todayIn(TZ);
  const current = periodOf(today, 'weekly', 5);
  const signals = await projectSignals(
    db,
    active.map((p) => p.id),
    today,
  );
  let written = 0;
  for (const [pi, p] of active.entries()) {
    const reporters = await db
      .select({ userId: members.userId, role: members.role })
      .from(members)
      .where(and(eq(members.projectId, p.id), eq(members.role, 'manager')))
      .orderBy(asc(members.createdAt))
      .limit(1);
    const manager = reporters[0]?.userId;
    if (!manager) continue;
    // Four past weeks: the story drifts towards the project's current health.
    for (let back = 4; back >= 1; back--) {
      const period = timed(periodOf(addDays(current.start, -7 * back), 'weekly', 5), TZ);
      const health: ProjectHealth =
        back > 2 && p.health === 'off_track' ? 'at_risk' : back > 3 ? 'on_track' : p.health;
      const story = STORY[health][(pi + back) % STORY[health].length]!;
      const late = (pi + back) % 5 === 0;
      await db
        .insert(statusUpdates)
        .values({
          projectId: p.id,
          authorId: manager,
          periodKey: period.key,
          cadence: 'weekly',
          periodStart: period.start,
          periodEnd: period.end,
          dueAt: period.dueAt,
          closesAt: period.closesAt,
          state: 'submitted',
          expected: true,
          status: health,
          progress: Math.max(0, (signals.get(p.id)?.progress ?? 30) - back * 4),
          forecastDate: health === 'off_track' && p.targetDate ? addDays(p.targetDate, 14) : null,
          ...story,
          signals: signals.get(p.id) ?? null,
          submittedAt: late ? at(addDays(period.due, 1), 10) : at(period.due, 15),
          reminderStage: late ? 2 : 1,
        })
        .onConflictDoNothing();
      written++;
    }
  }
  // This week: the expected updates are opened as the schedule's job would, and half of the projects have sent theirs.
  await services(ctx).reporting.run();
  for (const [pi, p] of active.entries()) {
    if (pi % 2 === 1) continue;
    const [pending] = await db
      .select()
      .from(statusUpdates)
      .where(
        and(
          eq(statusUpdates.projectId, p.id),
          eq(statusUpdates.periodKey, current.key),
          eq(statusUpdates.state, 'pending'),
        ),
      )
      .limit(1);
    if (!pending) continue;
    const story = STORY[p.health][pi % STORY[p.health].length]!;
    await db
      .update(statusUpdates)
      .set({
        state: 'submitted',
        status: p.health,
        progress: signals.get(p.id)?.progress ?? null,
        forecastDate: p.health === 'off_track' && p.targetDate ? addDays(p.targetDate, 14) : null,
        ...story,
        signals: signals.get(p.id) ?? null,
        submittedAt: new Date(Math.min(Date.now(), at(today, 9).getTime())),
      })
      .where(eq(statusUpdates.id, pending.id));
    written++;
  }
  ctx.logger.info({ updates: written }, 'status reporting demo data created');
}
