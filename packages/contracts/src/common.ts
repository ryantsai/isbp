import { locales } from '@isbp/i18n';
import { z } from 'zod';

/**
 * Timestamps travel as ISO-8601 strings and are `Date` inside the API.
 * Handlers return `Date`; the serializer encodes. Clients see the wire (input) type: `string`.
 */
export const dateTime = z.codec(z.iso.datetime({ offset: true }), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
});

export const id = z.uuid();
export const localeSchema = z.enum(locales);

/** Lowercase slug used for keys (groups, roles, IdPs, department codes allow upper too). */
export const keySchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'lowercase letters, digits, "-" and "_" only');

export const ref = z.object({ id: z.uuid(), name: z.string() });
export type Ref = z.infer<typeof ref>;

/** Password policy for local accounts (NIST 800-63B style: length over composition). */
export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .max(256)
  .refine((p) => new Set(p).size >= 5, 'Too repetitive');

export const okSchema = z.object({ ok: z.literal(true) });

/** Wire type helper: what a client receives / sends (dates as strings). */
export type Wire<T extends z.ZodType> = z.input<T>;
