'use client';

import { type Condition, localize, type LocalizedText } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { ConditionBuilder, type FactOption, useConditionText } from '@isbp/ui/condition-builder';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import {
  CalendarClockIcon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  TimerIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useId, useMemo, useState } from 'react';
import type { z } from 'zod';
import {
  channelSchema,
  DEFAULT_PAUSE_STATUSES,
  type SlaPolicy,
  type TicketStatus,
  type TicketType,
  type upsertSlaPolicySchema,
} from '../../contracts';
import {
  type PolicyReach,
  placementFor,
  PRIORITIES,
  type Priority,
  prioritiesOf,
  policyReach,
  reachAfter,
} from '../../sla-coverage';
import { INVALIDATE, useCategories } from '../lib';
import { isDone, statusesOf } from '../statuses';
import type { CalendarDto } from '../types';
import {
  CheckGroup,
  DeleteButton,
  MoveButtons,
  refocus,
  TypeChecks,
  usePolicies,
  useSheetParam,
} from './shared';
import { moved } from './logic';
import {
  allSame,
  type Prio,
  type Targets,
  TargetsEditor,
  type TargetTexts,
  targetsOf,
  textsOf,
  useFormatTarget,
} from './targets';

type PolicyInput = z.input<typeof upsertSlaPolicySchema>;
type Policies = ReturnType<typeof usePolicies>;
const NO_CALENDARS: CalendarDto[] = [];

/** Ticket facts SLA conditions can test ("Category (with subcategories)" first: the usual rule). */
export function useSlaFacts(): FactOption[] {
  const t = useTranslations('itsm.settingsPage.sla.facts');
  const tt = useTranslations('itsm');
  const { tree } = useCategories(undefined, true);
  return useMemo(() => {
    const categories = tree.map((n) => ({ value: n.category.key, label: n.path }));
    return [
      { path: 'ticket.categoryKeys', label: t('categoryTree'), type: 'string', options: categories },
      { path: 'ticket.priority', label: t('priority'), type: 'number' },
      { path: 'ticket.major', label: t('major'), type: 'boolean' },
      {
        path: 'ticket.channel',
        label: t('channel'),
        type: 'string',
        options: channelSchema.options.map((c) => ({ value: c, label: tt(`channel.${c}`) })),
      },
      { path: 'ticket.impact', label: t('impact'), type: 'number' },
      { path: 'ticket.urgency', label: t('urgency'), type: 'number' },
      { path: 'ticket.categoryKey', label: t('category'), type: 'string', options: categories },
    ];
  }, [t, tt, tree]);
}

/** Sentences for where a policy can't apply ("This policy will never apply: …"). */
function useReachLines(policies: Pick<Policies, 'nameOf' | 'positionOf'>) {
  const t = useTranslations('itsm.settingsPage.sla.reach');
  const tt = useTranslations('itsm.settingsPage.sla.typesInSentence');
  const format = useFormatter();
  const { nameOf, positionOf } = policies;
  return useCallback(
    (reach: PolicyReach | null, types: readonly TicketType[]): string[] => {
      if (!reach?.blocked.length) return [];
      const by = [...new Set(reach.blocked.map((b) => b.by))];
      if (reach.blocked.length === types.length && by.length === 1)
        return [by[0] ? t('never', { name: nameOf(by[0]), position: positionOf(by[0]) }) : t('neverNoMatch')];
      return by.map((q) => {
        const list = format.list(
          reach.blocked.filter((b) => b.by === q).map((b) => tt(b.type)),
          { type: 'conjunction' },
        );
        return q
          ? t('notFor', { types: list, name: nameOf(q), position: positionOf(q) })
          : t('notForNoMatch', { types: list });
      });
    },
    [t, tt, format, nameOf, positionOf],
  );
}

function Notice({
  tone,
  children,
  action,
}: {
  tone: 'warning' | 'info';
  children: ReactNode;
  action?: ReactNode;
}) {
  const Icon = tone === 'warning' ? TriangleAlertIcon : InfoIcon;
  return (
    <div
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-sm',
        tone === 'warning' ? 'border-warning/40 bg-warning/10 text-warning-foreground' : 'bg-muted/40',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid min-w-0 flex-1 basis-60 gap-1">{children}</div>
      {action}
    </div>
  );
}

/** "Incidents · Category is Hardware" — what a policy applies to. */
function useAppliesText() {
  const tt = useTranslations('itsm');
  const format = useFormatter();
  const facts = useSlaFacts();
  const conditionText = useConditionText(facts);
  return useCallback(
    (p: Pick<SlaPolicy, 'ticketTypes' | 'condition'>) =>
      [
        format.list(
          p.ticketTypes.map((ty) => tt(`typesPlural.${ty}`)),
          { type: 'conjunction' },
        ),
        p.condition && conditionText(p.condition),
      ]
        .filter(Boolean)
        .join(' · '),
    [tt, format, conditionText],
  );
}

interface FormProps {
  policy: SlaPolicy | null;
  calendars: CalendarDto[];
  policies: Policies;
  onDone: () => void;
}

/** The policy editor; mounted fresh for every opening (`key`), so its state starts from the policy. */
function PolicyForm({ policy, calendars, policies, onDone }: FormProps) {
  const t = useTranslations('itsm.settingsPage.sla');
  const tt = useTranslations('itsm');
  const tc = useTranslations('common');
  const locale = useLocale();
  const id = useId();
  const facts = useSlaFacts();
  const format = useFormatTarget();
  const formatter = useFormatter();
  const reachLines = useReachLines(policies);
  const { ordered, asCoverage, coverage, nameOf, positionOf } = policies;

  const [name, setName] = useState<LocalizedText>(policy?.name ?? {});
  const [description, setDescription] = useState(policy?.description ?? '');
  const [types, setTypes] = useState<TicketType[]>(policy?.ticketTypes ?? ['incident']);
  const [condition, setCondition] = useState<Condition | undefined>(policy?.condition ?? undefined);
  // New policies copy targets, calendar and pause statuses from the policy they take tickets from, until changed.
  const [texts, setTexts] = useState<TargetTexts | null>(policy ? textsOf(policy.targets, format) : null);
  const [same, setSame] = useState<boolean | null>(null);
  const [calendarId, setCalendarId] = useState(policy?.calendar.id ?? '');
  const [pause, setPause] = useState<TicketStatus[] | null>(policy?.pauseStatuses ?? null);
  const [warnPct, setWarnPct] = useState<number | null>(policy ? Math.round(policy.warnAt * 100) : null);
  const [active, setActive] = useState(policy?.active ?? true);
  /** "Check it first": put it before this policy when saving. */
  const [placeBefore, setPlaceBefore] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const candidate = { ticketTypes: types, condition: condition ?? null };
  const others = asCoverage.filter((p) => p.id !== policy?.id);
  /** Where a new policy goes (or where "Check it first" puts an existing one). */
  const placement = placementFor(candidate, others, coverage);
  const source = policy ? null : (ordered.find((p) => p.id === placement) ?? null);
  const index = policy ? ordered.findIndex((p) => p.id === policy.id) : -1;
  const earlier = placeBefore
    ? others.slice(
        0,
        others.findIndex((p) => p.id === placeBefore),
      )
    : policy
      ? asCoverage.slice(0, index)
      : others.slice(0, placement ? others.findIndex((p) => p.id === placement) : others.length);
  const reach = reachAfter(candidate, earlier, coverage);
  const lines = reachLines(reach, types);
  /** Policies that would stop applying to some ticket type once this one is placed (new, or "Check it first"). */
  const target = placeBefore ?? (policy ? undefined : placement);
  let shadowed: string[] = [];
  if (target !== undefined) {
    const list = [...others];
    const at = target ? list.findIndex((p) => p.id === target) : list.length;
    list.splice(at < 0 ? list.length : at, 0, { id: policy?.id ?? '__new__', ...candidate, active: true });
    const after = policyReach(list, coverage);
    shadowed = ordered
      .filter((q) => q.id !== policy?.id && q.active)
      .filter((q) =>
        (after.get(q.id)?.blocked ?? []).some((b) => !q.reach?.blocked.some((x) => x.type === b.type)),
      )
      .map((q) => q.id);
  }
  const shadowText = shadowed.length
    ? t('reach.shadows', {
        names: formatter.list(
          shadowed.map((q) => t('quoted', { name: nameOf(q) })),
          { type: 'conjunction' },
        ),
      })
    : null;

  const visible = prioritiesOf(condition ?? null, coverage);
  const shownTexts = texts ?? textsOf(source?.targets, format);
  const shownSame = same ?? (visible.length > 1 && allSame(shownTexts, visible));
  const shownCalendar = calendarId || source?.calendar.id || calendars[0]?.id || '';
  const shownPause = pause ?? source?.pauseStatuses ?? [...DEFAULT_PAUSE_STATUSES];
  const shownWarn = warnPct ?? Math.round((source?.warnAt ?? 0.75) * 100);
  const targets: Targets | null = targetsOf(shownTexts, visible, shownSame);
  const pausable = statusesOf().filter(
    (s) => !isDone(s) && (types.length === 0 || types.some((ty) => statusesOf(ty).includes(s))),
  );

  const errors = {
    name: !Object.values(name).some((v) => v?.trim()),
    types: !types.length,
    calendar: !shownCalendar,
    targets: !targets,
    warn: shownWarn < 10 || shownWarn > 99,
  };
  const invalid = Object.values(errors).some(Boolean);
  const snapshot = JSON.stringify([
    name,
    description,
    types,
    condition ?? null,
    texts,
    same,
    calendarId,
    pause,
    warnPct,
    active,
    placeBefore,
  ]);
  const [initial] = useState(snapshot);
  const dirty = snapshot !== initial;

  const list = useFieldList();
  const moreFilled = countFilled(description);

  const save = useApiMutation(
    (api, body: PolicyInput) =>
      policy
        ? api.patch<SlaPolicy>(`/itsm/sla-policies/${policy.id}`, body)
        : api.post<SlaPolicy>('/itsm/sla-policies', body),
    { invalidate: INVALIDATE, success: tc('saved'), onSuccess: onDone },
  );
  const remove = useApiMutation((api) => api.delete(`/itsm/sla-policies/${policy!.id}`), {
    invalidate: INVALIDATE,
    success: tc('deleted'),
    onSuccess: onDone,
  });

  return (
    <SheetContent className="sm:max-w-2xl" closeLabel={tc('close')} dirty={dirty && !save.isSuccess}>
      <SheetForm
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (invalid || !targets) return;
          save.mutate({
            name,
            description: description.trim() || null,
            ticketTypes: types,
            condition: condition ?? null,
            targets,
            calendarId: shownCalendar,
            pauseStatuses: shownPause.filter((s) => pausable.includes(s)),
            warnAt: shownWarn / 100,
            active,
            // New policies are placed by the server (before the policy that would take their tickets).
            ...(placeBefore ? { placeBefore } : {}),
          });
        }}
      >
        <SheetHeader>
          <SheetTitle>{policy ? t('editTitle') : t('createTitle')}</SheetTitle>
          <SheetDescription>{t('sheetHint')}</SheetDescription>
        </SheetHeader>
        <SheetBody className="grid content-start gap-4 pb-6">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-name`}>{t('name')}</Label>
            <LocalizedInput
              id={`${id}-name`}
              value={name}
              onChange={setName}
              invalid={touched && errors.name}
              aria-describedby={`${id}-name-hint`}
            />
            <p
              id={`${id}-name-hint`}
              className={cn(
                'text-xs',
                touched && errors.name ? 'text-sm text-destructive' : 'text-muted-foreground',
              )}
            >
              {touched && errors.name ? t('nameRequired') : t('nameHint')}
            </p>
          </div>

          <div className="grid gap-4">
            <TypeChecks
              label={t('types')}
              value={types}
              onChange={setTypes}
              invalid={touched && errors.types}
            />
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('condition')}</legend>
              <p className="text-xs text-muted-foreground">{t('conditionHint')}</p>
              <ConditionBuilder value={condition} onChange={setCondition} facts={facts} />
            </fieldset>
            <div role="status" aria-live="polite" className="empty:hidden">
              {lines.length > 0 && !placeBefore ? (
                <Notice
                  tone="warning"
                  action={
                    policy && placement ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPlaceBefore(placement)}
                      >
                        {t('reach.checkFirst')}
                      </Button>
                    ) : undefined
                  }
                >
                  {lines.map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                </Notice>
              ) : placeBefore ? (
                <Notice
                  tone={shadowText ? 'warning' : 'info'}
                  action={
                    <Button type="button" size="sm" variant="ghost" onClick={() => setPlaceBefore(null)}>
                      {t('reach.keepPlace')}
                    </Button>
                  }
                >
                  <p>
                    {t('reach.willMove', { name: nameOf(placeBefore), position: positionOf(placeBefore) })}
                  </p>
                  {shadowText && <p>{shadowText}</p>}
                </Notice>
              ) : !policy && placement ? (
                <Notice tone={shadowText ? 'warning' : 'info'}>
                  <p>
                    {t('reach.placedBefore', { name: nameOf(placement), position: positionOf(placement) })}
                  </p>
                  {shadowText && <p>{shadowText}</p>}
                </Notice>
              ) : null}
            </div>
          </div>

          <TargetsEditor
            value={shownTexts}
            onChange={setTexts}
            visible={visible}
            same={shownSame}
            onSameChange={setSame}
            showErrors={touched}
            copiedFrom={!texts && source ? localize(source.name, locale) : null}
          />

          <div className="grid gap-2">
            <Label htmlFor={`${id}-calendar`}>{t('calendar')}</Label>
            <Select value={shownCalendar || undefined} onValueChange={setCalendarId}>
              <SelectTrigger
                id={`${id}-calendar`}
                className="w-full"
                aria-invalid={touched && errors.calendar ? true : undefined}
                aria-describedby={`${id}-calendar-hint`}
              >
                <SelectValue placeholder={t('calendarPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.alwaysOpen && !/24\s*[×x]\s*7/i.test(c.name)
                      ? t('calendarAlwaysOpen', { name: c.name })
                      : c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={`${id}-calendar-hint`} className="text-xs text-muted-foreground">
              {t('calendarHint')}
            </p>
          </div>

          {policy && (
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <Label htmlFor={`${id}-active`} className="flex-col items-start gap-0.5">
                <span>{t('active')}</span>
                <span className="text-xs font-normal text-muted-foreground">{t('activeHint')}</span>
              </Label>
              <Switch id={`${id}-active`} checked={active} onCheckedChange={setActive} />
            </div>
          )}
          <OptionalFields
            label={t('moreOptions')}
            hint={list([t('descriptionLabel'), t('warnAt')])}
            filled={moreFilled}
          >
            <div className="grid gap-2">
              <Label htmlFor={`${id}-description`}>{t('descriptionLabel')}</Label>
              <Textarea
                id={`${id}-description`}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-warn`}>{t('warnAt')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${id}-warn`}
                  type="number"
                  min={10}
                  max={99}
                  value={shownWarn}
                  onChange={(e) => setWarnPct(Number(e.target.value) || 0)}
                  aria-invalid={touched && errors.warn ? true : undefined}
                  aria-describedby={`${id}-warn-hint`}
                  className="w-24 tabular-nums"
                />
                <span className="text-sm text-muted-foreground" aria-hidden>
                  %
                </span>
              </div>
              <p id={`${id}-warn-hint`} className="text-xs text-muted-foreground">
                {t('warnAtHint')}
              </p>
            </div>
            <CheckGroup
              label={t('pauseStatuses')}
              options={pausable}
              value={shownPause}
              onChange={setPause}
              render={(s) => tt(`status.${s}`)}
            />
          </OptionalFields>
          {touched && invalid && (
            <p role="alert" className="text-sm text-destructive">
              {t('fixErrors')}
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          {policy && (
            <DeleteButton
              title={t('deleteTitle')}
              description={t('deleteBody')}
              onConfirm={() => remove.mutate(undefined)}
              pending={remove.isPending}
            />
          )}
          <Button type="button" variant="outline" onClick={onDone}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {tc('save')}
          </Button>
        </SheetFooter>
      </SheetForm>
    </SheetContent>
  );
}

/** Response/resolution per priority on a list card: only the priorities the rules allow, one column when equal. */
function TargetsSummary({ policy, visible }: { policy: SlaPolicy; visible: readonly Priority[] }) {
  const t = useTranslations('itsm.settingsPage.sla');
  const tt = useTranslations('itsm');
  const format = useFormatTarget();
  const formatter = useFormatter();
  const targets = policy.targets as Partial<Targets>;
  const value = (p: Priority, k: 'responseMinutes' | 'resolutionMinutes') => targets[String(p) as Prio]?.[k];
  const equal = visible.every(
    (p) =>
      value(p, 'responseMinutes') === value(visible[0]!, 'responseMinutes') &&
      value(p, 'resolutionMinutes') === value(visible[0]!, 'resolutionMinutes'),
  );
  const columns: { key: string; label: string; p: Priority }[] =
    equal && visible.length > 1
      ? [
          {
            key: 'all',
            label:
              visible.length === PRIORITIES.length
                ? t('allPriorities')
                : formatter.list(
                    visible.map((p) => tt(`priorityShort.${p}`)),
                    { type: 'conjunction', style: 'narrow' },
                  ),
            p: visible[0]!,
          },
        ]
      : visible.map((p) => ({ key: String(p), label: tt(`priorityShort.${p}`), p }));
  return (
    <div className="overflow-x-auto">
      <table className={cn('text-xs', columns.length > 2 ? 'w-full max-w-2xl min-w-80' : 'w-auto')}>
        <caption className="sr-only">{t('targets')}</caption>
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" className="py-1 pr-6 text-left font-medium">
              {t('priority')}
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="px-2 py-1 text-right font-medium whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(['responseMinutes', 'resolutionMinutes'] as const).map((k) => (
            <tr key={k} className="border-t">
              <th
                scope="row"
                className="py-1 pr-6 text-left font-normal whitespace-nowrap text-muted-foreground"
              >
                {tt(`slaMetric.${k === 'responseMinutes' ? 'response' : 'resolution'}`)}
              </th>
              {columns.map((c) => {
                const v = value(c.p, k);
                return (
                  <td key={c.key} className="px-2 py-1 text-right whitespace-nowrap tabular-nums">
                    {v ? format(v) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** SLA policies in evaluation order, each with what it applies to, its targets and whether it can apply at all. */
export function SlaTab() {
  const t = useTranslations('itsm.settingsPage.sla');
  const ts = useTranslations('itsm.settingsPage');
  const tc = useTranslations('common');
  const locale = useLocale();
  const policies = usePolicies();
  const { query, ordered, coverage } = policies;
  const calendars = useApiQuery<{ items: CalendarDto[] }>('/itsm/calendars');
  const sheet = useSheetParam();
  const appliesText = useAppliesText();
  const reachLines = useReachLines(policies);
  // A new key for every opening, so the form starts from the policy (and keeps its content while closing).
  const target = sheet.editing ?? (sheet.creating ? 'new' : null);
  const [session, setSession] = useState({ target, last: target, n: 0 });
  if (target !== session.target)
    setSession({
      target,
      last: target ?? session.last,
      n: target !== null ? session.n + 1 : session.n,
    });
  const editing = ordered.find((p) => p.id === session.last) ?? null;
  const open = (sheet.creating || (sheet.editing !== null && Boolean(editing))) && !calendars.isLoading;

  const reorder = useApiMutation(
    (api, v: { ids: string[]; focus?: { id: string; direction: -1 | 1 } }) =>
      api.put<{ items: SlaPolicy[] }>('/itsm/sla-policies/order', { ids: v.ids }),
    {
      invalidate: INVALIDATE,
      onSuccess: (_r, v) => v.focus && refocus(`sla-${v.focus.id}`, v.focus.direction),
    },
  );
  const move = (index: number, direction: -1 | 1) =>
    reorder.mutate({
      ids: moved(
        ordered.map((p) => p.id),
        index,
        direction,
      ),
      focus: { id: ordered[index]!.id, direction },
    });
  const checkFirst = (p: SlaPolicy, before: string) => {
    const ids = ordered.map((x) => x.id).filter((x) => x !== p.id);
    ids.splice(ids.indexOf(before), 0, p.id);
    reorder.mutate({ ids });
  };

  return (
    <section className="grid gap-4" aria-labelledby="itsm-sla-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="itsm-sla-title" className="text-lg font-semibold">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button onClick={sheet.openCreate} disabled={!calendars.data?.items.length}>
          <PlusIcon />
          {t('new')}
        </Button>
      </div>
      {query.error ? (
        <ErrorState
          error={query.error}
          onRetry={() => query.refetch()}
          kind="list"
          className="rounded-xl border"
        />
      ) : query.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !ordered.length ? (
        <EmptyState icon={<TimerIcon />} title={t('empty')} className="rounded-xl border border-dashed" />
      ) : (
        <AnimatedList as="ol" aria-label={t('title')}>
          {ordered.map((p, i) => {
            const name = localize(p.name, locale);
            const lines = p.active ? reachLines(p.reach, p.ticketTypes) : [];
            const before = p.active
              ? placementFor(
                  { ticketTypes: p.ticketTypes, condition: p.condition },
                  policies.asCoverage.filter((x) => x.id !== p.id),
                  coverage,
                )
              : null;
            const visible = prioritiesOf(p.condition, coverage);
            return (
              <AnimatedItem key={p.id} className="pb-3">
                <article
                  aria-labelledby={`sla-${p.id}-name`}
                  className={cn('grid gap-3 rounded-xl border bg-card p-4', !p.active && 'bg-muted/30')}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className="mt-0.5 grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums"
                        title={t('positionHint')}
                      >
                        <span className="sr-only">{t('position', { position: i + 1 })}</span>
                        <span aria-hidden>{i + 1}</span>
                      </span>
                      <div className="min-w-0">
                        <h3 id={`sla-${p.id}-name`} className="flex flex-wrap items-center gap-2 font-medium">
                          {name}
                          {!p.active && <Badge variant="muted">{t('inactive')}</Badge>}
                        </h3>
                        {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <MoveButtons
                        name={name}
                        first={i === 0}
                        last={i === ordered.length - 1}
                        onMove={(d) => move(i, d)}
                        pending={reorder.isPending}
                        idPrefix={`sla-${p.id}`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => sheet.openEdit(p.id)}
                        aria-label={ts('editItem', { name })}
                      >
                        <PencilIcon />
                        <span className="hidden sm:inline">{tc('edit')}</span>
                      </Button>
                    </div>
                  </div>
                  {lines.length > 0 && (
                    <Notice
                      tone="warning"
                      action={
                        before ? (
                          <Button
                            size="sm"
                            variant="outline"
                            loading={reorder.isPending}
                            onClick={() => checkFirst(p, before)}
                          >
                            {t('reach.checkFirst')}
                          </Button>
                        ) : undefined
                      }
                    >
                      {lines.map((l) => (
                        <p key={l}>{l}</p>
                      ))}
                    </Notice>
                  )}
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{t('appliesTo')}</dt>
                      <dd>{appliesText(p)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{t('calendar')}</dt>
                      <dd className="inline-flex items-center gap-1.5">
                        <CalendarClockIcon className="size-3.5 text-muted-foreground" aria-hidden />
                        {p.calendar.name}
                      </dd>
                    </div>
                  </dl>
                  <TargetsSummary policy={p} visible={visible} />
                </article>
              </AnimatedItem>
            );
          })}
        </AnimatedList>
      )}
      <Sheet open={open} onOpenChange={(o) => !o && sheet.close()}>
        {(open || session.n > 0) && (
          <PolicyForm
            key={session.n}
            policy={editing}
            calendars={calendars.data?.items ?? NO_CALENDARS}
            policies={policies}
            onDone={sheet.close}
          />
        )}
      </Sheet>
    </section>
  );
}
