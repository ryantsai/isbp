/**
 * Action items (Phase 11, `docs/architecture.md` §17.5): tracked here as meeting items (My work, reminders), or routed
 * to a project task through the AI tool registry as the person sending the minutes, after which they follow the
 * task's events. Routing is claimed per item, so a retried publish never creates a task twice.
 */
import { users } from '@isbp/db/schema';
import { type AuthContext, type Db, HttpError, likePattern, type ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { actionItemQuerySchema, createActionItemSchema, updateActionItemSchema } from '../contracts';
import { addDays, formatMeetingRef, type ItemStatus, type RouteError } from '../model';
import { accessFor, involvement, visibleMeetings } from './access';
import { type ActionItemRow, actionItems, type MeetingRow, meetings } from './schema';
import {
  forbidden,
  invalid,
  invalidState,
  ITEM_ENTITY,
  itemHref,
  MEETING_ENTITY,
  notFound,
  peopleByIds,
  personRef,
  text,
  textLocale,
} from './shared';

type CreateInput = z.output<typeof createActionItemSchema>;
type UpdateInput = z.output<typeof updateActionItemSchema>;
type ListQuery = z.output<typeof actionItemQuerySchema>;

export const CREATE_TASK = 'projects.create_task';
const TASK = 'projects.task';
const PROJECT = 'projects.project';

type MeetingInfo = Pick<
  MeetingRow,
  'id' | 'number' | 'title' | 'startsAt' | 'organizerId' | 'visibility' | 'status'
>;
const MEETING_COLS = {
  id: meetings.id,
  number: meetings.number,
  title: meetings.title,
  startsAt: meetings.startsAt,
  organizerId: meetings.organizerId,
  visibility: meetings.visibility,
  status: meetings.status,
};

/** What a project task's status means for the item it came from. */
export function itemStatusOfTask(status: string): ItemStatus {
  return status === 'done' ? 'done' : status === 'cancelled' ? 'cancelled' : 'open';
}

/** A refusal from the projects module, as the reason the item stays a meeting item. */
export function routeErrorOf(err: unknown): RouteError {
  if (err instanceof HttpError)
    return err.statusCode === 403
      ? 'forbidden'
      : err.statusCode === 404
        ? 'not_found'
        : err.statusCode < 500
          ? 'invalid'
          : 'failed';
  return 'failed';
}

export interface Routed {
  itemId: string;
  title: string;
  ok: boolean;
  reference: string | null;
  error: RouteError | null;
}

export class ActionItemService {
  constructor(private readonly ctx: ModuleContext) {}

  /* ───────────── views ───────────── */

  /** Items as the API returns them: owner, project and task resolved for the reader, what the reader may do. */
  async toDtos(rows: readonly { item: ActionItemRow; meeting: MeetingInfo }[], auth: AuthContext) {
    if (!rows.length) return [];
    const me = auth.user?.id ?? null;
    const meetingIds = [...new Set(rows.map((r) => r.meeting.id))];
    const [people, involved, resolved] = await Promise.all([
      peopleByIds(
        this.ctx.db,
        rows.map((r) => r.item.ownerId),
      ),
      involvement(this.ctx.db, meetingIds, me),
      this.ctx.records.resolve(
        [
          ...rows.filter((r) => r.item.projectId).map((r) => ({ type: PROJECT, id: r.item.projectId! })),
          ...rows
            .filter((r) => r.item.targetId)
            .map((r) => ({ type: r.item.targetType ?? TASK, id: r.item.targetId! })),
        ],
        auth,
      ),
    ]);
    return rows.map(({ item: i, meeting: m }) => {
      const access = accessFor(m, involved(m.id), auth);
      const project = i.projectId ? resolved.get(`${PROJECT}:${i.projectId}`) : undefined;
      const task = i.targetId ? resolved.get(`${i.targetType ?? TASK}:${i.targetId}`) : undefined;
      const reference = formatMeetingRef(m.number);
      return {
        id: i.id,
        meeting: { id: m.id, reference, title: m.title, startsAt: m.startsAt },
        title: i.title,
        owner: personRef(i.ownerId ? people.get(i.ownerId) : null),
        dueDate: i.dueDate,
        status: i.status,
        destination: i.destination,
        project: project ? { id: project.id, key: project.reference ?? '', name: project.title } : null,
        task:
          i.targetId && i.targetReference
            ? {
                id: i.targetId,
                reference: i.targetReference,
                href: task?.href ?? `/projects/tasks/${i.targetReference}`,
                status: task?.status ? { key: task.status.key, tone: task.status.tone } : null,
              }
            : null,
        routeError: i.routeError,
        note: i.note,
        completedAt: i.completedAt,
        live: m.status === 'published',
        canEdit: access.canEdit && !i.targetId,
        canComplete: !i.targetId && (access.canEdit || (me !== null && i.ownerId === me)),
      };
    });
  }

  /** A meeting's item rows, in order (no reader view). */
  forMeetingRows(db: Db, meetingId: string) {
    return db
      .select()
      .from(actionItems)
      .where(eq(actionItems.meetingId, meetingId))
      .orderBy(asc(actionItems.sort), asc(actionItems.createdAt));
  }

  async forMeeting(meeting: MeetingInfo, auth: AuthContext) {
    const rows = await this.forMeetingRows(this.ctx.db, meeting.id);
    return this.toDtos(
      rows.map((item) => ({ item, meeting })),
      auth,
    );
  }

  /** Open items of the meetings `meeting` follows up (up to ten meetings back). */
  async earlier(meeting: Pick<MeetingRow, 'previousId'>, auth: AuthContext) {
    const chain: string[] = [];
    let previous = meeting.previousId;
    while (previous && chain.length < 10 && !chain.includes(previous)) {
      chain.push(previous);
      const [row] = await this.ctx.db
        .select({ previousId: meetings.previousId })
        .from(meetings)
        .where(eq(meetings.id, previous));
      previous = row?.previousId ?? null;
    }
    if (!chain.length) return [];
    const rows = await this.ctx.db
      .select({ item: actionItems, meeting: MEETING_COLS })
      .from(actionItems)
      .innerJoin(meetings, eq(meetings.id, actionItems.meetingId))
      .where(
        and(inArray(actionItems.meetingId, chain), eq(actionItems.status, 'open'), visibleMeetings(auth)),
      )
      .orderBy(desc(meetings.startsAt), asc(actionItems.sort));
    return this.toDtos(rows, auth);
  }

  /** "My action items" (owned by me) or "assigned" (of meetings I organised). */
  async list(q: ListQuery, auth: AuthContext) {
    const me = auth.user?.id;
    if (!me) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
    const status = q.status ?? 'open';
    const where = and(
      visibleMeetings(auth),
      q.view === 'assigned' ? eq(meetings.organizerId, me) : eq(actionItems.ownerId, me),
      eq(meetings.status, 'published'),
      status === 'all'
        ? undefined
        : status === 'open'
          ? eq(actionItems.status, 'open')
          : ne(actionItems.status, 'open'),
      q.q ? ilike(actionItems.title, likePattern(q.q)) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.ctx.db
        .select({ item: actionItems, meeting: MEETING_COLS })
        .from(actionItems)
        .innerJoin(meetings, eq(meetings.id, actionItems.meetingId))
        .where(where)
        .orderBy(sql`${actionItems.dueDate} asc nulls last`, desc(meetings.startsAt), asc(actionItems.sort))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db
        .select({ n: count() })
        .from(actionItems)
        .innerJoin(meetings, eq(meetings.id, actionItems.meetingId))
        .where(where),
    ]);
    return { items: await this.toDtos(rows, auth), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  /* ───────────── loading and checks ───────────── */

  private async loadItem(id: string, auth: AuthContext) {
    const [row] = await this.ctx.db
      .select({ item: actionItems, meeting: MEETING_COLS })
      .from(actionItems)
      .innerJoin(meetings, eq(meetings.id, actionItems.meetingId))
      .where(eq(actionItems.id, id));
    if (!row) throw notFound('item');
    const involved = await involvement(this.ctx.db, [row.meeting.id], auth.user?.id);
    const access = accessFor(row.meeting, involved(row.meeting.id), auth);
    if (!access.canView) throw notFound('item');
    return { ...row, access };
  }

  /** 400 when the owner isn't an active person. */
  async checkOwner(ownerId: string | null | undefined, db: Db = this.ctx.db) {
    if (!ownerId) return;
    const [u] = await db.select({ status: users.status }).from(users).where(eq(users.id, ownerId));
    if (u?.status !== 'active') throw invalid('ownerId', 'The owner must be an active person');
  }

  /** 400 when a task item names no project the caller can see. */
  async checkProject(
    destination: string | undefined,
    projectId: string | null | undefined,
    auth: AuthContext,
  ) {
    if (destination !== 'task') return;
    if (!projectId) throw invalid('projectId', 'Choose the project the task goes to');
    if (!(await this.ctx.records.get({ type: PROJECT, id: projectId }, auth)))
      throw invalid('projectId', 'You cannot see that project');
  }

  /* ───────────── writes ───────────── */

  /** Inserts items in `tx` (minutes accepted, or one added on the page); audit and events per item. */
  async insert(
    tx: Db,
    meeting: MeetingInfo,
    inputs: readonly CreateInput[],
    auth: AuthContext,
  ): Promise<ActionItemRow[]> {
    if (!inputs.length) return [];
    const [last] = await tx
      .select({ sort: sql<number>`coalesce(max(${actionItems.sort}), 0)`.mapWith(Number) })
      .from(actionItems)
      .where(eq(actionItems.meetingId, meeting.id));
    let sort = last?.sort ?? 0;
    const rows = await tx
      .insert(actionItems)
      .values(
        inputs.map((i) => ({
          meetingId: meeting.id,
          title: i.title,
          ownerId: i.ownerId ?? null,
          dueDate: i.dueDate ?? null,
          destination: i.destination ?? 'meeting',
          projectId: i.destination === 'task' ? (i.projectId ?? null) : null,
          sort: (sort += 10),
          createdBy: auth.user?.id ?? null,
        })),
      )
      .returning();
    const reference = formatMeetingRef(meeting.number);
    for (const r of rows) {
      await this.ctx.audit.record(
        {
          action: 'meetings.action-item.created',
          entityType: ITEM_ENTITY,
          entityId: r.id,
          entityLabel: `${reference} ${r.title}`,
          metadata: {
            meetingId: meeting.id,
            destination: r.destination,
            ownerId: r.ownerId,
            dueDate: r.dueDate,
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'meetings.action-item.created',
        {
          meetingId: meeting.id,
          reference,
          title: meeting.title,
          itemId: r.id,
          item: r.title,
          ownerId: r.ownerId,
        },
        { tx },
      );
    }
    return rows;
  }

  /** Tells the owners of live meeting items about them (not the person who did it). */
  async notifyAssigned(tx: Db, meeting: MeetingInfo, rows: readonly ActionItemRow[], auth: AuthContext) {
    const reference = formatMeetingRef(meeting.number);
    for (const r of rows) {
      if (!r.ownerId || r.ownerId === auth.user?.id || r.destination !== 'meeting' || r.status !== 'open')
        continue;
      await this.ctx.notifications.notify(
        {
          type: 'meetings.action-item.assigned',
          recipients: [r.ownerId],
          params: { item: r.title, reference, meeting: meeting.title, due: r.dueDate ?? '' },
          href: itemHref(reference, r.id),
        },
        { tx },
      );
    }
  }

  /** Adds one item on the meeting page; on sent minutes it goes live at once (a task item is created now). */
  async create(meeting: MeetingInfo, input: CreateInput, auth: AuthContext) {
    await this.checkOwner(input.ownerId);
    await this.checkProject(input.destination, input.projectId, auth);
    const [row] = await this.ctx.transaction(async (tx) => {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(actionItems)
        .where(eq(actionItems.meetingId, meeting.id));
      if (n >= 100) throw invalidState('A meeting holds at most 100 action items', 'too_many');
      const inserted = await this.insert(tx, meeting, [input], auth);
      if (meeting.status === 'published') await this.notifyAssigned(tx, meeting, inserted, auth);
      return inserted;
    });
    const routed =
      meeting.status === 'published' && row!.destination === 'task' ? await this.route(row!.id, auth) : null;
    return { id: row!.id, routed };
  }

  async update(id: string, input: UpdateInput, auth: AuthContext) {
    const { item, meeting, access } = await this.loadItem(id, auth);
    const me = auth.user?.id ?? null;
    const onlyStatus = Object.keys(input).every((k) => k === 'status' || k === 'note');
    const isOwner = me !== null && item.ownerId === me;
    if (!access.canEdit && !(onlyStatus && isOwner))
      throw forbidden('Only the meeting’s organiser, its attendees and the item’s owner can change it');
    if (item.targetId && Object.keys(input).some((k) => k !== 'note'))
      throw invalidState('This item is a project task now: change it there', 'routed', {
        reference: item.targetReference,
      });
    if (input.ownerId !== undefined) await this.checkOwner(input.ownerId);
    const destination = input.destination ?? item.destination;
    const projectId = input.projectId !== undefined ? input.projectId : item.projectId;
    if (input.destination !== undefined || input.projectId !== undefined)
      await this.checkProject(destination, projectId, auth);

    const set: Partial<ActionItemRow> = {};
    if (input.title !== undefined) set.title = input.title;
    if (input.ownerId !== undefined) set.ownerId = input.ownerId ?? null;
    if (input.dueDate !== undefined) set.dueDate = input.dueDate ?? null;
    if (input.note !== undefined) set.note = input.note || null;
    if (input.destination !== undefined) {
      set.destination = input.destination;
      set.routeError = null;
    }
    if (input.projectId !== undefined || input.destination !== undefined)
      set.projectId = destination === 'task' ? (projectId ?? null) : null;
    if (input.status !== undefined && input.status !== item.status) {
      set.status = input.status;
      set.completedAt = input.status === 'open' ? null : new Date();
      set.completedBy = input.status === 'open' ? null : me;
    }
    if (input.dueDate !== undefined && input.dueDate !== item.dueDate) {
      set.remindedDueDate = null;
      set.overdueRemindedAt = null;
    }
    const reference = formatMeetingRef(meeting.number);
    const saved = await this.ctx.transaction(async (tx) => {
      const [row] = await tx.update(actionItems).set(set).where(eq(actionItems.id, id)).returning();
      const fields = ['title', 'ownerId', 'dueDate', 'status', 'destination', 'projectId', 'note'] as const;
      const changes = this.ctx.audit.diff(
        Object.fromEntries(fields.map((f) => [f, item[f]])),
        Object.fromEntries(fields.map((f) => [f, row![f]])),
      );
      await this.ctx.audit.record(
        {
          action: 'meetings.action-item.updated',
          entityType: ITEM_ENTITY,
          entityId: id,
          entityLabel: `${reference} ${row!.title}`,
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish(
        'meetings.action-item.updated',
        {
          meetingId: meeting.id,
          reference,
          title: meeting.title,
          itemId: id,
          item: row!.title,
          ownerId: row!.ownerId,
          changes: Object.keys(changes),
        },
        { tx },
      );
      if (meeting.status === 'published' && row!.ownerId && row!.ownerId !== item.ownerId)
        await this.notifyAssigned(tx, meeting, [row!], auth);
      return row!;
    });
    const routed =
      meeting.status === 'published' && saved.destination === 'task' && !saved.targetId
        ? await this.route(id, auth)
        : null;
    return { id, routed };
  }

  async remove(id: string, auth: AuthContext) {
    const { item, meeting, access } = await this.loadItem(id, auth);
    if (!access.canEdit) throw forbidden('Only the meeting’s organiser and its attendees can remove items');
    const reference = formatMeetingRef(meeting.number);
    await this.ctx.transaction(async (tx) => {
      await tx.delete(actionItems).where(eq(actionItems.id, id));
      await this.ctx.audit.record(
        {
          action: 'meetings.action-item.deleted',
          entityType: ITEM_ENTITY,
          entityId: id,
          entityLabel: `${reference} ${item.title}`,
          metadata: { task: item.targetReference },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'meetings.action-item.deleted',
        {
          meetingId: meeting.id,
          reference,
          title: meeting.title,
          itemId: id,
          item: item.title,
          ownerId: item.ownerId,
        },
        { tx },
      );
    });
  }

  /* ───────────── routing to project tasks ───────────── */

  /**
   * Creates the project task for a `task` item as `auth` (the person sending the minutes), through the AI tool registry
   * (`projects.create_task`): the project's own rules apply. On success the item follows the task and the meeting is
   * linked to it; when the project refuses, the item stays a meeting item with the reason.
   */
  async route(itemId: string, auth: AuthContext): Promise<Routed> {
    const [claimed] = await this.ctx.db
      .update(actionItems)
      .set({ targetState: 'creating', routeError: null })
      .where(
        and(
          eq(actionItems.id, itemId),
          eq(actionItems.destination, 'task'),
          isNull(actionItems.targetId),
          or(isNull(actionItems.targetState), lt(actionItems.updatedAt, new Date(Date.now() - 5 * 60_000))),
        ),
      )
      .returning();
    if (!claimed) {
      const [row] = await this.ctx.db.select().from(actionItems).where(eq(actionItems.id, itemId));
      return {
        itemId,
        title: row?.title ?? '',
        ok: Boolean(row?.targetId),
        reference: row?.targetReference ?? null,
        error: null,
      };
    }
    const [meeting] = await this.ctx.db
      .select(MEETING_COLS)
      .from(meetings)
      .where(eq(meetings.id, claimed.meetingId));
    const reference = formatMeetingRef(meeting!.number);
    const fail = async (error: RouteError): Promise<Routed> => {
      await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .update(actionItems)
          .set({ destination: 'meeting', targetState: null, routeError: error })
          .where(eq(actionItems.id, itemId))
          .returning();
        await this.ctx.audit.record(
          {
            action: 'meetings.action-item.updated',
            entityType: ITEM_ENTITY,
            entityId: itemId,
            entityLabel: `${reference} ${claimed.title}`,
            changes: { destination: ['task', 'meeting'] },
            metadata: { routeError: error, projectId: claimed.projectId },
            outcome: 'failure',
          },
          { tx },
        );
        if (meeting!.status === 'published') await this.notifyAssigned(tx, meeting!, [row!], auth);
      });
      return { itemId, title: claimed.title, ok: false, reference: null, error };
    };
    if (!this.ctx.ai.tools.list(auth).some((t) => t.name === CREATE_TASK)) return fail('unavailable');
    const project = claimed.projectId
      ? await this.ctx.records.get({ type: PROJECT, id: claimed.projectId }, auth)
      : null;
    if (!project?.reference) return fail('not_found');
    const [owner] = claimed.ownerId
      ? await this.ctx.db
          .select({ email: users.email, status: users.status })
          .from(users)
          .where(eq(users.id, claimed.ownerId))
      : [];
    const locale = textLocale(auth.user?.locale);
    let task: { id: string; reference: string; href?: string };
    try {
      task = await this.ctx.ai.tools.invoke<{ id: string; reference: string; href?: string }>(
        CREATE_TASK,
        {
          project: project.reference,
          title: claimed.title,
          description: text(locale, 'server.taskDescription', {
            reference,
            title: meeting!.title,
            date: meeting!.startsAt.toISOString().slice(0, 10),
          }),
          ...(owner?.status === 'active' ? { assigneeEmail: owner.email } : {}),
          ...(claimed.dueDate ? { dueDate: claimed.dueDate } : {}),
        },
        { auth },
      );
    } catch (err) {
      this.ctx.logger.info({ err, itemId }, 'routing an action item to a project task was refused');
      return fail(routeErrorOf(err));
    }
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(actionItems)
        .set({
          targetType: TASK,
          targetId: task.id,
          targetReference: task.reference,
          targetState: 'created',
          routeError: null,
        })
        .where(eq(actionItems.id, itemId));
      await this.ctx.records.link(
        { type: MEETING_ENTITY, id: claimed.meetingId },
        { type: TASK, id: task.id },
        { tx },
      );
      await this.ctx.audit.record(
        {
          action: 'meetings.action-item.routed',
          entityType: ITEM_ENTITY,
          entityId: itemId,
          entityLabel: `${reference} ${claimed.title}`,
          metadata: { task: task.reference, taskId: task.id, project: project.reference },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'meetings.action-item.routed',
        {
          meetingId: claimed.meetingId,
          reference,
          title: meeting!.title,
          itemId,
          item: claimed.title,
          ownerId: claimed.ownerId,
          taskId: task.id,
          task: task.reference,
        },
        { tx },
      );
    });
    return { itemId, title: claimed.title, ok: true, reference: task.reference, error: null };
  }

  /* ───────────── following project tasks ───────────── */

  /** A project task's status or assignee changed (or it was deleted): its items follow (idempotent). */
  async followTask(
    taskId: string,
    change: { status?: string; assigneeId?: string | null; deleted?: boolean },
  ) {
    const rows = await this.ctx.db
      .select({ item: actionItems, meeting: MEETING_COLS })
      .from(actionItems)
      .innerJoin(meetings, eq(meetings.id, actionItems.meetingId))
      .where(and(eq(actionItems.targetType, TASK), eq(actionItems.targetId, taskId)));
    for (const { item, meeting } of rows) {
      const set: Partial<ActionItemRow> = {};
      if (change.deleted) set.status = 'cancelled';
      else if (change.status) set.status = itemStatusOfTask(change.status);
      if (change.assigneeId !== undefined) set.ownerId = change.assigneeId;
      const next = { ...item, ...set };
      if (next.status === item.status && next.ownerId === item.ownerId) continue;
      if (next.status !== item.status) set.completedAt = next.status === 'open' ? null : new Date();
      const reference = formatMeetingRef(meeting.number);
      await this.ctx.transaction(async (tx) => {
        await tx.update(actionItems).set(set).where(eq(actionItems.id, item.id));
        const changes = this.ctx.audit.diff(
          { status: item.status, ownerId: item.ownerId },
          { status: next.status, ownerId: next.ownerId },
        );
        await this.ctx.audit.record(
          {
            action: 'meetings.action-item.updated',
            entityType: ITEM_ENTITY,
            entityId: item.id,
            entityLabel: `${reference} ${item.title}`,
            changes,
            metadata: { source: TASK, task: item.targetReference },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'meetings.action-item.updated',
          {
            meetingId: meeting.id,
            reference,
            title: meeting.title,
            itemId: item.id,
            item: item.title,
            ownerId: next.ownerId,
            changes: Object.keys(changes),
          },
          { tx },
        );
      });
    }
  }

  /** People who leave: their open meeting items lose their owner (the organiser reassigns them). */
  async offboard(userId: string) {
    await this.ctx.db
      .update(actionItems)
      .set({ ownerId: null })
      .where(
        and(eq(actionItems.ownerId, userId), eq(actionItems.status, 'open'), isNull(actionItems.targetId)),
      );
  }

  /* ───────────── reminders ───────────── */

  /**
   * Reminds owners of open meeting items (of sent minutes) due tomorrow, once per due date; tells owners of overdue
   * items (weekly while overdue) and the organiser the first time. Rows are claimed with a conditional update.
   */
  async reminders(today: string, now: Date = new Date()) {
    const tomorrow = addDays(today, 1);
    const live = sql`exists (select 1 from ${meetings} m where m.id = ${actionItems.meetingId} and m.status = 'published')`;
    const base = and(
      eq(actionItems.status, 'open'),
      eq(actionItems.destination, 'meeting'),
      isNull(actionItems.targetId),
      live,
    );
    return this.ctx.transaction(async (tx) => {
      const dueSoon = await tx
        .update(actionItems)
        .set({ remindedDueDate: tomorrow })
        .where(
          and(
            base,
            eq(actionItems.dueDate, tomorrow),
            sql`${actionItems.remindedDueDate} is distinct from ${actionItems.dueDate}`,
            sql`${actionItems.ownerId} is not null`,
          ),
        )
        .returning();
      const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
      const before = await tx
        .select({ id: actionItems.id, overdueRemindedAt: actionItems.overdueRemindedAt })
        .from(actionItems)
        .where(
          and(
            base,
            lt(actionItems.dueDate, today),
            or(isNull(actionItems.overdueRemindedAt), lt(actionItems.overdueRemindedAt, weekAgo)),
          ),
        );
      const firstTime = new Set(before.filter((b) => !b.overdueRemindedAt).map((b) => b.id));
      const overdue = before.length
        ? await tx
            .update(actionItems)
            .set({ overdueRemindedAt: now })
            .where(
              and(
                inArray(
                  actionItems.id,
                  before.map((b) => b.id),
                ),
                or(isNull(actionItems.overdueRemindedAt), lt(actionItems.overdueRemindedAt, weekAgo)),
              ),
            )
            .returning()
        : [];
      const meetingIds = [...new Set([...dueSoon, ...overdue].map((r) => r.meetingId))];
      if (!meetingIds.length) return { dueSoon: 0, overdue: 0 };
      const meetingRows = await tx
        .select(MEETING_COLS)
        .from(meetings)
        .where(inArray(meetings.id, meetingIds));
      const byId = new Map(meetingRows.map((m) => [m.id, m]));
      for (const r of dueSoon) {
        const m = byId.get(r.meetingId)!;
        const reference = formatMeetingRef(m.number);
        await this.ctx.notifications.notify(
          {
            type: 'meetings.action-item.due_soon',
            recipients: [r.ownerId],
            params: { item: r.title, reference, meeting: m.title, due: r.dueDate ?? '' },
            href: itemHref(reference, r.id),
          },
          { tx },
        );
      }
      for (const r of overdue) {
        const m = byId.get(r.meetingId)!;
        const reference = formatMeetingRef(m.number);
        const recipients = [r.ownerId, ...(firstTime.has(r.id) ? [m.organizerId] : [])].filter(
          (x, i, all): x is string => Boolean(x) && all.indexOf(x) === i,
        );
        const people = await peopleByIds(tx, [r.ownerId]);
        await this.ctx.notifications.notify(
          {
            type: 'meetings.action-item.overdue',
            recipients,
            params: {
              item: r.title,
              reference,
              meeting: m.title,
              due: r.dueDate ?? '',
              owner: r.ownerId ? (people.get(r.ownerId)?.displayName ?? '') : '',
            },
            href: itemHref(reference, r.id),
          },
          { tx },
        );
      }
      return { dueSoon: dueSoon.length, overdue: overdue.length };
    });
  }

  /** Open and total items per meeting (lists). */
  async countsFor(meetingIds: readonly string[]) {
    if (!meetingIds.length) return new Map<string, { open: number; total: number }>();
    const rows = await this.ctx.db
      .select({
        meetingId: actionItems.meetingId,
        total: count(),
        open: sql<number>`count(*) filter (where ${actionItems.status} = 'open')`.mapWith(Number),
      })
      .from(actionItems)
      .where(inArray(actionItems.meetingId, [...meetingIds]))
      .groupBy(actionItems.meetingId);
    return new Map(rows.map((r) => [r.meetingId, { open: r.open, total: r.total }]));
  }
}

export type ItemDto = Awaited<ReturnType<ActionItemService['toDtos']>>[number];
