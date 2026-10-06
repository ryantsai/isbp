import { z } from 'zod';
import {
  type Condition,
  conditionFacts,
  conditionSchema,
  evaluateCondition,
  type LocalizedText,
  localizedTextSchema,
} from './conditions';

/**
 * One field model for custom fields (stored in an entity's `attributes` JSONB) and form-builder forms.
 * The same {@link validateFields} runs in the browser and in the API.
 */
export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
  'email',
  'url',
  'user',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const DISPLAY_TYPES = ['heading', 'paragraph', 'divider'] as const;
export type DisplayType = (typeof DISPLAY_TYPES)[number];

export interface FieldOption {
  value: string;
  label: LocalizedText;
}

export interface FieldValidation {
  /** number: value range · multiselect: number of choices */
  min?: number;
  max?: number;
  /** text, textarea, email, url: length */
  minLength?: number;
  maxLength?: number;
  /** text: regular expression the whole value must match */
  pattern?: string;
}

export type FieldValue = string | number | boolean | string[] | null;

export interface FieldDef {
  /** Key in the stored data (`attributes.costCenter`, `submission.data.deviceType`). */
  key: string;
  type: FieldType;
  label: LocalizedText;
  help?: LocalizedText;
  placeholder?: LocalizedText;
  required?: boolean;
  options?: FieldOption[];
  validation?: FieldValidation;
  defaultValue?: FieldValue;
  /** Conditional logic: shown (and validated) only when this holds against the other values. */
  visibleWhen?: Condition;
  width?: 'full' | 'half';
}

export interface DisplayElement {
  id: string;
  type: DisplayType;
  text?: LocalizedText;
  visibleWhen?: Condition;
}

export type FormElement = (FieldDef & { id: string }) | DisplayElement;

export interface FormSchema {
  elements: FormElement[];
}

export const FIELD_KEY_RE = /^[a-z][a-zA-Z0-9_]{0,63}$/;
const DEFAULT_MAX_LENGTH: Partial<Record<FieldType, number>> = {
  text: 500,
  textarea: 10_000,
  email: 320,
  url: 2_000,
};
const PATTERN_INPUT_LIMIT = 2_000;

/**
 * Rejects patterns with nested quantifiers such as `(a+)+` — the classic catastrophic-backtracking
 * (ReDoS) shape — since admin-authored patterns run against user input on the server.
 */
export function isSafePattern(pattern: string): boolean {
  if (pattern.length > 200) return false;
  try {
    new RegExp(pattern, 'u');
  } catch {
    return false;
  }
  return !/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(pattern);
}

const optionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label: localizedTextSchema,
});

export const fieldDefSchema: z.ZodType<FieldDef, FieldDef> = z
  .object({
    key: z.string().regex(FIELD_KEY_RE, 'Start with a lowercase letter; letters, digits and _ only'),
    type: z.enum(FIELD_TYPES),
    label: localizedTextSchema,
    help: localizedTextSchema.optional(),
    placeholder: localizedTextSchema.optional(),
    required: z.boolean().optional(),
    options: z.array(optionSchema).max(200).optional(),
    validation: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        minLength: z.number().int().min(0).max(10_000).optional(),
        maxLength: z.number().int().min(1).max(10_000).optional(),
        pattern: z.string().max(200).optional(),
      })
      .optional(),
    defaultValue: z
      .union([z.string().max(2000), z.number(), z.boolean(), z.array(z.string().max(100)).max(200), z.null()])
      .optional(),
    visibleWhen: conditionSchema.optional(),
    width: z.enum(['full', 'half']).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.type === 'select' || f.type === 'multiselect') {
      if (!f.options?.length)
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least one option' });
      const values = f.options?.map((o) => o.value) ?? [];
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'Option values must be unique' });
    }
    const v = f.validation;
    if (v?.min !== undefined && v.max !== undefined && v.min > v.max)
      ctx.addIssue({ code: 'custom', path: ['validation', 'max'], message: 'Maximum is below the minimum' });
    if (v?.minLength !== undefined && v.maxLength !== undefined && v.minLength > v.maxLength)
      ctx.addIssue({
        code: 'custom',
        path: ['validation', 'maxLength'],
        message: 'Maximum is below the minimum',
      });
    if (v?.pattern && !isSafePattern(v.pattern))
      ctx.addIssue({ code: 'custom', path: ['validation', 'pattern'], message: 'Invalid or unsafe pattern' });
  });

const displayElementSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(DISPLAY_TYPES),
  text: localizedTextSchema.optional(),
  visibleWhen: conditionSchema.optional(),
});

export const formSchemaSchema: z.ZodType<FormSchema, FormSchema> = z
  .object({
    elements: z
      .array(
        z.union([
          displayElementSchema,
          z.intersection(z.object({ id: z.string().min(1).max(64) }), fieldDefSchema),
        ]),
      )
      .max(200),
  })
  .superRefine((s, ctx) => {
    const ids = new Set<string>();
    const keys = new Set<string>();
    s.elements.forEach((el, i) => {
      if (ids.has(el.id))
        ctx.addIssue({ code: 'custom', path: ['elements', i, 'id'], message: 'Duplicate id' });
      ids.add(el.id);
      if (isField(el)) {
        if (keys.has(el.key))
          ctx.addIssue({ code: 'custom', path: ['elements', i, 'key'], message: 'Duplicate field key' });
        keys.add(el.key);
      }
    });
  });

export function isField(el: FormElement): el is FieldDef & { id: string } {
  return (FIELD_TYPES as readonly string[]).includes(el.type);
}

export function formFields(schema: FormSchema | null | undefined): FieldDef[] {
  return (schema?.elements ?? []).filter(isField);
}

/* ───────────────────────────── validation ───────────────────────────── */

export type FieldErrorCode =
  | 'required'
  | 'type'
  | 'tooShort'
  | 'tooLong'
  | 'min'
  | 'max'
  | 'pattern'
  | 'option'
  | 'email'
  | 'url'
  | 'date'
  | 'user';

export interface FieldError {
  code: FieldErrorCode;
  /** e.g. `{ min: 3 }` for `tooShort` */
  params?: Record<string, number>;
}

export interface FieldValidationResult {
  ok: boolean;
  /** Cleaned, coerced values of the visible fields (hidden and unknown keys are dropped). */
  values: Record<string, FieldValue>;
  errors: Record<string, FieldError>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function blank(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * Which fields are visible for these values. Visibility is resolved to a fixed point so a field
 * hidden by one condition cannot keep another field visible through its stale value.
 */
export function visibleFieldKeys(
  fields: readonly Pick<FieldDef, 'key' | 'visibleWhen'>[],
  values: Record<string, unknown>,
) {
  let visible = new Set(fields.map((f) => f.key));
  for (let i = 0; i <= fields.length; i++) {
    const facts = Object.fromEntries(Object.entries(values).filter(([k]) => visible.has(k)));
    const next = new Set(fields.filter((f) => evaluateCondition(f.visibleWhen, facts)).map((f) => f.key));
    if (next.size === visible.size && [...next].every((k) => visible.has(k))) return next;
    visible = next;
  }
  return visible;
}

/** Visible display elements and fields of a form, in order. */
export function visibleElements(schema: FormSchema, values: Record<string, unknown>): FormElement[] {
  const fields = formFields(schema);
  const keys = visibleFieldKeys(fields, values);
  const facts = Object.fromEntries(Object.entries(values).filter(([k]) => keys.has(k)));
  return schema.elements.filter((el) =>
    isField(el) ? keys.has(el.key) : evaluateCondition(el.visibleWhen, facts),
  );
}

function checkField(f: FieldDef, raw: unknown): { value?: FieldValue; error?: FieldError } {
  const v = f.validation ?? {};
  switch (f.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'url': {
      if (typeof raw !== 'string') return { error: { code: 'type' } };
      const s = f.type === 'textarea' ? raw.replace(/\r\n/g, '\n').trim() : raw.trim();
      const max = Math.min(v.maxLength ?? DEFAULT_MAX_LENGTH[f.type]!, DEFAULT_MAX_LENGTH[f.type]!);
      if (v.minLength !== undefined && s.length < v.minLength)
        return { error: { code: 'tooShort', params: { min: v.minLength } } };
      if (s.length > max) return { error: { code: 'tooLong', params: { max } } };
      if (f.type === 'email' && !EMAIL_RE.test(s)) return { error: { code: 'email' } };
      if (f.type === 'url') {
        let ok = false;
        try {
          ok = ['http:', 'https:'].includes(new URL(s).protocol);
        } catch {
          ok = false;
        }
        if (!ok) return { error: { code: 'url' } };
      }
      if (f.type === 'text' && v.pattern) {
        if (
          s.length > PATTERN_INPUT_LIMIT ||
          !isSafePattern(v.pattern) ||
          !new RegExp(`^(?:${v.pattern})$`, 'u').test(s)
        )
          return { error: { code: 'pattern' } };
      }
      return { value: s };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return { error: { code: 'type' } };
      if (v.min !== undefined && n < v.min) return { error: { code: 'min', params: { min: v.min } } };
      if (v.max !== undefined && n > v.max) return { error: { code: 'max', params: { max: v.max } } };
      return { value: n };
    }
    case 'boolean':
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true' || raw === 'false') return { value: raw === 'true' };
      return { error: { code: 'type' } };
    case 'date': {
      if (typeof raw !== 'string' || !DATE_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`)))
        return { error: { code: 'date' } };
      const d = new Date(`${raw}T00:00:00Z`);
      if (d.toISOString().slice(0, 10) !== raw) return { error: { code: 'date' } };
      return { value: raw };
    }
    case 'select':
      if (typeof raw !== 'string' || !f.options?.some((o) => o.value === raw))
        return { error: { code: 'option' } };
      return { value: raw };
    case 'multiselect': {
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : null;
      if (!list || list.some((x) => typeof x !== 'string' || !f.options?.some((o) => o.value === x)))
        return { error: { code: 'option' } };
      const unique = [...new Set(list as string[])];
      if (v.min !== undefined && unique.length < v.min)
        return { error: { code: 'min', params: { min: v.min } } };
      if (v.max !== undefined && unique.length > v.max)
        return { error: { code: 'max', params: { max: v.max } } };
      return { value: unique };
    }
    case 'user':
      if (typeof raw !== 'string' || !UUID_RE.test(raw)) return { error: { code: 'user' } };
      return { value: raw.toLowerCase() };
  }
}

/**
 * Validates and coerces values against field definitions. Hidden fields (by `visibleWhen`) are
 * neither required nor kept, so conditional logic cannot be bypassed by submitting hidden values.
 * `user` fields are only checked for shape here — the API verifies the user exists.
 */
export function validateFields(
  fields: readonly FieldDef[],
  input: Record<string, unknown>,
): FieldValidationResult {
  const visible = visibleFieldKeys(fields, input);
  const values: Record<string, FieldValue> = {};
  const errors: Record<string, FieldError> = {};
  for (const f of fields) {
    if (!visible.has(f.key)) continue;
    const raw = input[f.key];
    if (blank(raw) || (typeof raw === 'string' && !raw.trim())) {
      if (f.required) errors[f.key] = { code: 'required' };
      continue;
    }
    const res = checkField(f, raw);
    if (res.error) errors[f.key] = res.error;
    else if (res.value !== undefined) {
      if (f.required && f.type === 'boolean' && res.value === false) errors[f.key] = { code: 'required' };
      else values[f.key] = res.value;
    }
  }
  return { ok: Object.keys(errors).length === 0, values, errors };
}

/** Initial values for a form or entity editor (defaults filled in). */
export function defaultFieldValues(fields: readonly FieldDef[], existing: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = existing[f.key] ?? f.defaultValue;
    out[f.key] = v ?? (f.type === 'multiselect' ? [] : f.type === 'boolean' ? false : '');
  }
  return out;
}

/** Field keys that a condition references but that don't exist (builder warnings). */
export function unknownConditionFacts(
  fields: readonly FieldDef[],
  condition: Condition | undefined,
): string[] {
  const keys = new Set(fields.map((f) => f.key));
  return conditionFacts(condition).filter((k) => !keys.has(k.split('.')[0]!));
}
