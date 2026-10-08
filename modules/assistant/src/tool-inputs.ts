import { z } from 'zod';
import { itemOpSchema, refNameSchema } from './contracts';

/** Inputs of the assistant's AI tools (declared in the manifest, so web-safe: Zod only). */
const kindName = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);
const changeSetId = z
  .uuid()
  .describe('The change set to add to (from an earlier result). Omit to start a new one.');

export const toolInputs = {
  listKinds: z.object({}),
  describeKind: z.object({ kind: kindName.describe('A kind from assistant.list_kinds, e.g. core.workflow') }),
  listObjects: z.object({
    kind: kindName,
    query: z.string().max(200).optional().describe('Filter by name'),
    limit: z.number().int().min(1).max(100).default(25),
    includeArchived: z.boolean().default(false),
  }),
  getObject: z.object({ kind: kindName, id: z.string().min(1).max(200) }),
  proposeChange: z.object({
    changeSetId: changeSetId.optional(),
    ref: refNameSchema
      .optional()
      .describe(
        'Name for this item; later items use "$ref:<name>" where its id goes. Same name replaces the item.',
      ),
    kind: kindName,
    op: itemOpSchema.describe('create, update (full value), archive or delete — as the kind allows'),
    targetId: z.string().max(200).optional().describe('The object to change (update, archive, delete)'),
    label: z.string().max(200).optional().describe('Short name of the change for people'),
    value: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('The full value in the kind’s schema (create, update)'),
    note: z.string().max(2000).optional().describe('Why, for the reviewer'),
  }),
  removeChange: z.object({
    changeSetId: z.uuid(),
    item: z.string().min(1).max(200).describe('The item’s ref or id'),
  }),
  getChangeSet: z.object({ changeSetId: z.uuid() }),
  applyChangeSet: z.object({ changeSetId: z.uuid() }),
  rollbackChangeSet: z.object({
    changeSetId: z.uuid(),
    reason: z.string().trim().max(1000).optional().describe('Why, for the audit log'),
  }),
  requestReview: z.object({
    changeSetId: z.uuid(),
    note: z.string().trim().max(2000).optional().describe('A note for the reviewer'),
  }),
  updateChangeSet: z.object({
    changeSetId: z.uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().trim().max(4000).optional().describe('What it does and why, for the reviewer'),
  }),
};
