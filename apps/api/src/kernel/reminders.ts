import {
  applications,
  groupMembers,
  groups,
  roleAssignments,
  roles,
  scheduledReminders,
  users,
  uuidv7,
} from '@isbp/db/schema';
import type { Db, LocalizedText, NotificationParam } from '@isbp/sdk/server';
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { ModuleRegistry } from './modules';
import type { NotificationCenter } from './notifications/service';
import { PLATFORM_APP_KEY } from './rbac';

/** Who a reminder goes to, resolved when it is sent (group members and role holders of that day). */
export interface ReminderRecipients {
  userIds?: string[];
  /** Members of these groups. */
  groupKeys?: string[];
  /** Holders of these platform roles (directly or through a group). */
  roleKeys?: string[];
}

/** What scheduled a reminder: `{ type: 'form-submission', id, runId }` for a request's `core.remind` action. */
export interface ReminderSource {
  type: string;
  id: string;
  runId?: string;
}

export interface ScheduleReminder {
  moduleId: string;
  /** A notification type of `moduleId` (`core.reminder.due`). */
  type: string;
  recipients: ReminderRecipients;
  /** ICU parameters of the notification text (ISO date-times are shown as dates, localized texts per language). */
  params: Record<string, string | number | LocalizedText>;
  href?: string | null;
  dueAt: Date;
  source: ReminderSource;
}

type Row = typeof scheduledReminders.$inferSelect;

/** Exact ISO date-times in stored params become dates again (formatted in each recipient's zone and language). */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const BATCH = 200;

/**
 * Notifications sent on a later date (`core.scheduled_reminders`): a request's `core.remind` action schedules one
 * ("30 days before the rule expires"); the core job `deliver-reminders` sends those that are due through the
 * notification centre, resolving groups and roles then. A reminder is sent once (claimed atomically).
 */
export class ReminderService {
  constructor(
    private readonly deps: {
      db: Db;
      registry: ModuleRegistry;
      notifications: NotificationCenter;
      logger: FastifyBaseLogger;
    },
  ) {}

  private get db() {
    return this.deps.db;
  }

  /** The reminder a source (a process action run) already scheduled, if any — makes scheduling idempotent. */
  async bySource(source: ReminderSource, tx: Db = this.db): Promise<Row | null> {
    const [row] = await tx
      .select()
      .from(scheduledReminders)
      .where(sql`${scheduledReminders.source} @> ${JSON.stringify(source)}::jsonb`)
      .limit(1);
    return row ?? null;
  }

  async schedule(input: ScheduleReminder, tx: Db = this.db): Promise<Row> {
    const [row] = await tx
      .insert(scheduledReminders)
      .values({
        id: uuidv7(),
        moduleId: input.moduleId,
        type: input.type,
        recipients: input.recipients,
        params: input.params,
        href: input.href ?? null,
        dueAt: input.dueAt,
        source: input.source,
      })
      .returning();
    return row!;
  }

  /** Reminders of a source (`{ type: 'form-submission', id }`), by due date. */
  async listFor(source: Pick<ReminderSource, 'type' | 'id'>, tx: Db = this.db): Promise<Row[]> {
    return tx
      .select()
      .from(scheduledReminders)
      .where(
        sql`${scheduledReminders.source} @> ${JSON.stringify({ type: source.type, id: source.id })}::jsonb`,
      )
      .orderBy(asc(scheduledReminders.dueAt));
  }

  /** Cancels the pending reminders of a source (a request that was withdrawn); returns how many. */
  async cancelFor(source: Pick<ReminderSource, 'type' | 'id'>, tx: Db = this.db): Promise<number> {
    const rows = await tx
      .update(scheduledReminders)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(scheduledReminders.status, 'pending'),
          sql`${scheduledReminders.source} @> ${JSON.stringify({ type: source.type, id: source.id })}::jsonb`,
        ),
      )
      .returning({ id: scheduledReminders.id });
    return rows.length;
  }

  /** The people a reminder goes to now: the named people, the groups' members and the roles' holders (active). */
  async resolve(recipients: ReminderRecipients, tx: Db = this.db): Promise<string[]> {
    const ids = new Set((recipients.userIds ?? []).filter((x) => typeof x === 'string'));
    const groupKeys = (recipients.groupKeys ?? []).filter((x) => typeof x === 'string');
    const roleKeys = (recipients.roleKeys ?? []).filter((x) => typeof x === 'string');
    if (groupKeys.length)
      for (const m of await tx
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(inArray(groups.key, groupKeys)))
        ids.add(m.userId);
    if (roleKeys.length) {
      const now = new Date();
      const held = await tx
        .select({ userId: roleAssignments.userId, groupId: roleAssignments.groupId })
        .from(roleAssignments)
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .innerJoin(applications, eq(applications.id, roles.applicationId))
        .where(
          and(
            eq(applications.key, PLATFORM_APP_KEY),
            inArray(roles.key, roleKeys),
            or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, now)),
          ),
        );
      for (const h of held) if (h.userId) ids.add(h.userId);
      const viaGroups = held.map((h) => h.groupId).filter((g): g is string => Boolean(g));
      if (viaGroups.length)
        for (const m of await tx
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(inArray(groupMembers.groupId, viaGroups)))
          ids.add(m.userId);
    }
    if (!ids.size) return [];
    const active = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, [...ids]), eq(users.status, 'active')));
    return active.map((u) => u.id);
  }

  /**
   * Sends the reminders due by `now` (the `deliver-reminders` job; tests call it with a date). Each is claimed
   * (`pending` → `sent`) in the transaction that creates its notifications, so a reminder is sent once even when two
   * workers run the job. Returns how many were sent.
   */
  async deliverDue(now: Date = new Date(), limit = BATCH): Promise<{ sent: number; failed: number }> {
    const due = await this.db
      .select({ id: scheduledReminders.id })
      .from(scheduledReminders)
      .where(and(eq(scheduledReminders.status, 'pending'), lte(scheduledReminders.dueAt, now)))
      .orderBy(asc(scheduledReminders.dueAt))
      .limit(limit);
    let sent = 0;
    let failed = 0;
    for (const { id } of due) {
      try {
        const done = await this.db.transaction(async (raw) => {
          const tx = raw as unknown as Db;
          const [row] = await tx
            .update(scheduledReminders)
            .set({ status: 'sent', sentAt: new Date() })
            .where(and(eq(scheduledReminders.id, id), eq(scheduledReminders.status, 'pending')))
            .returning();
          if (!row) return false;
          // A reminder of a module that is no longer enabled is dropped (marked sent, nothing goes out).
          if (!this.deps.registry.isEnabled(row.moduleId)) return true;
          const recipients = await this.resolve(row.recipients, tx);
          if (recipients.length)
            await this.deps.notifications.notify(
              row.moduleId,
              { type: row.type, recipients, params: paramsOf(row.params), href: row.href ?? undefined },
              tx,
            );
          return true;
        });
        if (done) sent++;
      } catch (err) {
        failed++;
        this.deps.logger.error({ err, reminderId: id }, 'reminder could not be sent');
      }
    }
    return { sent, failed };
  }
}

function paramsOf(params: Record<string, unknown>): Record<string, NotificationParam> {
  const out: Record<string, NotificationParam> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') out[k] = ISO_INSTANT_RE.test(v) ? new Date(v) : v;
    else if (typeof v === 'number') out[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = v as LocalizedText;
  }
  return out;
}
