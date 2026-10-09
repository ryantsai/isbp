/**
 * ITSM API contract — shared by the server routes, the web pages and other modules (Helpdesk AI uses the
 * AI tool schemas, CMDB hosts the `cmdb.ci.related` slot). Wire types (`z.input`) are what clients see.
 *
 * REST endpoints (mounted at /api/v1/itsm):
 *
 *   Tickets (all types)
 *     GET    /tickets                       ticketQuerySchema → page(ticketListItemSchema)
 *     POST   /tickets                       createTicketSchema → ticketDetailSchema (201)
 *     GET    /tickets/:ref                  → ticketDetailSchema            (ref = uuid or INC-00042 …)
 *     PATCH  /tickets/:ref                  updateTicketSchema → ticketDetailSchema
 *     POST   /tickets/:ref/transition       transitionSchema → ticketDetailSchema
 *     POST   /tickets/:ref/assign-to-me     → ticketDetailSchema
 *     GET    /tickets/:ref/activities       activityQuerySchema → page(activitySchema)
 *     POST   /tickets/:ref/comments         commentSchema → activitySchema (201)
 *     POST   /tickets/:ref/links            createLinkSchema → ticketDetailSchema
 *     DELETE /tickets/:ref/links/:linkId    → ticketDetailSchema
 *     POST   /tickets/:ref/reopen           reopenSchema → ticketDetailSchema       (requester: "still broken")
 *     POST   /tickets/:ref/confirm          confirmSchema → ticketDetailSchema      (requester: fixed + CSAT)
 *     POST   /tickets/:ref/acceptance       acceptanceSchema → ticketDetailSchema   (change requester, in review)
 *     PATCH  /tickets/:ref/problem          updateProblemSchema → ticketDetailSchema
 *     POST   /tickets/:ref/problem/article  knownErrorArticleSchema → knownErrorArticleResultSchema (201)
 *     PATCH  /tickets/:ref/change           updateChangeSchema → ticketDetailSchema
 *     GET    /queues                        → queueCountsSchema   (counts for the agent views)
 *
 *   Changes
 *     GET    /changes/calendar              calendarQuerySchema → changeCalendarPageSchema
 *                                           (keyset pages by planned start: `cursor` = the last page's nextCursor)
 *     GET    /changes/conflicts             conflictQuerySchema → { items: changeConflictSchema[] }
 *
 *   Lookups
 *     GET    /groups                        → { items: assignmentGroupSchema[] }   (core groups for pickers)
 *     GET    /groups/:id/agents             → { items: personRefSchema[] }
 *     GET    /categories                    categoryQuerySchema → { items: categorySchema[] }
 *
 *   Configuration (itsm.config.manage)
 *     POST   /categories · PATCH /categories/:id · DELETE /categories/:id
 *     PUT    /categories/order              categoryOrderSchema → { items: categorySchema[] }   (one level)
 *     GET    /calendars · POST /calendars · PATCH /calendars/:id · DELETE /calendars/:id
 *     GET    /sla-policies · POST /sla-policies · PATCH /sla-policies/:id · DELETE /sla-policies/:id
 *     PUT    /sla-policies/order            policyOrderSchema → { items: slaPolicySchema[] }   (evaluation order)
 *     GET    /catalog                       → { items: catalogItemSchema[] }  (published forms + fulfilment)
 *     PUT    /catalog/:formKey              upsertCatalogItemSchema → catalogItemSchema
 *     DELETE /catalog/:formKey
 *
 *   Reports (itsm.reports.read)
 *     GET    /reports/overview              reportQuerySchema → overviewReportSchema
 */
import { dateTime, recordRefSchema } from '@isbp/contracts';
import { conditionSchema, listQuerySchema, localizedTextSchema } from '@isbp/sdk';
import { z } from 'zod';

const id = z.uuid();

/* ───────────────────────────── enums ───────────────────────────── */

export const ticketTypeSchema = z.enum(['incident', 'service_request', 'problem', 'change']);
export type TicketType = z.infer<typeof ticketTypeSchema>;

/** Reference prefixes: INC-00042, SR-00042, PRB-00042, CHG-00042 (one sequence per type). */
export const TICKET_PREFIX: Record<TicketType, string> = {
  incident: 'INC',
  service_request: 'SR',
  problem: 'PRB',
  change: 'CHG',
};

export function formatTicketRef(type: TicketType, number: number): string {
  return `${TICKET_PREFIX[type]}-${String(number).padStart(5, '0')}`;
}

/**
 * Who gets the "New change" form on `/itsm/changes` (also opened by `?new=1&title=…&link=<type>:<id>`). Modules
 * that link there (ALM's "Raise a change") offer the action only to these people.
 */
export const NEW_CHANGE_PERMISSION = 'itsm.changes.manage';

/** `INC-00042` → { type, number }; null for anything else. */
export function parseTicketRef(ref: string): { type: TicketType; number: number } | null {
  const m = /^(INC|SR|PRB|CHG)-0*(\d{1,12})$/i.exec(ref.trim());
  if (!m) return null;
  const prefix = m[1]!.toUpperCase();
  const type = (Object.keys(TICKET_PREFIX) as TicketType[]).find((t) => TICKET_PREFIX[t] === prefix)!;
  return { type, number: Number(m[2]) };
}

/** Union of every type's statuses; the per-type state machines live in the server (and `TRANSITIONS`). */
export const ticketStatusSchema = z.enum([
  // incident & service request
  'new',
  'pending_approval',
  'in_progress',
  'on_hold',
  'resolved',
  'fulfilled',
  'closed',
  'cancelled',
  // problem
  'investigating',
  'known_error',
  // change
  'draft',
  'assessment',
  'authorization',
  'scheduled',
  'implementing',
  'review',
  'rejected',
]);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

/**
 * Allowed transitions per type (source of truth for both the API and the UI's status menu).
 * Changes move `authorization → scheduled|rejected` only through the CAB workflow, not by hand.
 */
export const TRANSITIONS: Record<TicketType, Partial<Record<TicketStatus, TicketStatus[]>>> = {
  incident: {
    new: ['in_progress', 'on_hold', 'resolved', 'cancelled'],
    in_progress: ['on_hold', 'resolved', 'cancelled'],
    on_hold: ['in_progress', 'resolved', 'cancelled'],
    resolved: ['in_progress', 'closed'],
  },
  service_request: {
    new: ['in_progress', 'on_hold', 'fulfilled', 'cancelled'],
    pending_approval: ['cancelled'],
    in_progress: ['on_hold', 'fulfilled', 'cancelled'],
    on_hold: ['in_progress', 'fulfilled', 'cancelled'],
    fulfilled: ['in_progress', 'closed'],
  },
  problem: {
    new: ['investigating', 'known_error', 'cancelled'],
    investigating: ['known_error', 'resolved', 'cancelled'],
    known_error: ['investigating', 'resolved'],
    resolved: ['investigating', 'closed'],
  },
  change: {
    // `authorization` from a draft: "Submit for approval" passes the assessment in the same step.
    draft: ['assessment', 'authorization', 'cancelled'],
    assessment: ['draft', 'authorization', 'cancelled'],
    authorization: ['cancelled'],
    scheduled: ['implementing', 'cancelled'],
    implementing: ['review'],
    review: ['closed'],
    rejected: ['draft'],
  },
};

/**
 * Resolution sign-off (`itsm.resolution`): resolving these types starts the bound workflow; while it runs the ticket is
 * `pending_approval` ("Waiting for sign-off") and may only go back to work or be cancelled.
 */
export const SIGN_OFF_TYPES: readonly TicketType[] = ['incident', 'service_request', 'problem'];
export const SIGN_OFF_TRANSITIONS: readonly TicketStatus[] = ['in_progress', 'cancelled'];

/** What the service desk's queues hold: problems and changes have their own pages and owners. */
export const DESK_TYPES: readonly TicketType[] = ['incident', 'service_request'];

/** Statuses where the ticket no longer needs work (closed for SLA, queues and "My requests"). */
export const DONE_STATUSES: readonly TicketStatus[] = [
  'resolved',
  'fulfilled',
  'closed',
  'cancelled',
  'rejected',
];
/** Statuses that pause resolution SLAs by default. */
export const DEFAULT_PAUSE_STATUSES: readonly TicketStatus[] = ['on_hold', 'pending_approval'];

/** 1 = high … 3 = low. */
export const levelSchema = z.number().int().min(1).max(3);
/** P1 (critical) … P4 (low). */
export const prioritySchema = z.number().int().min(1).max(4);

/** ITIL impact × urgency matrix → priority. */
export function priorityFor(impact: number, urgency: number): number {
  const matrix = [
    [1, 2, 3],
    [2, 3, 4],
    [3, 4, 4],
  ];
  return matrix[Math.min(Math.max(impact, 1), 3) - 1]![Math.min(Math.max(urgency, 1), 3) - 1]!;
}

/** `integration`: created by a sync with another system (ServiceDesk Plus, Azure DevOps). */
export const channelSchema = z.enum([
  'portal',
  'agent',
  'chat',
  'email',
  'phone',
  'form',
  'ai',
  'integration',
]);
export const resolutionCodeSchema = z.enum([
  'solved',
  'workaround',
  'user_error',
  'duplicate',
  'no_fault_found',
  'not_reproducible',
  'cancelled_by_requester',
]);
export type ResolutionCode = z.infer<typeof resolutionCodeSchema>;

export const changeTypeSchema = z.enum(['standard', 'normal', 'emergency']);
export const riskSchema = z.enum(['low', 'medium', 'high']);
export const linkTypeSchema = z.enum(['related', 'caused_by', 'duplicate_of', 'parent_of', 'implements']);
export type LinkType = z.infer<typeof linkTypeSchema>;
export const slaMetricSchema = z.enum(['response', 'resolution']);
export const slaStatusSchema = z.enum(['running', 'paused', 'met', 'breached', 'cancelled']);
export const activityKindSchema = z.enum([
  'comment', // public reply (requester and agents see it)
  'work_note', // internal (agents only)
  'status',
  'assignment',
  'field', // other field changes (`data.changes`)
  'link',
  'sla', // warning / breach
  'approval', // CAB / request approval progress
  'triage', // AI or agent triage (`data.confidence`, `data.rationale`)
  'system',
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

/* ───────────────────────────── shared shapes ───────────────────────────── */

export const personRefSchema = z.object({ id, displayName: z.string(), avatarUrl: z.string().nullable() });
export type PersonRef = z.input<typeof personRefSchema>;

export const groupRefSchema = z.object({ id, key: z.string(), name: z.string() });
export const categoryRefSchema = z.object({
  id,
  key: z.string(),
  name: localizedTextSchema,
  path: z.string(),
  /** Parents, top first, with their names in every language (the page shows the path in the viewer's). */
  ancestors: z.array(z.object({ id, name: localizedTextSchema })).optional(),
});
export const ciRefSchema = z.object({
  id,
  number: z.number().int(),
  reference: z.string(),
  name: z.string(),
  classKey: z.string(),
  status: z.string(),
  criticality: z.string(),
});
export type CiRef = z.input<typeof ciRefSchema>;

export const slaSchema = z.object({
  id,
  metric: slaMetricSchema,
  /** `name` is the English name; `label` the name in every language it was given in (show this one). */
  policy: z.object({ id, name: z.string(), label: localizedTextSchema }),
  status: slaStatusSchema,
  startedAt: dateTime,
  dueAt: dateTime,
  /** When it was met or breached. */
  stoppedAt: dateTime.nullable(),
  /** Business-time elapsed / target, 0–1+ (≥ 1 = breached). */
  elapsedRatio: z.number(),
  warned: z.boolean(),
});
export type TicketSla = z.input<typeof slaSchema>;

/** SLA summary for list rows: the most urgent running target. */
export const slaBadgeSchema = z
  .object({ metric: slaMetricSchema, status: slaStatusSchema, dueAt: dateTime, elapsedRatio: z.number() })
  .nullable();

/* ───────────────────────────── tickets ───────────────────────────── */

export const ticketListItemSchema = z.object({
  id,
  type: ticketTypeSchema,
  number: z.number().int(),
  reference: z.string(),
  title: z.string(),
  status: ticketStatusSchema,
  priority: prioritySchema,
  impact: levelSchema,
  urgency: levelSchema,
  category: categoryRefSchema.nullable(),
  requester: personRefSchema.nullable(),
  assignmentGroup: groupRefSchema.nullable(),
  assignee: personRefSchema.nullable(),
  major: z.boolean(),
  channel: channelSchema,
  sla: slaBadgeSchema,
  /** Changes: planned window. */
  plannedStart: dateTime.nullable(),
  plannedEnd: dateTime.nullable(),
  /** Changes: type and risk (null for other tickets). */
  changeType: changeTypeSchema.nullable(),
  risk: riskSchema.nullable(),
  /** `pending_approval` because its resolution waits for a sign-off (`itsm.resolution`). */
  awaitingSignOff: z.boolean(),
  createdAt: dateTime,
  updatedAt: dateTime,
  resolvedAt: dateTime.nullable(),
});
export type TicketListItem = z.input<typeof ticketListItemSchema>;

export const ticketLinkSchema = z.object({
  id,
  type: linkTypeSchema,
  /** `outgoing`: this ticket → other (e.g. this incident is `caused_by` the problem). */
  direction: z.enum(['outgoing', 'incoming']),
  ticket: z.object({
    id,
    type: ticketTypeSchema,
    reference: z.string(),
    title: z.string(),
    status: ticketStatusSchema,
    priority: prioritySchema,
  }),
});

export const changeDetailSchema = z.object({
  changeType: changeTypeSchema,
  risk: riskSchema,
  reason: z.string(),
  plannedStart: dateTime.nullable(),
  plannedEnd: dateTime.nullable(),
  implementationPlan: z.string(),
  backoutPlan: z.string(),
  testPlan: z.string(),
  /** CAB workflow (while authorizing and afterwards). */
  approvalInstanceId: id.nullable(),
  /** Other changes touching the same CIs in an overlapping window. */
  conflicts: z.array(z.object({ id, reference: z.string(), title: z.string(), status: ticketStatusSchema })),
});

export const problemDetailSchema = z.object({
  rootCause: z.string(),
  workaround: z.string(),
  knownError: z.boolean(),
  /** Knowledge article documenting the known error. */
  kbArticle: z.object({ id, reference: z.string(), title: z.string() }).nullable(),
});

export const ticketSourceSchema = z
  .object({
    /** A catalog fulfilment of the submission, or a form's process action (`id` is then the run). */
    type: z.enum(['form-submission', 'process-action']),
    id,
    submissionId: id.optional(),
    reference: z.string(),
    formKey: z.string(),
    formName: localizedTextSchema,
  })
  .nullable();

export const ticketDetailSchema = ticketListItemSchema.extend({
  description: z.string(),
  requestedFor: personRefSchema.nullable(),
  department: z.object({ id, name: z.string() }).nullable(),
  cis: z.array(ciRefSchema),
  links: z.array(ticketLinkSchema),
  slas: z.array(slaSchema),
  resolutionCode: resolutionCodeSchema.nullable(),
  resolutionNotes: z.string().nullable(),
  satisfaction: z.number().int().min(1).max(5).nullable(),
  satisfactionComment: z.string().nullable(),
  /** Service-request answers from the catalog form (rendered with the form schema). */
  source: ticketSourceSchema,
  answers: z.array(z.object({ key: z.string(), label: localizedTextSchema, value: z.string() })).nullable(),
  change: changeDetailSchema.nullable(),
  /**
   * A change's acceptance by its requester in the post-implementation review (`review`, and once closed): `pending`
   * until they accept it or report a problem. `required`: closing waits for their acceptance (ITSM setting).
   */
  acceptance: z
    .object({
      state: z.enum(['pending', 'accepted', 'problem']),
      note: z.string().nullable(),
      by: personRefSchema.nullable(),
      at: dateTime.nullable(),
      required: z.boolean(),
    })
    .nullable(),
  /** The running resolution sign-off: the status it resolves to once approved. */
  signOff: z.object({ instanceId: id, to: ticketStatusSchema }).nullable(),
  problem: problemDetailSchema.nullable(),
  /** Custom field values (`itsm.ticket`). */
  attributes: z.record(z.string(), z.unknown()),
  firstResponseAt: dateTime.nullable(),
  closedAt: dateTime.nullable(),
  /** What the viewer may do — the UI renders from this, the API enforces it again. */
  viewer: z.object({
    role: z.enum(['agent', 'requester']),
    canEdit: z.boolean(),
    canComment: z.boolean(),
    canWorkNote: z.boolean(),
    /** Statuses the viewer may move the ticket to now. */
    transitions: z.array(ticketStatusSchema),
    canReopen: z.boolean(),
    canConfirm: z.boolean(),
    /** The change's requester may accept it or report a problem (post-implementation review). */
    canAccept: z.boolean(),
  }),
});
export type TicketDetail = z.input<typeof ticketDetailSchema>;

export const ticketQuerySchema = listQuerySchema.extend({
  /**
   * `mine` = I requested it · `assigned` = assigned to me · `groups` = my groups' tickets ·
   * `unassigned` = no assignee in my groups · `all` = everything I can read.
   */
  view: z.enum(['mine', 'assigned', 'groups', 'unassigned', 'all']).default('all'),
  type: ticketTypeSchema.optional(),
  /** Comma-separated types (`incident,service_request`: the service desk's queues); `type` wins when both are set. */
  types: z.string().max(100).optional(),
  /** Comma-separated statuses, or `open` / `done`. */
  status: z.string().max(300).optional(),
  priority: z.coerce.number().int().min(1).max(4).optional(),
  categoryId: id.optional(),
  groupId: id.optional(),
  assigneeId: id.optional(),
  requesterId: id.optional(),
  ciId: id.optional(),
  /** `attention` = breached or at risk (sort by `slaDue` to see the most urgent first). */
  sla: z.enum(['breached', 'at_risk', 'attention']).optional(),
  major: z.stringbool().optional(),
});
export type TicketQuery = z.input<typeof ticketQuerySchema>;

/** Sort keys the ticket lists offer (`sort=priority`, `sort=-updatedAt`…). */
export const TICKET_SORT_KEYS = [
  'number',
  'priority',
  'status',
  'title',
  'plannedStart',
  'createdAt',
  'updatedAt',
  'resolvedAt',
  /** The earliest due time of the ticket's breached or running SLA targets. */
  'slaDue',
] as const;

export const createTicketSchema = z.object({
  type: ticketTypeSchema.default('incident'),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(20_000).default(''),
  /** Requesters may set urgency only; agents set everything. Default 2/2 (P3). */
  impact: levelSchema.optional(),
  urgency: levelSchema.optional(),
  categoryId: id.nullish(),
  assignmentGroupId: id.nullish(),
  assigneeId: id.nullish(),
  /** Agents raising a ticket for someone else. */
  requesterId: id.nullish(),
  requestedForId: id.nullish(),
  ciIds: z.array(id).max(20).default([]),
  channel: channelSchema.optional(),
  major: z.boolean().optional(),
  attributes: z.record(z.string().max(64), z.unknown()).optional(),
  /** Records of any module to link the new ticket to (e.g. the asset it is about, the release a change deploys). */
  links: z.array(recordRefSchema).max(5).default([]),
  /**
   * Tickets to link the new one to, from its point of view (a problem raised from incidents:
   * `{ target: 'INC-00120', type: 'caused_by', direction: 'incoming' }`). The caller must be able to read them.
   */
  ticketLinks: z
    .array(
      z.object({
        target: z.string().trim().min(1).max(40),
        type: linkTypeSchema,
        direction: z.enum(['outgoing', 'incoming']).default('outgoing'),
      }),
    )
    .max(20)
    .default([]),
  change: z
    .object({
      changeType: changeTypeSchema.default('normal'),
      risk: riskSchema.default('medium'),
      reason: z.string().trim().max(5_000).default(''),
      plannedStart: dateTime.nullish(),
      plannedEnd: dateTime.nullish(),
      implementationPlan: z.string().trim().max(20_000).default(''),
      backoutPlan: z.string().trim().max(20_000).default(''),
      testPlan: z.string().trim().max(20_000).default(''),
    })
    .optional(),
});
export type CreateTicketInput = z.input<typeof createTicketSchema>;

export const updateTicketSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(20_000),
    impact: levelSchema,
    urgency: levelSchema,
    /** Override the matrix (recorded in the timeline). Null = back to the matrix. */
    priority: prioritySchema.nullable(),
    categoryId: id.nullable(),
    assignmentGroupId: id.nullable(),
    assigneeId: id.nullable(),
    requestedForId: id.nullable(),
    /** Agents correcting who reported it (e.g. logged for the wrong caller). */
    requesterId: id,
    ciIds: z.array(id).max(20),
    major: z.boolean(),
    attributes: z.record(z.string().max(64), z.unknown()),
  })
  .partial();
export type UpdateTicketInput = z.input<typeof updateTicketSchema>;

export const transitionSchema = z.object({
  status: ticketStatusSchema,
  /** Added to the timeline (public for resolve/fulfil, otherwise a work note). */
  note: z.string().trim().max(10_000).optional(),
  /** Required to resolve / fulfil / cancel. */
  resolutionCode: resolutionCodeSchema.optional(),
  resolutionNotes: z.string().trim().max(10_000).optional(),
  /** Resolving: the knowledge article that solved it (linked to the ticket, shown in the timeline). */
  articleId: id.optional(),
});
export type TransitionInput = z.input<typeof transitionSchema>;

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  /** false = internal work note (agents only). */
  public: z.boolean().default(true),
});
export type CommentInput = z.input<typeof commentSchema>;

export const reopenSchema = z.object({ reason: z.string().trim().min(3).max(5_000) });
/** The change's requester in its post-implementation review: "Accept the change", or "Report a problem" (reason). */
export const acceptanceSchema = z
  .object({
    accepted: z.boolean(),
    note: z.string().trim().max(5_000).optional(),
  })
  .refine((v) => v.accepted || (v.note?.length ?? 0) >= 3, {
    message: 'Say what is wrong',
    path: ['note'],
  });
export type AcceptanceInput = z.input<typeof acceptanceSchema>;

export const confirmSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(2_000).optional(),
});

export const createLinkSchema = z.object({
  target: z.string().trim().min(1).max(40),
  type: linkTypeSchema,
  /** `incoming`: the target points at this ticket (e.g. on a problem: the incident is `caused_by` it). */
  direction: z.enum(['outgoing', 'incoming']).default('outgoing'),
});

export const updateProblemSchema = z
  .object({
    rootCause: z.string().trim().max(20_000),
    workaround: z.string().trim().max(20_000),
    knownError: z.boolean(),
    kbArticleId: id.nullable(),
  })
  .partial();

/**
 * "Write the known-error article": the page sends the draft's text in the author's language (headings from its
 * catalog, the problem's root cause and workaround); the article starts as a draft for agents.
 */
export const knownErrorArticleSchema = z.object({
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(500).optional(),
  body: z.string().min(1).max(50_000),
  locale: z.enum(['en', 'zh-TW', 'ja-JP']),
});
export const knownErrorArticleResultSchema = z.object({
  article: z.object({ id, reference: z.string(), href: z.string() }),
});

export const updateChangeSchema = z
  .object({
    changeType: changeTypeSchema,
    risk: riskSchema,
    reason: z.string().trim().max(5_000),
    plannedStart: dateTime.nullable(),
    plannedEnd: dateTime.nullable(),
    implementationPlan: z.string().trim().max(20_000),
    backoutPlan: z.string().trim().max(20_000),
    testPlan: z.string().trim().max(20_000),
  })
  .partial();

/* ───────────────────────────── timeline ───────────────────────────── */

export const activitySchema = z.object({
  id,
  kind: activityKindSchema,
  public: z.boolean(),
  /** Null for system entries; AI agents show their name with `ai: true`. */
  author: z
    .object({ id: id.nullable(), displayName: z.string(), avatarUrl: z.string().nullable(), ai: z.boolean() })
    .nullable(),
  body: z.string().nullable(),
  /** Kind-specific: `{ from, to }` for status/assignment, `{ changes }` for fields, `{ confidence, rationale }` for triage… */
  data: z.record(z.string(), z.unknown()),
  createdAt: dateTime,
});
export type Activity = z.input<typeof activitySchema>;

export const activityQuerySchema = listQuerySchema.extend({
  /** Oldest first by default (a conversation); the UI may ask newest first. */
  order: z.enum(['asc', 'desc']).default('asc'),
});

/* ───────────────────────────── queues ───────────────────────────── */

/**
 * Open incidents and service requests per agent view (problems and changes have their own pages; drafts wait for
 * nobody, so they never count).
 */
export const queueCountsSchema = z.object({
  assigned: z.number().int(),
  groups: z.number().int(),
  unassigned: z.number().int(),
  breached: z.number().int(),
  atRisk: z.number().int(),
  /** Breached or at risk. */
  attention: z.number().int(),
  mine: z.number().int(),
  majorOpen: z.number().int(),
  /** All open tickets the viewer can read (the "All open" queue). */
  open: z.number().int(),
});

/* ───────────────────────────── changes ───────────────────────────── */

/**
 * Changes planned in a window (at most 400 days), ordered by planned start, then id. A page holds `limit` changes
 * (1–500, 200 by default); `cursor` is the `nextCursor` of the page before (opaque: a malformed one is a 400).
 */
export const calendarQuerySchema = z.object({
  from: dateTime,
  to: dateTime,
  ciId: id.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export const changeCalendarItemSchema = z.object({
  id,
  reference: z.string(),
  title: z.string(),
  status: ticketStatusSchema,
  changeType: changeTypeSchema,
  risk: riskSchema,
  plannedStart: dateTime,
  plannedEnd: dateTime,
  cis: z.array(z.object({ id, name: z.string() })),
  assignee: personRefSchema.nullable(),
  hasConflict: z.boolean(),
});
/** One page of the change calendar; `nextCursor` is null on the last page. */
export const changeCalendarPageSchema = z.object({
  items: z.array(changeCalendarItemSchema),
  nextCursor: z.string().nullable(),
});
export const conflictQuerySchema = z.object({
  start: dateTime,
  end: dateTime,
  ciIds: z.string().max(2000).optional(),
  exclude: id.optional(),
});
export const changeConflictSchema = z.object({
  id,
  reference: z.string(),
  title: z.string(),
  status: ticketStatusSchema,
  plannedStart: dateTime,
  plannedEnd: dateTime,
  sharedCis: z.array(z.object({ id, name: z.string() })),
});

/* ───────────────────────────── configuration ───────────────────────────── */

export const assignmentGroupSchema = z.object({
  id,
  key: z.string(),
  name: z.string(),
  memberCount: z.number().int(),
  /** Active members who can work tickets. */
  agentCount: z.number().int(),
  /**
   * A service desk group: a role of the group lets its members work tickets, or tickets, categories or catalog items
   * are assigned to it (pickers list these first).
   */
  worksTickets: z.boolean(),
});

export const categorySchema = z.object({
  id,
  key: z.string(),
  name: localizedTextSchema,
  /** "Network › VPN" in English (localize on the client from `ancestors`). */
  path: z.string(),
  ancestors: z.array(z.object({ id, name: localizedTextSchema })),
  parentId: id.nullable(),
  ticketTypes: z.array(ticketTypeSchema),
  defaultGroup: groupRefSchema.nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  ticketCount: z.number().int(),
});
export type Category = z.input<typeof categorySchema>;
export const categoryQuerySchema = z.object({
  type: ticketTypeSchema.optional(),
  includeInactive: z.stringbool().default(false),
});
export const upsertCategorySchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  name: localizedTextSchema,
  parentId: id.nullish(),
  ticketTypes: z.array(ticketTypeSchema).min(1),
  defaultGroupId: id.nullish(),
  active: z.boolean().default(true),
  /** Order among its siblings; omitted on create = after the last sibling. */
  sortOrder: z.number().int().optional(),
});
/** The new order of a category's children (`parentId` null = the top level): every one of them, once. */
export const categoryOrderSchema = z.object({
  parentId: id.nullable(),
  ids: z.array(id).min(1).max(1000),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const workingHoursSchema = z.object({
  /** 0 = Sunday … 6 = Saturday; empty = closed. */
  days: z.array(z.array(z.object({ start: hhmm, end: hhmm })).max(4)).length(7),
});
export type WorkingHours = z.infer<typeof workingHoursSchema>;
export const calendarSchema = z.object({
  id,
  name: z.string(),
  timezone: z.string(),
  hours: workingHoursSchema,
  holidays: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string() })),
  /** 24×7: business time = wall-clock time. */
  alwaysOpen: z.boolean(),
  policyCount: z.number().int(),
});
export type BusinessCalendar = z.input<typeof calendarSchema>;
export const upsertCalendarSchema = calendarSchema.omit({ id: true, policyCount: true });

const target = z.object({
  responseMinutes: z.number().int().min(1).max(525_600),
  resolutionMinutes: z.number().int().min(1).max(525_600),
});
/** A policy's name in every language (`name` on the ticket's SLA rows stays the English text). */
const policyNameSchema = localizedTextSchema.refine(
  (t) => Object.values(t).every((v) => !v || v.length <= 200),
  'At most 200 characters',
);
/** Why a policy never applies to a ticket type: the policy that matches those tickets first (null: no ticket can match). */
export const policyReachSchema = z.object({
  blocked: z.array(z.object({ type: ticketTypeSchema, by: id.nullable() })),
});
export const slaPolicySchema = z.object({
  id,
  name: policyNameSchema,
  description: z.string().nullable(),
  ticketTypes: z.array(ticketTypeSchema),
  /**
   * Extra condition on ticket facts (`ticket.priority`, `ticket.categoryKey`, `ticket.categoryKeys` — the category and
   * its ancestors —, `ticket.major`, `ticket.channel`…).
   */
  condition: conditionSchema.nullable(),
  /** Targets per priority (`'1'`…`'4'`). */
  targets: z.record(z.enum(['1', '2', '3', '4']), target),
  calendar: z.object({ id, name: z.string() }),
  pauseStatuses: z.array(ticketStatusSchema),
  /** Warn at this share of the target (e.g. 0.75). */
  warnAt: z.number().min(0.1).max(0.99),
  /** Evaluation order (lowest first); the settings page shows the position and offers Move up / Move down. */
  sortOrder: z.number().int(),
  active: z.boolean(),
  /** Where the policy stands at its place in the order (null: its rules read facts that can't be checked). */
  reach: policyReachSchema.nullable(),
});
export type SlaPolicy = z.input<typeof slaPolicySchema>;
export const upsertSlaPolicySchema = slaPolicySchema
  .omit({ id: true, calendar: true, reach: true, sortOrder: true, name: true })
  .extend({
    /** Plain text (English) or the name per language. */
    name: z.union([z.string().trim().min(1).max(200), policyNameSchema]),
    calendarId: id,
    description: z.string().trim().max(1000).nullish(),
    /** Omitted on create: placed before the first policy that would otherwise take all its tickets, else last. */
    sortOrder: z.number().int().optional(),
    /** Put the policy just before this one in the evaluation order (`null`: last). Wins over `sortOrder`. */
    placeBefore: id.nullish(),
  });
/** The new evaluation order: every SLA policy, once. */
export const policyOrderSchema = z.object({ ids: z.array(id).min(1).max(1000) });

export const catalogItemSchema = z.object({
  formKey: z.string(),
  formName: localizedTextSchema,
  formIcon: z.string(),
  formCategory: z.string().nullable(),
  hasApproval: z.boolean(),
  /** Null = the form is not fulfilled by the service desk. */
  fulfilment: z
    .object({
      active: z.boolean(),
      category: categoryRefSchema.nullable(),
      group: groupRefSchema.nullable(),
      priority: prioritySchema,
      fulfilOn: z.enum(['submitted', 'approved']),
      ticketCount: z.number().int(),
    })
    .nullable(),
});
export type CatalogItem = z.input<typeof catalogItemSchema>;
export const upsertCatalogItemSchema = z.object({
  active: z.boolean().default(true),
  categoryId: id.nullish(),
  groupId: id.nullish(),
  priority: prioritySchema.default(3),
  fulfilOn: z.enum(['submitted', 'approved']).default('approved'),
});

/* ───────────────────────────── reports ───────────────────────────── */

export const reportQuerySchema = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) });
export const overviewReportSchema = z.object({
  days: z.number().int(),
  open: z.object({
    total: z.number().int(),
    byPriority: z.array(z.object({ priority: prioritySchema, count: z.number().int() })),
    byType: z.array(z.object({ type: ticketTypeSchema, count: z.number().int() })),
    byStatus: z.array(z.object({ status: ticketStatusSchema, count: z.number().int() })),
  }),
  /** One point per day: tickets created and resolved. */
  volume: z.array(z.object({ date: z.string(), created: z.number().int(), resolved: z.number().int() })),
  sla: z.object({
    responseMet: z.number().int(),
    responseBreached: z.number().int(),
    resolutionMet: z.number().int(),
    resolutionBreached: z.number().int(),
  }),
  /** Mean time to resolve, business-agnostic hours, per priority (resolved in the period). */
  mttrHours: z.array(z.object({ priority: prioritySchema, hours: z.number(), count: z.number().int() })),
  backlogAge: z.array(
    z.object({ bucket: z.enum(['lt1d', '1to3d', '3to7d', '7to30d', 'gt30d']), count: z.number().int() }),
  ),
  topCategories: z.array(z.object({ category: categoryRefSchema, count: z.number().int() })),
  csat: z.object({ average: z.number().nullable(), responses: z.number().int() }),
  /** Open major incidents. */
  majorOpen: z.number().int(),
});
export type OverviewReport = z.input<typeof overviewReportSchema>;

/* ───────────────────────────── slots ───────────────────────────── */

/** A knowledge article a reply cites (recorded as "Article used" when the agent resolves with that reply). */
export interface ReplyArticle {
  id: string;
  reference: string;
  title: string;
}

/** Props of `<Slot name="itsm.ticket.aside">` — e.g. Helpdesk AI's assist panel on the ticket page. */
export interface TicketAsideSlotProps {
  ticket: TicketDetail;
  actions: {
    /**
     * Puts text into the reply composer (public comment), for the agent to review and send. Pass `article` when the
     * text cites a knowledge article: "Send and resolve" then offers it as the article used.
     */
    insertReply(text: string, meta?: { article?: ReplyArticle }): void;
    /** Re-fetches the ticket after the slot changed it through the API. */
    refresh(): void;
    /**
     * Links another ticket to this one, from this ticket's point of view (e.g. on a problem
     * `{ type: 'caused_by', direction: 'incoming' }`: "the incident is caused by this problem"). Resolves once saved
     * (the ticket refreshes); rejects with the API error. `ticket.links` shows what is already linked.
     */
    linkTicket(
      reference: string,
      link: { type: LinkType; direction: 'outgoing' | 'incoming' },
    ): Promise<void>;
  };
}

/* ───────────────────────────── AI tools (contract for Helpdesk AI and MCP) ───────────────────────────── */

export const aiTicketRef = z
  .object({ id: id.optional(), reference: z.string().max(20).optional() })
  .refine((v) => v.id || v.reference, 'Give the ticket id or reference');

export const aiFindTicketsInput = z.object({
  query: z.string().max(500).optional(),
  status: z.enum(['open', 'done', 'all']).default('open'),
  type: ticketTypeSchema.optional(),
  limit: z.number().int().min(1).max(25).default(10),
});

export const aiMyTicketsInput = z.object({
  status: z.enum(['open', 'done', 'all']).default('open'),
  limit: z.number().int().min(1).max(25).default(10),
});

export const aiCreateTicketInput = z.object({
  type: z.enum(['incident', 'service_request']).default('incident'),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(20_000),
  urgency: levelSchema.optional(),
  categoryId: id.optional(),
  ciIds: z.array(id).max(10).optional(),
  channel: z.enum(['chat', 'portal', 'ai']).default('chat'),
});

export const aiAddCommentInput = z.object({
  ticketId: id,
  body: z.string().trim().min(1).max(20_000),
  /** false = internal work note (agents only). */
  public: z.boolean().default(true),
});

export const aiTriageTicketInput = z.object({
  ticketId: id,
  categoryId: id.optional(),
  impact: levelSchema.optional(),
  urgency: levelSchema.optional(),
  assignmentGroupId: id.optional(),
  assigneeId: id.optional(),
  /** Only fill fields that are still empty / default (never overwrite an agent's choice). */
  onlyEmpty: z.boolean().default(true),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().max(2_000).optional(),
});

export const aiResolveTicketInput = z.object({
  ticketId: id,
  resolutionCode: resolutionCodeSchema,
  resolutionNotes: z.string().trim().min(3).max(10_000),
});

/** What AI tools return for a ticket (compact, no custom fields). */
export const aiTicketSchema = z.object({
  id,
  reference: z.string(),
  type: ticketTypeSchema,
  title: z.string(),
  description: z.string(),
  status: ticketStatusSchema,
  priority: prioritySchema,
  impact: levelSchema,
  urgency: levelSchema,
  category: z.object({ id, key: z.string(), path: z.string() }).nullable(),
  assignmentGroup: groupRefSchema.nullable(),
  assignee: z.object({ id, displayName: z.string() }).nullable(),
  requester: z.object({ id, displayName: z.string(), locale: z.string() }).nullable(),
  cis: z.array(z.object({ id, name: z.string() })),
  resolutionCode: resolutionCodeSchema.nullable(),
  resolutionNotes: z.string().nullable(),
  href: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  /** Latest timeline entries the caller may see (comments and work notes), oldest first. */
  activities: z.array(
    z.object({
      kind: activityKindSchema,
      public: z.boolean(),
      author: z.string().nullable(),
      body: z.string().nullable(),
      at: z.string(),
    }),
  ),
});
export type AiTicket = z.infer<typeof aiTicketSchema>;

export const aiTriageOptionsSchema = z.object({
  categories: z.array(
    z.object({
      id,
      key: z.string(),
      path: z.string(),
      ticketTypes: z.array(ticketTypeSchema),
      defaultGroupId: id.nullable(),
    }),
  ),
  groups: z.array(z.object({ id, key: z.string(), name: z.string() })),
});
export type AiTriageOptions = z.infer<typeof aiTriageOptionsSchema>;

/** Items of `itsm.find_tickets` and `itsm.my_tickets` (`{ items }`): compact, names instead of ids. */
export const aiTicketSummarySchema = z.object({
  id,
  reference: z.string(),
  type: ticketTypeSchema,
  title: z.string(),
  status: ticketStatusSchema,
  priority: prioritySchema,
  requester: z.string().nullable(),
  assignee: z.string().nullable(),
  updatedAt: z.string(),
  resolutionNotes: z.string().nullable(),
  href: z.string(),
});
export const aiTicketListSchema = z.object({ items: z.array(aiTicketSummarySchema) });
export type AiTicketList = z.infer<typeof aiTicketListSchema>;

/** `itsm.triage_ticket` result: which requested fields were applied or kept (onlyEmpty), and the ticket. */
export const aiTriageResultSchema = z.object({
  applied: z.array(z.string()),
  skipped: z.array(z.string()),
  ticket: aiTicketSchema,
});
export type AiTriageResult = z.infer<typeof aiTriageResultSchema>;

/** `itsm.add_comment` result. */
export const aiCommentResultSchema = z.object({
  id,
  ticketId: id,
  reference: z.string(),
  public: z.boolean(),
  createdAt: z.string(),
});
export type AiCommentResult = z.infer<typeof aiCommentResultSchema>;
