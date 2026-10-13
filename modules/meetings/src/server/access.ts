/**
 * Who may see and do what with a meeting. Routes, the record resolver, global search, the shared index's ACL and the
 * AI tools all go through these functions, so the UI and the API can't disagree.
 *
 * - `meetings.meetings.admin` manages every meeting; `meetings.meetings.read` sees every meeting.
 * - With `meetings.meetings.use`, people see internal meetings and the private ones they organise, attend or own an
 *   action item of (they are told about the item and work on it there).
 * - The organiser and the attendees edit a meeting (details, notes, minutes, items) and send its minutes; the
 *   organiser deletes it. An action item's owner marks it done.
 */
import type { AuthContext, Db } from '@isbp/sdk/server';
import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { PERMISSIONS, type Visibility } from '../model';
import { actionItems, attendees, meetings } from './schema';

export interface MeetingAccess {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isAttendee: boolean;
}

export const isAdmin = (auth: AuthContext) => auth.can(PERMISSIONS.admin);
/** Sees every meeting, private ones included. */
export const seesAll = (auth: AuthContext) => isAdmin(auth) || auth.can(PERMISSIONS.read);
export const canUse = (auth: AuthContext) => auth.can(PERMISSIONS.use) || seesAll(auth);

/** How the caller takes part in a meeting: as an attendee (edits it) or as the owner of one of its items (reads it). */
export interface Involvement {
  attendee: boolean;
  owner: boolean;
}

export function accessFor(
  meeting: { visibility: Visibility; organizerId: string | null },
  involved: Involvement,
  auth: AuthContext,
): MeetingAccess {
  const me = auth.user?.id ?? null;
  const admin = isAdmin(auth);
  const use = canUse(auth);
  const organizer = Boolean(me && meeting.organizerId === me);
  const isAttendee = involved.attendee;
  const canView =
    seesAll(auth) ||
    (use && (meeting.visibility === 'internal' || organizer || isAttendee || involved.owner));
  if (!canView) return { canView: false, canEdit: false, canDelete: false, isAttendee };
  return {
    canView,
    canEdit: admin || (use && (organizer || isAttendee)),
    canDelete: admin || (use && organizer),
    isAttendee,
  };
}

/** How `userId` takes part in each of `meetingIds` (for `accessFor`). */
export async function involvement(db: Db, meetingIds: readonly string[], userId: string | null | undefined) {
  const ids = [...new Set(meetingIds)];
  if (!userId || !ids.length) return (_meetingId: string): Involvement => ({ attendee: false, owner: false });
  const [attending, owning] = await Promise.all([
    db
      .select({ id: attendees.meetingId })
      .from(attendees)
      .where(and(inArray(attendees.meetingId, ids), eq(attendees.userId, userId))),
    db
      .selectDistinct({ id: actionItems.meetingId })
      .from(actionItems)
      .where(and(inArray(actionItems.meetingId, ids), eq(actionItems.ownerId, userId))),
  ]);
  const a = new Set(attending.map((r) => r.id));
  const o = new Set(owning.map((r) => r.id));
  return (meetingId: string): Involvement => ({ attendee: a.has(meetingId), owner: o.has(meetingId) });
}

/** SQL: an attendee row of the meeting for this person. */
export const attends = (userId: string): SQL =>
  sql`exists (select 1 from ${attendees} where ${attendees.meetingId} = ${meetings.id} and ${attendees.userId} = ${userId})`;

/** SQL: an action item of the meeting owned by this person. */
const ownsItemOf = (userId: string): SQL =>
  sql`exists (select 1 from ${actionItems} where ${actionItems.meetingId} = ${meetings.id} and ${actionItems.ownerId} = ${userId})`;

/** SQL filter: meetings the caller may see (none without `meetings.meetings.use`). */
export function visibleMeetings(auth: AuthContext): SQL | undefined {
  if (seesAll(auth)) return undefined;
  if (!canUse(auth)) return sql`false`;
  const me = auth.user?.id;
  if (!me) return eq(meetings.visibility, 'internal');
  return or(eq(meetings.visibility, 'internal'), eq(meetings.organizerId, me), attends(me), ownsItemOf(me));
}

/** SQL filter: meetings the person organised or attends. */
export function involves(userId: string): SQL {
  return or(eq(meetings.organizerId, userId), attends(userId))!;
}
