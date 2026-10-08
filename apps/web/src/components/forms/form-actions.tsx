'use client';

import type { ProcessActionType, WorkflowDefinition } from '@isbp/contracts';
import {
  type ApprovalStep,
  type Condition,
  evaluateCondition,
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
  STEP_FACTS_ROOT,
  validateFields,
  walkSteps,
} from '@isbp/sdk';
import { useApi } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { ConditionBuilder, type FactOption, useConditionText } from '@isbp/ui/condition-builder';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@isbp/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { FieldControl, useFieldErrorText } from '@isbp/ui/form-renderer';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
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
import { Textarea } from '@isbp/ui/textarea';
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
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cleanElement, hasText, newElementId, useTodayFact } from '@/components/fields/field-utils';
import { NavIcon } from '@/components/nav-icon';
import { fieldType, useFieldFacts } from '@/components/workflows/field-facts';
import { useApiQuery } from '@/lib/api';

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
}

/** Values a text field can insert: the form's answers (raw and as shown), picked records' facts, the request. */
function useTemplateValues(fields: readonly FieldDef[]): TemplateValue[] {
  const t = useTranslations('forms.actions.values');
  const locale = useLocale();
  const facts = useFieldFacts(fields, 'data');
  return useMemo(() => {
    const shown = new Set(['select', 'multiselect', 'user', 'boolean']);
    const answers: TemplateValue[] = facts
      .filter((f) => f.path.startsWith('data.'))
      .flatMap((f) => {
        const key = f.path.slice(5);
        const field = fields.find((x) => x.key === key);
        const own = { path: f.path, label: f.label, group: 'answers' as const };
        return field && shown.has(field.type)
          ? [
              own,
              {
                path: `answers.${key}`,
                label: t('asShown', { field: localize(field.label, locale) || key }),
                group: 'answers' as const,
              },
            ]
          : [own];
      });
    const records: TemplateValue[] = facts
      .filter((f) => f.path.startsWith('records.'))
      .map((f) => ({ path: f.path, label: f.label, group: 'records' }));
    const request: TemplateValue[] = (
      [
        ['request.reference', 'reference'],
        ['request.url', 'url'],
        ['request.form', 'form'],
        ['requester.displayName', 'requesterName'],
        ['requester.email', 'requesterEmail'],
        ['decidedBy.displayName', 'decidedBy'],
      ] as const
    ).map(([path, key]) => ({ path, label: t(key), group: 'request' }));
    return [...answers, ...records, ...request];
  }, [facts, fields, locale, t]);
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
  const groups = (['answers', 'records', 'request'] as const)
    .map((g) => ({ g, items: values.filter((v) => v.group === g) }))
    .filter((x) => x.items.length);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={t('insertFor', { field: fieldLabel })}
        >
          <BracesIcon /> <span className="hidden sm:inline">{t('insert')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
        {groups.map(({ g, items }, i) => (
          <DropdownMenuGroup key={g}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{t(`valueGroups.${g}`)}</DropdownMenuLabel>
            {items.map((v) => (
              <DropdownMenuItem key={v.path} onSelect={() => onInsert(v.path)} className="grid gap-0.5">
                <span className="truncate">{v.label}</span>
                <code className="truncate font-mono text-[11px] text-muted-foreground">{`{{${v.path}}}`}</code>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  values: readonly TemplateValue[];
  disabled?: boolean;
}) {
  const t = useTranslations('forms.actions');
  const locale = useLocale();
  const id = useId();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const label = localize(field.label, locale) || field.key;
  const describedBy = `${id}-hint`;
  const help = error ?? (secret && stored ? t('secretStored') : localize(field.help, locale));
  const templated = !secret && (field.type === 'text' || field.type === 'textarea');
  const text = typeof value === 'string' ? value : '';

  const insert = (path: string) => {
    const token = `{{${path}}}`;
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    onChange(text.slice(0, start) + token + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const common = {
    id,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': help ? describedBy : undefined,
  };

  return (
    <div className={field.width === 'half' ? 'grid min-w-0 gap-1.5' : 'grid min-w-0 gap-1.5 sm:col-span-2'}>
      <div className="flex min-w-0 items-end justify-between gap-2">
        <Label htmlFor={id} className="min-w-0">
          <span className="truncate">{label}</span>
          {field.required && (
            <span aria-hidden className="text-destructive">
              *
            </span>
          )}
        </Label>
        {templated && (
          <InsertValueMenu values={values} fieldLabel={label} onInsert={insert} disabled={disabled} />
        )}
      </div>
      {secret ? (
        <div className="flex gap-2">
          <Input
            {...common}
            ref={ref}
            type="password"
            autoComplete="new-password"
            value={text}
            onChange={(e) => onChange(e.target.value || (stored ? { set: true } : ''))}
          />
          {stored && !disabled && (
            <Button type="button" variant="outline" onClick={() => onChange(null)}>
              {t('secretRemove')}
            </Button>
          )}
        </div>
      ) : field.type === 'textarea' ? (
        <Textarea
          {...common}
          ref={ref}
          rows={field.key === 'body' ? 8 : 4}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className={field.key === 'body' ? 'font-mono text-xs' : undefined}
        />
      ) : field.type === 'text' ? (
        <Input {...common} ref={ref} value={text} onChange={(e) => onChange(e.target.value)} />
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
      {help && (
        <p
          id={describedBy}
          className={error ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'}
        >
          {help}
        </p>
      )}
    </div>
  );
}

/* ───────────────────────── editor sheet ───────────────────────── */

function ActionSheet({
  action,
  item,
  isNew,
  fields,
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
  const values = useTemplateValues(fields);
  const errors = actionErrors(value, item);
  const secrets = new Set(item?.secrets ?? []);
  const shown = item ? visibleFields(item.fields, value.config) : [];
  const setConfig = (key: string, v: unknown) =>
    setValue((cur) => ({ ...cur, config: { ...cur.config, [key]: v } }));
  const save = () => {
    setTried(true);
    if (Object.keys(errors).length) return;
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
            <NavIcon name={item?.icon ?? undefined} className="size-4 shrink-0 text-primary" />
            {isNew ? t('addTitle', { name: typeName }) : t('editTitle', { name: typeName })}
          </SheetTitle>
          <SheetDescription>{item ? root(item.description) : t('unavailable')}</SheetDescription>
        </SheetHeader>
        <SheetBody className="grid gap-5 pb-6">
          {readOnly && item && (
            <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t('readOnly', { permission: item.permission })}
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-on`}>{t('on')}</Label>
            <Select
              value={value.on}
              disabled={readOnly}
              onValueChange={(on) => setValue((cur) => ({ ...cur, on: on as ProcessActionOutcome }))}
            >
              <SelectTrigger id={`${uid}-on`} className="w-full" aria-describedby={`${uid}-on-hint`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROCESS_ACTION_OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {t(`outcomes.${o}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={`${uid}-on-hint`} className="text-xs text-muted-foreground">
              {hasApproval ? t('onHint') : t('noApprovalHint')}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-name`}>{t('name')}</Label>
            <LocalizedInput
              id={`${uid}-name`}
              value={value.name ?? {}}
              disabled={readOnly}
              placeholder={typeName}
              aria-describedby={`${uid}-name-hint`}
              onChange={(name: LocalizedText) => setValue((cur) => ({ ...cur, name }))}
            />
            <p id={`${uid}-name-hint`} className="text-xs text-muted-foreground">
              {t('nameHint')}
            </p>
          </div>
          <fieldset className="grid gap-2" disabled={readOnly} aria-describedby={`${uid}-when-hint`}>
            <legend className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <FilterIcon className="size-3.5 text-muted-foreground" aria-hidden /> {t('when')}
            </legend>
            <p id={`${uid}-when-hint`} className="-mt-1 text-xs text-muted-foreground">
              {t('whenHint')}
            </p>
            <ConditionBuilder
              value={value.when}
              facts={facts}
              onChange={(when: Condition | undefined) =>
                setValue((cur) => {
                  const { when: _w, ...rest } = cur;
                  return when ? { ...rest, when } : rest;
                })
              }
            />
          </fieldset>
          {item ? (
            <fieldset className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-medium">{t('settings')}</legend>
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
                <p className="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-2">
                  <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('templatesHint')}
                </p>
              )}
            </fieldset>
          ) : (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <TriangleAlertIcon className="size-4 shrink-0" aria-hidden /> {t('unavailable')}
            </p>
          )}
          {tried && Object.keys(errors).length > 0 && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {t('fixIssues', { count: Object.keys(errors).length })}
            </p>
          )}
        </SheetBody>
        <SheetFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            {readOnly ? t('close') : t('cancel')}
          </Button>
          {!readOnly && (
            <Button type="button" onClick={save}>
              {isNew ? t('add') : t('apply')}
            </Button>
          )}
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
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl" closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('pickerTitle')}</DialogTitle>
          <DialogDescription>{t('pickerDescription')}</DialogDescription>
        </DialogHeader>
        <ul
          className="grid max-h-[60dvh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2"
          aria-label={t('pickerTitle')}
        >
          {allowed.map((item) => (
            <li key={item.type} className="min-w-0">
              <button
                type="button"
                onClick={() => onPick(item)}
                className="flex h-full w-full min-w-0 items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
                  <NavIcon name={item.icon ?? undefined} />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="font-medium break-words">{root(item.name)}</span>
                  <span className="text-xs break-words text-muted-foreground">{root(item.description)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {allowed.length < items.length && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />{' '}
            {t('someNotAllowed', { count: items.length - allowed.length })}
          </p>
        )}
      </DialogContent>
    </Dialog>
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
  readOnly,
  onChange,
}: {
  actions: readonly FormAction[];
  elements: readonly FormElement[];
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
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        {!readOnly && (
          <Button type="button" onClick={() => setPicking(true)} disabled={!items?.some((i) => i.allowed)}>
            <PlusIcon /> {t('addAction')}
          </Button>
        )}
      </div>
      {!hasApproval && actions.some((a) => a.on !== 'submitted') && (
        <p className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('noApprovalHint')}
        </p>
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
        <ol className="grid gap-3" aria-label={t('title')}>
          <AnimatePresence initial={false}>
            {actions.map((a, i) => {
              const item = itemOf(a.type);
              const problems = issues.get(a.id) ?? 0;
              const name = nameOf(a);
              const locked = Boolean(item && !item.allowed);
              return (
                <motion.li
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="grid gap-2 rounded-xl border bg-card p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
                      <NavIcon name={item?.icon ?? undefined} />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium break-words">{name}</p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="muted">{t(`outcomesShort.${a.on}`)}</Badge>
                        {hasText(a.name) && item && <span>{root(item.name)}</span>}
                        {a.when && (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <FilterIcon className="size-3 shrink-0" aria-hidden />
                            <span className="break-words">
                              {t('onlyWhen', { condition: conditionText(a.when) })}
                            </span>
                          </span>
                        )}
                        {locked && (
                          <span className="inline-flex items-center gap-1">
                            <LockIcon className="size-3" aria-hidden /> {t('locked')}
                          </span>
                        )}
                        {!item && items && (
                          <span className="inline-flex items-center gap-1">
                            <TriangleAlertIcon className="size-3" aria-hidden /> {t('unavailableShort')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {!readOnly && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('moveUp', { name })}
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('moveDown', { name })}
                            disabled={i === actions.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            <ArrowDownIcon />
                          </Button>
                        </>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('edit', { name })}
                        onClick={() => setEditing({ action: a, isNew: false })}
                      >
                        <PencilIcon />
                      </Button>
                      {!readOnly && !locked && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('remove', { name })}
                          onClick={() => {
                            onChange(actions.filter((x) => x.id !== a.id));
                            setAnnouncement(t('removed', { name }));
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </div>
                  </div>
                  {problems > 0 && (
                    <div>
                      <Badge variant="destructive">
                        <TriangleAlertIcon aria-hidden /> {t('issues', { count: problems })}
                      </Badge>
                    </div>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
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
    </div>
  );
}
