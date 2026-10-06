'use client';

import {
  type FieldDef,
  type FieldError,
  type FormElement,
  isField,
  localize,
  validateFields,
  visibleElements,
} from '@isbp/sdk';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useMemo } from 'react';
import { type FieldValues, type Resolver, type UseFormReturn, useWatch } from 'react-hook-form';
import { cn } from '../lib/utils';
import { Checkbox } from './checkbox';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from './form';
import { Input } from './input';
import { type PersonOption, PersonPicker, usePeople } from './person-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Separator } from './separator';
import { Textarea } from './textarea';

/** Translates a field error code (`required`, `tooShort`, …) with its parameters. */
export function useFieldErrorText() {
  const t = useTranslations('ui.fieldErrors');
  return useCallback((e: FieldError) => t(e.code, e.params ?? {}), [t]);
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
      return {
        values: {},
        errors: Object.fromEntries(
          Object.entries(r.errors).map(([k, e]) => [k, { type: e.code, message: text(e) }]),
        ),
      };
    },
    [fields, text],
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
  ...aria
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  locale: string;
  disabled?: boolean;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const placeholder = localize(field.placeholder, locale) || undefined;
  const str = value === null || value === undefined ? '' : String(value);
  switch (field.type) {
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
  const watched = namePrefix ? all?.[namePrefix] : all;
  const values = useMemo(() => (watched ?? {}) as Record<string, unknown>, [watched]);
  const visible = visibleElements({ elements: [...elements] }, values);
  const name = (key: string) => (namePrefix ? `${namePrefix}.${key}` : key);

  return (
    <div className={cn('grid gap-x-4 sm:grid-cols-2', className)}>
      <AnimatePresence initial={false}>
        {visible.map((el) => {
          const span = !isField(el) || el.width !== 'half' ? 'sm:col-span-2' : '';
          return (
            <motion.div key={el.id} {...reveal} className={cn('overflow-hidden', span)}>
              <div className="pb-4">
                {isField(el) ? (
                  <FormField
                    control={form.control}
                    name={name(el.key)}
                    render={({ field }) => (
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
                          />
                        </FormControl>
                        {el.help && <FormDescription>{localize(el.help, locale)}</FormDescription>}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : el.type === 'heading' ? (
                  <h3 className="pt-2 text-base font-semibold">{localize(el.text, locale)}</h3>
                ) : el.type === 'paragraph' ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">{localize(el.text, locale)}</p>
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
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length))
        return null;
      const label = (v: string) => localize(field.options?.find((o) => o.value === v)?.label, locale) || v;
      switch (field.type) {
        case 'boolean':
          return value ? t('yes') : t('no');
        case 'select':
          return label(String(value));
        case 'multiselect':
          return (value as string[]).map(label).join(', ');
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
    },
    [locale, t],
  );
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
          <div key={f.id} className={cn('min-w-0', f.type === 'textarea' && 'sm:col-span-2')}>
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
