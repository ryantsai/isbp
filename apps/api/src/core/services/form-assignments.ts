import {
  type AssignFormTaskConfig,
  assignFormTaskConfigSchema,
  assignmentDueAt,
  assignmentTitle,
  type createFormAssignmentSchema,
  type formAssignmentQuerySchema,
  type FormAssignmentState,
  formatRequestNumber,
  isTimeZone,
  type myFormAssignmentQuerySchema,
  periodKey,
} from '@isbp/contracts';
import {
  formAssignments,
  formSubmissions,
  formVersions,
  forms,
  groupMembers,
  groups,
  roleAssignments,
  roles,
  users,
} from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  localize,
  type ModuleContext,
  type TaskContext,
  type TaskOutcome,
} from '@isbp/sdk/server';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import { likePattern, orderBy, pageOffset } from '../util';
import { peopleById, ref } from './people';

type Row = typeof formAssignments.$inferSelect;
type FormRow = typeof forms.$inferSelect;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Reminders: none within this long of the previous one (or of the assignment), so at most one a day. */
export const REMIND_GAP_MS = 23 * HOUR;
/** "Due soon" reminders start this long before the due date. */
export const REMIND_BEFORE_MS = 2 * DAY;
/** After this long overdue, reminders become weekly. */
export const REMIND_DAILY_OVERDUE_MS = 7 * DAY;

/** Where the assignee fills it in: the form, with the assignment's context. */
export const assignmentHref = (formKey: string, id: string) =>
  `/requests/forms/${encodeURIComponent(formKey)}?assignment=${id}`;
const adminHref = (formId: string) => `/admin/forms/${formId}?tab=assignments`;

export function stateOf(row: Pick<Row, 'status' | 'dueAt' | 'completedAt'>, now: Date): FormAssignmentState {
  if (row.status === 'cancelled') return 'cancelled';
  if (row.status === 'done')
    return row.completedAt && row.completedAt.getTime() > row.dueAt.getTime() ? 'late' : 'done';
  return row.dueAt.getTime() < now.getTime() ? 'overdue' : 'open';
}

/** One person, or a group of people (any member may do it). */
type Assignee = { userId: string; groupId?: undefined } | { groupId: string; userId?: undefined };

interface OpenInput {
  form: FormRow;
  assignee: Assignee;
  title: string;
  dueAt: Date;
  periodKey: string | null;
  note: string | null;
  source: { type: 'job' | 'manual'; id: string | null };
  /** One assignment per key (job-created ones: per form, assignee and period). */
  dedupeKey: string | null;
  createdBy: string | null;
}

const invalid = (path: string, message: string) =>
  new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { issues: [{ path, message }] });

/**
 * Assigned and recurring forms (`core.form_assignments`): a form someone must fill in by a date. Form administrators
 * assign them by hand or a scheduled job opens one per period (`core.assign-form`); the assignee (or any member of
 * the assigned group) completes it by submitting the form with the assignment; an hourly job sends reminders.
 */
export class FormAssignmentService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  /* ───────────── lookups ───────────── */

  private async form(id: string): Promise<FormRow> {
    const [f] = await this.db.select().from(forms).where(eq(forms.id, id));
    if (!f) throw httpErrors.notFound('Form not found');
    return f;
  }

  private async row(id: string): Promise<Row | null> {
    const [a] = await this.db.select().from(formAssignments).where(eq(formAssignments.id, id));
    return a ?? null;
  }

  /** Ids of the groups the person belongs to. */
  private async groupIdsOf(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId));
    return rows.map((r) => r.id);
  }

  /** Whether the person is the assignee, or a member of the assigned group. */
  private async isAssignee(a: Row, userId: string | undefined): Promise<boolean> {
    if (!userId) return false;
    if (a.assigneeUserId) return a.assigneeUserId === userId;
    if (!a.assigneeGroupId) return false;
    const [m] = await this.db
      .select({ id: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, a.assigneeGroupId), eq(groupMembers.userId, userId)));
    return Boolean(m);
  }

  /** Who hears about it: the person, or the group's active members. */
  private async recipients(a: Pick<Row, 'assigneeUserId' | 'assigneeGroupId'>, db: Db = this.db) {
    if (a.assigneeUserId) return [a.assigneeUserId];
    if (!a.assigneeGroupId) return [];
    const rows = await db
      .select({ id: groupMembers.userId })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.groupId, a.assigneeGroupId), eq(users.status, 'active')));
    return rows.map((r) => r.id);
  }

  /**
   * Who maintains the form (and so hears about overdue assignments): its author, last editor and the publisher of the
   * live version, plus whoever assigned it by hand; else the platform administrators.
   */
  private async editorsOf(form: FormRow, a: Pick<Row, 'createdBy'>): Promise<string[]> {
    const [live] =
      form.publishedVersion === null
        ? []
        : await this.db
            .select({ by: formVersions.publishedBy })
            .from(formVersions)
            .where(and(eq(formVersions.formId, form.id), eq(formVersions.version, form.publishedVersion)));
    const ids = [form.createdBy, form.updatedBy, live?.by, a.createdBy].filter((x): x is string =>
      Boolean(x),
    );
    if (ids.length) return [...new Set(ids)];
    const admins = await this.db
      .select({ id: roleAssignments.userId })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roles.key, 'platform-admin'), isNotNull(roleAssignments.userId)));
    return [...new Set(admins.map((r) => r.id!))];
  }

  /** The assignee input (a user id or a group key), checked: an active person, or an existing group. */
  private async resolveAssignee(
    input: { type: 'user'; userId: string } | { type: 'group'; groupKey: string },
  ): Promise<Assignee & { label: string }> {
    if (input.type === 'user') {
      const [u] = await this.db
        .select({ id: users.id, name: users.displayName, status: users.status })
        .from(users)
        .where(eq(users.id, input.userId));
      if (!u || u.status !== 'active') throw invalid('assignee.userId', 'Choose an active person');
      return { userId: u.id, label: u.name };
    }
    const [g] = await this.db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.key, input.groupKey));
    if (!g) throw invalid('assignee.groupKey', 'Unknown group');
    return { groupId: g.id, label: g.name };
  }

  /** Assignments are for forms people can fill in: published and not archived. */
  private assertAssignable(form: FormRow, path = 'formId') {
    if (form.archivedAt) throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The form is archived', { path });
    if (form.publishedVersion === null)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Publish the form before assigning it', { path });
  }

  /* ───────────── DTOs ───────────── */

  async views(rows: Row[], now = new Date()) {
    if (!rows.length) return [];
    const formIds = [...new Set(rows.map((r) => r.formId))];
    const groupIds = [...new Set(rows.map((r) => r.assigneeGroupId).filter((x): x is string => Boolean(x)))];
    const subIds = rows.map((r) => r.submissionId).filter((x): x is string => Boolean(x));
    const [formRows, groupRows, subRows] = await Promise.all([
      this.db
        .select({ id: forms.id, key: forms.key, name: forms.name, icon: forms.icon })
        .from(forms)
        .where(inArray(forms.id, formIds)),
      groupIds.length
        ? this.db
            .select({ id: groups.id, key: groups.key, name: groups.name })
            .from(groups)
            .where(inArray(groups.id, groupIds))
        : Promise.resolve([]),
      subIds.length
        ? this.db
            .select({
              id: formSubmissions.id,
              number: formSubmissions.number,
              by: formSubmissions.submittedBy,
            })
            .from(formSubmissions)
            .where(inArray(formSubmissions.id, subIds))
        : Promise.resolve([]),
    ]);
    const people = await peopleById(this.db, [
      ...rows.flatMap((r) => [r.assigneeUserId, r.createdBy]),
      ...subRows.map((s) => s.by),
    ]);
    const formById = new Map(formRows.map((f) => [f.id, f]));
    const groupById = new Map(groupRows.map((g) => [g.id, g]));
    const subById = new Map(subRows.map((s) => [s.id, s]));
    return rows.map((r) => {
      const form = formById.get(r.formId)!;
      const group = r.assigneeGroupId ? groupById.get(r.assigneeGroupId) : undefined;
      const sub = r.submissionId ? subById.get(r.submissionId) : undefined;
      return {
        id: r.id,
        form,
        title: r.title,
        periodKey: r.periodKey,
        dueAt: r.dueAt,
        status: r.status,
        state: stateOf(r, now),
        assignee: r.assigneeUserId
          ? { type: 'user' as const, user: ref(people, r.assigneeUserId)! }
          : group
            ? { type: 'group' as const, group }
            : null,
        note: r.note,
        source: { type: r.source.type, id: r.source.id ?? null },
        submission: sub
          ? { id: sub.id, reference: formatRequestNumber(sub.number), submittedBy: ref(people, sub.by) }
          : null,
        createdBy: ref(people, r.createdBy),
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        href: assignmentHref(form.key, r.id),
      };
    });
  }

  private async view(row: Row) {
    return (await this.views([row]))[0]!;
  }

  /* ───────────── opening one ───────────── */

  /**
   * Opens an assignment (audit, event and the assignee's notification in one transaction). With a `dedupeKey` that
   * is already taken nothing happens and `created` is false.
   */
  async open(input: OpenInput): Promise<{ row: Row; created: boolean }> {
    const { form } = input;
    const created = await this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(formAssignments)
        .values({
          formId: form.id,
          title: input.title,
          assigneeUserId: input.assignee.userId ?? null,
          assigneeGroupId: input.assignee.groupId ?? null,
          periodKey: input.periodKey,
          dueAt: input.dueAt,
          source: input.source,
          dedupeKey: input.dedupeKey,
          note: input.note,
          createdBy: input.createdBy,
        })
        .onConflictDoNothing({ target: formAssignments.dedupeKey })
        .returning();
      if (!row) return null;
      await this.ctx.audit.record(
        {
          action: 'core.form-assignment.created',
          entityType: 'form_assignment',
          entityId: row.id,
          entityLabel: row.title,
          metadata: {
            form: form.key,
            periodKey: row.periodKey,
            dueAt: row.dueAt.toISOString(),
            assigneeUserId: row.assigneeUserId,
            assigneeGroupId: row.assigneeGroupId,
            source: input.source,
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'core.form-assignment.created',
        {
          assignmentId: row.id,
          formId: form.id,
          periodKey: row.periodKey,
          assigneeUserId: row.assigneeUserId,
          assigneeGroupId: row.assigneeGroupId,
          dueAt: row.dueAt.toISOString(),
          source: input.source.type,
        },
        { tx },
      );
      await this.ctx.notifications.notify(
        {
          type: 'core.form-assignment.assigned',
          recipients: await this.recipients(row, tx),
          params: { title: row.title, form: form.name, due: row.dueAt, note: row.note ?? '' },
          href: assignmentHref(form.key, row.id),
        },
        { tx },
      );
      return row;
    });
    if (created) return { row: created, created: true };
    const [existing] = await this.db
      .select()
      .from(formAssignments)
      .where(eq(formAssignments.dedupeKey, input.dedupeKey!));
    return { row: existing!, created: false };
  }

  /* ───────────── administration (core.forms.manage) ───────────── */

  /** Forms that can be assigned and the groups to assign them to. */
  async options() {
    const [formRows, groupRows] = await Promise.all([
      this.db
        .select({
          id: forms.id,
          key: forms.key,
          name: forms.name,
          icon: forms.icon,
          published: sql<boolean>`${forms.publishedVersion} is not null`,
        })
        .from(forms)
        .where(isNull(forms.archivedAt))
        .orderBy(asc(forms.key)),
      this.db
        .select({ id: groups.id, key: groups.key, name: groups.name })
        .from(groups)
        .where(ne(groups.key, 'everyone'))
        .orderBy(asc(groups.name))
        .limit(500),
    ]);
    return { forms: formRows, groups: groupRows };
  }

  /** Assign a form by hand. */
  async create(formId: string, input: z.output<typeof createFormAssignmentSchema>, auth: AuthContext) {
    const form = await this.form(formId);
    this.assertAssignable(form);
    const assignee = await this.resolveAssignee(input.assignee);
    const periodKey = input.periodKey ?? null;
    const title =
      input.title ??
      assignmentTitle(`${localize(form.name, auth.user?.locale ?? 'en')} {{period}}`, periodKey);
    const { row } = await this.open({
      form,
      assignee,
      title,
      dueAt: input.dueAt,
      periodKey,
      note: input.note ?? null,
      source: { type: 'manual', id: null },
      dedupeKey: null,
      createdBy: auth.user?.id ?? null,
    });
    return this.view(row);
  }

  async list(formId: string, q: z.output<typeof formAssignmentQuerySchema>, now = new Date()) {
    await this.form(formId);
    const a = formAssignments;
    const byState: Record<FormAssignmentState, ReturnType<typeof and>> = {
      open: and(eq(a.status, 'open'), gte(a.dueAt, now)),
      overdue: and(eq(a.status, 'open'), lt(a.dueAt, now)),
      done: and(eq(a.status, 'done'), lte(a.completedAt, a.dueAt)),
      late: and(eq(a.status, 'done'), sql`${a.completedAt} > ${a.dueAt}`),
      cancelled: eq(a.status, 'cancelled'),
    };
    const where = and(
      eq(a.formId, formId),
      q.state ? byState[q.state] : undefined,
      q.period ? eq(a.periodKey, q.period) : undefined,
      q.q ? ilike(a.title, likePattern(q.q)) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(a)
        .where(where)
        .orderBy(
          ...orderBy(
            q.sort,
            { dueAt: a.dueAt, createdAt: a.createdAt, completedAt: a.completedAt, title: a.title },
            '-dueAt',
            a.id,
          ),
        )
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.db.select({ n: count() }).from(a).where(where),
    ]);
    return { items: await this.views(rows, now), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  /** How each period went (the latest 12 periods), from the assignments' due dates and completion times. */
  async compliance(formId: string, now = new Date()) {
    await this.form(formId);
    const a = formAssignments;
    const at = now.toISOString();
    const rows = await this.db
      .select({
        periodKey: a.periodKey,
        dueAt: sql<Date>`max(${a.dueAt})`.mapWith(a.dueAt),
        total: count(),
        onTime: sql<number>`count(*) filter (where ${a.status} = 'done' and ${a.completedAt} <= ${a.dueAt})::int`,
        late: sql<number>`count(*) filter (where ${a.status} = 'done' and ${a.completedAt} > ${a.dueAt})::int`,
        overdue: sql<number>`count(*) filter (where ${a.status} = 'open' and ${a.dueAt} < ${at}::timestamptz)::int`,
        open: sql<number>`count(*) filter (where ${a.status} = 'open' and ${a.dueAt} >= ${at}::timestamptz)::int`,
        cancelled: sql<number>`count(*) filter (where ${a.status} = 'cancelled')::int`,
      })
      .from(a)
      .where(eq(a.formId, formId))
      .groupBy(a.periodKey)
      .orderBy(desc(sql`max(${a.dueAt})`))
      .limit(12);
    return { periods: rows };
  }

  async cancel(id: string, reason: string | null | undefined, auth: AuthContext) {
    const a = await this.row(id);
    if (!a) throw httpErrors.notFound('Assignment not found');
    const form = await this.form(a.formId);
    const now = new Date();
    await this.ctx.transaction(async (tx) => {
      const [moved] = await tx
        .update(formAssignments)
        .set({ status: 'cancelled', updatedAt: now })
        .where(and(eq(formAssignments.id, id), eq(formAssignments.status, 'open')))
        .returning({ id: formAssignments.id });
      if (!moved)
        throw new HttpError(409, ErrorCodes.ASSIGNMENT_CLOSED, 'Only open assignments can be cancelled', {
          status: a.status,
        });
      await this.ctx.audit.record(
        {
          action: 'core.form-assignment.cancelled',
          entityType: 'form_assignment',
          entityId: id,
          entityLabel: a.title,
          metadata: {
            form: form.key,
            periodKey: a.periodKey,
            reason: reason ?? null,
            by: auth.user?.id ?? null,
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'core.form-assignment.cancelled',
        { assignmentId: id, formId: a.formId, periodKey: a.periodKey },
        { tx },
      );
    });
    return this.view((await this.row(id))!);
  }

  /* ───────────── the assignee ───────────── */

  /** Open (or closed) assignments of the person and of their groups. */
  async mine(q: z.output<typeof myFormAssignmentQuerySchema>, auth: AuthContext, now = new Date()) {
    const me = auth.user!.id;
    const a = formAssignments;
    const groupIds = await this.groupIdsOf(me);
    const where = and(
      or(eq(a.assigneeUserId, me), groupIds.length ? inArray(a.assigneeGroupId, groupIds) : undefined),
      q.status === 'open'
        ? and(eq(a.status, 'open'), isNull(forms.archivedAt))
        : q.status === 'closed'
          ? ne(a.status, 'open')
          : undefined,
      q.q ? ilike(a.title, likePattern(q.q)) : undefined,
    );
    const order =
      q.status === 'open'
        ? [asc(a.dueAt), asc(a.id)]
        : q.status === 'closed'
          ? [desc(a.updatedAt), asc(a.id)]
          : [desc(sql`${a.status} = 'open'`), desc(a.dueAt), asc(a.id)];
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ a })
        .from(a)
        .innerJoin(forms, eq(forms.id, a.formId))
        .where(where)
        .orderBy(...order)
        .limit(q.pageSize)
        .offset(pageOffset(q.page, q.pageSize)),
      this.db.select({ n: count() }).from(a).innerJoin(forms, eq(forms.id, a.formId)).where(where),
    ]);
    return {
      items: await this.views(
        rows.map((r) => r.a),
        now,
      ),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** One of the person's assignments (404 for anyone else). */
  async mineOne(id: string, auth: AuthContext) {
    const a = await this.row(id);
    if (!a || !(await this.isAssignee(a, auth.user?.id))) throw httpErrors.notFound('Assignment not found');
    return this.view(a);
  }

  /** The form an open assignment of the person is for (it opens that form to them whatever its audience). */
  async openFormIdFor(id: string | undefined, auth: AuthContext): Promise<string | undefined> {
    if (!id) return undefined;
    const a = await this.row(id);
    if (!a || a.status !== 'open' || !(await this.isAssignee(a, auth.user?.id))) return undefined;
    return a.formId;
  }

  /**
   * The assignment a submission completes: it must exist (404), be the person's or their group's (403) and still be
   * open (409 `ASSIGNMENT_CLOSED`).
   */
  async forSubmission(id: string, auth: AuthContext): Promise<Row> {
    const a = await this.row(id);
    if (!a) throw httpErrors.notFound('Assignment not found');
    if (!(await this.isAssignee(a, auth.user?.id)))
      throw new HttpError(
        403,
        ErrorCodes.FORBIDDEN,
        'Only the assignee, or a member of the assigned group, can complete this assignment',
      );
    if (a.status !== 'open')
      throw new HttpError(409, ErrorCodes.ASSIGNMENT_CLOSED, 'This assignment is already closed', {
        status: a.status,
      });
    return a;
  }

  /** Whether the assignment is for the form with this key. */
  async isFor(a: Row, formKey: string): Promise<boolean> {
    const [f] = await this.db.select({ id: forms.id }).from(forms).where(eq(forms.key, formKey));
    return f?.id === a.formId;
  }

  /** Marks the assignment done by this submission, in the submission's transaction (one submission per assignment). */
  async complete(
    tx: Db,
    a: Row,
    sub: { id: string; number: number },
    form: Pick<FormRow, 'key'>,
    now = new Date(),
  ) {
    const [done] = await tx
      .update(formAssignments)
      .set({ status: 'done', submissionId: sub.id, completedAt: now, updatedAt: now })
      .where(and(eq(formAssignments.id, a.id), eq(formAssignments.status, 'open')))
      .returning();
    if (!done)
      throw new HttpError(
        409,
        ErrorCodes.ASSIGNMENT_CLOSED,
        'This assignment was completed or cancelled meanwhile',
      );
    const late = now.getTime() > a.dueAt.getTime();
    await this.ctx.audit.record(
      {
        action: 'core.form-assignment.completed',
        entityType: 'form_assignment',
        entityId: a.id,
        entityLabel: a.title,
        metadata: { form: form.key, periodKey: a.periodKey, request: formatRequestNumber(sub.number), late },
      },
      { tx },
    );
    await this.ctx.events.publish(
      'core.form-assignment.completed',
      { assignmentId: a.id, formId: a.formId, periodKey: a.periodKey, submissionId: sub.id, late },
      { tx },
    );
  }

  /* ───────────── reminders (hourly job) ───────────── */

  /**
   * Reminds assignees of open assignments due within two days and of overdue ones — at most once a day (weekly after
   * a week overdue), never within a day of being assigned. The first reminder after the due date also tells the
   * form's editors and publishes `core.form-assignment.overdue`. Assignments of archived or paused forms wait.
   */
  async remind(now = new Date()): Promise<{ reminded: number; overdue: number }> {
    const a = formAssignments;
    const quiet = new Date(now.getTime() - REMIND_GAP_MS);
    let reminded = 0;
    let overdue = 0;
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const batch = await this.db
        .select({ a, form: forms })
        .from(a)
        .innerJoin(forms, eq(forms.id, a.formId))
        .where(
          and(
            eq(a.status, 'open'),
            lte(a.dueAt, new Date(now.getTime() + REMIND_BEFORE_MS)),
            sql`coalesce(${a.lastRemindedAt}, ${a.createdAt}) <= ${quiet.toISOString()}::timestamptz`,
            isNull(forms.archivedAt),
            eq(forms.active, true),
            sql`${a.id} > ${after}`,
          ),
        )
        .orderBy(asc(a.id))
        .limit(200);
      if (!batch.length) break;
      after = batch[batch.length - 1]!.a.id;
      for (const { a: row, form } of batch) {
        const late = row.dueAt.getTime() <= now.getTime();
        // A week after the due date, once a week is enough.
        if (
          late &&
          now.getTime() - row.dueAt.getTime() > REMIND_DAILY_OVERDUE_MS &&
          row.lastRemindedAt &&
          now.getTime() - row.lastRemindedAt.getTime() < REMIND_DAILY_OVERDUE_MS - HOUR
        )
          continue;
        const firstOverdue =
          late && (!row.lastRemindedAt || row.lastRemindedAt.getTime() < row.dueAt.getTime());
        const sent = await this.remindOne(row, form, { late, firstOverdue, now });
        if (sent) {
          reminded++;
          if (firstOverdue) overdue++;
        }
      }
      if (batch.length < 200) break;
    }
    return { reminded, overdue };
  }

  private async remindOne(
    row: Row,
    form: FormRow,
    { late, firstOverdue, now }: { late: boolean; firstOverdue: boolean; now: Date },
  ): Promise<boolean> {
    const editors = firstOverdue ? await this.editorsOf(form, row) : [];
    return this.ctx.transaction(async (tx) => {
      // Claimed by moving `lastRemindedAt`: a concurrent run finds it changed and sends nothing.
      const [claimed] = await tx
        .update(formAssignments)
        .set({ lastRemindedAt: now })
        .where(
          and(
            eq(formAssignments.id, row.id),
            eq(formAssignments.status, 'open'),
            row.lastRemindedAt
              ? eq(formAssignments.lastRemindedAt, row.lastRemindedAt)
              : isNull(formAssignments.lastRemindedAt),
          ),
        )
        .returning({ id: formAssignments.id });
      if (!claimed) return false;
      const href = assignmentHref(form.key, row.id);
      await this.ctx.notifications.notify(
        {
          type: 'core.form-assignment.reminder',
          recipients: await this.recipients(row, tx),
          params: { title: row.title, form: form.name, due: row.dueAt, overdue: late ? 'yes' : 'no' },
          href,
        },
        { tx },
      );
      if (firstOverdue) {
        const assignee = row.assigneeUserId
          ? ((await peopleById(tx, [row.assigneeUserId])).get(row.assigneeUserId)?.displayName ?? '?')
          : ((
              await tx
                .select({ name: groups.name })
                .from(groups)
                .where(eq(groups.id, row.assigneeGroupId ?? '00000000-0000-0000-0000-000000000000'))
            )[0]?.name ?? '?');
        await this.ctx.notifications.notify(
          {
            type: 'core.form-assignment.overdue',
            recipients: editors,
            params: { title: row.title, form: form.name, due: row.dueAt, assignee },
            href: adminHref(form.id),
          },
          { tx },
        );
        await this.ctx.audit.record(
          {
            action: 'core.form-assignment.overdue',
            category: 'system',
            entityType: 'form_assignment',
            entityId: row.id,
            entityLabel: row.title,
            metadata: { form: form.key, periodKey: row.periodKey, dueAt: row.dueAt.toISOString() },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'core.form-assignment.overdue',
          { assignmentId: row.id, formId: form.id, periodKey: row.periodKey, dueAt: row.dueAt.toISOString() },
          { tx },
        );
      }
      return true;
    });
  }

  /* ───────────── `core.assign-form` (Scheduled Jobs) ───────────── */

  private async taskForm(formKey: string): Promise<FormRow> {
    const [f] = await this.db.select().from(forms).where(eq(forms.key, formKey));
    if (!f) throw invalid('formKey', `Unknown form ${formKey}`);
    if (f.archivedAt) throw invalid('formKey', 'The form is archived');
    if (f.publishedVersion === null) throw invalid('formKey', 'Publish the form before assigning it');
    return f;
  }

  /** The job editor's checks: a published form, an active person or an existing group, a usable title. */
  async validateTask(config: AssignFormTaskConfig) {
    const c = assignFormTaskConfigSchema.parse(config);
    await this.taskForm(c.formKey);
    await this.resolveAssignee(c.assignee);
    if (!assignmentTitle(c.title, '2026-01')) throw invalid('title', 'Enter a title');
  }

  async describeTask(config: AssignFormTaskConfig) {
    const c = assignFormTaskConfigSchema.parse(config);
    const [f] = await this.db
      .select({ id: forms.id, name: forms.name })
      .from(forms)
      .where(eq(forms.key, c.formKey));
    const who =
      c.assignee.type === 'group'
        ? `group ${c.assignee.groupKey}`
        : ((await peopleById(this.db, [c.assignee.userId])).get(c.assignee.userId)?.displayName ??
          'a person');
    return {
      label: `Assign “${f ? localize(f.name, 'en') : c.formKey}” to ${who}, each ${c.period}`,
      href: f ? adminHref(f.id) : null,
    };
  }

  /**
   * One run: the assignment of the period the run's slot falls in (in the job's time zone). A run of a period that
   * already has one (a retry, "Run now", another job) changes nothing.
   */
  async runTask(config: AssignFormTaskConfig, task: TaskContext): Promise<TaskOutcome> {
    const c = assignFormTaskConfigSchema.parse(config);
    const timeZone = isTimeZone(task.timeZone) ? task.timeZone : 'UTC';
    const form = await this.taskForm(c.formKey);
    const assignee = await this.resolveAssignee(c.assignee);
    const key = periodKey(task.scheduledFor, c.period, timeZone);
    const dueAt = assignmentDueAt(task.scheduledFor, c.period, c.due, timeZone);
    const who = assignee.userId ? `user:${assignee.userId}` : `group:${assignee.groupId}`;
    const { row, created } = await this.open({
      form,
      assignee,
      title: assignmentTitle(c.title, key),
      dueAt,
      periodKey: key,
      note: c.note ?? null,
      source: { type: 'job', id: task.jobId },
      dedupeKey: `form:${form.id}:${who}:${key}`.slice(0, 300),
      createdBy: null,
    });
    task.log(
      created
        ? `Assigned “${row.title}” to ${assignee.label}, due ${row.dueAt.toISOString()} (${timeZone})`
        : `“${row.title}” is already assigned for ${key} (${row.status})`,
    );
    return {
      summary: created ? `Assigned ${row.title}` : `Already assigned for ${key}`,
      metrics: { created: created ? 1 : 0 },
      href: adminHref(form.id),
    };
  }
}
