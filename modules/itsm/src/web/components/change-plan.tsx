'use client';

import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { CheckCircle2Icon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { changeTypeSchema, riskSchema } from '../../contracts';
import { fromLocalInput, ticketHref } from '../lib';
import type { ChangeConflict, ChangeType, Risk } from '../types';
import { TicketStatusBadge } from './badges';

export interface ChangePlanValues {
  changeType: ChangeType;
  risk: Risk;
  reason: string;
  /** `datetime-local` values. */
  plannedStart: string;
  plannedEnd: string;
  implementationPlan: string;
  backoutPlan: string;
  testPlan: string;
}

export const emptyPlan: ChangePlanValues = {
  changeType: 'normal',
  risk: 'medium',
  reason: '',
  plannedStart: '',
  plannedEnd: '',
  implementationPlan: '',
  backoutPlan: '',
  testPlan: '',
};

/** The window ends after it starts (both optional while drafting). */
export const windowInvalid = (v: Pick<ChangePlanValues, 'plannedStart' | 'plannedEnd'>) =>
  Boolean(v.plannedStart && v.plannedEnd && v.plannedEnd <= v.plannedStart);

export type ChangePlanPart = 'classification' | 'reason' | 'window' | 'plans';
const ALL_PARTS: readonly ChangePlanPart[] = ['classification', 'reason', 'window', 'plans'];

/**
 * Type, risk, reason, planned window and the implementation / backout / test plans (`parts` picks some, in this
 * order). `windowRequired`: the window is needed now (submitting) — empty fields are errors.
 */
export function ChangePlanFields({
  value,
  onChange,
  showErrors,
  parts = ALL_PARTS,
  windowRequired,
}: {
  value: ChangePlanValues;
  onChange: (v: ChangePlanValues) => void;
  showErrors?: boolean;
  parts?: readonly ChangePlanPart[];
  windowRequired?: boolean;
}) {
  const t = useTranslations('itsm');
  const tp = useTranslations('itsm.changePlan');
  const id = useId();
  const set = <K extends keyof ChangePlanValues>(k: K, v: ChangePlanValues[K]) =>
    onChange({ ...value, [k]: v });
  const badWindow = showErrors && windowInvalid(value);
  const missingStart = showErrors && windowRequired && !value.plannedStart;
  const missingEnd = showErrors && windowRequired && !value.plannedEnd;
  return (
    <div className="grid gap-4">
      {parts.includes('classification') && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-type`}>{tp('changeType')}</Label>
            <Select value={value.changeType} onValueChange={(v) => set('changeType', v as ChangeType)}>
              <SelectTrigger id={`${id}-type`} className="w-full" aria-describedby={`${id}-type-hint`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {changeTypeSchema.options.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`changeType.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={`${id}-type-hint`} className="text-xs text-muted-foreground">
              {tp(`typeHint.${value.changeType}`)}
            </p>
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-risk`}>{tp('risk')}</Label>
            <Select value={value.risk} onValueChange={(v) => set('risk', v as Risk)}>
              <SelectTrigger id={`${id}-risk`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {riskSchema.options.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`risk.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      {parts.includes('reason') && (
        <div className="grid gap-2">
          <Label htmlFor={`${id}-reason`}>{tp('reason')}</Label>
          <Textarea
            id={`${id}-reason`}
            rows={2}
            value={value.reason}
            onChange={(e) => set('reason', e.target.value)}
          />
        </div>
      )}
      {parts.includes('window') && (
        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">{tp('window')}</legend>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-start`} className="text-xs text-muted-foreground">
              {tp('start')}
            </Label>
            <Input
              id={`${id}-start`}
              type="datetime-local"
              value={value.plannedStart}
              onChange={(e) => set('plannedStart', e.target.value)}
              aria-invalid={missingStart || undefined}
              aria-describedby={missingStart ? `${id}-start-error` : undefined}
            />
            {missingStart && (
              <p id={`${id}-start-error`} className="text-sm text-destructive">
                {tp('windowRequired')}
              </p>
            )}
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-end`} className="text-xs text-muted-foreground">
              {tp('end')}
            </Label>
            <Input
              id={`${id}-end`}
              type="datetime-local"
              value={value.plannedEnd}
              min={value.plannedStart || undefined}
              onChange={(e) => set('plannedEnd', e.target.value)}
              aria-invalid={badWindow || missingEnd || undefined}
              aria-describedby={badWindow || missingEnd ? `${id}-end-error` : undefined}
            />
            {(badWindow || missingEnd) && (
              <p id={`${id}-end-error`} className="text-sm text-destructive">
                {badWindow ? tp('endBeforeStart') : tp('windowRequired')}
              </p>
            )}
          </div>
        </fieldset>
      )}
      {parts.includes('plans') &&
        (['implementationPlan', 'backoutPlan', 'testPlan'] as const).map((k) => (
          <div key={k} className="grid gap-2">
            <Label htmlFor={`${id}-${k}`}>{tp(k)}</Label>
            <Textarea id={`${id}-${k}`} rows={3} value={value[k]} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
    </div>
  );
}

/** Live check for other changes touching the same CIs in an overlapping window. */
export function ConflictCheck({
  plannedStart,
  plannedEnd,
  ciIds,
  exclude,
}: {
  plannedStart: string;
  plannedEnd: string;
  ciIds: string[];
  exclude?: string;
}) {
  const t = useTranslations('itsm.changePlan.conflicts');
  const format = useFormatter();
  const [query, setQuery] = useState<{ start: string; end: string; ciIds: string } | null>(null);
  const ciKey = ciIds.join(',');
  // Debounced so typing a date doesn't fire a request per keystroke.
  useEffect(() => {
    const start = fromLocalInput(plannedStart);
    const end = fromLocalInput(plannedEnd);
    const h = setTimeout(
      () => setQuery(start && end && end > start && ciKey ? { start, end, ciIds: ciKey } : null),
      400,
    );
    return () => clearTimeout(h);
  }, [plannedStart, plannedEnd, ciKey]);
  const { data, isFetching } = useApiQuery<{ items: ChangeConflict[] }>(
    query ? '/itsm/changes/conflicts' : null,
    query ? { ...query, exclude } : undefined,
  );
  if (!query) return null;
  const items = data?.items ?? [];
  return (
    <div aria-live="polite" aria-busy={isFetching || undefined}>
      {!data ? null : items.length ? (
        <div className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlertIcon className="size-4 shrink-0 text-warning-foreground" aria-hidden />
            {t('found', { count: items.length })}
          </p>
          <ul className="grid gap-1.5">
            {items.map((c) => (
              <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={ticketHref(c.reference)}
                  className="font-mono text-xs font-medium hover:underline"
                >
                  {c.reference}
                </Link>
                <span className="min-w-0 truncate">{c.title}</span>
                <TicketStatusBadge status={c.status} />
                <span className="w-full text-xs text-muted-foreground">
                  {format.dateTimeRange(new Date(c.plannedStart), new Date(c.plannedEnd), {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' · '}
                  {t('shared', { cis: c.sharedCis.map((s) => s.name).join(', ') })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2Icon className="size-4" aria-hidden />
          {t('none')}
        </p>
      )}
    </div>
  );
}
