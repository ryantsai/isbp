import { dateTime } from '@isbp/contracts';
import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';
import {
  DESTINATIONS,
  ITEM_STATUSES,
  MAX_ATTENDEES,
  MAX_DECISIONS,
  MAX_ITEMS,
  MEETING_STATUSES,
  ROUTE_ERRORS,
  VISIBILITIES,
} from './model';

export * from './model';

/* ───────────────────────────── primitives ───────────────────────────── */

export const dateOnly = z.iso.date();
export const meetingStatusSchema = z.enum(MEETING_STATUSES);
export const visibilitySchema = z.enum(VISIBILITIES);
export const itemStatusSchema = z.enum(ITEM_STATUSES);
export const destinationSchema = z.enum(DESTINATIONS);
export const routeErrorSchema = z.enum(ROUTE_ERRORS);
export const organiseModeSchema = z.enum(['llm', 'builtin']);

export const personSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type PersonRef = z.input<typeof personSchema>;

/** A project the meeting is linked to (resolved for the reader through the record registry). */
export const projectRefSchema = z.object({ id: z.uuid(), key: z.string(), name: z.string() });
export type ProjectRef = z.input<typeof projectRefSchema>;

const line = (max: number) => z.string().trim().min(1).max(max);
const notesText = z.string().max(100_000);

/* ───────────────────────────── action items ───────────────────────────── */

export const actionItemSchema = z.object({
  id: z.uuid(),
  meeting: z.object({ id: z.uuid(), reference: z.string(), title: z.string(), startsAt: dateTime }),
  title: z.string(),
  owner: personSchema.nullable(),
  dueDate: dateOnly.nullable(),
  status: itemStatusSchema,
  destination: destinationSchema,
  /** The project a task item goes to (or went to). */
  project: projectRefSchema.nullable(),
  /** The project task the item became (reference such as NET-42), once created. */
  task: z
    .object({
      id: z.uuid(),
      reference: z.string(),
      href: z.string(),
      /** The task's status as the reader may see it (null when they can't see the task). */
      status: z.object({ key: z.string(), tone: z.string() }).nullable(),
    })
    .nullable(),
  /** The project refused the task: the item stays a meeting item. */
  routeError: routeErrorSchema.nullable(),
  note: z.string().nullable(),
  completedAt: dateTime.nullable(),
  /** The meeting's minutes were sent: the item is live (on My work, reminded). */
  live: z.boolean(),
  canEdit: z.boolean(),
  /** The caller may mark it done or reopen it (its owner, or an editor of the meeting). */
  canComplete: z.boolean(),
});
export type ActionItem = z.input<typeof actionItemSchema>;

const itemFields = {
  title: line(300).describe('What has to be done'),
  ownerId: z.uuid().nullish().describe('User id of the person who does it'),
  dueDate: dateOnly.nullish().describe('YYYY-MM-DD'),
  destination: destinationSchema.optional().describe('meeting (tracked here) or task (a project task)'),
  /** The project a `task` item goes to; it must be a project the meeting is linked to or the caller picks. */
  projectId: z.uuid().nullish(),
};
export const createActionItemSchema = z.object(itemFields);
export type CreateActionItemInput = z.input<typeof createActionItemSchema>;
export const updateActionItemSchema = z
  .object({ ...itemFields, status: itemStatusSchema, note: z.string().trim().max(2_000).nullable() })
  .partial();
export type UpdateActionItemInput = z.input<typeof updateActionItemSchema>;

export const actionItemQuerySchema = listQuerySchema.extend({
  /** `mine` (default): items I own; `assigned`: items of meetings I organised. */
  view: z.enum(['mine', 'assigned']).optional(),
  /** `open` (default), `done` or `all`. */
  status: z.enum(['open', 'done', 'all']).optional(),
});

/* ───────────────────────────── meetings ───────────────────────────── */

export const meetingViewerSchema = z.object({
  /** Organiser or attendee (or an admin): change details, notes, minutes and items, and send the minutes. */
  canEdit: z.boolean(),
  /** Organiser or admin. */
  canDelete: z.boolean(),
  isAttendee: z.boolean(),
});

export const meetingSummarySchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  title: z.string(),
  startsAt: dateTime,
  durationMinutes: z.number().int(),
  location: z.string().nullable(),
  status: meetingStatusSchema,
  visibility: visibilitySchema,
  organizer: personSchema.nullable(),
  attendeeCount: z.number().int(),
  items: z.object({ open: z.number().int(), total: z.number().int() }),
  updatedAt: dateTime,
});
export type MeetingSummary = z.input<typeof meetingSummarySchema>;

export const meetingDetailSchema = meetingSummarySchema.extend({
  guests: z.string().nullable(),
  notes: z.string().nullable(),
  summary: z.string().nullable(),
  decisions: z.array(z.string()),
  questions: z.array(z.string()),
  attendees: z.array(personSchema),
  actionItems: z.array(actionItemSchema),
  /** Open items of the meetings this one follows up. */
  earlierItems: z.array(actionItemSchema),
  previous: z.object({ id: z.uuid(), reference: z.string(), title: z.string() }).nullable(),
  /** Projects the meeting is linked to that the reader may see. */
  projects: z.array(projectRefSchema),
  organisedMode: organiseModeSchema.nullable(),
  publishedAt: dateTime.nullable(),
  publishedBy: personSchema.nullable(),
  createdAt: dateTime,
  viewer: meetingViewerSchema,
});
export type MeetingDetail = z.input<typeof meetingDetailSchema>;

export const meetingQuerySchema = listQuerySchema.extend({
  /** Meetings I organised or attend (default true for people who can't read every meeting). */
  mine: z.stringbool().optional(),
  status: meetingStatusSchema.optional(),
  /** Linked to this record (`projects.project:<id>`). */
  linked: z.string().max(120).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

const meetingFields = {
  title: line(200),
  startsAt: dateTime,
  durationMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60),
  location: z.string().trim().max(300).nullish(),
  visibility: visibilitySchema,
  attendeeIds: z.array(z.uuid()).max(MAX_ATTENDEES),
  guests: z.string().trim().max(500).nullish(),
  notes: notesText.nullish(),
};

export const createMeetingSchema = z.object({
  ...meetingFields,
  durationMinutes: meetingFields.durationMinutes.optional(),
  visibility: visibilitySchema.optional(),
  attendeeIds: meetingFields.attendeeIds.optional(),
  /** Records the meeting is about (a project, a change, a CI…), linked on create: `<type>:<id>`. */
  links: z.array(z.string().max(120)).max(10).optional(),
});
export type CreateMeetingInput = z.input<typeof createMeetingSchema>;

export const updateMeetingSchema = z
  .object({
    ...meetingFields,
    summary: z.string().max(10_000).nullable(),
    decisions: z.array(line(1_000)).max(MAX_DECISIONS),
    questions: z.array(line(1_000)).max(MAX_DECISIONS),
  })
  .partial();
export type UpdateMeetingInput = z.input<typeof updateMeetingSchema>;

/* ───────────────────────────── organising ───────────────────────────── */

export const organiseInputSchema = z.object({
  /** The notes as they are on screen (unsaved changes included); default: the saved notes. */
  notes: notesText.optional(),
});

export const proposedItemSchema = z.object({
  title: z.string(),
  ownerId: z.uuid().nullable(),
  /** A name the notes give that isn't an attendee. */
  ownerHint: z.string().nullable(),
  dueDate: dateOnly.nullable(),
  destination: destinationSchema,
  projectId: z.uuid().nullable(),
});
export type ProposedItem = z.input<typeof proposedItemSchema>;

/** What "Organise" proposes; nothing is stored until a person accepts it. */
export const organiseResultSchema = z.object({
  mode: organiseModeSchema,
  model: z.string().nullable(),
  fallback: z.boolean(),
  summary: z.string().nullable(),
  decisions: z.array(z.string()),
  questions: z.array(z.string()),
  actionItems: z.array(proposedItemSchema),
});
export type OrganiseResult = z.input<typeof organiseResultSchema>;

/** The accepted proposal: replaces the minutes' text and adds the action items. */
export const applyMinutesSchema = z.object({
  summary: z.string().max(10_000).nullable(),
  decisions: z.array(line(1_000)).max(MAX_DECISIONS),
  questions: z.array(line(1_000)).max(MAX_DECISIONS),
  actionItems: z.array(createActionItemSchema).max(MAX_ITEMS),
  mode: organiseModeSchema.nullish(),
});
export type ApplyMinutesInput = z.input<typeof applyMinutesSchema>;

/** Publishing (and routing an item added later): what happened to each task item. */
export const routedSchema = z.object({
  itemId: z.uuid(),
  title: z.string(),
  ok: z.boolean(),
  reference: z.string().nullable(),
  error: routeErrorSchema.nullable(),
});
export const publishResultSchema = z.object({ meeting: meetingDetailSchema, routed: z.array(routedSchema) });
export type PublishResult = z.input<typeof publishResultSchema>;

export const followUpSchema = z.object({ startsAt: dateTime.optional() });

/* ───────────────────────────── AI tools ───────────────────────────── */

export const aiFindMeetingsInput = z.object({
  query: z.string().trim().max(300).optional().describe('Words to look for in titles, minutes and notes'),
  project: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe('Project key (NET) or name the meetings are linked to'),
  projectIds: z.array(z.uuid()).max(100).optional().describe('Ids of projects the meetings are linked to'),
  from: dateOnly.optional().describe('Meetings on or after this day (YYYY-MM-DD)'),
  to: dateOnly.optional().describe('Meetings on or before this day (YYYY-MM-DD)'),
  limit: z.number().int().min(1).max(50).default(10),
});
export const aiMyActionItemsInput = z.object({ status: z.enum(['open', 'all']).default('open') });
export const aiCreateMinutesInput = z.object({
  title: line(200),
  startsAt: z.string().describe('ISO date-time of the meeting, e.g. 2026-10-13T10:00:00+08:00'),
  attendeeEmails: z.array(z.email()).max(MAX_ATTENDEES).default([]),
  notes: notesText.describe('The notes as taken (Markdown)'),
  project: z.string().trim().max(200).optional().describe('Project key (NET) to link the meeting to'),
});
