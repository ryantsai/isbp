import { dateTime } from '@isbp/contracts';
import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';

export const severitySchema = z.enum(['info', 'maintenance', 'incident']);
export type Severity = z.infer<typeof severitySchema>;
export const postStatusSchema = z.enum(['draft', 'published', 'archived']);
export type PostStatus = z.infer<typeof postStatusSchema>;

export const postSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  severity: severitySchema,
  status: postStatusSchema,
  pinned: z.boolean(),
  startsAt: dateTime.nullable(),
  endsAt: dateTime.nullable(),
  publishedAt: dateTime.nullable(),
  author: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Post = z.input<typeof postSchema>;

/** `current` = published and not ended; `drafts` and `archive` need manage permission for drafts. */
export const postQuerySchema = listQuerySchema.extend({
  view: z.enum(['current', 'drafts', 'archive']).default('current'),
  severity: severitySchema.optional(),
});
export type PostQuery = z.input<typeof postQuerySchema>;

export const createPostSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(10_000).default(''),
    severity: severitySchema.optional(),
    pinned: z.boolean().default(false),
    startsAt: dateTime.nullish(),
    endsAt: dateTime.nullish(),
    publish: z.boolean().default(false),
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, {
    path: ['endsAt'],
    message: 'Must be after the start',
  });
export type CreatePostInput = z.input<typeof createPostSchema>;

export const updatePostSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(10_000),
    severity: severitySchema,
    pinned: z.boolean(),
    startsAt: dateTime.nullable(),
    endsAt: dateTime.nullable(),
  })
  .partial();
export type UpdatePostInput = z.input<typeof updatePostSchema>;
