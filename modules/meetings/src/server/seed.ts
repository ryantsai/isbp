/**
 * Demo meetings (idempotent: skipped once any meeting exists): the network project's weekly sync (last week's sent
 * minutes, with items routed to project tasks when Projects is on, and this week's follow-up), a change review with
 * decisions, and today's meeting with notes still to organise. Written through the services as the admin, so links,
 * audit, events, the search index and routing behave as they do for people.
 */
import { groupMembers, groups, users } from '@isbp/db/schema';
import type { ModuleContext } from '@isbp/sdk/server';
import { and, asc, eq, ne } from 'drizzle-orm';
import { addDays, organiseNotes, todayIn } from '../model';
import { meetings } from './schema';
import { services } from './services';

const at = (day: string, hour: number) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+08:00`);

export async function seedMeetings(ctx: ModuleContext) {
  const [exists] = await ctx.db.select({ id: meetings.id }).from(meetings).limit(1);
  if (exists) return;
  const [admin] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, 'admin'), eq(users.status, 'active')));
  if (!admin) return ctx.logger.warn('meetings seed skipped: no active admin account');
  const auth = await ctx.rbac.authFor(admin.id);
  if (!auth) return;
  const team = await ctx.db
    .select({ id: users.id, name: users.displayName })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groups.key, 'network-team'), eq(users.status, 'active'), ne(users.id, admin.id)))
    .orderBy(asc(users.displayName))
    .limit(3);
  const others =
    team.length >= 2
      ? team
      : await ctx.db
          .select({ id: users.id, name: users.displayName })
          .from(users)
          .where(and(eq(users.status, 'active'), ne(users.id, admin.id)))
          .orderBy(asc(users.email))
          .limit(3);
  const [a, b] = [others[0], others[1] ?? others[0]];
  const s = services(ctx);
  const today = todayIn();
  const net = (await ctx.records.search('NET', { auth, types: ['projects.project'], limit: 1 }))[0];
  const links = net ? [`projects.project:${net.id}`] : [];

  // Last week's sync: sent minutes; items go to the project (as tasks) when it is linked.
  const syncNotes = [
    'Core switch replacement slipped a week because of the vendor delivery.',
    'Wi-Fi 7 rollout on floors 8–11 is on track.',
    'Decision: Move the core cutover to the weekend of the 7th.',
    'Decision: Keep the old core as fallback for two weeks after the cutover.',
    '## Action items',
    `- ${a?.name ?? 'Admin'}: confirm the new delivery date with the vendor by ${addDays(today, -3)}`,
    `- ${b?.name ?? 'Admin'}: update the cutover runbook by ${addDays(today, 4)}`,
    '- Book the weekend change window next week',
    'Do we need a second maintenance window for floor 11?',
  ].join('\n');
  const sync = await s.meetings.create(
    {
      title: 'Network refresh — weekly sync',
      startsAt: at(addDays(today, -7), 10),
      durationMinutes: 45,
      location: 'Taipei HQ 12F, Room A',
      visibility: 'internal',
      attendeeIds: others.map((o) => o.id),
      notes: syncNotes,
      links,
    },
    auth,
  );
  const people = [{ id: admin.id, name: 'Admin' }, ...others].map((p) => ({ id: p.id, name: p.name }));
  const organised = organiseNotes(syncNotes, { attendees: people, meetingDate: addDays(today, -7) });
  await s.meetings.applyMinutes(
    sync.reference,
    {
      summary: organised.summary,
      decisions: organised.decisions,
      questions: organised.questions,
      mode: 'builtin',
      actionItems: organised.actionItems.map((i, n) => ({
        title: i.title,
        ownerId: i.ownerId,
        dueDate: i.dueDate,
        // The vendor follow-up stays a meeting item (it is overdue: reminders show it); the rest become project tasks.
        destination: net && n > 0 ? ('task' as const) : ('meeting' as const),
        projectId: net && n > 0 ? net.id : null,
      })),
    },
    auth,
  );
  await s.meetings.publish(sync.reference, auth);

  // This week's follow-up: a draft listing last week's open items.
  const next = await s.meetings.followUp(sync.reference, { startsAt: at(today, 10) }, auth);
  await s.meetings.update(
    next.reference,
    {
      notes: [
        'Vendor confirmed delivery for Thursday.',
        'TODO @admin send the cutover communication to all staff by Friday',
        'Decision: Cutover starts Saturday 22:00.',
      ].join('\n'),
    },
    auth,
  );

  // A change review with decisions only.
  const cab = await s.meetings.create(
    {
      title: 'Change advisory board',
      startsAt: at(addDays(today, -2), 14),
      durationMinutes: 60,
      visibility: 'internal',
      attendeeIds: others.map((o) => o.id),
      notes: 'Reviewed 4 normal changes. Firewall rule clean-up approved; DB patching postponed.',
    },
    auth,
  );
  await s.meetings.applyMinutes(
    cab.reference,
    {
      summary:
        '- Reviewed four normal changes\n- Two approved, one postponed, one sent back for a rollback plan',
      decisions: [
        'Approve the firewall rule clean-up for Friday night',
        'Postpone database patching to next month',
      ],
      questions: [],
      mode: 'builtin',
      actionItems: [
        {
          title: 'Add a rollback plan to the storage firmware change',
          ownerId: b?.id ?? admin.id,
          dueDate: addDays(today, 2),
        },
      ],
    },
    auth,
  );
  await s.meetings.publish(cab.reference, auth);
  ctx.logger.info('meetings demo data created');
}
