import { z } from 'zod';
import { dateTime } from './common';

/** `itsm.ticket:<id>` — a record of any module (see `formatRecordRef` in `@isbp/sdk`). */
export const recordRefString = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*:[A-Za-z0-9_-]{1,64}$/, 'Expected <module>.<type>:<id>');

export const recordRefSchema = z.object({
  type: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
  id: z.string().min(1).max(64),
});
export type RecordRefInput = z.infer<typeof recordRefSchema>;

export const statusToneSchema = z.enum(['neutral', 'info', 'success', 'warning', 'danger']);

/** A linkable record type the caller can pick from (enabled module, permission held). */
export const recordTypeSchema = z.object({
  /** `itsm.ticket` */
  type: z.string(),
  moduleId: z.string(),
  /** i18n key of the singular noun. */
  name: z.string(),
  icon: z.string().nullable(),
});
export type RecordTypeInfo = z.infer<typeof recordTypeSchema>;

export const resolvedRecordSchema = z.object({
  type: z.string(),
  moduleId: z.string(),
  id: z.string(),
  reference: z.string().nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  /** `key` is an i18n key in the owning module's catalog. */
  status: z.object({ key: z.string(), tone: statusToneSchema }).nullable(),
  href: z.string(),
  icon: z.string().nullable(),
  editable: z.boolean(),
});
export type ResolvedRecordInfo = z.infer<typeof resolvedRecordSchema>;

const actor = z.object({ id: z.uuid(), name: z.string() }).nullable();

export const recordLinkSchema = z.object({
  id: z.uuid(),
  ref: recordRefSchema,
  /** `null` with `hidden` set when the caller can't see the other record (or its module is off). */
  record: resolvedRecordSchema.nullable(),
  hidden: z.enum(['forbidden', 'unavailable']).nullable(),
  createdAt: dateTime,
  createdBy: actor,
});
export type RecordLinkDto = z.input<typeof recordLinkSchema>;

export const recordLinksResponseSchema = z.object({
  record: resolvedRecordSchema,
  links: z.array(recordLinkSchema),
});

export const createRecordLinkSchema = z.object({ to: recordRefSchema });

export const fileInfoSchema = z.object({
  id: z.uuid(),
  record: recordRefSchema,
  name: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  uploadedBy: actor,
  createdAt: dateTime,
  href: z.string(),
  /** Raster images can be previewed inline (`href?inline=1`). */
  previewable: z.boolean(),
});
export type FileInfoDto = z.input<typeof fileInfoSchema>;

export const recordFilesResponseSchema = z.object({
  record: resolvedRecordSchema,
  files: z.array(fileInfoSchema),
  /** Upload limits for the picker (`maxBytes`, blocked extensions). */
  limits: z.object({ maxBytes: z.number().int(), blockedExtensions: z.array(z.string()) }),
});

/**
 * Props of the core record panels a module hosts on its record pages:
 * `<Slot name="core.record.links" props={{ record }} />` and `<Slot name="core.record.files" props={{ record }} />`.
 * Whether the viewer may change them comes from the module's resolver (`editable`). The links panel also reports
 * the record to the shell's page context (`usePageRecord` in `@isbp/sdk/web`), so every record page tells the
 * assistant which record is open without code of its own.
 */
export interface RecordPanelSlotProps {
  record: { type: string; id: string };
  /** Hide the card chrome when the host renders its own heading. */
  bare?: boolean;
}

/**
 * Props of `<Slot name="core.shell.header">`, hosted by the shell on every page in the header's action group
 * (before the notification bell). Contributions render one compact icon button (`size="icon"`, translated
 * `aria-label`) and open their own sheet or popover; the page they are on comes from `usePageContext()`.
 */
export type ShellHeaderSlotProps = Record<string, never>;

/** Props of `<Slot name="core.user.overview">` on the user page (Administration → People). */
export interface UserOverviewSlotProps {
  user: { id: string; displayName: string };
}
