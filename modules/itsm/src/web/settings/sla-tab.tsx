'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Table } from '@astryxdesign/core/Table';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { type Condition, localize, type LocalizedText } from '@isbp/sdk';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { ConditionBuilder, type FactOption, useConditionText } from '@isbp/ui/condition-builder';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
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
import { CalendarClockIcon, PencilIcon, PlusIcon, TimerIcon } from 'lucide-react';
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
  SettingsSection,
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

/** A notice about where a policy sits in the order: the first line is the headline, the others follow it. */
function Notice({ tone, lines, action }: { tone: 'warning' | 'info'; lines: string[]; action?: ReactNode }) {
  const [title = '', ...rest] = lines;
  return (
    <Banner
      status={tone}
      title={title}
      description={
        rest.length ? (
          <VStack gap={1}>
            {rest.map((l) => (
              <Text as="p" key={l}>
                {l}
              </Text>
            ))}
          </VStack>
        ) : undefined
      }
      endContent={action}
      collapsible={false}
    />
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
        <SheetBody className="pb-6">
          <FormLayout defaultOptionality="optional">
            <Field
              label={t('name')}
              isRequired
              inputID={`${id}-name`}
              description={touched && errors.name ? undefined : t('nameHint')}
              status={touched && errors.name ? { type: 'error', message: t('nameRequired') } : undefined}
              statusVariant="detached"
            >
              <LocalizedInput
                id={`${id}-name`}
                value={name}
                onChange={setName}
                invalid={touched && errors.name}
              />
            </Field>

            <VStack gap={4}>
              <TypeChecks
                label={t('types')}
                value={types}
                onChange={setTypes}
                invalid={touched && errors.types}
              />
              <Field
                label={t('condition')}
                isGroupLabel
                labelID={`${id}-condition-label`}
                inputID={`${id}-condition`}
                description={t('conditionHint')}
              >
                <VStack role="group" aria-labelledby={`${id}-condition-label`} gap={0}>
                  <ConditionBuilder value={condition} onChange={setCondition} facts={facts} />
                </VStack>
              </Field>
              {lines.length > 0 && !placeBefore ? (
                <Notice
                  tone="warning"
                  lines={lines}
                  action={
                    policy && placement ? (
                      <Button
                        label={t('reach.checkFirst')}
                        variant="secondary"
                        size="sm"
                        onClick={() => setPlaceBefore(placement)}
                      />
                    ) : undefined
                  }
                />
              ) : placeBefore ? (
                <Notice
                  tone={shadowText ? 'warning' : 'info'}
                  lines={[
                    t('reach.willMove', { name: nameOf(placeBefore), position: positionOf(placeBefore) }),
                    ...(shadowText ? [shadowText] : []),
                  ]}
                  action={
                    <Button
                      label={t('reach.keepPlace')}
                      variant="ghost"
                      size="sm"
                      onClick={() => setPlaceBefore(null)}
                    />
                  }
                />
              ) : !policy && placement ? (
                <Notice
                  tone={shadowText ? 'warning' : 'info'}
                  lines={[
                    t('reach.placedBefore', { name: nameOf(placement), position: positionOf(placement) }),
                    ...(shadowText ? [shadowText] : []),
                  ]}
                />
              ) : null}
            </VStack>

            <TargetsEditor
              value={shownTexts}
              onChange={setTexts}
              visible={visible}
              same={shownSame}
              onSameChange={setSame}
              showErrors={touched}
              copiedFrom={!texts && source ? localize(source.name, locale) : null}
            />

            <Selector
              label={t('calendar')}
              description={t('calendarHint')}
              placeholder={t('calendarPlaceholder')}
              value={shownCalendar || undefined}
              onChange={setCalendarId}
              status={touched && errors.calendar ? { type: 'error' } : undefined}
              options={calendars.map((c) => ({
                value: c.id,
                label:
                  c.alwaysOpen && !/24\s*[×x]\s*7/i.test(c.name)
                    ? t('calendarAlwaysOpen', { name: c.name })
                    : c.name,
              }))}
            />

            {policy && (
              <Switch label={t('active')} description={t('activeHint')} value={active} onChange={setActive} />
            )}
            <OptionalFields
              label={t('moreOptions')}
              hint={list([t('descriptionLabel'), t('warnAt')])}
              filled={moreFilled}
            >
              <TextArea
                label={t('descriptionLabel')}
                rows={2}
                value={description}
                onChange={setDescription}
              />
              <NumberInput
                label={t('warnAt')}
                description={t('warnAtHint')}
                min={10}
                max={99}
                units="%"
                isIntegerOnly
                value={shownWarn}
                onChange={(v) => setWarnPct(v || 0)}
                status={touched && errors.warn ? { type: 'error' } : undefined}
                width={160}
              />
              <CheckGroup
                label={t('pauseStatuses')}
                options={pausable}
                value={shownPause}
                onChange={setPause}
                render={(s) => tt(`status.${s}`)}
              />
            </OptionalFields>
            {touched && invalid && <Banner status="error" title={t('fixErrors')} collapsible={false} />}
          </FormLayout>
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
          <Button label={tc('cancel')} variant="secondary" onClick={onDone} />
          <Button label={tc('save')} variant="primary" isLoading={save.isPending} type="submit" />
        </SheetFooter>
      </SheetForm>
    </SheetContent>
  );
}

/** One row of the targets table on a list card: the metric and a value per priority column. */
interface SummaryRow extends Record<string, string> {
  key: string;
  metric: string;
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
  const rows = (['responseMinutes', 'resolutionMinutes'] as const).map((k) => {
    const row: SummaryRow = {
      key: k,
      metric: tt(`slaMetric.${k === 'responseMinutes' ? 'response' : 'resolution'}`),
    };
    for (const c of columns) {
      const v = value(c.p, k);
      row[c.key] = v ? format(v) : '—';
    }
    return row;
  });
  return (
    <VStack maxWidth={columns.length > 2 ? 672 : undefined}>
      <Table
        data={rows}
        idKey="key"
        density="compact"
        columns={[
          {
            key: 'metric',
            header: t('priority'),
            renderCell: (r) => <Text color="secondary">{r.metric}</Text>,
          },
          ...columns.map((c) => ({
            key: c.key,
            header: c.label,
            align: 'end' as const,
            renderCell: (r: SummaryRow) => <Text hasTabularNumbers>{r[c.key]}</Text>,
          })),
        ]}
      />
    </VStack>
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
    <SettingsSection
      id="itsm-sla-title"
      title={t('title')}
      description={t('description')}
      action={
        <Button
          label={t('new')}
          variant="primary"
          icon={<Icon icon={PlusIcon} />}
          isDisabled={!calendars.data?.items.length}
          onClick={sheet.openCreate}
        />
      }
    >
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
                <Card role="article" aria-labelledby={`sla-${p.id}-name`}>
                  <CardHeader>
                    <CardTitle>
                      <HStack gap={2} wrap="wrap" vAlign="center">
                        <Tooltip content={t('positionHint')}>
                          <Badge
                            variant="neutral"
                            label={
                              <>
                                <span className="sr-only">{t('position', { position: i + 1 })}</span>
                                <span aria-hidden>{i + 1}</span>
                              </>
                            }
                          />
                        </Tooltip>
                        <Heading level={3} id={`sla-${p.id}-name`}>
                          {name}
                        </Heading>
                        {!p.active && <Badge variant="neutral" label={t('inactive')} />}
                      </HStack>
                    </CardTitle>
                    {p.description && <Text type="supporting">{p.description}</Text>}
                    <CardAction>
                      <HStack gap={1} vAlign="center">
                        <MoveButtons
                          name={name}
                          first={i === 0}
                          last={i === ordered.length - 1}
                          onMove={(d) => move(i, d)}
                          pending={reorder.isPending}
                          idPrefix={`sla-${p.id}`}
                        />
                        <Button
                          label={tc('edit')}
                          aria-label={ts('editItem', { name })}
                          variant="ghost"
                          size="sm"
                          icon={<Icon icon={PencilIcon} />}
                          onClick={() => sheet.openEdit(p.id)}
                        />
                      </HStack>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <VStack gap={3}>
                      {lines.length > 0 && (
                        <Notice
                          tone="warning"
                          lines={lines}
                          action={
                            before ? (
                              <Button
                                label={t('reach.checkFirst')}
                                variant="secondary"
                                size="sm"
                                isLoading={reorder.isPending}
                                onClick={() => checkFirst(p, before)}
                              />
                            ) : undefined
                          }
                        />
                      )}
                      <MetadataList columns="multi">
                        <MetadataListItem label={t('appliesTo')}>{appliesText(p)}</MetadataListItem>
                        <MetadataListItem
                          label={t('calendar')}
                          icon={<Icon icon={CalendarClockIcon} size="sm" color="secondary" />}
                        >
                          {p.calendar.name}
                        </MetadataListItem>
                      </MetadataList>
                      <TargetsSummary policy={p} visible={visible} />
                    </VStack>
                  </CardContent>
                </Card>
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
    </SettingsSection>
  );
}
