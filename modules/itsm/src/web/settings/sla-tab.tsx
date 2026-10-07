'use client';

import type { Condition } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { ConditionBuilder, type FactOption, useConditionText } from '@isbp/ui/condition-builder';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
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
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import { CalendarClockIcon, PencilIcon, PlusIcon, TimerIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import type { z } from 'zod';
import {
  channelSchema,
  DEFAULT_PAUSE_STATUSES,
  type SlaPolicy,
  type TicketStatus,
  type TicketType,
  type upsertSlaPolicySchema,
} from '../../contracts';
import { INVALIDATE, useCategories, useDuration } from '../lib';
import { isDone, statusesOf } from '../statuses';
import type { CalendarDto } from '../types';
import { CheckGroup, DeleteButton, TypeChecks } from './shared';

type PolicyInput = z.input<typeof upsertSlaPolicySchema>;
type Prio = '1' | '2' | '3' | '4';
type Targets = Record<Prio, { responseMinutes: number; resolutionMinutes: number }>;
const PRIOS: Prio[] = ['1', '2', '3', '4'];
const NO_CALENDARS: CalendarDto[] = [];

const DEFAULT_TARGETS: Targets = {
  '1': { responseMinutes: 15, resolutionMinutes: 240 },
  '2': { responseMinutes: 30, resolutionMinutes: 480 },
  '3': { responseMinutes: 240, resolutionMinutes: 1440 },
  '4': { responseMinutes: 480, resolutionMinutes: 2400 },
};

/** Ticket facts SLA conditions can test. */
export function useSlaFacts(): FactOption[] {
  const t = useTranslations('itsm.settingsPage.sla.facts');
  const tt = useTranslations('itsm');
  const { tree } = useCategories(undefined, true);
  return useMemo(
    () => [
      { path: 'ticket.priority', label: t('priority'), type: 'number' },
      {
        path: 'ticket.categoryKey',
        label: t('category'),
        type: 'string',
        options: tree.map((n) => ({ value: n.category.key, label: n.path })),
      },
      { path: 'ticket.major', label: t('major'), type: 'boolean' },
      {
        path: 'ticket.channel',
        label: t('channel'),
        type: 'string',
        options: channelSchema.options.map((c) => ({ value: c, label: tt(`channel.${c}`) })),
      },
      { path: 'ticket.impact', label: t('impact'), type: 'number' },
      { path: 'ticket.urgency', label: t('urgency'), type: 'number' },
    ],
    [t, tt, tree],
  );
}

/** Hours + minutes inputs for one target (stored as minutes). */
function DurationInput({
  minutes,
  onChange,
  label,
}: {
  minutes: number;
  onChange: (m: number) => void;
  label: string;
}) {
  const t = useTranslations('itsm.settingsPage.sla');
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={8760}
        value={h}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0) * 60 + m)}
        aria-label={t('hoursOf', { target: label })}
        className="h-8 w-16 px-2 text-right tabular-nums"
      />
      <span className="text-xs text-muted-foreground" aria-hidden>
        {t('h')}
      </span>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={59}
        value={m}
        onChange={(e) => onChange(h * 60 + Math.min(59, Math.max(0, Number(e.target.value) || 0)))}
        aria-label={t('minutesOf', { target: label })}
        className="h-8 w-14 px-2 text-right tabular-nums"
      />
      <span className="text-xs text-muted-foreground" aria-hidden>
        {t('m')}
      </span>
    </div>
  );
}

function PolicySheet({
  policy,
  calendars,
  open,
  onOpenChange,
}: {
  policy: SlaPolicy | null;
  calendars: CalendarDto[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('itsm.settingsPage.sla');
  const tt = useTranslations('itsm');
  const tc = useTranslations('common');
  const id = useId();
  const facts = useSlaFacts();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [types, setTypes] = useState<TicketType[]>(['incident']);
  const [condition, setCondition] = useState<Condition | undefined>(undefined);
  const [targets, setTargets] = useState<Targets>(DEFAULT_TARGETS);
  const [calendarId, setCalendarId] = useState<string>('');
  const [pause, setPause] = useState<TicketStatus[]>([...DEFAULT_PAUSE_STATUSES]);
  const [warnPct, setWarnPct] = useState(75);
  const [sortOrder, setSortOrder] = useState(100);
  const [active, setActive] = useState(true);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(policy?.name ?? '');
    setDescription(policy?.description ?? '');
    setTypes(policy?.ticketTypes ?? ['incident']);
    setCondition(policy?.condition ?? undefined);
    setTargets({ ...DEFAULT_TARGETS, ...(policy?.targets as Partial<Targets> | undefined) });
    setCalendarId(policy?.calendar.id ?? calendars[0]?.id ?? '');
    setPause(policy?.pauseStatuses ?? [...DEFAULT_PAUSE_STATUSES]);
    setWarnPct(Math.round((policy?.warnAt ?? 0.75) * 100));
    setSortOrder(policy?.sortOrder ?? 100);
    setActive(policy?.active ?? true);
    setTouched(false);
  }, [open, policy, calendars]);

  const save = useApiMutation(
    (api, body: PolicyInput) =>
      policy
        ? api.patch<SlaPolicy>(`/itsm/sla-policies/${policy.id}`, body)
        : api.post<SlaPolicy>('/itsm/sla-policies', body),
    { invalidate: INVALIDATE, success: tc('saved'), onSuccess: () => onOpenChange(false) },
  );
  const remove = useApiMutation((api) => api.delete(`/itsm/sla-policies/${policy!.id}`), {
    invalidate: INVALIDATE,
    success: tc('deleted'),
    onSuccess: () => onOpenChange(false),
  });
  const pausable = statusesOf().filter(
    (s) => !isDone(s) && (types.length === 0 || types.some((ty) => statusesOf(ty).includes(s))),
  );
  const invalidTargets = PRIOS.some(
    (p) => targets[p].responseMinutes < 1 || targets[p].resolutionMinutes < 1,
  );
  const errors = {
    name: !name.trim(),
    types: !types.length,
    calendar: !calendarId,
    targets: invalidTargets,
    warn: warnPct < 10 || warnPct > 99,
  };
  const invalid = Object.values(errors).some(Boolean);
  const setTarget = (p: Prio, k: 'responseMinutes' | 'resolutionMinutes', v: number) =>
    setTargets((cur) => ({ ...cur, [p]: { ...cur[p], [k]: v } }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <form
          noValidate
          className="flex h-full flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (invalid) return;
            save.mutate({
              name: name.trim(),
              description: description.trim() || null,
              ticketTypes: types,
              condition: condition ?? null,
              targets,
              calendarId,
              pauseStatuses: pause.filter((s) => pausable.includes(s)),
              warnAt: warnPct / 100,
              sortOrder,
              active,
            });
          }}
        >
          <SheetHeader>
            <SheetTitle>{policy ? t('editTitle') : t('createTitle')}</SheetTitle>
            <SheetDescription>{t('sheetHint')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-6">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-name`}>{t('name')}</Label>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={touched && errors.name ? true : undefined}
                aria-describedby={touched && errors.name ? `${id}-name-error` : undefined}
              />
              {touched && errors.name && (
                <p id={`${id}-name-error`} className="text-sm text-destructive">
                  {t('nameRequired')}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-description`}>{t('descriptionLabel')}</Label>
              <Textarea
                id={`${id}-description`}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
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
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('targets')}</legend>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium">
                        {t('priority')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium">
                        {tt('slaMetric.response')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium">
                        {tt('slaMetric.resolution')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRIOS.map((p) => (
                      <tr key={p} className="border-t">
                        <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                          {tt(`priority.${p}`)}
                        </th>
                        <td className="px-3 py-2">
                          <DurationInput
                            minutes={targets[p].responseMinutes}
                            onChange={(v) => setTarget(p, 'responseMinutes', v)}
                            label={`${tt(`priorityShort.${p}`)} ${tt('slaMetric.response')}`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <DurationInput
                            minutes={targets[p].resolutionMinutes}
                            onChange={(v) => setTarget(p, 'resolutionMinutes', v)}
                            label={`${tt(`priorityShort.${p}`)} ${tt('slaMetric.resolution')}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {touched && errors.targets && <p className="text-sm text-destructive">{t('targetsInvalid')}</p>}
            </fieldset>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`${id}-calendar`}>{t('calendar')}</Label>
                <Select value={calendarId || undefined} onValueChange={setCalendarId}>
                  <SelectTrigger
                    id={`${id}-calendar`}
                    className="w-full"
                    aria-invalid={touched && errors.calendar ? true : undefined}
                  >
                    <SelectValue placeholder={t('calendarPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {calendars.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-warn`}>{t('warnAt')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${id}-warn`}
                    type="number"
                    min={10}
                    max={99}
                    value={warnPct}
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
            </div>
            <CheckGroup
              label={t('pauseStatuses')}
              options={pausable}
              value={pause}
              onChange={setPause}
              render={(s) => tt(`status.${s}`)}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`${id}-order`}>{t('sortOrder')}</Label>
                <Input
                  id={`${id}-order`}
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                  aria-describedby={`${id}-order-hint`}
                />
                <p id={`${id}-order-hint`} className="text-xs text-muted-foreground">
                  {t('sortOrderHint')}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 self-start rounded-lg border px-3 py-2 sm:mt-7">
                <Label htmlFor={`${id}-active`}>{t('active')}</Label>
                <Switch id={`${id}-active`} checked={active} onCheckedChange={setActive} />
              </div>
            </div>
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {tc('save')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** SLA policies: list with a summary of each, plus the editor sheet. */
export function SlaTab() {
  const t = useTranslations('itsm.settingsPage.sla');
  const tt = useTranslations('itsm');
  const tc = useTranslations('common');
  const duration = useDuration();
  const facts = useSlaFacts();
  const conditionText = useConditionText(facts);
  const policies = useApiQuery<{ items: SlaPolicy[] }>('/itsm/sla-policies');
  const calendars = useApiQuery<{ items: CalendarDto[] }>('/itsm/calendars');
  const [editing, setEditing] = useState<SlaPolicy | null>(null);
  const [open, setOpen] = useState(false);
  const items = [...(policies.data?.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const edit = (p: SlaPolicy | null) => {
    setEditing(p);
    setOpen(true);
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
        <Button onClick={() => edit(null)} disabled={!calendars.data?.items.length}>
          <PlusIcon />
          {t('new')}
        </Button>
      </div>
      {policies.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !items.length ? (
        <EmptyState icon={<TimerIcon />} title={t('empty')} className="rounded-xl border border-dashed" />
      ) : (
        <ul className="grid gap-3">
          {items.map((p, i) => (
            <motion.li
              key={p.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i, 10) * 0.04 }}
              className={cn('grid gap-3 rounded-xl border bg-card p-4 shadow-xs', !p.active && 'bg-muted/30')}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="text-xs text-muted-foreground tabular-nums">#{p.sortOrder}</span>
                    {p.name}
                    {!p.active && <Badge variant="muted">{t('inactive')}</Badge>}
                  </h3>
                  {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => edit(p)}>
                  <PencilIcon />
                  {tc('edit')}
                </Button>
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{t('appliesTo')}</dt>
                  <dd>
                    {p.ticketTypes.map((ty) => tt(`typesPlural.${ty}`)).join(', ')}
                    {p.condition && (
                      <span className="text-muted-foreground"> · {conditionText(p.condition)}</span>
                    )}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{t('calendar')}</dt>
                  <dd className="inline-flex items-center gap-1.5">
                    <CalendarClockIcon className="size-3.5 text-muted-foreground" aria-hidden />
                    {p.calendar.name}
                  </dd>
                </div>
              </dl>
              <div className="overflow-x-auto">
                <table className="w-full min-w-96 text-xs">
                  <caption className="sr-only">{t('targets')}</caption>
                  <thead>
                    <tr className="text-muted-foreground">
                      <th scope="col" className="py-1 pr-3 text-left font-medium">
                        {t('priority')}
                      </th>
                      {PRIOS.map((pr) => (
                        <th key={pr} scope="col" className="px-2 py-1 text-right font-medium">
                          {tt(`priorityShort.${pr}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(['responseMinutes', 'resolutionMinutes'] as const).map((k) => (
                      <tr key={k} className="border-t">
                        <th scope="row" className="py-1 pr-3 text-left font-normal text-muted-foreground">
                          {tt(`slaMetric.${k === 'responseMinutes' ? 'response' : 'resolution'}`)}
                        </th>
                        {PRIOS.map((pr) => {
                          const v = (p.targets as Partial<Targets>)[pr]?.[k];
                          return (
                            <td key={pr} className="px-2 py-1 text-right tabular-nums">
                              {v ? duration(v * 60_000) : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
      <PolicySheet
        policy={editing}
        calendars={calendars.data?.items ?? NO_CALENDARS}
        open={open}
        onOpenChange={setOpen}
      />
    </section>
  );
}
