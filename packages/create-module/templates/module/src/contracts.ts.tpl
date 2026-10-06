import { dateTime } from '@isbp/contracts';
import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';

export const itemStatusSchema = z.enum(['draft', 'active', 'archived']);

export const itemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: itemStatusSchema,
  owner: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Item = z.input<typeof itemSchema>;

export const itemQuerySchema = listQuerySchema.extend({ status: itemStatusSchema.optional() });

export const createItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).nullish(),
  status: itemStatusSchema.optional(),
  ownerId: z.uuid().nullish(),
});
export type CreateItemInput = z.input<typeof createItemSchema>;

export const updateItemSchema = createItemSchema.partial();
export type UpdateItemInput = z.input<typeof updateItemSchema>;
