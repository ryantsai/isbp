'use client';

import type { ProcessActionType, WorkflowDefinition } from '@isbp/contracts';
import {
  type ApprovalStep,
  type Condition,
  evaluateCondition,
  FIELD_KEY_RE,
  type FieldDef,
  type FieldError,
  type FormAction,
  type FormElement,
  formSchemaSchema,
  isField,
  type LocalizedText,
  localize,
  PROCESS_ACTION_OUTCOMES,
  type ProcessActionOutcome,
  renderTemplate,
  STEP_FACTS_ROOT,
  templatePaths,
  todayFact,
  validateFields,
  walkSteps,
} from '@isbp/sdk';
import { useApi } from '@isbp/sdk/web';
import { ConditionBuilder, type FactOption, useConditionText } from '@isbp/ui/condition-builder';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { FormDialog } from '@isbp/ui/form-dialog';
import { FieldControl, useFieldErrorText } from '@isbp/ui/form-renderer';
import { IconTile } from '@isbp/ui/icon-tile';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BracesIcon,
  FilterIcon,
  InfoIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WorkflowIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  cleanElement,
  hasText,
  incompleteConditions,
  newElementId,
  useTodayFact,
} from '@/components/fields/field-utils';
import { navIcon } from '@/components/nav-icon';
import { fieldType, useFieldFacts } from '@/components/workflows/field-facts';
import { useApiQuery } from '@/lib/api';
import { type TemplateInputHandle, type TemplateLabel, TemplateInput } from './template-input';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Field } from '@astryxdesign/core/Field';
import { FieldStatus } from '@astryxdesign/core/FieldStatus';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';

/* ───────────────────────── catalog and issues ───────────────────────── */

/**
 * The action types with their configuration fields for the builder's current fields (sent as the unsaved draft, so
 * "the person in field …" lists what the form has now). Refreshed shortly after the fields change.
 */
export function useActionCatalog(formId: string, elements: readonly FormElement[]) {
  const api = useApi();
  const draft = useMemo(() => {
    const schema = { elements: elements.map((el) => cleanElement(el)) };
    // A draft that doesn't parse yet (a label being typed) falls back to the saved one.
    return formSchemaSchema.safeParse(schema).success ? JSON.stringify(schema) : '';
  }, [elements]);
  const [debounced, setDebounced] = useState(draft);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(draft), 400);
    return () => clearTimeout(timer);
  }, [draft]);
  const query = useQuery({
    queryKey: ['/forms/process-actions', formId, debounced],
    queryFn: () =>
      api.post<{ items: ProcessActionType[] }>('/forms/process-actions', {
        formId,
        ...(debounced ? { draft: JSON.parse(debounced) as unknown } : {}),
      }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { items: query.data?.items ?? null, loading: query.isLoading };
}

const isSet = (v: unknown) => Boolean(v && typeof v === 'object' && (v as { set?: unknown }).set === true);

/** The fields an action shows for its config (conditional ones only when they apply). */
const visibleFields = (fields: readonly FieldDef[], config: Record<string, unknown>) =>
  fields.filter((f) => !f.visibleWhen || evaluateCondition(f.visibleWhen, config));

/** What stops an action from saving (the API runs the same field checks), by config key. */
export function actionErrors(
  action: FormAction,
  item: ProcessActionType | undefined,
): Record<string, FieldError> {
  if (!item) return {};
  const secrets = new Set(item.secrets);
  const probe = Object.fromEntries(
    Object.entries(action.config).map(([k, v]) => [
      k,
      secrets.has(k) ? (isSet(v) || (typeof v === 'string' && v) ? 'x' : '') : v,
    ]),
  );
  return validateFields(item.fields, probe).errors;
}

/** Problems of every action, by action id (for the tab badge and the publish check). */
export function actionsIssues(
  actions: readonly FormAction[],
  items: readonly ProcessActionType[] | null,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!items) return out;
  for (const a of actions) {
    const item = items.find((i) => i.type === a.type);
    // An action this editor may not change is checked by the API (its choices may be ones they aren't offered).
    if (!item?.allowed) continue;
    const n = Object.keys(actionErrors(a, item)).length;
    if (n) out.set(a.id, n);
  }
  return out;
}

/** Default config of a new action: each field's default value. */
function defaultsOf(item: ProcessActionType): Record<string, unknown> {
  return Object.fromEntries(
    item.fields.filter((f) => f.defaultValue !== undefined).map((f) => [f.key, f.defaultValue]),
  );
}

/* ───────────────────────── conditions ───────────────────────── */

/** The fields approvers fill in on the attached workflow's steps (`steps.<step>.<key>`), from its published graph. */
function useStepFacts(workflowId: string | null | undefined): FactOption[] {
  const locale = useLocale();
  const { data } = useApiQuery<WorkflowDefinition>(workflowId ? `/workflows/${workflowId}` : null);
  return useMemo(() => {
    const graph = data?.published ?? data?.draft;
    if (!graph) return [];
    return walkSteps(graph.steps)
      .map((s) => s.step)
      .filter((s): s is ApprovalStep => s.type === 'approval')
      .flatMap((step) =>
        (step.fields ?? []).map((f) => ({
          path: `${STEP_FACTS_ROOT}.${step.id}.${f.key}`,
          label: `${localize(step.name, locale) || step.id} › ${localize(f.label, locale) || f.key}`,
          type: fieldType(f),
          options: f.options?.map((o) => ({ value: o.value, label: localize(o.label, locale) || o.value })),
        })),
      );
  }, [data, locale]);
}

/**
 * What an action's "Only when…" can test: the answers (table columns included), the picked records' facts, what
 * approvers filled in, the requester and today.
 */
function useActionFacts(fields: readonly FieldDef[], workflowId: string | null | undefined): FactOption[] {
  const t = useTranslations('forms.actions.facts');
  const answers = useFieldFacts(fields, 'data');
  const steps = useStepFacts(workflowId);
  const today = useTodayFact();
  return useMemo(
    () => [
      ...answers,
      ...steps,
      { path: 'requester.departmentCode', label: t('requesterDepartment'), type: 'string' as const },
      { path: 'requester.jobTitle', label: t('requesterJobTitle'), type: 'string' as const },
      today,
    ],
    [answers, steps, today, t],
  );
}

/* ───────────────────────── template values ───────────────────────── */

interface TemplateValue {
  path: string;
  label: string;
  group: 'answers' | 'records' | 'request';
  /** What it could look like on a request, for the "e.g." line. */
  sample: string;
  /** The sample is only a stand-in ("[Application]"): the menu doesn't show it. */
  standIn?: boolean;
}

/** Field types whose stored value isn't what people read (option values, ids): text uses `answers.<key>`. */
const SHOWN_TYPES = new Set(['select', 'multiselect', 'user', 'boolean', 'record', 'rows']);

/** The values a text setting can insert, with sample values. */
interface TemplateValues {
  /** What the "Insert value" menu offers. */
  items: TemplateValue[];
  /** The chip label of any path (offered or not, e.g. typed by hand or kept from an older form). */
  labelOf: (path: string) => TemplateLabel;
  /** Sample values by path, for the example line. */
  context: Record<string, unknown>;
}

/** `a.b.c` → `{ a: { b: { c: value } } }` (merged into `target`). */
function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const segs = path.split('.');
  let cur = target;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    cur = (next && typeof next === 'object' ? next : (cur[seg] = {})) as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = value;
}

/**
 * Values a text setting can insert: the answers as people read them (option labels, people's names, "Yes"), the name
 * of each picked record and the records' readable facts, and the request. Never ids (a person's or a group's) or
 * stored option values: a ticket title would show them as they are.
 */
function useTemplateValues(fields: readonly FieldDef[], formName?: LocalizedText): TemplateValues {
  const t = useTranslations('forms.actions.values');
  const ts = useTranslations('forms.actions.sample');
  const locale = useLocale();
  const facts = useFieldFacts(fields, 'data');
  return useMemo(() => {
    const en = (text: LocalizedText | undefined) => localize(text, 'en') || localize(text, locale);
    const labelOfField = (f: FieldDef) => localize(f.label, locale) || f.key;
    const hint = (f: FieldDef) =>
      (localize(f.placeholder, locale) ?? '').replace(/^(e\.g\.|eg\.|例如|例)\s*[:：]?\s*/i, '').trim();
    // A plausible value, as the server renders it (English option labels, ISO dates, "Yes").
    const sampleOf = (f: FieldDef): string => {
      const dv = f.defaultValue;
      const option = (v: unknown) => en(f.options?.find((o) => o.value === v)?.label) || String(v);
      switch (f.type) {
        case 'select':
          return typeof dv === 'string' && dv ? option(dv) : f.options?.[0] ? option(f.options[0].value) : '';
        case 'multiselect':
          return (Array.isArray(dv) && dv.length ? dv : (f.options ?? []).slice(0, 2).map((o) => o.value))
            .map(option)
            .join(', ');
        case 'boolean':
          return 'Yes';
        case 'user':
          return ts('person');
        case 'number':
          return String(typeof dv === 'number' ? dv : (f.validation?.min ?? 1200));
        case 'date':
          return typeof dv === 'string' && dv ? dv : todayFact();
        case 'email':
          return ts('email');
        case 'url':
          return 'https://example.com';
        case 'rows':
          return (f.rows?.fields ?? [])
            .slice(0, 3)
            .map((c) => `${en(c.label) || c.key}: ${sampleOf(c)}`)
            .join(' · ');
        case 'record':
          return ts('record', { field: labelOfField(f) });
        default:
          return (typeof dv === 'string' && dv) || hint(f) || ts('answer', { field: labelOfField(f) });
      }
    };

    const items: TemplateValue[] = [];
    const labels = new Map<string, TemplateLabel>();
    const offer = (v: TemplateValue) => {
      items.push(v);
      labels.set(v.path, { label: v.label, known: true });
    };
    const named = fields.filter((f) => FIELD_KEY_RE.test(f.key));
    for (const f of named) {
      const label = labelOfField(f);
      const sample = sampleOf(f);
      const standIn = sample === ts('answer', { field: label }) || sample === ts('record', { field: label });
      if (f.type === 'record')
        offer({
          path: `answers.${f.key}`,
          label: t('recordName', { field: label }),
          group: 'records',
          sample,
          standIn,
        });
      else
        offer({
          path: SHOWN_TYPES.has(f.type) ? `answers.${f.key}` : `data.${f.key}`,
          label,
          group: 'answers',
          sample,
          standIn,
        });
      // Older templates may use the other form of the same answer: shown, but not offered.
      const other = SHOWN_TYPES.has(f.type) ? `data.${f.key}` : `answers.${f.key}`;
      if (!labels.has(other))
        labels.set(other, {
          label: SHOWN_TYPES.has(f.type) ? t('stored', { field: label }) : label,
          known: !SHOWN_TYPES.has(f.type),
        });
    }
    for (const f of facts.filter((x) => x.path.startsWith('records.'))) {
      // A person's or a group's id, a key: never readable text.
      const readable = !f.ref && f.type !== 'id';
      if (!readable) {
        labels.set(f.path, { label: f.label, known: false });
        continue;
      }
      offer({
        path: f.path,
        label: f.label,
        group: 'records',
        sample: f.options?.[0]?.label ?? ts('answer', { field: f.label }),
        standIn: !f.options?.length,
      });
    }
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    const reference = 'REQ-01042';
    (
      [
        ['request.reference', 'reference', reference],
        ['request.url', 'url', `${origin}/requests/${reference}`],
        ['request.form', 'form', en(formName) || ts('form')],
        ['requester.displayName', 'requesterName', ts('person')],
        ['requester.email', 'requesterEmail', ts('email')],
        ['decidedBy.displayName', 'decidedBy', ts('approver')],
      ] as const
    ).forEach(([path, key, sample]) => offer({ path, label: t(key), group: 'request', sample }));

    const context: Record<string, unknown> = {};
    for (const v of items) setPath(context, v.path, v.sample);
    const labelOf = (path: string): TemplateLabel => {
      const known = labels.get(path);
      if (known) return known;
      // A field that is gone, or a path typed by hand.
      const key = /^(?:data|answers)\.([^.]+)/.exec(path)?.[1];
      const field = key ? fields.find((f) => f.key === key) : undefined;
      return { label: field ? labelOfField(field) : path, known: false };
    };
    return { items, labelOf, context };
  }, [facts, fields, formName, locale, t, ts]);
}

function InsertValueMenu({
  values,
  fieldLabel,
  onInsert,
  disabled,
}: {
  values: readonly TemplateValue[];
  fieldLabel: string;
  onInsert: (path: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('forms.actions');
  const sections = (['answers', 'records', 'request'] as const)
    .map((g) => ({ g, items: values.filter((v) => v.group === g) }))
    .filter((x) => x.items.length)
    .map(({ g, items }) => ({
      type: 'section' as const,
      title: t(`valueGroups.${g}`),
      items: items.map((v) => ({
        label: v.label,
        description: v.sample && !v.standIn ? t('example', { text: v.sample }) : undefined,
        onClick: () => onInsert(v.path),
      })),
    }));
  return (
    <DropdownMenu
      button={{
        label: t('insert'),
        'aria-label': t('insertFor', { field: fieldLabel }),
        variant: 'secondary',
        size: 'sm',
        icon: <Icon icon={BracesIcon} />,
        isDisabled: disabled,
      }}
      hasChevron={false}
      items={sections}
      menuWidth={288}
      menuMaxHeight={320}
      alignment="end"
    />
  );
}

/* ───────────────────────── one config field ───────────────────────── */

function ConfigField({
  field,
  value,
  onChange,
  error,
  secret,
  stored,
  values,
  disabled,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  error: string | null;
  secret: boolean;
  /** A secret is stored on the server (shown as `{ set: true }`). */
  stored: boolean;
  values: TemplateValues;
  disabled?: boolean;
}) {
  const t = useTranslations('forms.actions');
  const locale = useLocale();
  const id = useId();
  const editor = useRef<TemplateInputHandle>(null);
  const label = localize(field.label, locale) || field.key;
  const describedBy = `${id}-hint`;
  const help = error ?? (secret && stored ? t('secretStored') : localize(field.help, locale));
  const templated = !secret && (field.type === 'text' || field.type === 'textarea');
  const text = typeof value === 'string' ? value : '';
  // The text with sample values, once it holds at least one value from the request.
  const example = templated && templatePaths(text).length ? renderTemplate(text, values.context).trim() : '';
  const status = error ? ({ type: 'error', message: error } as const) : undefined;
  const hint = error ? undefined : help || undefined;

  if (secret)
    return (
      <HStack gap={2} vAlign="end">
        <StackItem size="fill">
          <TextInput
            label={label}
            type="password"
            autoComplete="new-password"
            isRequired={field.required}
            isDisabled={disabled}
            description={hint}
            status={status}
            value={text}
            onChange={(v) => onChange(v || (stored ? { set: true } : ''))}
          />
        </StackItem>
        {stored && !disabled && (
          <Button label={t('secretRemove')} variant="secondary" onClick={() => onChange(null)} />
        )}
      </HStack>
    );

  return (
    <Field
      label={label}
      inputID={id}
      isRequired={field.required}
      isDisabled={disabled}
      description={hint}
      descriptionID={describedBy}
      status={status ? { ...status, messageID: describedBy } : undefined}
      statusVariant="detached"
    >
      {templated ? (
        <VStack gap={1.5}>
          <TemplateInput
            id={id}
            handleRef={editor}
            value={text}
            onChange={onChange}
            labelOf={values.labelOf}
            multiline={field.type === 'textarea'}
            rows={field.key === 'body' ? 8 : 4}
            mono={field.key === 'body'}
            placeholder={localize(field.placeholder, locale) || undefined}
            disabled={disabled}
            invalid={Boolean(error)}
            ariaLabel={label}
            describedBy={
              [help && describedBy, example && `${id}-example`].filter(Boolean).join(' ') || undefined
            }
          />
          <HStack gap={2} hAlign="between" vAlign="start">
            <StackItem size="fill">
              {example && (
                <Text type="supporting" id={`${id}-example`} maxLines={3}>
                  {t('example', { text: example })}
                </Text>
              )}
            </StackItem>
            <InsertValueMenu
              values={values.items}
              fieldLabel={label}
              onInsert={(path) => editor.current?.insert(path)}
              disabled={disabled}
            />
          </HStack>
        </VStack>
      ) : (
        <FieldControl
          field={field}
          value={value}
          onChange={onChange}
          locale={locale}
          disabled={disabled}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={help ? describedBy : undefined}
        />
      )}
    </Field>
  );
}

/* ───────────────────────── editor sheet ───────────────────────── */

function ActionSheet({
  action,
  item,
  isNew,
  fields,
  formName,
  facts,
  hasApproval,
  readOnly,
  onSave,
  onClose,
}: {
  action: FormAction;
  item: ProcessActionType | undefined;
  isNew: boolean;
  fields: readonly FieldDef[];
  formName?: LocalizedText;
  /** What "Only when…" can test. */
  facts: readonly FactOption[];
  hasApproval: boolean;
  readOnly: boolean;
  onSave: (a: FormAction) => void;
  onClose: () => void;
}) {
  const t = useTranslations('forms.actions');
  const root = useTranslations();
  const errorText = useFieldErrorText();
  const uid = useId();
  const [value, setValue] = useState<FormAction>(action);
  const [tried, setTried] = useState(false);
  const values = useTemplateValues(fields, formName);
  const errors = actionErrors(value, item);
  const whenIncomplete = incompleteConditions(value.when) > 0;
  const secrets = new Set(item?.secrets ?? []);
  const shown = item ? visibleFields(item.fields, value.config) : [];
  const setConfig = (key: string, v: unknown) =>
    setValue((cur) => ({ ...cur, config: { ...cur.config, [key]: v } }));
  const save = () => {
    setTried(true);
    if (Object.keys(errors).length || whenIncomplete) return;
    const name = value.name && hasText(value.name) ? value.name : undefined;
    const { name: _name, when, ...rest } = value;
    onSave({ ...rest, ...(name ? { name } : {}), ...(when ? { when } : {}) });
  };
  const typeName = item ? root(item.name) : value.type;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-xl" closeLabel={t('close')}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Icon icon={navIcon(item?.icon ?? undefined)} color="accent" />
            {isNew ? t('addTitle', { name: typeName }) : t('editTitle', { name: typeName })}
          </SheetTitle>
          <SheetDescription>{item ? root(item.description) : t('unavailable')}</SheetDescription>
        </SheetHeader>
        <SheetBody className="pb-6">
          <VStack gap={5}>
            {readOnly && item && (
              <Banner
                status="info"
                collapsible={false}
                icon={<Icon icon={LockIcon} />}
                title={t('readOnly', { permission: item.permission })}
              />
            )}
            <Selector
              label={t('on')}
              description={hasApproval ? t('onHint') : t('noApprovalHint')}
              value={value.on}
              isDisabled={readOnly}
              onChange={(on) => setValue((cur) => ({ ...cur, on: on as ProcessActionOutcome }))}
              options={PROCESS_ACTION_OUTCOMES.map((o) => ({ value: o, label: t(`outcomes.${o}`) }))}
            />
            <Field
              label={t('name')}
              inputID={`${uid}-name`}
              description={t('nameHint')}
              isDisabled={readOnly}
            >
              <LocalizedInput
                id={`${uid}-name`}
                value={value.name ?? {}}
                disabled={readOnly}
                placeholder={typeName}
                onChange={(name: LocalizedText) => setValue((cur) => ({ ...cur, name }))}
              />
            </Field>
            <fieldset disabled={readOnly}>
              <Field
                label={t('when')}
                isGroupLabel
                labelIcon={FilterIcon}
                inputID={`${uid}-when`}
                description={t('whenHint')}
                status={tried && whenIncomplete ? { type: 'error', message: t('whenIncomplete') } : undefined}
                statusVariant="detached"
              >
                <div id={`${uid}-when`}>
                  <ConditionBuilder
                    value={value.when}
                    facts={facts}
                    emptyText={t('whenEmpty')}
                    onChange={(when: Condition | undefined) =>
                      setValue((cur) => {
                        const { when: _w, ...rest } = cur;
                        return when ? { ...rest, when } : rest;
                      })
                    }
                  />
                </div>
              </Field>
            </fieldset>
            {item ? (
              <VStack as="section" gap={4} aria-labelledby={`${uid}-settings`}>
                <Heading level={3} id={`${uid}-settings`}>
                  {t('settings')}
                </Heading>
                {shown.map((f) => (
                  <ConfigField
                    key={f.key}
                    field={f}
                    value={value.config[f.key]}
                    onChange={(v) => setConfig(f.key, v)}
                    error={tried && errors[f.key] ? errorText(errors[f.key]!) : null}
                    secret={secrets.has(f.key)}
                    stored={isSet(action.config[f.key])}
                    values={values}
                    disabled={readOnly}
                  />
                ))}
                {item.fields.some((f) => f.type === 'text' || f.type === 'textarea') && (
                  <HStack gap={2} vAlign="start">
                    <Icon icon={InfoIcon} size="sm" color="secondary" />
                    <StackItem size="fill">
                      <Text type="supporting">{t('templatesHint')}</Text>
                    </StackItem>
                  </HStack>
                )}
              </VStack>
            ) : (
              <HStack gap={2} vAlign="center" role="status">
                <Icon icon={TriangleAlertIcon} color="secondary" />
                <Text color="secondary">{t('unavailable')}</Text>
              </HStack>
            )}
            {tried && Object.keys(errors).length > 0 && (
              <FieldStatus
                type="error"
                variant="detached"
                message={t('fixIssues', { count: Object.keys(errors).length })}
              />
            )}
          </VStack>
        </SheetBody>
        <SheetFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button label={readOnly ? t('close') : t('cancel')} variant="ghost" onClick={onClose} />
          {!readOnly && <Button label={isNew ? t('add') : t('apply')} variant="primary" onClick={save} />}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ───────────────────────── type picker ───────────────────────── */

function TypePicker({
  items,
  onPick,
  onClose,
}: {
  items: readonly ProcessActionType[];
  onPick: (item: ProcessActionType) => void;
  onClose: () => void;
}) {
  const t = useTranslations('forms.actions');
  const root = useTranslations();
  const allowed = items.filter((i) => i.allowed);
  const close = (open: boolean) => {
    if (!open) onClose();
  };
  return (
    <FormDialog
      isOpen
      onOpenChange={close}
      title={t('pickerTitle')}
      subtitle={t('pickerDescription')}
      size="lg"
    >
      <VStack gap={2}>
        <List hasDividers>
          {allowed.map((item) => (
            <ListItem
              key={item.type}
              label={root(item.name)}
              description={root(item.description)}
              startContent={
                <IconTile aria-hidden size="sm">
                  <Icon icon={navIcon(item.icon ?? undefined)} />
                </IconTile>
              }
              onClick={() => onPick(item)}
            />
          ))}
        </List>
        {allowed.length < items.length && (
          <HStack gap={2} vAlign="start" paddingInline={2}>
            <Icon icon={LockIcon} size="sm" color="secondary" />
            <StackItem size="fill">
              <Text type="supporting">{t('someNotAllowed', { count: items.length - allowed.length })}</Text>
            </StackItem>
          </HStack>
        )}
      </VStack>
    </FormDialog>
  );
}

/* ───────────────────────── the tab ───────────────────────── */

/**
 * The Actions tab: what the form does after a request is sent, approved or rejected (raise a change, grant a role,
 * notify people, call a webhook…). Each action is added from a type picker, configured with the shared field
 * renderer (text fields can insert values from the answers), named, timed and ordered. The API checks the same
 * fields and the editor's permission for each action type when the form is saved.
 */
export function FormActions({
  actions,
  elements,
  items,
  loading,
  hasApproval,
  workflowId,
  formName,
  readOnly,
  onChange,
}: {
  actions: readonly FormAction[];
  elements: readonly FormElement[];
  /** The form's name: "Form name" values in the examples. */
  formName?: LocalizedText;
  items: readonly ProcessActionType[] | null;
  loading: boolean;
  hasApproval: boolean;
  /** The attached workflow: its step fields are offered to "Only when…". */
  workflowId?: string | null;
  readOnly?: boolean;
  onChange: (actions: FormAction[], tag?: string) => void;
}) {
  const t = useTranslations('forms.actions');
  const root = useTranslations();
  const locale = useLocale();
  const fields = useMemo(() => elements.filter(isField), [elements]);
  const facts = useActionFacts(fields, workflowId);
  const conditionText = useConditionText(facts);
  const issues = useMemo(() => actionsIssues(actions, items), [actions, items]);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<{ action: FormAction; isNew: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const itemOf = (type: string) => items?.find((i) => i.type === type);
  const nameOf = (a: FormAction) => {
    const item = itemOf(a.type);
    return localize(a.name, locale) || (item ? root(item.name) : a.type);
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= actions.length) return;
    const next = [...actions];
    const [moved] = next.splice(i, 1);
    next.splice(j, 0, moved!);
    onChange(next);
    setAnnouncement(t('moved', { name: nameOf(moved!), position: j + 1, total: actions.length }));
  };

  return (
    <VStack gap={4} maxWidth={768} className="mx-auto w-full">
      <HStack gap={3} wrap="wrap" hAlign="between" vAlign="start">
        <StackItem size="fill">
          <VStack gap={0.5}>
            <Heading level={2}>{t('title')}</Heading>
            <Text type="supporting">{t('description')}</Text>
          </VStack>
        </StackItem>
        {!readOnly && (
          <Button
            label={t('addAction')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            isDisabled={!items?.some((i) => i.allowed)}
            onClick={() => setPicking(true)}
          />
        )}
      </HStack>
      {!hasApproval && actions.some((a) => a.on !== 'submitted') && (
        <Banner status="info" collapsible={false} title={t('noApprovalHint')} />
      )}
      {loading && !items ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : !actions.length ? (
        <EmptyState
          icon={<WorkflowIcon />}
          title={t('emptyTitle')}
          description={t('emptyHint')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <AnimatedList as="ol" className="-mb-3" aria-label={t('title')}>
          {actions.map((a, i) => {
            const item = itemOf(a.type);
            const problems = issues.get(a.id) ?? 0;
            const name = nameOf(a);
            const locked = Boolean(item && !item.allowed);
            return (
              <AnimatedItem key={a.id} className="pb-3">
                <Card>
                  <CardContent>
                    <VStack gap={2}>
                      <HStack gap={3} vAlign="start">
                        <IconTile aria-hidden size="sm">
                          <Icon icon={navIcon(item?.icon ?? undefined)} />
                        </IconTile>
                        <StackItem size="fill">
                          <VStack gap={1}>
                            <Text weight="medium" wordBreak="break-word">
                              {name}
                            </Text>
                            <HStack gap={1.5} wrap="wrap" vAlign="center">
                              <Badge variant="neutral" label={t(`outcomesShort.${a.on}`)} />
                              {hasText(a.name) && item && <Text type="supporting">{root(item.name)}</Text>}
                              {a.when && (
                                <HStack gap={1} vAlign="center">
                                  <Icon icon={FilterIcon} size="xsm" color="secondary" />
                                  <Text type="supporting" wordBreak="break-word">
                                    {t('onlyWhen', { condition: conditionText(a.when) })}
                                  </Text>
                                </HStack>
                              )}
                              {locked && (
                                <HStack gap={1} vAlign="center">
                                  <Icon icon={LockIcon} size="xsm" color="secondary" />
                                  <Text type="supporting">{t('locked')}</Text>
                                </HStack>
                              )}
                              {!item && items && (
                                <HStack gap={1} vAlign="center">
                                  <Icon icon={TriangleAlertIcon} size="xsm" color="secondary" />
                                  <Text type="supporting">{t('unavailableShort')}</Text>
                                </HStack>
                              )}
                            </HStack>
                          </VStack>
                        </StackItem>
                        <HStack gap={1} wrap="wrap" hAlign="end">
                          {!readOnly && (
                            <>
                              <IconButton
                                label={t('moveUp', { name })}
                                variant="ghost"
                                icon={<Icon icon={ArrowUpIcon} />}
                                isDisabled={i === 0}
                                onClick={() => move(i, -1)}
                              />
                              <IconButton
                                label={t('moveDown', { name })}
                                variant="ghost"
                                icon={<Icon icon={ArrowDownIcon} />}
                                isDisabled={i === actions.length - 1}
                                onClick={() => move(i, 1)}
                              />
                            </>
                          )}
                          <IconButton
                            label={t('edit', { name })}
                            variant="ghost"
                            icon={<Icon icon={PencilIcon} />}
                            onClick={() => setEditing({ action: a, isNew: false })}
                          />
                          {!readOnly && !locked && (
                            <IconButton
                              label={t('remove', { name })}
                              variant="ghost"
                              icon={<Icon icon={Trash2Icon} />}
                              onClick={() => {
                                onChange(actions.filter((x) => x.id !== a.id));
                                setAnnouncement(t('removed', { name }));
                              }}
                            />
                          )}
                        </HStack>
                      </HStack>
                      {problems > 0 && (
                        <HStack>
                          <Badge
                            variant="error"
                            label={t('issues', { count: problems })}
                            icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
                          />
                        </HStack>
                      )}
                    </VStack>
                  </CardContent>
                </Card>
              </AnimatedItem>
            );
          })}
        </AnimatedList>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {picking && items && (
        <TypePicker
          items={items}
          onClose={() => setPicking(false)}
          onPick={(item) => {
            setPicking(false);
            setEditing({
              isNew: true,
              action: {
                id: newElementId('a'),
                on: hasApproval ? 'approved' : 'submitted',
                type: item.type,
                config: defaultsOf(item),
              },
            });
          }}
        />
      )}
      {editing && (
        <ActionSheet
          key={editing.action.id}
          action={editing.action}
          item={itemOf(editing.action.type)}
          isNew={editing.isNew}
          fields={fields}
          formName={formName}
          facts={facts}
          hasApproval={hasApproval}
          readOnly={
            Boolean(readOnly) || Boolean(itemOf(editing.action.type) && !itemOf(editing.action.type)!.allowed)
          }
          onClose={() => setEditing(null)}
          onSave={(action) => {
            onChange(
              editing.isNew ? [...actions, action] : actions.map((x) => (x.id === action.id ? action : x)),
              `action-${action.id}`,
            );
            setAnnouncement(
              editing.isNew ? t('added', { name: nameOf(action) }) : t('updated', { name: nameOf(action) }),
            );
            setEditing(null);
          }}
        />
      )}
    </VStack>
  );
}
