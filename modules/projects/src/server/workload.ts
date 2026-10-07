import { users } from '@isbp/db/schema';
import type { AuthContext, ModuleContext } from '@isbp/sdk/server';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { workloadQuerySchema } from '../contracts';
import {
  addDays,
  formatTaskRef,
  OPEN_TASK_STATUSES,
  overBy,
  round1,
  todayIn,
  utilisation,
  weekStart,
  weeklyCapacity,
  weeklyHours,
} from '../model';
import { seesAll } from './access';
import type { ProjectService } from './projects';
import { members, projects, tasks } from './schema';
import { actorOf } from './shared';

type Query = z.output<typeof workloadQuerySchema>;

interface CellTask {
  id: string;
  reference: string;
  title: string;
  status: (typeof tasks.$inferSelect)['status'];
  projectKey: string;
  dueDate: string | null;
  hours: number;
}

interface Cell {
  week: string;
  planned: number;
  capacity: number;
  utilisation: number | null;
  overBy: number;
  tasks: CellTask[];
}

/**
 * Planned hours per person per ISO week against their capacity. Each open task's remaining (or estimated)
 * hours are spread evenly over its working days up to its due date; capacity is the person's allocation to
 * the projects in view × `hoursPerWeek`. Two queries per request (members, tasks), then pure arithmetic
 * (`model.ts`).
 */
export class WorkloadService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly projectSvc: ProjectService,
  ) {}

  /** One project: its members' hours in this project against their allocation to it. */
  async forProject(ref: string, q: Query, auth: AuthContext) {
    const { project } = await this.projectSvc.load(ref, auth);
    return this.compute([project.id], q, auth);
  }

  /**
   * Across projects: every live project for admins and the PMO, otherwise the projects the caller
   * manages. Allocations and hours are summed over those projects.
   */
  async forPortfolio(q: Query, auth: AuthContext) {
    const me = actorOf(auth);
    const rows = await this.ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          isNull(projects.archivedAt),
          inArray(projects.status, ['proposed', 'active', 'on_hold']),
          seesAll(auth)
            ? undefined
            : me
              ? sql`exists (select 1 from ${members} where ${members.projectId} = ${projects.id} and ${members.userId} = ${me} and ${members.role} = 'manager')`
              : sql`false`,
        ),
      );
    return this.compute(
      rows.map((r) => r.id),
      q,
      auth,
    );
  }

  private async compute(projectIds: string[], q: Query, auth: AuthContext) {
    const today = todayIn(auth.user?.timezone);
    const from = weekStart(q.from ?? today);
    const weeks = Array.from({ length: q.weeks }, (_, i) => addDays(from, i * 7));
    const windowEnd = addDays(from, q.weeks * 7 - 1);
    const { hoursPerWeek } = await this.projectSvc.settings();
    if (!projectIds.length)
      return { from, today, weeks, hoursPerWeek, people: [], unassigned: this.emptyCells(weeks) };

    const [memberRows, taskRows] = await Promise.all([
      this.ctx.db
        .select({
          userId: members.userId,
          allocationPct: members.allocationPct,
          key: projects.key,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(members)
        .innerJoin(projects, eq(projects.id, members.projectId))
        .innerJoin(users, eq(users.id, members.userId))
        .where(
          and(inArray(members.projectId, projectIds), ne(members.role, 'viewer'), eq(users.status, 'active')),
        ),
      // Open tasks with hours whose plan can reach the window (work is planned from today on).
      this.ctx.db
        .select({
          id: tasks.id,
          number: tasks.number,
          title: tasks.title,
          status: tasks.status,
          key: projects.key,
          assigneeId: tasks.assigneeId,
          assigneeName: users.displayName,
          assigneeAvatar: users.avatarUrl,
          startDate: tasks.startDate,
          dueDate: tasks.dueDate,
          estimateHours: tasks.estimateHours,
          remainingHours: tasks.remainingHours,
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .leftJoin(users, eq(users.id, tasks.assigneeId))
        .where(
          and(
            inArray(tasks.projectId, projectIds),
            inArray(tasks.status, [...OPEN_TASK_STATUSES]),
            isNotNull(tasks.dueDate),
            or(isNotNull(tasks.remainingHours), isNotNull(tasks.estimateHours)),
            sql`greatest(${tasks.dueDate}, ${today}::date) >= ${from}::date`,
            sql`(${tasks.startDate} is null or ${tasks.startDate} <= ${windowEnd}::date)`,
          ),
        )
        .limit(20_000),
    ]);

    type Row = {
      user: { id: string; displayName: string; avatarUrl: string | null };
      projects: Map<string, number>;
      planned: number[];
      tasks: CellTask[][];
    };
    const blank = () => ({
      planned: weeks.map(() => 0),
      tasks: weeks.map(() => [] as CellTask[]),
    });
    const people = new Map<string, Row>();
    for (const m of memberRows) {
      const row =
        people.get(m.userId) ??
        ({
          user: { id: m.userId, displayName: m.displayName, avatarUrl: m.avatarUrl },
          projects: new Map(),
          ...blank(),
        } satisfies Row);
      row.projects.set(m.key, (row.projects.get(m.key) ?? 0) + m.allocationPct);
      people.set(m.userId, row);
    }
    const unassigned = blank();
    for (const t of taskRows) {
      const perWeek = weeklyHours(t, today, from, q.weeks);
      let target = unassigned;
      if (t.assigneeId) {
        // Assigned to someone no longer in view (e.g. a former member): show them with no capacity.
        const row =
          people.get(t.assigneeId) ??
          ({
            user: {
              id: t.assigneeId,
              displayName: t.assigneeName ?? '—',
              avatarUrl: t.assigneeAvatar ?? null,
            },
            projects: new Map(),
            ...blank(),
          } satisfies Row);
        people.set(t.assigneeId, row);
        target = row;
      }
      perWeek.forEach((hours, i) => {
        if (hours <= 0) return;
        target.planned[i]! += hours;
        target.tasks[i]!.push({
          id: t.id,
          reference: formatTaskRef(t.key, t.number),
          title: t.title,
          status: t.status,
          projectKey: t.key,
          dueDate: t.dueDate,
          hours: round1(hours),
        });
      });
    }

    const cells = (planned: number[], list: CellTask[][], capacity: number): Cell[] =>
      weeks.map((week, i) => {
        const p = round1(planned[i]!);
        return {
          week,
          planned: p,
          capacity: round1(capacity),
          utilisation: (() => {
            const u = utilisation(p, capacity);
            return u === null ? null : Math.round(u * 100) / 100;
          })(),
          overBy: overBy(p, capacity),
          tasks: list[i]!.sort((a, b) => b.hours - a.hours),
        };
      });

    return {
      from,
      today,
      weeks,
      hoursPerWeek,
      people: [...people.values()]
        .map((r) => {
          const allocations = [...r.projects.values()];
          const capacity = weeklyCapacity(allocations, hoursPerWeek);
          return {
            user: r.user,
            allocationPct: allocations.reduce((a, b) => a + b, 0),
            projects: [...r.projects].map(([key, allocationPct]) => ({ key, allocationPct })),
            cells: cells(r.planned, r.tasks, capacity),
          };
        })
        .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName)),
      unassigned: cells(unassigned.planned, unassigned.tasks, 0).map((c) => ({ ...c, overBy: 0 })),
    };
  }

  private emptyCells(weeks: string[]): Cell[] {
    return weeks.map((week) => ({ week, planned: 0, capacity: 0, utilisation: null, overBy: 0, tasks: [] }));
  }
}
