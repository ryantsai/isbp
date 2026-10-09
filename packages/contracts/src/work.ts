import { z } from 'zod';
import { dateTime } from './common';

/* ───────────── My work: everything waiting for the signed-in person ───────────── */

/** `approval` decisions, `todo` things to fill in or do, `review` records to check, `task` assigned work items. */
export const workKindSchema = z.enum(['approval', 'todo', 'review', 'task']);
export type WorkKind = z.infer<typeof workKindSchema>;

export const workItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  /** Translated detail: an i18n key with ICU values ("4 to check"). */
  detail: z
    .object({ key: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])) })
    .nullable(),
  href: z.string(),
  due: dateTime.nullable(),
  since: dateTime.nullable(),
  overdue: z.boolean(),
});
export type WorkItemDTO = z.input<typeof workItemSchema>;

export const workSectionSchema = z.object({
  /** `<module>.<key>`, e.g. `dbaccess.reviews`. */
  source: z.string(),
  moduleId: z.string(),
  kind: workKindSchema,
  /** i18n key of the heading. */
  label: z.string(),
  icon: z.string().nullable(),
  /** The module's own full list. */
  href: z.string().nullable(),
  count: z.number().int(),
  items: z.array(workItemSchema),
  /** The source failed or timed out: show "Couldn't load", not "nothing". */
  error: z.boolean(),
});
export type WorkSection = z.input<typeof workSectionSchema>;

export const myWorkQuerySchema = z.object({
  /** Items per source (counts are always complete). */
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const myWorkSchema = z.object({
  /** Sources with something for the person (and failed ones), in My work order. */
  sections: z.array(workSectionSchema),
  /** The badge: everything except `task` items. */
  total: z.number().int(),
  tasks: z.number().int(),
});
export type MyWork = z.input<typeof myWorkSchema>;

export const workCountsSchema = z.object({
  total: z.number().int(),
  tasks: z.number().int(),
  byKind: z.object({
    approval: z.number().int(),
    todo: z.number().int(),
    review: z.number().int(),
    task: z.number().int(),
  }),
});
export type WorkCounts = z.input<typeof workCountsSchema>;
