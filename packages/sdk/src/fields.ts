import { z } from 'zod';
import {
  type Condition,
  conditionFacts,
  conditionSchema,
  evaluateCondition,
  type LocalizedText,
  localizedTextSchema,
  RESERVED_FACTS,
  TODAY_FACT,
  todayFact,
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
  'record',
  'rows',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** The types a table (`rows`) field's columns may have: every field type except another table. */
export const ROW_FIELD_TYPES = [
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
  'record',
] as const satisfies readonly FieldType[];
export type RowFieldType = (typeof ROW_FIELD_TYPES)[number];
/** At most this many rows in a table field (and columns per row: {@link MAX_ROW_FIELDS}). */
export const MAX_ROWS = 50;
export const MAX_ROW_FIELDS = 20;

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
/** One row of a table (`rows`) field: its columns' values by sub-field key. */
export type FieldRow = Record<string, FieldValue>;
/** A stored answer: a field value, or the rows of a table field. */
export type FieldAnswer = FieldValue | FieldRow[];

/**
 * A table field (`type: 'rows'`): a list of rows with the same columns (firewall rule lines, accounts, backup items).
 * Columns are fields of the simple types ({@link ROW_FIELD_TYPES}) without conditions; the value is a list of row
 * objects. `min`/`max` bound the number of rows (at most {@link MAX_ROWS}); rows left completely empty are ignored.
 */
export interface RowsFieldOptions {
  fields: FieldDef[];
  min?: number;
  max?: number;
}

/**
 * A `record` field picks records of other modules (`manifest.records.types`), stored as refs `<type>:<id>`
 * (`cmdb.ci:…`). Only records the person may read can be picked (checked by the API through the resolvers);
 * `where` narrows the choice by the record type's facts (`{ fact: 'environment', op: 'eq', value: 'production' }`).
 */
export interface RecordFieldOptions {
  /** Record types that may be picked, e.g. `['cmdb.ci']`. */
  types: string[];
  /** Pick several (stored as a list; at most 20). */
  multiple?: boolean;
  where?: Condition;
}

/** `cmdb.ci:01J…` — a record reference as stored in a `record` field. */
export const RECORD_REF_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*:[A-Za-z0-9_.-]{1,100}$/;
export const RECORD_TYPE_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
export const MAX_RECORD_VALUES = 20;

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
  /** Required for `record` fields. */
  record?: RecordFieldOptions;
  /** Required for `rows` (table) fields: the columns and how many rows. */
  rows?: RowsFieldOptions;
}

export interface DisplayElement {
  id: string;
  type: DisplayType;
  text?: LocalizedText;
  visibleWhen?: Condition;
}

export type FormElement = (FieldDef & { id: string }) | DisplayElement;

/**
 * A rule across fields, checked like field validation (browser and API): when `when` holds (always, without it),
 * `require` must hold, or the form shows `message` on `fields` (or above the form). Conditions read the answers by
 * field key and may compare two fields (`valueFact`).
 */
export interface FormRule {
  id: string;
  when?: Condition;
  require: Condition;
  message: LocalizedText;
  /** Field keys the message is shown on. */
  fields?: string[];
}

export const PROCESS_ACTION_OUTCOMES = ['submitted', 'approved', 'rejected'] as const;
export type ProcessActionOutcome = (typeof PROCESS_ACTION_OUTCOMES)[number];

/**
 * Work a form does after it is sent, approved or rejected (`manifest.processActions`, e.g. `itsm.create-change`):
 * run in the worker after commit, retried, shown on the request. `config` follows the action's own fields; text
 * values may use templates (`{{data.title}}`, `{{requester.name}}`, `{{request.reference}}`).
 */
export interface FormAction {
  id: string;
  on: ProcessActionOutcome;
  /** `<module>.<action>`. */
  type: string;
  name?: LocalizedText;
  /**
   * Run only when this holds, evaluated when the outcome is recorded against `{ data, records, steps, requester,
   * today }` (`data.<key>`, `records.<key>.<fact>`, `steps.<stepId>.<key>`, `requester.departmentCode`…). An action
   * whose condition doesn't hold is recorded as skipped (reason `condition`).
   */
  when?: Condition;
  config: Record<string, unknown>;
}

export interface FormSchema {
  elements: FormElement[];
  rules?: FormRule[];
  actions?: FormAction[];
}

export const FIELD_KEY_RE = /^[a-z][a-zA-Z0-9_]{0,63}$/;
const DEFAULT_MAX_LENGTH: Partial<Record<FieldType, number>> = {
  text: 500,
  textarea: 10_000,
  email: 320,
  url: 2_000,
};
const PATTERN_INPUT_LIMIT = 2_000;

/** `+`, `*` or `{n,}`: a quantifier without an upper bound. */
const UNBOUNDED_QUANTIFIER = /[+*]|\{\d+,\}/;
const ANY_QUANTIFIER = /[+*]|\{\d+(?:,\d*)?\}/;
/** The innermost group (`(…)`, `(?:…)`, lookarounds, named groups) and the quantifier after it, if any. */
const INNERMOST_GROUP = /\((?:\?(?:[:=!]|<[=!]|<[A-Za-z]\w*>))?([^()]*)\)\s*([+*]|\{\d+(?:,\d*)?\})?/;

/**
 * Rejects patterns with nested quantifiers such as `(a+)+` or `((a*)b)*` — the classic catastrophic-backtracking
 * (ReDoS) shape — since admin-authored patterns run against user input on the server. A quantified group with a
 * quantifier inside is unsafe when either of them is unbounded; bounded ones such as `(\d{1,3}\.){3}` (an IPv4
 * address) can't backtrack catastrophically. Groups are checked from the innermost out.
 */
export function isSafePattern(pattern: string): boolean {
  if (pattern.length > 200) return false;
  try {
    new RegExp(pattern, 'u');
  } catch {
    return false;
  }
  // Escaped characters (`\+`, `\(`) are literals, and so is everything inside a character class.
  let rest = pattern.replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, 'x');
  for (let m = INNERMOST_GROUP.exec(rest); m; m = INNERMOST_GROUP.exec(rest)) {
    const [whole, inner = '', outer = ''] = m;
    const innerQuantified = ANY_QUANTIFIER.test(inner);
    const unbounded = UNBOUNDED_QUANTIFIER.test(inner) || UNBOUNDED_QUANTIFIER.test(outer);
    if (outer && innerQuantified && unbounded) return false;
    // The group becomes one atom that keeps what its enclosing group needs to know.
    const atom = unbounded ? 'x+' : innerQuantified || outer ? 'x{1}' : 'x';
    rest = rest.slice(0, m.index) + atom + rest.slice(m.index + whole.length);
  }
  return true;
}

const optionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label: localizedTextSchema,
});

const fieldBaseSchema = z.object({
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
  record: z
    .object({
      types: z.array(z.string().regex(RECORD_TYPE_RE, 'Use <module>.<type>')).min(1).max(10),
      multiple: z.boolean().optional(),
      where: conditionSchema.optional(),
    })
    .optional(),
});

/** Checks every field definition shares (options, record types, ranges, patterns). */
function refineField(f: z.output<typeof fieldBaseSchema>, ctx: z.RefinementCtx) {
  if (f.type === 'record' && !f.record?.types.length)
    ctx.addIssue({ code: 'custom', path: ['record', 'types'], message: 'Choose at least one record type' });
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
}

/** A column of a table field: a field of a simple type, without conditions. */
const rowFieldSchema = fieldBaseSchema.extend({ type: z.enum(ROW_FIELD_TYPES) }).superRefine((f, ctx) => {
  refineField(f, ctx);
  if (f.visibleWhen)
    ctx.addIssue({ code: 'custom', path: ['visibleWhen'], message: 'Table columns have no conditions' });
});

const rowsSchema = z
  .object({
    fields: z.array(rowFieldSchema).min(1, 'Add at least one column').max(MAX_ROW_FIELDS),
    min: z.number().int().min(0).max(MAX_ROWS).optional(),
    max: z.number().int().min(1).max(MAX_ROWS).optional(),
  })
  .superRefine((r, ctx) => {
    const keys = r.fields.map((f) => f.key);
    keys.forEach((k, i) => {
      if (keys.indexOf(k) !== i)
        ctx.addIssue({ code: 'custom', path: ['fields', i, 'key'], message: 'Duplicate column key' });
    });
    if (r.min !== undefined && r.max !== undefined && r.min > r.max)
      ctx.addIssue({ code: 'custom', path: ['max'], message: 'Maximum is below the minimum' });
  });

export const fieldDefSchema: z.ZodType<FieldDef, FieldDef> = fieldBaseSchema
  .extend({ rows: rowsSchema.optional() })
  .superRefine((f, ctx) => {
    refineField(f, ctx);
    if (f.type === 'rows') {
      if (!f.rows?.fields.length)
        ctx.addIssue({ code: 'custom', path: ['rows', 'fields'], message: 'Add at least one column' });
      if (f.defaultValue !== undefined && f.defaultValue !== null)
        ctx.addIssue({ code: 'custom', path: ['defaultValue'], message: 'Tables have no default value' });
    }
  });

const displayElementSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(DISPLAY_TYPES),
  text: localizedTextSchema.optional(),
  visibleWhen: conditionSchema.optional(),
});

const elementId = z.string().min(1).max(64);

export const formRuleSchema: z.ZodType<FormRule, FormRule> = z.object({
  id: elementId,
  when: conditionSchema.optional(),
  require: conditionSchema,
  message: localizedTextSchema,
  fields: z.array(z.string().regex(FIELD_KEY_RE)).max(20).optional(),
});

export const formActionSchema: z.ZodType<FormAction, FormAction> = z.object({
  id: elementId,
  on: z.enum(PROCESS_ACTION_OUTCOMES),
  type: z.string().regex(RECORD_TYPE_RE, 'Use <module>.<action>'),
  name: localizedTextSchema.optional(),
  when: conditionSchema.optional(),
  config: z.record(z.string(), z.unknown()),
});

export const formSchemaSchema: z.ZodType<FormSchema, FormSchema> = z
  .object({
    elements: z
      .array(z.union([displayElementSchema, z.intersection(z.object({ id: elementId }), fieldDefSchema)]))
      .max(200),
    rules: z.array(formRuleSchema).max(50).optional(),
    actions: z.array(formActionSchema).max(20).optional(),
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
    for (const list of ['rules', 'actions'] as const) {
      const seen = new Set<string>();
      s[list]?.forEach((item, i) => {
        if (seen.has(item.id))
          ctx.addIssue({ code: 'custom', path: [list, i, 'id'], message: 'Duplicate id' });
        seen.add(item.id);
      });
    }
    s.rules?.forEach((r, i) =>
      r.fields?.forEach((k, j) => {
        if (!keys.has(k))
          ctx.addIssue({ code: 'custom', path: ['rules', i, 'fields', j], message: 'Unknown field' });
      }),
    );
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
  | 'user'
  | 'record'
  /** A table has fewer rows than `rows.min` (`params.min`) or more than `rows.max` (`params.max`). */
  | 'minRows'
  | 'maxRows'
  /** A form rule failed (`message` says why). */
  | 'rule';

export interface FieldError {
  code: FieldErrorCode;
  /** e.g. `{ min: 3 }` for `tooShort` */
  params?: Record<string, number>;
  /** The rule's own text, for `rule`. */
  message?: LocalizedText;
}

export interface FieldValidationResult {
  ok: boolean;
  /** Cleaned, coerced values of the visible fields (hidden and unknown keys are dropped). */
  values: Record<string, FieldAnswer>;
  /**
   * Errors by field key; a table's cells by `<key>.<row index>.<column key>` (`rules.2.port`, the index of the row as
   * given), its row count by `<key>`.
   */
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
    case 'record': {
      const types = f.record?.types ?? [];
      const ok = (x: unknown) =>
        typeof x === 'string' && RECORD_REF_RE.test(x) && types.includes(x.slice(0, x.indexOf(':')));
      if (f.record?.multiple) {
        const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : null;
        if (!list || !list.every(ok)) return { error: { code: 'record' } };
        const unique = [...new Set(list as string[])];
        if (unique.length > MAX_RECORD_VALUES)
          return { error: { code: 'max', params: { max: MAX_RECORD_VALUES } } };
        return { value: unique };
      }
      if (!ok(raw)) return { error: { code: 'record' } };
      return { value: raw as string };
    }
    case 'rows':
      // Tables are checked row by row in `validateFields` (their errors are per cell).
      return { error: { code: 'type' } };
  }
}

const isRowObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** A row whose every column is empty (or an unticked box) is ignored, like an empty field. */
function blankRow(columns: readonly FieldDef[], row: Record<string, unknown>): boolean {
  return columns.every((c) => {
    const v = row[c.key];
    return blank(v) || v === false || (typeof v === 'string' && !v.trim());
  });
}

/** The columns of a table field as they are checked (columns have no conditions). */
export function rowColumns(field: Pick<FieldDef, 'rows'>): FieldDef[] {
  return (field.rows?.fields ?? []).map(({ visibleWhen: _v, ...c }) => c);
}

/**
 * Checks a table: each row against the columns (errors `<key>.<index>.<column>`), then the number of rows that aren't
 * empty against `required`, `rows.min` and `rows.max` (errors on `<key>`).
 */
function checkRows(f: FieldDef, raw: unknown): { value?: FieldRow[]; errors: Record<string, FieldError> } {
  if (!Array.isArray(raw)) return { errors: { [f.key]: { code: 'type' } } };
  const max = Math.min(f.rows?.max ?? MAX_ROWS, MAX_ROWS);
  const columns = rowColumns(f);
  const errors: Record<string, FieldError> = {};
  const rows: FieldRow[] = [];
  raw.forEach((row, i) => {
    if (!isRowObject(row)) {
      errors[`${f.key}.${i}`] = { code: 'type' };
      return;
    }
    if (blankRow(columns, row)) return;
    const r = validateFields(columns, row);
    for (const [k, e] of Object.entries(r.errors)) errors[`${f.key}.${i}.${k}`] = e;
    if (r.ok) rows.push(r.values as FieldRow);
  });
  const count = Object.keys(errors).length
    ? raw.filter((r) => isRowObject(r) && !blankRow(columns, r)).length
    : rows.length;
  if (count > max) return { errors: { [f.key]: { code: 'maxRows', params: { max } } } };
  if (Object.keys(errors).length) return { errors };
  if (!count) return { errors: f.required ? { [f.key]: { code: 'required' } } : {} };
  if (f.rows?.min !== undefined && count < f.rows.min)
    return { errors: { [f.key]: { code: 'minRows', params: { min: f.rows.min } } } };
  return { value: rows, errors };
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
  const values: Record<string, FieldAnswer> = {};
  const errors: Record<string, FieldError> = {};
  for (const f of fields) {
    if (!visible.has(f.key)) continue;
    const raw = input[f.key];
    if (f.type === 'rows' && !blank(raw)) {
      const res = checkRows(f, raw);
      Object.assign(errors, res.errors);
      if (res.value) values[f.key] = res.value;
      continue;
    }
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

/** Error key of a rule that names no field: shown above the form. */
export const FORM_ERROR_KEY = '_form';

/**
 * Validates a whole form: its fields (`validateFields`), then its rules against the cleaned values. A failed rule
 * puts a `rule` error (with the rule's message) on each of its visible fields that has no error yet, or on `_form`
 * when it names none (or only hidden ones). Rules may also read the reserved `today` fact (`YYYY-MM-DD`, UTC unless
 * `opts.today` says otherwise), e.g. "the planned start is today or later".
 */
export function validateForm(
  schema: FormSchema,
  input: Record<string, unknown>,
  opts: { today?: string } = {},
): FieldValidationResult {
  const fields = formFields(schema);
  const result = validateFields(fields, input);
  if (!result.ok) return result;
  const visible = visibleFieldKeys(fields, input);
  const facts = { [TODAY_FACT]: opts.today ?? todayFact(), ...result.values };
  const errors: Record<string, FieldError> = {};
  for (const rule of schema.rules ?? []) {
    if (!evaluateCondition(rule.when, facts) || evaluateCondition(rule.require, facts)) continue;
    const error: FieldError = { code: 'rule', message: rule.message };
    const shown = (rule.fields ?? []).filter((k) => visible.has(k));
    const keys = shown.length ? shown : [FORM_ERROR_KEY];
    for (const k of keys) errors[k] ??= error;
  }
  return { ok: Object.keys(errors).length === 0, values: result.values, errors };
}

/** Initial values for a form or entity editor (defaults filled in). */
export function defaultFieldValues(fields: readonly FieldDef[], existing: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === 'rows') {
      const rows = existing[f.key];
      // A required table starts with its minimum number of empty rows (at least one).
      out[f.key] = Array.isArray(rows)
        ? rows
        : Array.from({ length: Math.max(f.rows?.min ?? 0, f.required ? 1 : 0) }, () => emptyRow(f));
      continue;
    }
    const v = existing[f.key] ?? f.defaultValue;
    out[f.key] =
      v ??
      (f.type === 'multiselect' || (f.type === 'record' && f.record?.multiple)
        ? []
        : f.type === 'boolean'
          ? false
          : '');
  }
  return out;
}

/** A new, empty row of a table field (its columns' defaults). */
export function emptyRow(field: Pick<FieldDef, 'rows'>): Record<string, unknown> {
  return defaultFieldValues(rowColumns(field));
}

/**
 * Every field with each table cell as a field of its own, keyed `<key>.<row index>.<column key>`, and the values under
 * the same keys: what server-side checks of people and picked records go through, so a cell's error lands on the
 * cell.
 */
export function expandRowFields(
  fields: readonly FieldDef[],
  values: Record<string, unknown>,
): { fields: FieldDef[]; values: Record<string, unknown> } {
  const outFields: FieldDef[] = [];
  const outValues: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type !== 'rows') {
      outFields.push(f);
      if (f.key in values) outValues[f.key] = values[f.key];
      continue;
    }
    const rows = values[f.key];
    if (!Array.isArray(rows)) continue;
    const columns = rowColumns(f);
    rows.forEach((row, i) => {
      if (!isRowObject(row)) return;
      for (const c of columns) {
        const key = `${f.key}.${i}.${c.key}`;
        outFields.push({ ...c, key });
        if (c.key in row) outValues[key] = row[c.key];
      }
    });
  }
  return { fields: outFields, values: outValues };
}

/** Field keys that a condition references but that don't exist (builder warnings). */
export function unknownConditionFacts(
  fields: readonly FieldDef[],
  condition: Condition | undefined,
): string[] {
  const keys = new Set(fields.map((f) => f.key));
  return conditionFacts(condition).filter((k) => !keys.has(k.split('.')[0]!) && !RESERVED_FACTS.includes(k));
}
