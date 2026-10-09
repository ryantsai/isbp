'use client';

import {
  type FieldDef,
  type FieldError,
  FORM_ERROR_KEY,
  type FormElement,
  type FormSchema,
  isField,
  localize,
  validateFields,
  validateForm,
  visibleElements,
} from '@isbp/sdk';
import { CircleAlertIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useMemo } from 'react';
import {
  type FieldErrors,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
  useFormState,
  useWatch,
} from 'react-hook-form';
import { cn } from '../lib/utils';
import { Checkbox } from './checkbox';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from './form';
import { Input } from './input';
import { useReducedMotion } from './motion';
import { type PersonOption, PersonPicker, usePeople } from './person-picker';
import { RecordPicker, RecordValues, recordRefs } from './record-picker';
import { RowsControl, RowsTable } from './rows-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Separator } from './separator';
import { Textarea } from './textarea';

/**
 * Translates a field error code (`required`, `tooShort`, …) with its parameters; a form rule's error (`rule`) shows
 * the rule's own message in the reader's language.
 */
export function useFieldErrorText() {
  const t = useTranslations('ui.fieldErrors');
  const locale = useLocale();
  return useCallback(
    (e: FieldError) =>
      e.code === 'rule' ? localize(e.message, locale) || t('rule') : t(e.code, e.params ?? {}),
    [t, locale],
  );
}

/**
 * Field errors as React Hook Form keeps them: a table's cell errors (`rules.2.port`) nested under the table's key
 * (`rules[2].port`), so revalidating the table clears them together.
 */
function rhfErrors(errors: Record<string, FieldError>, text: (e: FieldError) => string) {
  const out: Record<string, unknown> = {};
  for (const [key, e] of Object.entries(errors)) {
    const entry = { type: e.code, message: text(e) };
    const parts = key.split('.');
    let cur = out;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        cur[part] = entry;
        return;
      }
      const next = cur[part];
      if (!next || typeof next !== 'object' || 'message' in next)
        cur[part] = /^\d+$/.test(parts[i + 1]!) ? [] : {};
      cur = cur[part] as Record<string, unknown>;
    });
  }
  return out;
}

/**
 * The error message at a path (`attributes.rules.2.port`) whether React Hook Form keeps it nested (`rules[2].port`, from
 * the resolvers and `setError`) or under a flat key (`attributes['rules.2.port']`, from custom-field refinements).
 */
function errorMessageAt(errors: unknown, path: readonly string[]): string | undefined {
  if (!errors || typeof errors !== 'object') return undefined;
  const here = errors as Record<string, unknown>;
  if (!path.length) {
    const m = (here as { message?: unknown }).message;
    return typeof m === 'string' && m ? m : undefined;
  }
  const flat = here[path.join('.')];
  if (flat && typeof flat === 'object' && typeof (flat as { message?: unknown }).message === 'string')
    return (flat as { message: string }).message || undefined;
  return errorMessageAt(here[path[0]!], path.slice(1));
}

/**
 * React Hook Form resolver for admin-defined fields: the same `validateFields` the API runs, so the
 * browser and the server agree; hidden (conditional) fields are dropped before submit.
 */
export function useFieldsResolver(fields: readonly FieldDef[]): Resolver<FieldValues> {
  const text = useFieldErrorText();
  return useCallback(
    async (values: FieldValues) => {
      const r = validateFields(fields, values);
      if (r.ok) return { values: r.values, errors: {} };
      return { values: {}, errors: rhfErrors(r.errors, text) as FieldErrors };
    },
    [fields, text],
  );
}

/**
 * React Hook Form resolver for a whole form: `validateForm` (fields, then the form's rules), as the API runs it.
 * Rules that name no visible field report under `_form`; show them with {@link FormErrorSummary}.
 */
export function useFormResolver(schema: FormSchema): Resolver<FieldValues> {
  const text = useFieldErrorText();
  return useCallback(
    async (values: FieldValues) => {
      const r = validateForm(schema, values);
      if (r.ok) return { values: r.values, errors: {} };
      return { values: {}, errors: rhfErrors(r.errors, text) as FieldErrors };
    },
    [schema, text],
  );
}

/**
 * Form-level errors (rules that name no field) above the form, as an alert. After a submit attempt it follows the
 * answers live; before, it shows what the server reported (`form.setError('_form', …)`).
 */
export function FormErrorSummary({
  schema,
  form,
  className,
}: {
  schema: FormSchema;
  form: UseFormReturn<FieldValues>;
  className?: string;
}) {
  const t = useTranslations('ui.formErrors');
  const text = useFieldErrorText();
  const values = useWatch({ control: form.control }) as Record<string, unknown> | undefined;
  const { submitCount, errors } = useFormState({ control: form.control });
  const live = submitCount > 0 ? validateForm(schema, values ?? {}).errors[FORM_ERROR_KEY] : undefined;
  const message = live ? text(live) : (errors[FORM_ERROR_KEY]?.message as string | undefined);
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        'flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm',
        className,
      )}
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="grid gap-0.5">
        <p className="font-medium text-destructive">{t('title')}</p>
        <p>{message}</p>
      </div>
    </div>
  );
}

/** Adds custom-field errors to a Zod/RHF form whose custom values live under `prefix` (e.g. `attributes`). */
export function useFieldsRefinement(fields: readonly FieldDef[], prefix: string) {
  const text = useFieldErrorText();
  return useCallback(
    (values: Record<string, unknown>) => {
      const r = validateFields(fields, values ?? {});
      return Object.entries(r.errors).map(([k, e]) => ({ path: `${prefix}.${k}`, message: text(e) }));
    },
    [fields, prefix, text],
  );
}

function OptionSelect({
  field,
  value,
  onChange,
  locale,
  ...aria
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: string) => void;
  locale: string;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const t = useTranslations('ui.select');
  return (
    <Select value={typeof value === 'string' && value ? value : undefined} onValueChange={onChange}>
      <SelectTrigger className="w-full" {...aria}>
        <SelectValue placeholder={localize(field.placeholder, locale) || t('placeholder')} />
      </SelectTrigger>
      <SelectContent>
        {(field.options ?? []).map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {localize(o.label, locale) || o.value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MultiCheck({
  field,
  value,
  onChange,
  locale,
  id,
  invalid,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: string[]) => void;
  locale: string;
  id?: string;
  invalid?: boolean;
}) {
  const list = Array.isArray(value) ? (value as string[]) : [];
  return (
    <div id={id} role="group" className="flex flex-wrap gap-2">
      {(field.options ?? []).map((o) => {
        const checked = list.includes(o.value);
        return (
          <label
            key={o.value}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
              checked ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/60',
            )}
          >
            <Checkbox
              checked={checked}
              aria-invalid={invalid || undefined}
              onCheckedChange={(c) => onChange(c ? [...list, o.value] : list.filter((x) => x !== o.value))}
            />
            {localize(o.label, locale) || o.value}
          </label>
        );
      })}
    </div>
  );
}

function PersonValue({
  value,
  onChange,
  ...rest
}: {
  value: unknown;
  onChange: (id: string | null) => void;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
}) {
  const id = typeof value === 'string' && value ? value : null;
  const people = usePeople([id]);
  const picked: PersonOption | null = id ? (people.get(id) ?? { id, displayName: '…' }) : null;
  return <PersonPicker value={picked} onChange={(p) => onChange(p?.id ?? null)} {...rest} />;
}

/** The input control for one field type. */
export function FieldControl({
  field,
  value,
  onChange,
  locale,
  disabled,
  cellError,
  ...aria
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  locale: string;
  disabled?: boolean;
  /** A table field's cell errors (`row`, column key). */
  cellError?: (row: number, key: string) => string | undefined;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const placeholder = localize(field.placeholder, locale) || undefined;
  const str = value === null || value === undefined ? '' : String(value);
  switch (field.type) {
    case 'rows':
      return (
        <RowsControl
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
          id={aria.id}
          invalid={aria['aria-invalid']}
          describedBy={aria['aria-describedby']}
          cellError={cellError}
          renderCell={(column, cell, set, props) => (
            <FieldControl
              field={column}
              value={cell}
              onChange={set}
              locale={locale}
              disabled={disabled}
              {...props}
            />
          )}
        />
      );
    case 'textarea':
      return (
        <Textarea
          {...aria}
          disabled={disabled}
          placeholder={placeholder}
          rows={4}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <Input
          {...aria}
          disabled={disabled}
          type="number"
          inputMode="decimal"
          placeholder={placeholder}
          min={field.validation?.min}
          max={field.validation?.max}
          value={str}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    case 'boolean':
      return (
        <div className="flex h-9 items-center">
          <Checkbox
            {...aria}
            disabled={disabled}
            checked={value === true}
            onCheckedChange={(c) => onChange(c === true)}
          />
        </div>
      );
    case 'date':
      return (
        <Input
          {...aria}
          disabled={disabled}
          type="date"
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'select':
      return <OptionSelect field={field} value={value} onChange={onChange} locale={locale} {...aria} />;
    case 'multiselect':
      return (
        <MultiCheck
          field={field}
          value={value}
          onChange={onChange}
          locale={locale}
          id={aria.id}
          invalid={aria['aria-invalid']}
        />
      );
    case 'user':
      return (
        <PersonValue
          value={value}
          onChange={onChange}
          id={aria.id}
          invalid={aria['aria-invalid']}
          disabled={disabled}
          aria-describedby={aria['aria-describedby']}
        />
      );
    case 'record': {
      const multiple = Boolean(field.record?.multiple);
      return (
        <RecordPicker
          value={recordRefs(value)}
          onChange={(refs) => onChange(multiple ? refs : (refs[0] ?? ''))}
          types={field.record?.types ?? []}
          multiple={multiple}
          where={field.record?.where}
          placeholder={placeholder}
          id={aria.id}
          invalid={aria['aria-invalid']}
          disabled={disabled}
          aria-describedby={aria['aria-describedby']}
        />
      );
    }
    default:
      return (
        <Input
          {...aria}
          disabled={disabled}
          type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}
          placeholder={placeholder}
          maxLength={field.validation?.maxLength}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

const reveal = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.18, ease: 'easeOut' },
} as const;

/**
 * Renders admin-defined form elements bound to a React Hook Form instance. Conditional fields slide
 * in and out as the answers change. `namePrefix` nests values (e.g. `attributes` on an entity form).
 */
export function FormFields({
  elements,
  form,
  namePrefix,
  disabled,
  className,
}: {
  elements: readonly FormElement[];
  form: UseFormReturn<FieldValues>;
  namePrefix?: string;
  disabled?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  const all = useWatch({ control: form.control }) as Record<string, unknown> | undefined;
  const { errors } = useFormState({ control: form.control });
  const watched = namePrefix ? all?.[namePrefix] : all;
  const values = useMemo(() => (watched ?? {}) as Record<string, unknown>, [watched]);
  const visible = visibleElements({ elements: [...elements] }, values);
  const name = (key: string) => (namePrefix ? `${namePrefix}.${key}` : key);
  const reduce = useReducedMotion();

  return (
    <div className={cn('grid gap-x-4 sm:grid-cols-2', className)}>
      <AnimatePresence initial={false}>
        {visible.map((el) => {
          const span = !isField(el) || el.width !== 'half' ? 'sm:col-span-2' : '';
          return (
            <motion.div
              key={el.id}
              {...reveal}
              transition={reduce ? { duration: 0 } : reveal.transition}
              className={cn('overflow-hidden', span)}
            >
              <div className="pb-4">
                {isField(el) ? (
                  <FormField
                    control={form.control}
                    name={name(el.key)}
                    render={({ field }) =>
                      el.type === 'boolean' ? (
                        // A yes/no field is one row: [✓] Label, the label part of the click target.
                        <FormItem className="gap-1.5">
                          <div className="flex items-start gap-2.5">
                            <FormControl>
                              <Checkbox
                                disabled={disabled}
                                checked={field.value === true}
                                onCheckedChange={(c) => field.onChange(c === true)}
                                className="mt-0.5"
                              />
                            </FormControl>
                            <FormLabel className="leading-snug font-normal">
                              {localize(el.label, locale)}
                              {el.required && (
                                <span aria-hidden className="text-destructive">
                                  *
                                </span>
                              )}
                            </FormLabel>
                          </div>
                          {el.help && (
                            <FormDescription className="pl-6.5">{localize(el.help, locale)}</FormDescription>
                          )}
                          <FormMessage className="pl-6.5" />
                        </FormItem>
                      ) : (
                        <FormItem>
                          <FormLabel>
                            {localize(el.label, locale)}
                            {el.required && (
                              <span aria-hidden className="text-destructive">
                                *
                              </span>
                            )}
                          </FormLabel>
                          <FormControl>
                            <FieldControl
                              field={el}
                              value={field.value}
                              onChange={field.onChange}
                              locale={locale}
                              disabled={disabled}
                              cellError={
                                el.type === 'rows'
                                  ? (row, key) =>
                                      errorMessageAt(errors, [...name(el.key).split('.'), String(row), key])
                                  : undefined
                              }
                            />
                          </FormControl>
                          {el.help && <FormDescription>{localize(el.help, locale)}</FormDescription>}
                          <FormMessage />
                        </FormItem>
                      )
                    }
                  />
                ) : el.type === 'heading' ? (
                  <h3 className="pt-2 text-base font-semibold">{localize(el.text, locale)}</h3>
                ) : el.type === 'paragraph' ? (
                  <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                    {localize(el.text, locale)}
                  </p>
                ) : (
                  <Separator className="my-2" />
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** Display text of a stored value (options localized, booleans as yes/no, people by name). */
export function useFieldValueText() {
  const locale = useLocale();
  const t = useTranslations('ui.boolean');
  return useCallback(
    (
      field: FieldDef,
      value: unknown,
      people?: ReadonlyMap<string, { displayName: string }> | Record<string, string>,
    ): ReactNode => {
      // Tables show each cell with the same text as a field of its type.
      const show = (f: FieldDef, v: unknown): ReactNode => valueText(f, v, people, locale, t, show);
      return show(field, value);
    },
    [locale, t],
  );
}

function valueText(
  field: FieldDef,
  value: unknown,
  people: ReadonlyMap<string, { displayName: string }> | Record<string, string> | undefined,
  locale: string,
  t: (key: 'yes' | 'no') => string,
  show: (f: FieldDef, v: unknown) => ReactNode,
): ReactNode {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length))
    return null;
  const label = (v: string) => localize(field.options?.find((o) => o.value === v)?.label, locale) || v;
  switch (field.type) {
    case 'rows':
      return <RowsTable field={field} value={value} cellText={show} />;
    case 'boolean':
      return value ? t('yes') : t('no');
    case 'select':
      return label(String(value));
    case 'multiselect':
      return (value as string[]).map(label).join(', ');
    case 'record':
      return <RecordValues refs={recordRefs(value)} />;
    case 'user': {
      const id = String(value);
      if (!people) return id;
      return people instanceof Map
        ? (people.get(id)?.displayName ?? id)
        : ((people as Record<string, string>)[id] ?? id);
    }
    case 'url':
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline-offset-2 hover:underline"
        >
          {String(value)}
        </a>
      );
    case 'date':
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(`${String(value)}T00:00:00Z`),
      );
    case 'number':
      return new Intl.NumberFormat(locale).format(Number(value));
    default:
      return String(value);
  }
}

/** Read-only answers of a submission (or an entity's custom fields), visible fields only. */
export function FormAnswers({
  elements,
  data,
  people,
  emptyText,
  className,
}: {
  elements: readonly FormElement[];
  data: Record<string, unknown>;
  people?: Record<string, string>;
  emptyText?: string;
  className?: string;
}) {
  const locale = useLocale();
  const text = useFieldValueText();
  const visible = visibleElements({ elements: [...elements] }, data).filter(isField);
  return (
    <dl className={cn('grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2', className)}>
      {visible.map((f) => {
        const value = text(f, data[f.key], people);
        return (
          <div
            key={f.id}
            className={cn('min-w-0', (f.type === 'textarea' || f.type === 'rows') && 'sm:col-span-2')}
          >
            <dt className="text-xs font-medium text-muted-foreground">{localize(f.label, locale)}</dt>
            <dd
              className={cn(
                'mt-0.5 break-words',
                f.type === 'textarea' && 'whitespace-pre-line',
                value === null && 'text-muted-foreground',
              )}
            >
              {value ?? emptyText ?? '—'}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
