import { departments, users, uuidv7 } from '@isbp/db/schema';
import type { ModuleContext } from '@isbp/sdk/server';
import { asc, eq } from 'drizzle-orm';
import { addDays, type MemberRole, rankSequence, type TaskStatus, todayIn } from '../model';
import {
  members,
  milestones,
  projects,
  projectUpdates,
  taskActivity,
  taskComments,
  taskDependencies,
  tasks,
} from './schema';
import { PROJECT_SPECS, type PersonPick, type ProjectSpec } from './seed-data';
import { seedStatusReporting } from './seed-status';
import { services } from './services';

/** Named demo accounts are placed explicitly; department picks use the rest of the organisation. */
const NAMED = new Set(['admin', 'helpdesk', 'hr.partner', 'auditor']);
const ROLE_RANK: Record<MemberRole, number> = { manager: 0, member: 1, viewer: 2 };

/** Small deterministic PRNG (mulberry32) so re-seeding a fresh database gives the same demo. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Person {
  id: string;
  username: string;
  managerId: string | null;
  dept: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A timestamp on `day` at `hour:minutes` Taipei time (UTC+8). */
const at = (day: string, hour = 10, minutes = 0) => new Date(`${day}T${pad(hour)}:${pad(minutes)}:00+08:00`);

/**
 * Demo projects for the IT department (idempotent per project key). Runs after the core, Phase 1 and
 * Phase 2 seeds; the proposed `KHH` project is submitted through the real `projects.proposal` workflow,
 * so its approval waits in the owner's manager's inbox.
 */
export async function seedProjects(ctx: ModuleContext) {
  const db = ctx.db;
  const today = todayIn('Asia/Taipei');
  const now = new Date();
  const random = prng(20261007);

  const people: Person[] = await db
    .select({ id: users.id, username: users.username, managerId: users.managerId, dept: departments.code })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(users.status, 'active'))
    .orderBy(asc(users.email));
  const admin = people.find((p) => p.username === 'admin');
  if (!admin) {
    ctx.logger.warn('projects seed skipped: no active admin account');
    return;
  }
  const deptIds = new Map(
    (await db.select({ id: departments.id, code: departments.code }).from(departments)).map((d) => [
      d.code,
      d.id,
    ]),
  );
  const others = people.filter((p) => !NAMED.has(p.username));
  const fallback = (salt: number) => (others.length ? others[salt % others.length]! : admin);

  /**
   * The proposal's owner (`dept: 'IT'`) must have a manager, or the seeded approval would find no
   * approver: IT people who report to the admin first (the approval then waits in the admin's inbox),
   * else anyone with a manager.
   */
  const reportsToAdmin = others.filter((p) => p.managerId === admin.id && p.dept?.startsWith('IT'));
  const managed = reportsToAdmin.length ? reportsToAdmin : others.filter((p) => p.managerId);

  const resolve = (pick: PersonPick, salt: number): Person => {
    if ('username' in pick) return people.find((p) => p.username === pick.username) ?? fallback(salt);
    if (pick.dept === 'IT' && managed.length) return managed[pick.index % managed.length]!;
    const list = others.filter((p) => p.dept === pick.dept);
    return list.length ? list[pick.index % list.length]! : fallback(salt + pick.index);
  };

  let created = 0;
  for (const [pi, spec] of PROJECT_SPECS.entries()) {
    const [exists] = await db.select({ id: projects.id }).from(projects).where(eq(projects.key, spec.key));
    if (exists) continue;
    await seedProject(ctx, spec, { today, now, random, resolve, deptIds, salt: pi * 7 });
    created++;
  }
  if (created) ctx.logger.info({ projects: created }, 'projects demo data created');
  await seedStatusReporting(ctx);
}

async function seedProject(
  ctx: ModuleContext,
  spec: ProjectSpec,
  env: {
    today: string;
    now: Date;
    random: () => number;
    resolve: (pick: PersonPick, salt: number) => Person;
    deptIds: Map<string, string>;
    salt: number;
  },
) {
  const { today, random } = env;
  const day = (offset: number) => addDays(today, offset);

  // Members by slot; one row per person (highest role, largest allocation wins).
  const slotUser = new Map<string, string>();
  const byUser = new Map<string, { role: MemberRole; allocation: number }>();
  for (const [i, m] of spec.members.entries()) {
    const person = env.resolve(m.who, env.salt + i);
    slotUser.set(m.slot, person.id);
    const prev = byUser.get(person.id);
    byUser.set(person.id, {
      role: prev && ROLE_RANK[prev.role] <= ROLE_RANK[m.role] ? prev.role : m.role,
      allocation: Math.max(prev?.allocation ?? 0, m.allocation),
    });
  }
  const ownerId = slotUser.get(spec.owner)!;
  byUser.set(ownerId, { role: 'manager', allocation: byUser.get(ownerId)?.allocation ?? 50 });
  const assignable = (slot: string | undefined) => {
    const id = slot ? slotUser.get(slot) : undefined;
    return id && byUser.get(id)?.role !== 'viewer' ? id : null;
  };

  const lastHealth = [...(spec.history ?? [])]
    .filter((h) => h[0] === 'health')
    .sort((a, b) => a[4] - b[4])[0];
  const projectId = uuidv7();
  const createdAt = new Date(env.now.getTime() - (Math.max(-spec.start, 0) + 12) * 86_400_000);
  const approved = spec.status !== 'proposed';

  await ctx.transaction(async (tx) => {
    await tx.insert(projects).values({
      id: projectId,
      key: spec.key,
      name: spec.name,
      description: spec.description,
      status: spec.status,
      health: spec.health,
      healthNote: spec.healthNote ?? null,
      healthUpdatedAt: lastHealth ? new Date(env.now.getTime() - lastHealth[4] * 86_400_000) : null,
      priority: spec.priority,
      visibility: spec.visibility,
      ownerId,
      departmentId: env.deptIds.get(spec.dept) ?? null,
      startDate: day(spec.start),
      targetDate: day(spec.target),
      completedAt: spec.completedDaysAgo ? at(day(-spec.completedDaysAgo), 17) : null,
      budgetHours: spec.budgetHours,
      nextTaskNumber: spec.tasks.length + 1,
      approvalStatus: approved ? 'approved' : null,
      approvalDecidedAt: approved ? new Date(createdAt.getTime() + 2 * 86_400_000) : null,
      createdBy: ownerId,
      createdAt,
      updatedAt: env.now,
    });
    await tx.insert(members).values(
      [...byUser].map(([userId, m]) => ({
        projectId,
        userId,
        role: m.role,
        allocationPct: m.allocation,
        createdAt,
      })),
    );

    const milestoneIds = spec.milestones.map(() => uuidv7());
    if (spec.milestones.length)
      await tx.insert(milestones).values(
        spec.milestones.map((m, i) => ({
          id: milestoneIds[i]!,
          projectId,
          name: m.name,
          description: m.description ?? null,
          dueDate: day(m.due),
          status: m.done || spec.status === 'completed' ? ('done' as const) : ('open' as const),
          completedAt: m.done || spec.status === 'completed' ? at(day(m.due), 16) : null,
          sort: i,
          createdAt,
        })),
      );

    // Tasks: ids up front (parents and dependencies refer to earlier titles), ranks per board column.
    const ids = spec.tasks.map(() => uuidv7());
    const idOf = new Map(spec.tasks.map((task, i) => [task.title, ids[i]!]));
    const columns = new Map<TaskStatus, number[]>();
    spec.tasks.forEach((task, i) => columns.set(task.status, [...(columns.get(task.status) ?? []), i]));
    const rankOf = new Map<number, string>();
    for (const list of columns.values()) {
      const ranks = rankSequence(list.length);
      list.forEach((taskIndex, j) => rankOf.set(taskIndex, ranks[j]!));
    }
    const created = spec.tasks.map((task) => {
      const startOffset = task.start ?? task.due ?? -20;
      const offset = Math.min(startOffset - 3 - Math.floor(random() * 8), -1);
      return at(day(offset), 9 + Math.floor(random() * 8), Math.floor(random() * 60));
    });
    await tx.insert(tasks).values(
      spec.tasks.map((task, i) => {
        const due = task.due !== undefined ? day(task.due) : null;
        const start = task.start !== undefined ? day(task.start) : null;
        const done = task.status === 'done';
        const completedAt = done
          ? due && due <= today
            ? at(due, 16, Math.floor(random() * 50))
            : at(day(-1), 15)
          : null;
        return {
          id: ids[i]!,
          projectId,
          number: i + 1,
          title: task.title,
          description: task.description ?? null,
          type: task.type ?? 'task',
          parentId: task.parent ? (idOf.get(task.parent) ?? null) : null,
          status: task.status,
          priority: task.priority ?? (i % 5 === 0 ? 'high' : i % 7 === 3 ? 'low' : 'medium'),
          assigneeId: assignable(task.assignee),
          reporterId: ownerId,
          milestoneId: task.milestone !== undefined ? (milestoneIds[task.milestone] ?? null) : null,
          startDate: start,
          dueDate: due,
          estimateHours: task.estimate ?? null,
          remainingHours: done ? 0 : (task.remaining ?? null),
          rank: rankOf.get(i)!,
          labels: task.labels ?? [],
          completedAt,
          createdAt: created[i]!,
          updatedAt:
            completedAt ??
            new Date(Math.max(created[i]!.getTime(), env.now.getTime() - (i % 9) * 3_600_000 * 7)),
        };
      }),
    );

    const deps = spec.tasks.flatMap((task, i) =>
      (task.deps ?? [])
        .map((title) => idOf.get(title))
        .filter((id): id is string => Boolean(id) && id !== ids[i])
        .map((dependsOnId) => ({ taskId: ids[i]!, dependsOnId, createdBy: ownerId, createdAt: created[i]! })),
    );
    if (deps.length) await tx.insert(taskDependencies).values(deps);

    // Timeline: creation, the move out of the backlog/to-do columns, and comments.
    const activity: (typeof taskActivity.$inferInsert)[] = [];
    spec.tasks.forEach((task, i) => {
      activity.push({
        taskId: ids[i]!,
        kind: 'created',
        toValue: 'todo',
        actorId: ownerId,
        createdAt: created[i]!,
      });
      if (task.status !== 'todo' && task.status !== 'backlog') {
        const startedAt = new Date(created[i]!.getTime() + (1 + Math.floor(random() * 3)) * 86_400_000);
        activity.push({
          taskId: ids[i]!,
          kind: 'status',
          field: 'status',
          fromValue: 'todo',
          toValue: task.status,
          actorId: assignable(task.assignee) ?? ownerId,
          createdAt: startedAt > env.now ? env.now : startedAt,
        });
      }
    });
    const comments: (typeof taskComments.$inferInsert)[] = [];
    spec.tasks.forEach((task, i) => {
      for (const [slot, body, daysAgo] of task.comments ?? []) {
        const createdAtComment = new Date(
          env.now.getTime() - daysAgo * 86_400_000 - Math.floor(random() * 6) * 3_600_000,
        );
        const id = uuidv7();
        comments.push({
          id,
          taskId: ids[i]!,
          authorId: slotUser.get(slot) ?? ownerId,
          body,
          createdAt: createdAtComment,
        });
        activity.push({
          taskId: ids[i]!,
          kind: 'comment',
          toValue: id,
          actorId: slotUser.get(slot) ?? ownerId,
          createdAt: createdAtComment,
        });
      }
    });
    if (comments.length) await tx.insert(taskComments).values(comments);
    await tx.insert(taskActivity).values(activity);

    const history = spec.history ?? [];
    if (history.length)
      await tx.insert(projectUpdates).values(
        history.map(([kind, from, to, note, daysAgo, slot]) => ({
          projectId,
          kind,
          fromValue: from,
          toValue: to,
          note,
          authorId: slotUser.get(slot) ?? ownerId,
          createdAt: new Date(env.now.getTime() - daysAgo * 86_400_000),
        })),
      );
  });

  // A real pending approval for the proposed project (large budget → the owner's manager decides).
  if (spec.status === 'proposed') {
    try {
      await services(ctx).projects.submit(projectId, ownerId);
    } catch (err) {
      ctx.logger.warn({ err, key: spec.key }, 'could not submit the seeded proposal');
    }
  }
}
