import { dateTime } from '@isbp/contracts';
import { z } from 'zod';

/*
 * The assistant's API: change sets (drafts of configuration changes that a person applies, reviews or rolls back)
 * and conversations with the agent that builds them. Design: docs/architecture.md §13.2–13.3.
 */

const id = z.uuid();

export const CHANGE_SET_STATUSES = ['draft', 'in_review', 'applied', 'rolled_back', 'discarded'] as const;
export const changeSetStatusSchema = z.enum(CHANGE_SET_STATUSES);
export type ChangeSetStatus = z.infer<typeof changeSetStatusSchema>;

export const ITEM_OPS = ['create', 'update', 'archive', 'delete'] as const;
export const itemOpSchema = z.enum(ITEM_OPS);
export type ItemOp = z.infer<typeof itemOpSchema>;

/** Destructive operations need an explicit confirmation to apply. */
export const DESTRUCTIVE_OPS: readonly ItemOp[] = ['archive', 'delete'];

/** An item's name inside its change set; later items use `"$ref:<name>"` where the item's id goes. */
export const refNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, 'lowercase letters, digits and dashes, starting with a letter');

export const REF_PREFIX = '$ref:';

/** `CS-00012`. */
export const changeSetReference = (n: number) => `CS-${String(n).padStart(5, '0')}`;
export const changeSetHref = (changeSetId: string) => `/assistant/change-sets/${changeSetId}`;

const personRefSchema = z.object({ id: z.string().nullable(), name: z.string() });

/* ───────────── items ───────────── */

export const issueSchema = z.object({ path: z.string(), message: z.string(), code: z.string().optional() });

/** The latest dry run of one item. */
export const checkResultSchema = z.object({
  ok: z.boolean(),
  /** Fails only for the proposer's own permissions: someone who holds them could apply it. */
  needsApprover: z.boolean(),
  code: z.string().nullable(),
  message: z.string().nullable(),
  issues: z.array(issueSchema),
  /** The permission that was missing, when known. */
  permission: z.string().nullable(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

/** An object as a kind returns it, with its version. */
export const objectSnapshotSchema = z.object({
  id: z.string(),
  label: z.string(),
  archived: z.boolean(),
  href: z.string().nullable(),
  version: z.string(),
  value: z.unknown(),
});
export type ObjectSnapshot = z.infer<typeof objectSnapshotSchema>;

export const changeSetItemSchema = z.object({
  id,
  position: z.number().int(),
  ref: z.string().nullable(),
  kind: z.string(),
  op: itemOpSchema,
  targetId: z.string().nullable(),
  label: z.string(),
  value: z.unknown(),
  /** The object as it is now (update/archive/delete), to diff against. */
  current: objectSnapshotSchema.nullable(),
  /** Version of the object when the item was proposed (or refreshed). */
  baseVersion: z.string().nullable(),
  /** The object changed since: applying would fail until the change set is refreshed. */
  stale: z.boolean(),
  check: checkResultSchema.nullable(),
  /** After applying: the object's id, and its state before and after. */
  appliedId: z.string().nullable(),
  before: objectSnapshotSchema.nullable(),
  after: objectSnapshotSchema.nullable(),
  note: z.string().nullable(),
});
export type ChangeSetItem = z.output<typeof changeSetItemSchema>;

/**
 * Props of `<Slot name="assistant.preview.<module>.<kind>">` on the change set page: the module that owns a kind
 * previews one item (`assistant.preview.core.workflow` draws the diagram with the simulator). `value` is what the
 * object will be (the applied value once the set is applied; null for archive and delete) and `current` the object
 * as it is now (before the change, once applied), null for a create. Values may contain `"$ref:<name>"` where
 * an object created earlier in the same set is meant.
 */
export interface AssistantPreviewProps {
  item: ChangeSetItem;
  value: unknown;
  current: ObjectSnapshot | null;
}

/* ───────────── change sets ───────────── */

export const changeSetSummarySchema = z.object({
  id,
  number: z.number().int(),
  reference: z.string(),
  title: z.string(),
  summary: z.string(),
  status: changeSetStatusSchema,
  itemCount: z.number().int(),
  kinds: z.array(z.string()),
  /** Every item passed its latest dry run. */
  ready: z.boolean(),
  createdBy: personRefSchema.extend({ type: z.enum(['user', 'service']) }),
  appliedBy: personRefSchema.nullable(),
  appliedAt: dateTime.nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type ChangeSetSummary = z.output<typeof changeSetSummarySchema>;

export const changeSetPermissionsSchema = z.object({
  canEdit: z.boolean(),
  canApply: z.boolean(),
  canSubmit: z.boolean(),
  canWithdraw: z.boolean(),
  canRollback: z.boolean(),
  canDiscard: z.boolean(),
  /** Apply permissions of the change set's kinds the viewer doesn't hold. */
  missing: z.array(z.string()),
  /** Why it can't be rolled back automatically, when it can't (`not_reversible`, `stale`). */
  rollbackBlocked: z.string().nullable(),
});

export const changeSetDetailSchema = changeSetSummarySchema.extend({
  items: z.array(changeSetItemSchema),
  conversationId: id.nullable(),
  review: z
    .object({ instanceId: id, requestedAt: dateTime.nullable(), note: z.string().nullable() })
    .nullable(),
  /** Why the last apply, review or rollback didn't go through. */
  lastError: z
    .object({ code: z.string(), message: z.string(), details: z.unknown().optional(), at: dateTime })
    .nullable(),
  checkedAt: dateTime.nullable(),
  destructive: z.boolean(),
  rolledBackBy: personRefSchema.nullable(),
  rolledBackAt: dateTime.nullable(),
  permissions: changeSetPermissionsSchema,
  href: z.string(),
});
export type ChangeSetDetail = z.output<typeof changeSetDetailSchema>;

export const changeSetQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: changeSetStatusSchema.optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().max(40).optional(),
});
export type ChangeSetQuery = z.output<typeof changeSetQuerySchema>;

export const createChangeSetSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(4000).optional(),
});

export const updateChangeSetSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(4000).optional(),
});

export const proposeItemSchema = z.object({
  /** Replaces the item with the same name. */
  ref: refNameSchema.optional(),
  kind: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
  op: itemOpSchema,
  /** The object to change (not for `create`). */
  targetId: z.string().min(1).max(200).nullish(),
  /** How the item reads in the change set ("Laptop request approval"). */
  label: z.string().trim().max(200).optional(),
  /** The full value in the kind's schema (`create`, `update`). */
  value: z.unknown().optional(),
  note: z.string().trim().max(2000).optional(),
});
export type ProposeItemInput = z.output<typeof proposeItemSchema>;

export const applySchema = z.object({
  /** Archives and deletes in the set need an explicit confirmation. */
  confirm: z.boolean().default(false),
});

export const rollbackSchema = z.object({
  confirm: z.boolean().default(false),
  reason: z.string().trim().max(1000).optional(),
});

export const submitSchema = z.object({ note: z.string().trim().max(2000).optional() });

export const buildTemplateSchema = z.object({
  kind: z.string().max(100),
  templateId: z.string().max(100),
  answers: z.record(z.string(), z.unknown()),
  /** Add to this change set (a new one otherwise). */
  changeSetId: id.optional(),
});

/* ───────────── status ───────────── */

export const AI_MODES = ['llm', 'builtin'] as const;
export type AiMode = (typeof AI_MODES)[number];

export const kindInfoSchema = z.object({
  kind: z.string(),
  moduleId: z.string(),
  label: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  operations: z.array(itemOpSchema),
  canApply: z.boolean(),
  templates: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
});
export type KindInfo = z.output<typeof kindInfoSchema>;

export const assistantStatusSchema = z.object({
  /** `llm` with a chat model; `builtin` (guided templates) without. */
  mode: z.enum(AI_MODES),
  model: z.string().nullable(),
  /** The kinds the viewer may propose changes to (guided templates and change sets need at least one). */
  kinds: z.array(kindInfoSchema),
  /**
   * How many of the platform's tools outside the assistant's own (tickets, comments, tasks, lookups …) the viewer
   * may use in a conversation. With a chat model, the panel chats when this or `kinds` is non-empty.
   */
  tools: z.number().int(),
});

/* ───────────── conversations ───────────── */

/** Where the person is: sent with every message so the agent knows the page. */
export const pageContextSchema = z.object({
  path: z.string().max(500),
  title: z.string().max(300).optional(),
  record: z
    .object({ type: z.string().max(100), id: z.string().max(200), label: z.string().max(300).optional() })
    .nullish(),
});
export type PageContext = z.infer<typeof pageContextSchema>;

export const toolUseSchema = z.object({ name: z.string(), ok: z.boolean() });

/**
 * A destructive tool call the agent made (applying a change set, rolling one back, any module's destructive tool):
 * nothing runs until the person confirms it in the panel.
 */
export const confirmationSchema = z.object({
  toolCallId: z.string(),
  /** Registry name, e.g. `assistant.apply_change_set`. */
  name: z.string(),
  /** What will happen, in the person's language ("Apply CS-00012 (3 changes)"). */
  label: z.string(),
  input: z.unknown(),
  status: z.enum(['pending', 'confirmed', 'declined', 'expired']),
  /** After it ran. */
  result: z
    .object({ ok: z.boolean(), code: z.string().nullable(), message: z.string().nullable() })
    .nullable(),
  changeSetId: z.string().nullable(),
});
export type Confirmation = z.output<typeof confirmationSchema>;

export const confirmSchema = z.object({ approve: z.boolean() });

export const messageSchema = z.object({
  id,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  tools: z.array(toolUseSchema),
  confirmations: z.array(confirmationSchema),
  mode: z.enum(AI_MODES).nullable(),
  model: z.string().nullable(),
  createdAt: dateTime,
});
export type Message = z.output<typeof messageSchema>;

export const conversationSchema = z.object({
  id,
  title: z.string(),
  changeSetId: id.nullable(),
  messageCount: z.number().int(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Conversation = z.output<typeof conversationSchema>;

export const conversationDetailSchema = conversationSchema.extend({
  messages: z.array(messageSchema),
  changeSet: changeSetSummarySchema.nullable(),
});

export const createConversationSchema = z.object({ page: pageContextSchema.optional() });

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  page: pageContextSchema.optional(),
});

/** Server-Sent Events of one turn. */
export type ChatStreamEvent =
  | { event: 'delta'; data: { text: string } }
  | { event: 'tool'; data: { name: string; status: 'running' | 'done' | 'error' } }
  | { event: 'change_set'; data: ChangeSetSummary }
  | { event: 'confirm'; data: Confirmation }
  | { event: 'done'; data: { messageId: string; mode: AiMode; model: string | null } }
  | { event: 'error'; data: { code: string } };
