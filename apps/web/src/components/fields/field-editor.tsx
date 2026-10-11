'use client';

import {
  type DisplayElement,
  type FieldDef,
  type FieldOption,
  type FieldType,
  type FieldValidation,
  isSafePattern,
  type LocalizedText,
  localize,
  MAX_ROWS,
  ROW_FIELD_TYPES,
} from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { ConditionBuilder } from '@isbp/ui/condition-builder';
import { FieldControl } from '@isbp/ui/form-renderer';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { Disclosure } from '@isbp/ui/motion';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  Columns2Icon,
  LockIcon,
  PlusIcon,
  RectangleHorizontalIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { useShowFieldKeys } from './field-keys';
import { ELEMENT_ICONS, ElementTypeIcon, FIELD_TYPE_ORDER } from './field-types';
import {
  CHOICE_TYPES,
  changeFieldType,
  cleanElement,
  cleanField,
  type EditableElement,
  elementIssues,
  type FieldIssue,
  fieldFacts,
  hasText,
  isAutoKey,
  isFieldElement,
  type IssueTarget,
  LENGTH_TYPES,
  newRowColumn,
  PLACEHOLDER_TYPES,
  slugKey,
  uniqueName,
} from './field-utils';
import { OptionsEditor } from './options-editor';
import { RecordOptionsEditor } from './record-options';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';

const NONE = '__none__';
const PATTERN_PRESETS = [
  { id: 'digits', pattern: '\\d+' },
  { id: 'lettersDigits', pattern: '[A-Za-z0-9]+' },
  { id: 'code', pattern: '[A-Z]{2,5}-\\d{2,6}' },
  { id: 'phone', pattern: '\\+?[0-9 ()\\-]{7,20}' },
  { id: 'noSpaces', pattern: '\\S+' },
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-4 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 id={id} className="text-xs font-semibold text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Issue texts under a control; `id` is referenced by the control's aria-describedby. */
function IssueText({ id, issues }: { id: string; issues: readonly FieldIssue[] }) {
  const t = useTranslations('fields.issues');
  if (!issues.length) return null;
  return (
    <div id={id} className="grid gap-0.5">
      {issues.map((i) => (
        <p key={i.code} className="text-xs font-medium text-destructive">
          {t(i.code, i.params ?? {})}
        </p>
      ))}
    </div>
  );
}

/**
 * Label, hint and issues around a CUSTOM control (a localized input, a field control, a group). Astryx inputs draw
 * their own; this is the same frame (`Field`) for the controls that don't. `htmlFor` is the id of the control inside
 * (none = a group, labelled as a whole).
 */
function Row({
  label,
  htmlFor,
  hint,
  hintId,
  issues = [],
  issueId,
  optional,
  children,
  aside,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  hintId?: string;
  issues?: readonly FieldIssue[];
  issueId?: string;
  optional?: boolean;
  children: ReactNode;
  aside?: ReactNode;
}) {
  const ti = useTranslations('fields.issues');
  const fallbackId = useId();
  const message = issues.map((i) => ti(i.code, i.params ?? {})).join(' ');
  return (
    <VStack gap={1}>
      <Field
        label={label}
        inputID={htmlFor ?? fallbackId}
        isGroupLabel={!htmlFor}
        isOptional={optional}
        description={hint}
        descriptionID={hint ? hintId : undefined}
        status={issueId && issues.length ? { type: 'error', message, messageID: issueId } : undefined}
        statusVariant="detached"
      >
        {children}
      </Field>
      {aside}
    </VStack>
  );
}

/** A number box that can be emptied (`undefined`), rounded and clamped. */
function NumberBox({
  label,
  hint,
  optional,
  value,
  onChange,
  invalid,
  integer,
  min,
  max,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  invalid?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <NumberInput
      label={label}
      description={hint}
      isOptional={optional}
      hasClear
      isIntegerOnly={integer}
      min={min}
      max={max}
      value={value ?? null}
      status={invalid ? { type: 'error' } : undefined}
      onChange={(v) => {
        if (v === null || v === undefined) return onChange(undefined);
        let n = Number(v);
        if (!Number.isFinite(n)) return;
        if (integer) n = Math.trunc(n);
        if (min !== undefined) n = Math.max(min, n);
        if (max !== undefined) n = Math.min(max, n);
        onChange(n);
      }}
    />
  );
}

/** Lists the field types with icon, name and a one-line description. */
export function FieldTypeSelect({
  value,
  onChange,
  types = FIELD_TYPE_ORDER,
  disabled,
  description,
}: {
  value: FieldType;
  onChange: (type: FieldType) => void;
  types?: readonly FieldType[];
  disabled?: boolean;
  description?: string;
}) {
  const t = useTranslations('fields.types');
  const te = useTranslations('fields.editor');
  return (
    <Selector
      label={te('type')}
      description={description}
      value={value}
      isDisabled={disabled}
      onChange={(v) => onChange(v as FieldType)}
      options={types.map((type) => ({ value: type, label: t(`${type}.name`), icon: ELEMENT_ICONS[type] }))}
    />
  );
}

const CUSTOM = '__custom__';

/** "Format" of a short text: a preset (digits, a code, a phone number…) or, last, a custom regular expression. */
function PatternEditor({
  value,
  onChange,
  issues,
}: {
  value: string | undefined;
  onChange: (pattern: string | undefined) => void;
  issues: readonly FieldIssue[];
}) {
  const t = useTranslations('fields.editor');
  const ti = useTranslations('fields.issues');
  const uid = useId();
  const [sample, setSample] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const preset = PATTERN_PRESETS.find((p) => p.pattern === value);
  const mode = value ? (preset?.id ?? CUSTOM) : customMode ? CUSTOM : NONE;
  const safe = value ? isSafePattern(value) : false;
  const matches = value && safe && sample ? new RegExp(`^(?:${value})$`, 'u').test(sample.trim()) : null;
  const patternIssues = issues.length ? issues.map((i) => ti(i.code, i.params ?? {})).join(' ') : '';
  return (
    <div className="grid gap-3">
      <Selector
        label={t('format')}
        value={mode}
        onChange={(v) => {
          setCustomMode(v === CUSTOM);
          if (v === NONE) onChange(undefined);
          else if (v !== CUSTOM) onChange(PATTERN_PRESETS.find((p) => p.id === v)?.pattern);
        }}
        options={[
          { value: NONE, label: t('formatAny') },
          ...PATTERN_PRESETS.map((p) => ({ value: p.id, label: t(`presets.${p.id}`) })),
          { value: CUSTOM, label: t('formatCustom') },
        ]}
      />
      {mode === CUSTOM && (
        <TextInput
          label={t('pattern')}
          description={t('patternHint')}
          placeholder="[A-Z]{2}-\d{4}"
          value={value ?? ''}
          status={issues.length > 0 ? { type: 'error', message: patternIssues } : undefined}
          onChange={(v) => onChange(v || undefined)}
        />
      )}
      {mode !== CUSTOM && <IssueText id={`${uid}-issues`} issues={issues} />}
      {value && safe && (
        <HStack gap={2} vAlign="center">
          <TextInput
            label={t('patternTest')}
            isLabelHidden
            size="sm"
            placeholder={t('patternTest')}
            value={sample}
            onChange={setSample}
          />
          <span aria-live="polite" className="shrink-0">
            {matches === true && (
              <Badge
                variant="success"
                label={t('patternMatches')}
                icon={<Icon icon={CheckIcon} size="xsm" />}
              />
            )}
            {matches === false && (
              <Badge variant="error" label={t('patternNoMatch')} icon={<Icon icon={XIcon} size="xsm" />} />
            )}
          </span>
        </HStack>
      )}
    </div>
  );
}

function DefaultValueEditor({
  field,
  onChange,
  issues,
}: {
  field: FieldDef;
  onChange: (value: FieldDef['defaultValue']) => void;
  issues: readonly FieldIssue[];
}) {
  const t = useTranslations('fields.editor');
  const ti = useTranslations('fields.issues');
  const locale = useLocale();
  const uid = useId();
  const describedBy = issues.length ? `${uid}-issues` : undefined;
  if (field.type === 'select') {
    return (
      <Selector
        label={t('defaultValue')}
        isOptional
        value={typeof field.defaultValue === 'string' && field.defaultValue ? field.defaultValue : NONE}
        status={
          issues.length > 0
            ? { type: 'error', message: issues.map((i) => ti(i.code, i.params ?? {})).join(' ') }
            : undefined
        }
        onChange={(v) => onChange(v === NONE ? undefined : v)}
        options={[
          { value: NONE, label: t('noDefault') },
          ...(field.options ?? [])
            .filter((o) => o.value.trim())
            .map((o: FieldOption) => ({
              value: o.value,
              label: o.label[locale as keyof LocalizedText] || o.label.en || o.value,
            })),
        ]}
      />
    );
  }
  const control: ReactNode =
    field.type === 'boolean' ? (
      <CheckboxInput
        label={t('checkedByDefault')}
        value={field.defaultValue === true}
        onChange={(c) => onChange(c ? true : undefined)}
      />
    ) : (
      <FieldControl
        field={{ ...field, required: false, placeholder: undefined }}
        value={field.defaultValue ?? (field.type === 'multiselect' ? [] : '')}
        onChange={(v) => onChange(v as FieldDef['defaultValue'])}
        locale={locale}
        id={`${uid}-default`}
        aria-invalid={issues.length > 0 || undefined}
        aria-describedby={describedBy}
      />
    );
  return (
    <Row
      label={t('defaultValue')}
      htmlFor={field.type === 'boolean' || field.type === 'multiselect' ? undefined : `${uid}-default`}
      optional
      issues={issues}
      issueId={`${uid}-issues`}
      aside={
        field.defaultValue !== undefined &&
        field.type !== 'boolean' && (
          <div>
            <Button
              label={t('clearDefault')}
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => onChange(undefined)}
            />
          </div>
        )
      }
    >
      {control}
    </Row>
  );
}

export interface FieldEditorProps {
  value: EditableElement;
  onChange: (next: EditableElement) => void;
  /** The other fields: condition facts and key uniqueness. */
  siblings: readonly FieldDef[];
  issues?: readonly FieldIssue[];
  /** Stored answers depend on the key/type (published form, existing custom field). */
  lockedKey?: boolean;
  lockedType?: boolean;
  /** Option values already used by stored answers. */
  lockedValues?: ReadonlySet<string>;
  types?: readonly FieldType[];
  /** Hides the type picker (e.g. when the caller shows it elsewhere). */
  hideType?: boolean;
  /** A table's column: no width and no conditional logic. */
  column?: boolean;
  className?: string;
}

/**
 * Properties of one field (label, key, type, options, validation, default and conditional logic) or
 * display element. Shared by the form builder and the custom-field admin.
 */
export function FieldEditor(props: FieldEditorProps) {
  if (!isFieldElement(props.value)) {
    return (
      <DisplayEditor
        value={props.value}
        onChange={props.onChange}
        siblings={props.siblings}
        issues={props.issues ?? []}
        className={props.className}
      />
    );
  }
  return <FieldPropsEditor {...props} field={props.value} />;
}

function FieldPropsEditor({
  field,
  onChange,
  siblings,
  issues = [],
  lockedKey,
  lockedType,
  lockedValues,
  types,
  hideType,
  column,
  className,
}: FieldEditorProps & { field: FieldDef & { id?: string } }) {
  const t = useTranslations('fields');
  const ti = useTranslations('fields.issues');
  const locale = useLocale();
  const uid = useId();
  const facts = useMemo(() => fieldFacts(siblings, locale), [siblings, locale]);
  const takenKeys = useMemo(() => new Set(siblings.map((f) => f.key)), [siblings]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const of = (target: IssueTarget) => issues.filter((i) => i.target === target);
  const described = (target: IssueTarget, hint?: string) =>
    [hint, of(target).length ? `${uid}-${target}-issues` : undefined].filter(Boolean).join(' ') || undefined;

  const set = (patch: Partial<FieldDef>) => onChange(cleanField({ ...field, ...patch }));
  const setValidation = (patch: Partial<FieldValidation>) =>
    set({ validation: { ...field.validation, ...patch } });
  const auto = !lockedKey && isAutoKey(field);
  const defaultOptions = (): FieldOption[] =>
    [1, 2].map((n) => ({ value: `option${n}`, label: { [locale]: t('editor.optionN', { n }) } }));

  const choice = CHOICE_TYPES.includes(field.type);
  const hasLength = LENGTH_TYPES.includes(field.type);
  const hasRange = field.type === 'number' || field.type === 'multiselect';
  const hasWidth = !column && field.type !== 'rows';
  const hasDefault = field.type !== 'user' && field.type !== 'record' && field.type !== 'rows';

  // "More options" and "Advanced" open by themselves while something in them needs fixing.
  const moreIssues = (['validation', 'pattern', 'defaultValue', 'visibleWhen'] as const).some(
    (target) => of(target).length > 0,
  );
  const keyIssues = of('key').length > 0;
  const showMore = moreOpen || moreIssues;
  const showAdvanced = advancedOpen || keyIssues;
  // What "More options" holds already, so a closed section doesn't hide that a field has, say, a condition.
  const moreSet = [
    hasText(field.help) && t('editor.help'),
    hasText(field.placeholder) && t('editor.placeholder'),
    hasWidth && field.width === 'half' && t('editor.widthHalf'),
    field.validation && t('editor.sections.validation'),
    field.defaultValue !== undefined && t('editor.defaultValue'),
    field.visibleWhen && t('editor.conditional'),
  ].filter((x): x is string => Boolean(x));

  return (
    <div className={cn('grid gap-4', className)}>
      <div className="grid gap-4">
        {!hideType && (
          <FieldTypeSelect
            value={field.type}
            types={types}
            disabled={lockedType}
            description={lockedType ? t('editor.typeLocked') : undefined}
            onChange={(type) => onChange(changeFieldType(field, type, defaultOptions))}
          />
        )}
        <Row
          label={t('editor.label')}
          htmlFor={`${uid}-label`}
          issues={of('label')}
          issueId={`${uid}-label-issues`}
        >
          <LocalizedInput
            id={`${uid}-label`}
            value={field.label}
            invalid={of('label').length > 0}
            aria-describedby={described('label')}
            placeholder={t('editor.labelPlaceholder')}
            onChange={(label) => {
              const slug = slugKey(label.en);
              set({ label, key: auto && slug ? uniqueName(slug, takenKeys) : field.key });
            }}
          />
        </Row>
        <Switch
          label={t('editor.required')}
          description={field.type === 'boolean' ? t('editor.requiredHintBoolean') : t('editor.requiredHint')}
          labelPosition="start"
          labelSpacing="spread"
          value={Boolean(field.required)}
          onChange={(required) => set({ required })}
        />
      </div>

      {choice && (
        <Section title={t('editor.sections.options')}>
          <OptionsEditor
            value={field.options ?? []}
            onChange={(options) => set({ options })}
            lockedValues={lockedValues}
            invalid={of('options').length > 0}
            describedBy={described('options')}
          />
          <IssueText id={`${uid}-options-issues`} issues={of('options')} />
        </Section>
      )}

      {field.type === 'record' && (
        <Section title={t('editor.sections.record')}>
          <RecordOptionsEditor field={field} onChange={(record) => set({ record })} issues={of('record')} />
        </Section>
      )}

      {field.type === 'rows' && (
        <Section title={t('editor.sections.rows')}>
          <RowsEditor field={field} onChange={(rows) => set({ rows })} issues={of('rows')} />
        </Section>
      )}

      <div className="grid gap-1 border-t pt-2">
        <Disclosure
          open={showMore}
          onOpenChange={setMoreOpen}
          summary={
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span>{t('editor.moreOptions')}</span>
              {moreSet.length > 0 && (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {moreSet.join(' · ')}
                </span>
              )}
            </span>
          }
          contentClassName="grid gap-6 pt-2 pb-2"
        >
          <div className="grid gap-4">
            <Row
              label={t('editor.help')}
              htmlFor={`${uid}-help`}
              optional
              hint={t('editor.helpHint')}
              hintId={`${uid}-help-hint`}
            >
              <LocalizedInput
                id={`${uid}-help`}
                value={field.help}
                aria-describedby={`${uid}-help-hint`}
                onChange={(help) => set({ help })}
              />
            </Row>
            {PLACEHOLDER_TYPES.includes(field.type) && (
              <Row label={t('editor.placeholder')} htmlFor={`${uid}-placeholder`} optional>
                <LocalizedInput
                  id={`${uid}-placeholder`}
                  value={field.placeholder}
                  onChange={(placeholder) => set({ placeholder })}
                />
              </Row>
            )}
            {hasWidth && (
              <VStack gap={1.5} hAlign="start">
                <Text type="label">{t('editor.width')}</Text>
                <SegmentedControl
                  label={t('editor.width')}
                  value={field.width === 'half' ? 'half' : 'full'}
                  onChange={(width) => set({ width: width === 'half' ? 'half' : 'full' })}
                >
                  <SegmentedControlItem
                    value="full"
                    label={t('editor.widthFull')}
                    icon={<Icon icon={RectangleHorizontalIcon} />}
                  />
                  <SegmentedControlItem
                    value="half"
                    label={t('editor.widthHalf')}
                    icon={<Icon icon={Columns2Icon} />}
                  />
                </SegmentedControl>
              </VStack>
            )}
          </div>

          {(hasRange || hasLength) && (
            <Section title={t('editor.sections.validation')}>
              {field.type === 'text' && (
                <PatternEditor
                  value={field.validation?.pattern}
                  issues={of('pattern')}
                  onChange={(pattern) => setValidation({ pattern })}
                />
              )}
              {hasRange && (
                <div className="grid grid-cols-2 gap-3">
                  <NumberBox
                    label={field.type === 'number' ? t('editor.min') : t('editor.minChoices')}
                    value={field.validation?.min}
                    integer={field.type === 'multiselect'}
                    min={field.type === 'multiselect' ? 0 : undefined}
                    invalid={of('validation').length > 0}
                    onChange={(min) => setValidation({ min })}
                  />
                  <NumberBox
                    label={field.type === 'number' ? t('editor.max') : t('editor.maxChoices')}
                    value={field.validation?.max}
                    integer={field.type === 'multiselect'}
                    min={field.type === 'multiselect' ? 1 : undefined}
                    invalid={of('validation').length > 0}
                    onChange={(max) => setValidation({ max })}
                  />
                </div>
              )}
              {hasLength && (
                <div className="grid grid-cols-2 gap-3">
                  <NumberBox
                    label={t('editor.minLength')}
                    value={field.validation?.minLength}
                    integer
                    min={0}
                    max={10_000}
                    invalid={of('validation').length > 0}
                    onChange={(minLength) => setValidation({ minLength })}
                  />
                  <NumberBox
                    label={t('editor.maxLength')}
                    value={field.validation?.maxLength}
                    integer
                    min={1}
                    max={10_000}
                    invalid={of('validation').length > 0}
                    onChange={(maxLength) => setValidation({ maxLength })}
                  />
                </div>
              )}
              <IssueText id={`${uid}-validation-issues`} issues={of('validation')} />
            </Section>
          )}

          {hasDefault && (
            <Section title={t('editor.sections.default')}>
              <DefaultValueEditor
                field={field}
                issues={of('defaultValue')}
                onChange={(defaultValue) => set({ defaultValue })}
              />
            </Section>
          )}

          {!column && (
            <Section title={t('editor.sections.logic')}>
              <LogicEditor
                value={field.visibleWhen}
                onChange={(visibleWhen) => set({ visibleWhen })}
                facts={facts}
                issues={of('visibleWhen')}
              />
            </Section>
          )}
        </Disclosure>

        <Disclosure
          open={showAdvanced}
          onOpenChange={setAdvancedOpen}
          summary={t('editor.advanced')}
          contentClassName="grid gap-4 pt-2 pb-2"
        >
          <TextInput
            label={t('editor.key')}
            description={lockedKey ? t('editor.keyLocked') : t('editor.keyHint')}
            autoComplete="off"
            value={field.key}
            isReadOnly={lockedKey}
            startIcon={lockedKey ? LockIcon : undefined}
            status={
              of('key').length > 0
                ? {
                    type: 'error',
                    message: of('key')
                      .map((i) => ti(i.code, i.params ?? {}))
                      .join(' '),
                  }
                : undefined
            }
            onChange={(v) => set({ key: v.replace(/[^A-Za-z0-9_]/g, '') })}
          />
          {auto && (
            <div>
              <Badge
                variant="neutral"
                label={t('editor.keyAuto')}
                icon={<Icon icon={WandSparklesIcon} size="xsm" />}
              />
            </div>
          )}
        </Disclosure>
      </div>
    </div>
  );
}

/**
 * The columns of a table field (each a field of a simple type, edited with the same field editor, without conditions)
 * and how many rows it takes. Columns are added, opened, moved and removed with buttons.
 */
function RowsEditor({
  field,
  onChange,
  issues,
}: {
  field: FieldDef;
  onChange: (rows: NonNullable<FieldDef['rows']>) => void;
  issues: readonly FieldIssue[];
}) {
  const t = useTranslations('fields.editor.rows');
  const tt = useTranslations('fields.types');
  const locale = useLocale();
  const uid = useId();
  const rows = field.rows ?? { fields: [] };
  const columns = rows.fields;
  const [open, setOpen] = useState<number | null>(columns.length === 1 ? 0 : null);
  const [announcement, setAnnouncement] = useState('');
  const [showKeys] = useShowFieldKeys();
  const set = (patch: Partial<NonNullable<FieldDef['rows']>>) => onChange({ ...rows, ...patch });
  const nameOf = (c: FieldDef) => localize(c.label, locale) || c.key;
  const setColumn = (i: number, next: FieldDef) =>
    set({ fields: columns.map((c, j) => (j === i ? next : c)) });
  const add = () => {
    const column = newRowColumn('text', columns, { [locale]: tt('text.defaultLabel') });
    set({ fields: [...columns, column] });
    setOpen(columns.length);
    setAnnouncement(t('added', { name: nameOf(column) }));
  };
  const remove = (i: number) => {
    const name = nameOf(columns[i]!);
    set({ fields: columns.filter((_, j) => j !== i) });
    setOpen(null);
    setAnnouncement(t('removed', { name }));
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ fields: next });
    if (open === i) setOpen(j);
    setAnnouncement(t('moved', { name: nameOf(columns[i]!), position: j + 1, total: columns.length }));
  };
  const rangeIssues = issues.filter((i) => i.code === 'rowsRangeInvalid' || i.code === 'columnsRequired');

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        <NumberBox
          label={t('min')}
          optional
          value={rows.min}
          integer
          min={0}
          max={MAX_ROWS}
          invalid={rangeIssues.some((i) => i.code === 'rowsRangeInvalid')}
          onChange={(min) => set({ min })}
        />
        <NumberBox
          label={t('max')}
          optional
          hint={t('maxHint', { max: MAX_ROWS })}
          value={rows.max}
          integer
          min={1}
          max={MAX_ROWS}
          invalid={rangeIssues.some((i) => i.code === 'rowsRangeInvalid')}
          onChange={(max) => set({ max })}
        />
      </div>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id={`${uid}-columns`} className="text-sm font-medium">
            {t('columns')}
          </h4>
          <Button
            label={t('addColumn')}
            variant="secondary"
            size="sm"
            icon={<Icon icon={PlusIcon} />}
            isDisabled={columns.length >= 20}
            type="button"
            onClick={add}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t('columnsHint')}</p>
        <ol aria-labelledby={`${uid}-columns`} className="grid gap-2">
          {columns.map((c, i) => {
            const others = columns.filter((_, j) => j !== i);
            const invalid = elementIssues(c, others).length > 0;
            const expanded = open === i;
            const name = nameOf(c);
            return (
              <li key={i} className="min-w-0 rounded-lg border">
                <div className="flex min-w-0 items-center gap-1.5 p-1.5">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`${uid}-col-${i}`}
                    onClick={() => setOpen(expanded ? null : i)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <ChevronRightIcon
                      aria-hidden
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                        expanded && 'rotate-90',
                      )}
                    />
                    <ElementTypeIcon type={c.type} size="sm" />
                    <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                    {showKeys && (
                      <code className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">
                        {c.key}
                      </code>
                    )}
                    {invalid && (
                      <Badge
                        variant="error"
                        label={t('needsAttention')}
                        icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
                        className="shrink-0"
                      />
                    )}
                  </button>
                  <IconButton
                    label={t('moveUp', { name })}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={ArrowUpIcon} />}
                    isDisabled={i === 0}
                    type="button"
                    onClick={() => move(i, -1)}
                  />
                  <IconButton
                    label={t('moveDown', { name })}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={ArrowDownIcon} />}
                    isDisabled={i === columns.length - 1}
                    type="button"
                    onClick={() => move(i, 1)}
                  />
                  <IconButton
                    label={t('remove', { name })}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={Trash2Icon} />}
                    isDisabled={columns.length <= 1}
                    type="button"
                    onClick={() => remove(i)}
                  />
                </div>
                {expanded && (
                  <div id={`${uid}-col-${i}`} className="border-t p-3">
                    <FieldEditor
                      value={c}
                      onChange={(next) => setColumn(i, next as FieldDef)}
                      siblings={others}
                      issues={elementIssues(c, others)}
                      types={ROW_FIELD_TYPES}
                      column
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <IssueText id={`${uid}-issues`} issues={rangeIssues} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function LogicEditor({
  value,
  onChange,
  facts,
  issues,
}: {
  value: FieldDef['visibleWhen'];
  onChange: (v: FieldDef['visibleWhen']) => void;
  facts: ReturnType<typeof fieldFacts>;
  issues: readonly FieldIssue[];
}) {
  const t = useTranslations('fields.editor');
  const uid = useId();
  return (
    <div className="grid gap-3">
      <div className="grid gap-0.5">
        <p className="text-sm font-medium">{t('visibleWhen')}</p>
        <p className="text-xs text-muted-foreground">{t('visibleWhenHint')}</p>
      </div>
      {!facts.length && !value ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t('noOtherFields')}
        </p>
      ) : (
        <ConditionBuilder value={value} onChange={onChange} facts={facts} emptyText={t('visibleWhenEmpty')} />
      )}
      <IssueText id={`${uid}-issues`} issues={issues} />
    </div>
  );
}

function DisplayEditor({
  value,
  onChange,
  siblings,
  issues,
  className,
}: {
  value: DisplayElement;
  onChange: (next: EditableElement) => void;
  siblings: readonly FieldDef[];
  issues: readonly FieldIssue[];
  className?: string;
}) {
  const t = useTranslations('fields');
  const locale = useLocale();
  const uid = useId();
  const facts = useMemo(() => fieldFacts(siblings, locale), [siblings, locale]);
  const textIssues = issues.filter((i) => i.target === 'text');
  return (
    <div className={cn('grid gap-4', className)}>
      {value.type !== 'divider' ? (
        <Section title={t('editor.sections.content')}>
          <Row
            label={t('editor.text')}
            htmlFor={`${uid}-text`}
            issues={textIssues}
            issueId={`${uid}-text-issues`}
          >
            <LocalizedInput
              id={`${uid}-text`}
              multiline={value.type === 'paragraph'}
              value={value.text}
              invalid={textIssues.length > 0}
              aria-describedby={textIssues.length ? `${uid}-text-issues` : undefined}
              onChange={(text) => onChange(cleanElement({ ...value, text }))}
            />
          </Row>
        </Section>
      ) : (
        <p className="text-sm text-muted-foreground">{t('editor.dividerHint')}</p>
      )}
      <Section title={t('editor.sections.logic')}>
        <LogicEditor
          value={value.visibleWhen}
          onChange={(visibleWhen) => onChange(cleanElement({ ...value, visibleWhen }))}
          facts={facts}
          issues={issues.filter((i) => i.target === 'visibleWhen')}
        />
      </Section>
    </div>
  );
}
