'use client';

import { Banner } from '@astryxdesign/core/Banner';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Divider } from '@astryxdesign/core/Divider';
import { Field } from '@astryxdesign/core/Field';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { MultiSelector } from '@astryxdesign/core/MultiSelector';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
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
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useId, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  type FieldErrors,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
  useFormState,
  useWatch,
} from 'react-hook-form';
import { useInputAttrs } from '../lib/input-attrs';
import { cn } from '../lib/utils';
import { FormField } from './form';
import { useReducedMotion } from './motion';
import { type PersonOption, PersonPicker, usePeople } from './person-picker';
import { RecordPicker, RecordValues, recordRefs } from './record-picker';
import { RowsControl, RowsTable } from './rows-field';

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
    <Banner
      status="error"
      title={t('title')}
      description={message}
      collapsible={false}
      className={className}
    />
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

/** Puts a caller's `id` / `aria-describedby` on the real input of an Astryx field (see `useInputAttrs`). */
function WithInputAttrs({
  id,
  describedBy,
  children,
}: {
  id?: string;
  describedBy?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useInputAttrs(root, { id, describedBy });
  return (
    <div ref={root} className="contents">
      {children}
    </div>
  );
}

interface FieldInputProps {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  locale: string;
  disabled?: boolean;
  /** A table field's cell errors (`row`, column key). */
  cellError?: (row: number, key: string) => string | undefined;
  /** Draw the label, hint and required marker (a form field), or only name the control (a table cell). */
  framed?: boolean;
  /** The hint under the label (framed). */
  help?: string;
  /** The error text, in the field's frame. */
  error?: string;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * One field type → the Astryx input that owns it. The input draws the label, hint, required marker and error when
 * `framed`; otherwise the label only names the control (`isLabelHidden`).
 */
function FieldInput({
  field,
  value,
  onChange,
  locale,
  disabled,
  cellError,
  framed,
  help,
  error,
  id,
  invalid,
  describedBy,
}: FieldInputProps) {
  const t = useTranslations('ui.select');
  const uid = useId();
  const label = localize(field.label, locale) || field.key;
  const placeholder = localize(field.placeholder, locale) || undefined;
  const str = value === null || value === undefined ? '' : String(value);
  const isInvalid = Boolean(error) || Boolean(invalid);
  const status = error
    ? { type: 'error' as const, message: error }
    : isInvalid
      ? { type: 'error' as const }
      : undefined;
  const frame = framed
    ? { label, description: help, isRequired: field.required }
    : { label, isLabelHidden: true, isRequired: field.required };

  // Controls the Astryx field can't draw itself (pickers, table) sit in a `Field` when framed.
  const framedControl = (control: ReactNode, group = false) =>
    framed ? (
      <Field
        label={label}
        inputID={uid}
        labelID={group ? `${uid}-label` : undefined}
        isGroupLabel={group}
        description={help}
        descriptionID={help ? `${uid}-desc` : undefined}
        isRequired={field.required}
        isDisabled={disabled}
        status={error ? { type: 'error', message: error, messageID: `${uid}-error` } : undefined}
      >
        {control}
      </Field>
    ) : (
      control
    );
  const pickerId = framed ? uid : id;
  const pickerDescribedBy = framed
    ? [help && `${uid}-desc`, error && `${uid}-error`].filter(Boolean).join(' ') || undefined
    : describedBy;

  switch (field.type) {
    case 'rows':
      return framedControl(
        <RowsControl
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
          id={pickerId}
          invalid={isInvalid || undefined}
          describedBy={pickerDescribedBy}
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
        />,
        true,
      );
    case 'user':
      return framedControl(
        <PersonValue
          value={value}
          onChange={onChange}
          id={pickerId}
          invalid={isInvalid || undefined}
          disabled={disabled}
          aria-describedby={pickerDescribedBy}
        />,
      );
    case 'record': {
      const multiple = Boolean(field.record?.multiple);
      return framedControl(
        <RecordPicker
          value={recordRefs(value)}
          onChange={(refs) => onChange(multiple ? refs : (refs[0] ?? ''))}
          types={field.record?.types ?? []}
          multiple={multiple}
          where={field.record?.where}
          placeholder={placeholder}
          id={pickerId}
          invalid={isInvalid || undefined}
          disabled={disabled}
          aria-describedby={pickerDescribedBy}
        />,
      );
    }
  }

  let control: ReactNode;
  switch (field.type) {
    case 'textarea':
      control = (
        <TextArea
          {...frame}
          isDisabled={disabled}
          status={status}
          placeholder={placeholder}
          rows={4}
          maxLength={field.validation?.maxLength}
          value={str}
          onChange={onChange}
        />
      );
      break;
    case 'number': {
      const n = value === '' || value === null || value === undefined ? null : Number(value);
      const shared = {
        ...frame,
        isDisabled: disabled,
        status,
        placeholder,
        value: n !== null && Number.isFinite(n) ? n : null,
      };
      // A standalone number can be emptied again (clear button); a table cell has no room for one. The range is
      // left to the validation message: the input would otherwise quietly replace 70000 with the maximum.
      control = framed ? (
        <NumberInput {...shared} hasClear onChange={(v) => onChange(v === null ? '' : v)} />
      ) : (
        <NumberInput {...shared} onChange={(v) => onChange(v)} />
      );
      break;
    }
    case 'boolean':
      control = (
        <CheckboxInput
          {...frame}
          isDisabled={disabled}
          status={error ? { type: 'error', message: error } : undefined}
          value={value === true}
          onChange={(checked) => onChange(checked)}
        />
      );
      break;
    case 'date':
      control = (
        <DateInput
          {...frame}
          isDisabled={disabled}
          status={status}
          placeholder={placeholder}
          value={(str || undefined) as ISODateString | undefined}
          onChange={(v) => onChange(v ?? '')}
        />
      );
      break;
    case 'select': {
      const options = (field.options ?? []).map((o) => ({
        value: o.value,
        label: localize(o.label, locale) || o.value,
      }));
      const selected = options.some((o) => o.value === str) ? str : null;
      // A searchable Selector's trigger is a button, where `aria-required` is not allowed: a required select only gets search
      // for long lists, and then goes without the marker (the validation message still names it).
      const searchable = options.length > (field.required ? 15 : 8);
      const shared = {
        ...frame,
        isRequired: frame.isRequired && !searchable,
        isDisabled: disabled,
        status,
        id: framed ? undefined : id,
        placeholder: placeholder || t('placeholder'),
        options,
        hasSearch: searchable,
      };
      control = field.required ? (
        <Selector {...shared} value={selected ?? undefined} onChange={(v) => onChange(v)} />
      ) : (
        <Selector {...shared} hasClear value={selected} onChange={(v) => onChange(v ?? '')} />
      );
      break;
    }
    case 'multiselect': {
      const options = (field.options ?? []).map((o) => ({
        value: o.value,
        label: localize(o.label, locale) || o.value,
      }));
      control = (
        <MultiSelector
          {...frame}
          isDisabled={disabled}
          status={status}
          placeholder={placeholder || t('placeholder')}
          triggerDisplay="labels"
          hasSearch={options.length > 8}
          options={options}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(v) => onChange(v)}
        />
      );
      break;
    }
    default:
      control = (
        <TextInput
          {...frame}
          isDisabled={disabled}
          status={status}
          type={field.type === 'email' ? 'email' : 'text'}
          placeholder={placeholder}
          value={str}
          onChange={onChange}
        />
      );
  }
  return framed ? (
    control
  ) : (
    <WithInputAttrs id={id} describedBy={describedBy}>
      {control}
    </WithInputAttrs>
  );
}

/**
 * The input control for one field type, named by the field's label (hidden): for a label, hint and error drawn
 * elsewhere (the field editor's default value, process-action settings, a table's cells). `error` puts the error text
 * in the control's frame; `id` / `aria-describedby` tie it to an external `<label htmlFor>` and hint.
 */
export function FieldControl({
  field,
  value,
  onChange,
  locale,
  disabled,
  cellError,
  error,
  id,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  locale: string;
  disabled?: boolean;
  /** A table field's cell errors (`row`, column key). */
  cellError?: (row: number, key: string) => string | undefined;
  /** Error text drawn in the control's own frame (table cells). */
  error?: string;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  return (
    <FieldInput
      field={field}
      value={value}
      onChange={onChange}
      locale={locale}
      disabled={disabled}
      cellError={cellError}
      error={error}
      id={id}
      invalid={invalid}
      describedBy={describedBy}
    />
  );
}

const reveal = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.18, ease: 'easeOut' },
} as const;

/**
 * The elements shown for the current answers (conditions applied). Its component re-renders only when that set
 * changes: watching every answer would re-render every field on each keystroke, and a closed date input still renders
 * its month grid.
 */
function useVisibleElements(
  elements: readonly FormElement[],
  form: UseFormReturn<FieldValues>,
  namePrefix: string | undefined,
): FormElement[] {
  const subscribe = useCallback(
    (onChange: () => void) =>
      form.subscribe({ name: namePrefix, formState: { values: true }, callback: onChange }),
    [form, namePrefix],
  );
  const visibleIds = () => {
    const all = form.getValues() as Record<string, unknown> | undefined;
    const values = ((namePrefix ? all?.[namePrefix] : all) ?? {}) as Record<string, unknown>;
    return JSON.stringify(visibleElements({ elements: [...elements] }, values).map((el) => el.id));
  };
  const ids = useSyncExternalStore(subscribe, visibleIds, visibleIds);
  return useMemo(() => {
    const shown = new Set(JSON.parse(ids) as string[]);
    return elements.filter((el) => shown.has(el.id));
  }, [elements, ids]);
}

/** A table field in a form, with its cells' errors (re-rendered when this table's errors change, not the form's). */
function RowsFormInput({
  form,
  name,
  ...props
}: Omit<FieldInputProps, 'cellError'> & { form: UseFormReturn<FieldValues>; name: string }) {
  const { errors } = useFormState({ control: form.control, name });
  return (
    <FieldInput
      {...props}
      cellError={(row, key) => errorMessageAt(errors, [...name.split('.'), String(row), key])}
    />
  );
}

/**
 * Renders admin-defined form elements bound to a React Hook Form instance. Conditional fields slide
 * in and out as the answers change. `namePrefix` nests values (e.g. `attributes` on an entity form).
 * Typing re-renders only the field being typed in.
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
  const visible = useVisibleElements(elements, form, namePrefix);
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
              <div className="p-0.5 pb-4">
                {isField(el) ? (
                  <FormField
                    control={form.control}
                    name={name(el.key)}
                    render={({ field, fieldState }) => {
                      const props = {
                        framed: true,
                        field: el,
                        value: field.value,
                        onChange: field.onChange,
                        locale,
                        disabled,
                        help: localize(el.help, locale) || undefined,
                        error: fieldState.error?.message || undefined,
                      };
                      return el.type === 'rows' ? (
                        <RowsFormInput {...props} form={form} name={name(el.key)} />
                      ) : (
                        <FieldInput {...props} />
                      );
                    }}
                  />
                ) : el.type === 'heading' ? (
                  <Heading level={3}>{localize(el.text, locale)}</Heading>
                ) : el.type === 'paragraph' ? (
                  <Text color="secondary" display="block" className="whitespace-pre-line">
                    {localize(el.text, locale)}
                  </Text>
                ) : (
                  <Divider />
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
        <Link href={String(value)} isExternalLink>
          {String(value)}
        </Link>
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
    <div className={cn('min-w-0', className)}>
      <MetadataList columns="multi">
        {visible.map((f) => {
          const value = text(f, data[f.key], people);
          return (
            <MetadataListItem key={f.id} label={localize(f.label, locale)}>
              {value === null ? (
                <Text color="secondary">{emptyText ?? '—'}</Text>
              ) : typeof value === 'string' || typeof value === 'number' ? (
                <Text className={f.type === 'textarea' ? 'whitespace-pre-line' : undefined}>{value}</Text>
              ) : (
                value
              )}
            </MetadataListItem>
          );
        })}
      </MetadataList>
    </div>
  );
}
