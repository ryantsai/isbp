import {
  type Condition,
  conditionFacts,
  type DisplayElement,
  type DisplayType,
  FIELD_KEY_RE,
  type FieldDef,
  type FieldType,
  type FieldValidation,
  type FormElement,
  isField,
  isSafePattern,
  type LocalizedText,
  localize,
  RESERVED_FACTS,
  TODAY_FACT,
  validateFields,
} from '@isbp/sdk';
import type { FactOption } from '@isbp/ui/condition-builder';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

/** Anything the field editor can edit: a field (custom field or form field) or a display element. */
export type EditableElement = (FieldDef & { id?: string }) | DisplayElement;

export const CHOICE_TYPES: readonly FieldType[] = ['select', 'multiselect'];
export const PLACEHOLDER_TYPES: readonly FieldType[] = [
  'text',
  'textarea',
  'number',
  'email',
  'url',
  'select',
];
export const LENGTH_TYPES: readonly FieldType[] = ['text', 'textarea', 'email', 'url'];

export function isFieldElement(el: EditableElement): el is FieldDef & { id?: string } {
  return isField(el as FormElement);
}

/** True when a localized text has at least one language filled in. */
export function hasText(text: LocalizedText | null | undefined): boolean {
  return Boolean(text && Object.values(text).some((v) => typeof v === 'string' && v.trim()));
}

/** "Estimated cost (USD)" → "estimatedCostUsd" (empty for text without latin letters or digits). */
export function slugKey(text: string | null | undefined): string {
  const words = (text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  const key = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
    .slice(0, 48);
  return /^[a-z]/.test(key) ? key : `f${key}`.slice(0, 48);
}

/** "Taipei HQ" → "taipei-hq" (stored option value). */
export function slugValue(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** `base`, or `base2`, `base3`… when taken. */
export function uniqueName(base: string, taken: ReadonlySet<string>, sep = ''): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}${sep}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const DEFAULT_KEY_RE =
  /^(?:text|textarea|number|boolean|date|select|multiselect|email|url|user|record|rows|column|field)\d*$/;
const DEFAULT_VALUE_RE = /^option-?\d+$/;

/** Whether the key still follows the label (so editing the English label may rename it). */
export function isAutoKey(field: Pick<FieldDef, 'key' | 'label'>): boolean {
  const slug = slugKey(field.label?.en);
  if (DEFAULT_KEY_RE.test(field.key)) return true;
  if (!slug) return false;
  return field.key === slug || field.key.replace(/\d+$/, '') === slug;
}

export function isAutoValue(value: string, label: LocalizedText | undefined): boolean {
  if (!value || DEFAULT_VALUE_RE.test(value)) return true;
  const slug = slugValue(label?.en);
  return Boolean(slug) && (value === slug || value.replace(/-\d+$/, '') === slug);
}

/** A new column for a table field, with a key no other column has. */
export function newRowColumn(type: FieldType, columns: readonly FieldDef[], label: LocalizedText): FieldDef {
  const taken = new Set(columns.map((c) => c.key));
  return { key: uniqueName(slugKey(label.en) || 'column', taken), type, label };
}

/** A short random id for new form elements (stable once created). */
export function newElementId(prefix = 'el'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Validation keys that apply to a field type. */
export function validationFor(type: FieldType, v: FieldValidation | undefined): FieldValidation | undefined {
  if (!v) return undefined;
  const out: FieldValidation = {};
  if (type === 'number' || type === 'multiselect') {
    if (v.min !== undefined) out.min = v.min;
    if (v.max !== undefined) out.max = v.max;
  }
  if (LENGTH_TYPES.includes(type)) {
    if (v.minLength !== undefined) out.minLength = v.minLength;
    if (v.maxLength !== undefined) out.maxLength = v.maxLength;
  }
  if (type === 'text' && v.pattern) out.pattern = v.pattern;
  return Object.keys(out).length ? out : undefined;
}

/** Removes empty optional parts so drafts stay small and compare cleanly. */
export function cleanField<T extends FieldDef>(field: T): T {
  const out = { ...field };
  if (!hasText(out.help)) delete out.help;
  if (!hasText(out.placeholder) || !PLACEHOLDER_TYPES.includes(out.type)) delete out.placeholder;
  if (!out.required) delete out.required;
  if (!CHOICE_TYPES.includes(out.type)) delete out.options;
  if (out.type !== 'rows') delete out.rows;
  else {
    // Columns are plain fields without conditions or layout.
    const rows: NonNullable<FieldDef['rows']> = {
      fields: (out.rows?.fields ?? []).map((c) => {
        const { visibleWhen: _v, width: _w, rows: _r, ...col } = cleanField(c);
        return col;
      }),
    };
    if (out.rows?.min !== undefined) rows.min = out.rows.min;
    if (out.rows?.max !== undefined) rows.max = out.rows.max;
    out.rows = rows;
  }
  if (out.type !== 'record') delete out.record;
  else {
    const record: NonNullable<FieldDef['record']> = { types: out.record?.types ?? [] };
    if (out.record?.multiple) record.multiple = true;
    if (out.record?.where) record.where = out.record.where;
    out.record = record;
  }
  const validation = validationFor(out.type, out.validation);
  if (validation) out.validation = validation;
  else delete out.validation;
  if (
    out.defaultValue === undefined ||
    out.defaultValue === null ||
    out.defaultValue === '' ||
    (Array.isArray(out.defaultValue) && !out.defaultValue.length) ||
    out.type === 'user' ||
    out.type === 'record' ||
    out.type === 'rows'
  )
    delete out.defaultValue;
  if (!out.visibleWhen) delete out.visibleWhen;
  if (out.width !== 'half') delete out.width;
  return out;
}

export function cleanElement<T extends EditableElement>(el: T): T {
  if (isFieldElement(el)) return cleanField(el) as T;
  const out = { ...el } as DisplayElement;
  if (out.type === 'divider' || !hasText(out.text)) delete out.text;
  if (!out.visibleWhen) delete out.visibleWhen;
  return out as T;
}

/** Changing the type keeps the shared parts (label, key, logic) and resets type-specific ones. */
export function changeFieldType<T extends FieldDef>(
  field: T,
  type: FieldType,
  defaultOptions: () => FieldDef['options'],
): T {
  const next = { ...field, type } as T;
  if (CHOICE_TYPES.includes(type)) next.options = field.options?.length ? field.options : defaultOptions();
  else delete next.options;
  if (type === 'record') next.record = field.record ?? { types: [] };
  if (type === 'rows')
    next.rows = field.rows?.fields.length ? field.rows : { fields: [newRowColumn('text', [], field.label)] };
  next.validation = validationFor(type, field.validation);
  delete next.defaultValue;
  return cleanField(next);
}

/* ───────────────────────────── issues ───────────────────────────── */

export type FieldIssueCode =
  | 'labelRequired'
  | 'keyInvalid'
  | 'keyDuplicate'
  | 'optionsRequired'
  | 'optionValueRequired'
  | 'optionValuesDuplicate'
  | 'optionLabelRequired'
  | 'rangeInvalid'
  | 'lengthInvalid'
  | 'patternInvalid'
  | 'defaultInvalid'
  | 'conditionSelf'
  | 'conditionUnknown'
  | 'textRequired'
  | 'recordTypesRequired'
  | 'columnsRequired'
  | 'columnInvalid'
  | 'rowsRangeInvalid';

export type IssueTarget =
  | 'label'
  | 'key'
  | 'options'
  | 'validation'
  | 'pattern'
  | 'defaultValue'
  | 'visibleWhen'
  | 'text'
  | 'record'
  | 'rows';

export interface FieldIssue {
  code: FieldIssueCode;
  target: IssueTarget;
  params?: Record<string, string>;
}

const TEXT_DISPLAY: readonly DisplayType[] = ['heading', 'paragraph'];

/**
 * Problems that would stop the element from saving (the API runs the same schema), phrased as codes
 * the editor translates. `siblings` are the other fields the element can refer to.
 */
export function elementIssues(el: EditableElement, siblings: readonly FieldDef[]): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const siblingKeys = new Set(siblings.map((f) => f.key));
  if (!isFieldElement(el)) {
    if (TEXT_DISPLAY.includes(el.type) && !hasText(el.text))
      issues.push({ code: 'textRequired', target: 'text' });
    if (
      conditionFacts(el.visibleWhen).some(
        (k) => !RESERVED_FACTS.includes(k) && !siblingKeys.has(k.split('.')[0] ?? ''),
      )
    )
      issues.push({ code: 'conditionUnknown', target: 'visibleWhen' });
    return issues;
  }
  if (!hasText(el.label)) issues.push({ code: 'labelRequired', target: 'label' });
  if (!FIELD_KEY_RE.test(el.key)) issues.push({ code: 'keyInvalid', target: 'key' });
  else if (siblingKeys.has(el.key))
    issues.push({ code: 'keyDuplicate', target: 'key', params: { key: el.key } });
  if (CHOICE_TYPES.includes(el.type)) {
    const options = el.options ?? [];
    const values = options.map((o) => o.value.trim());
    if (!options.length) issues.push({ code: 'optionsRequired', target: 'options' });
    else if (values.some((v) => !v)) issues.push({ code: 'optionValueRequired', target: 'options' });
    else if (new Set(values).size !== values.length)
      issues.push({ code: 'optionValuesDuplicate', target: 'options' });
    if (options.some((o) => !hasText(o.label)))
      issues.push({ code: 'optionLabelRequired', target: 'options' });
  }
  if (el.type === 'record' && !el.record?.types.length)
    issues.push({ code: 'recordTypesRequired', target: 'record' });
  if (el.type === 'rows') {
    const columns = el.rows?.fields ?? [];
    if (!columns.length) issues.push({ code: 'columnsRequired', target: 'rows' });
    columns.forEach((c) => {
      if (
        elementIssues(
          c,
          columns.filter((o) => o !== c),
        ).length
      )
        issues.push({ code: 'columnInvalid', target: 'rows', params: { column: c.key } });
    });
    const r = el.rows;
    if (r?.min !== undefined && r.max !== undefined && r.min > r.max)
      issues.push({ code: 'rowsRangeInvalid', target: 'rows' });
  }
  const v = el.validation;
  if (v?.min !== undefined && v.max !== undefined && v.min > v.max)
    issues.push({ code: 'rangeInvalid', target: 'validation' });
  if (v?.minLength !== undefined && v.maxLength !== undefined && v.minLength > v.maxLength)
    issues.push({ code: 'lengthInvalid', target: 'validation' });
  if (v?.pattern && !isSafePattern(v.pattern)) issues.push({ code: 'patternInvalid', target: 'pattern' });
  const dv = el.defaultValue;
  if (
    el.type !== 'user' &&
    el.type !== 'record' &&
    el.type !== 'rows' &&
    dv !== undefined &&
    dv !== null &&
    dv !== '' &&
    !(Array.isArray(dv) && !dv.length) &&
    FIELD_KEY_RE.test(el.key)
  ) {
    const probe = { ...el, required: false, visibleWhen: undefined };
    if (!validateFields([probe], { [el.key]: dv }).ok)
      issues.push({ code: 'defaultInvalid', target: 'defaultValue' });
  }
  const facts = conditionFacts(el.visibleWhen)
    .filter((k) => !RESERVED_FACTS.includes(k))
    .map((k) => k.split('.')[0] ?? '');
  if (facts.includes(el.key)) issues.push({ code: 'conditionSelf', target: 'visibleWhen' });
  else if (facts.some((k) => !siblingKeys.has(k)))
    issues.push({ code: 'conditionUnknown', target: 'visibleWhen' });
  return issues;
}

/** Issues for every element of a form, keyed by element id. */
export function formIssues(elements: readonly FormElement[]): Map<string, FieldIssue[]> {
  const fields = elements.filter(isField);
  const out = new Map<string, FieldIssue[]>();
  for (const el of elements) {
    const siblings = fields.filter((f) => f.id !== el.id);
    const list = elementIssues(el, siblings);
    if (list.length) out.set(el.id, list);
  }
  return out;
}

/* ───────────────────────────── conditions ───────────────────────────── */

/** Other fields as condition facts (labels in the viewer's language, options localized). */
export function fieldFacts(fields: readonly FieldDef[], locale: string): FactOption[] {
  return fields
    .filter((f) => FIELD_KEY_RE.test(f.key))
    .flatMap((f) => [f, ...tableColumnFacts(f, locale)])
    .map((f) => {
      const label = localize(f.label, locale) || f.key;
      const options = f.options?.map((o) => ({
        value: o.value,
        label: localize(o.label, locale) || o.value,
      }));
      switch (f.type) {
        case 'number':
          return { path: f.key, label, type: 'number' };
        case 'boolean':
          return { path: f.key, label, type: 'boolean' };
        case 'date':
          return { path: f.key, label, type: 'date' };
        case 'multiselect':
          return { path: f.key, label, type: 'list', options };
        case 'select':
          return { path: f.key, label, type: 'string', options };
        case 'user':
          return { path: f.key, label, type: 'id' };
        case 'record':
          return { path: f.key, label, type: f.record?.multiple ? 'list' : 'string' };
        case 'rows':
          return { path: f.key, label, type: 'list' };
        default:
          return { path: f.key, label, type: 'string' };
      }
    });
}

/**
 * How many conditions lack what they compare with: no field, or no value (and no other field) for an operator that
 * needs one. Such a condition never holds as the admin meant ("End is after …"), so builders refuse to save it.
 */
export function incompleteConditions(condition: Condition | null | undefined): number {
  if (!condition) return 0;
  if ('all' in condition) return condition.all.reduce((n, c) => n + incompleteConditions(c), 0);
  if ('any' in condition) return condition.any.reduce((n, c) => n + incompleteConditions(c), 0);
  if ('not' in condition) return incompleteConditions(condition.not);
  if (!condition.fact) return 1;
  if (condition.op === 'empty' || condition.op === 'notEmpty' || condition.valueFact) return 0;
  const v = condition.value;
  return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? 1 : 0;
}

/** The reserved `today` fact (`YYYY-MM-DD`, UTC) for date conditions: "the planned start is today or later". */
export function useTodayFact(): FactOption {
  const t = useTranslations('ui.conditions');
  const label = t('today');
  return useMemo(() => ({ path: TODAY_FACT, label, type: 'date' as const }), [label]);
}

/**
 * A table's columns as facts `<table>.<column>` ("Firewall rules › Port"): a column read across all rows, so a
 * condition matches when any row does.
 */
export function tableColumnFacts(field: FieldDef, locale: string): FieldDef[] {
  if (field.type !== 'rows') return [];
  const table = localize(field.label, locale) || field.key;
  return (field.rows?.fields ?? [])
    .filter((c) => FIELD_KEY_RE.test(c.key))
    .map((c) => ({
      ...c,
      key: `${field.key}.${c.key}`,
      label: { [locale]: `${table} › ${localize(c.label, locale) || c.key}` },
    }));
}

/** Stable JSON (sorted keys) for dirty checks. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}
