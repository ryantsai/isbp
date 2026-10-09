'use client';

import { cn } from '@isbp/ui';
import { Checkbox } from '@isbp/ui/checkbox';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { CopyIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useId } from 'react';
import { PRIORITIES, type Priority } from '../../sla-coverage';
import { durationParts, parseDuration } from './logic';

export type Prio = '1' | '2' | '3' | '4';
export const PRIOS: Prio[] = ['1', '2', '3', '4'];
export type Targets = Record<Prio, { responseMinutes: number; resolutionMinutes: number }>;
/** What the person typed per priority (kept as text so a half-typed value isn't lost). */
export type TargetTexts = Record<Prio, { response: string; resolution: string }>;

export const DEFAULT_TARGETS: Targets = {
  '1': { responseMinutes: 15, resolutionMinutes: 240 },
  '2': { responseMinutes: 30, resolutionMinutes: 480 },
  '3': { responseMinutes: 240, resolutionMinutes: 1440 },
  '4': { responseMinutes: 480, resolutionMinutes: 2400 },
};

/** "4h", "30m", "1h 30m" in the UI language (and parseable back). */
export function useFormatTarget() {
  const t = useTranslations('itsm.settingsPage.duration');
  return useCallback(
    (minutes: number) => {
      const p = durationParts(minutes);
      const values = { hours: String(p.hours), minutes: String(p.minutes) };
      if (!p.hours) return t('minutes', values);
      return p.minutes ? t('both', values) : t('hours', values);
    },
    [t],
  );
}

export function textsOf(targets: Partial<Targets> | undefined, format: (m: number) => string): TargetTexts {
  const full = { ...DEFAULT_TARGETS, ...targets };
  return Object.fromEntries(
    PRIOS.map((p) => [
      p,
      { response: format(full[p].responseMinutes), resolution: format(full[p].resolutionMinutes) },
    ]),
  ) as TargetTexts;
}

/** True when every visible priority has the same two targets. */
export function allSame(texts: TargetTexts, visible: readonly Priority[]) {
  const rows = visible.map((p) => texts[String(p) as Prio]);
  return rows.every(
    (r) =>
      parseDuration(r.response) === parseDuration(rows[0]!.response) &&
      parseDuration(r.resolution) === parseDuration(rows[0]!.resolution),
  );
}

/**
 * Minutes for every priority, or null when a visible one isn't a valid duration. With `same`, the first visible row
 * counts for every visible priority. Hidden priorities (the rules exclude them) keep their values: a ticket whose
 * priority changes later keeps the policy, and takes its target for the new priority.
 */
export function targetsOf(texts: TargetTexts, visible: readonly Priority[], same: boolean): Targets | null {
  const first = String(visible[0] ?? 1) as Prio;
  const out = {} as Targets;
  for (const p of PRIOS) {
    const shown = visible.includes(Number(p) as Priority);
    const row = same && shown ? texts[first] : texts[p];
    const responseMinutes = parseDuration(row.response);
    const resolutionMinutes = parseDuration(row.resolution);
    if (responseMinutes === null || resolutionMinutes === null) {
      if (shown) return null;
      out[p] = DEFAULT_TARGETS[p];
    } else out[p] = { responseMinutes, resolutionMinutes };
  }
  return out;
}

function DurationField({
  value,
  onChange,
  label,
  showError,
  describedBy,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  showError: boolean;
  describedBy?: string;
}) {
  const bad = showError && parseDuration(value) === null;
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      aria-invalid={bad || undefined}
      aria-describedby={describedBy}
      inputMode="text"
      autoComplete="off"
      spellCheck={false}
      className={cn('h-8 w-full min-w-20 px-2 tabular-nums sm:w-28')}
    />
  );
}

/**
 * Response and resolution targets per priority as compact durations, one row per priority the policy's rules allow,
 * or one row for all of them ("Same for all priorities").
 */
export function TargetsEditor({
  value,
  onChange,
  visible,
  same,
  onSameChange,
  showErrors,
  copiedFrom,
}: {
  value: TargetTexts;
  onChange: (v: TargetTexts) => void;
  /** Priorities the policy's rules allow (the others are hidden). */
  visible: readonly Priority[];
  same: boolean;
  onSameChange: (same: boolean) => void;
  showErrors: boolean;
  /** Name of the policy the targets were copied from (until the person changes them). */
  copiedFrom?: string | null;
}) {
  const t = useTranslations('itsm.settingsPage.sla');
  const tt = useTranslations('itsm');
  const format = useFormatter();
  const id = useId();
  const rows: (Prio | 'all')[] = same && visible.length > 1 ? ['all'] : visible.map((p) => String(p) as Prio);
  const first = String(visible[0] ?? 1) as Prio;
  const set = (row: Prio | 'all', key: 'response' | 'resolution', v: string) => {
    const targetsOfRow = row === 'all' ? visible.map((p) => String(p) as Prio) : [row];
    onChange(
      Object.fromEntries(
        PRIOS.map((p) => [p, targetsOfRow.includes(p) ? { ...value[p], [key]: v } : value[p]]),
      ) as TargetTexts,
    );
  };
  const invalid =
    showErrors &&
    rows.some((r) => {
      const row = value[r === 'all' ? first : r];
      return parseDuration(row.response) === null || parseDuration(row.resolution) === null;
    });
  const rowLabel = (r: Prio | 'all') => (r === 'all' ? t('allPriorities') : tt(`priority.${r}`));

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{t('targets')}</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {visible.length > 1 && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-same`}
              checked={same}
              onCheckedChange={(c) => {
                const on = c === true;
                if (on) {
                  const base = value[first];
                  onChange(
                    Object.fromEntries(
                      PRIOS.map((p) => [p, visible.includes(Number(p) as Priority) ? { ...base } : value[p]]),
                    ) as TargetTexts,
                  );
                }
                onSameChange(on);
              }}
            />
            <Label htmlFor={`${id}-same`} className="font-normal">
              {t('samePriorities')}
            </Label>
          </div>
        )}
        {copiedFrom && (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CopyIcon className="size-3.5" aria-hidden />
            {t('copiedFrom', { name: copiedFrom })}
          </p>
        )}
      </div>
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
            {rows.map((r) => {
              const row = value[r === 'all' ? first : r];
              const label = rowLabel(r);
              return (
                <tr key={r} className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                    {label}
                  </th>
                  <td className="px-3 py-2">
                    <DurationField
                      value={row.response}
                      onChange={(v) => set(r, 'response', v)}
                      label={`${label}: ${tt('slaMetric.response')}`}
                      showError={showErrors}
                      describedBy={`${id}-hint`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <DurationField
                      value={row.resolution}
                      onChange={(v) => set(r, 'resolution', v)}
                      label={`${label}: ${tt('slaMetric.resolution')}`}
                      showError={showErrors}
                      describedBy={`${id}-hint`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length < PRIORITIES.length && (
        <p className="text-xs text-muted-foreground">
          {t('onlyPriorities', {
            priorities: format.list(
              visible.map((p) => tt(`priorityShort.${p}`)),
              { type: 'conjunction' },
            ),
          })}
        </p>
      )}
      <p
        id={`${id}-hint`}
        className={cn('text-xs', invalid ? 'text-sm text-destructive' : 'text-muted-foreground')}
      >
        {invalid ? t('durationInvalid') : t('durationHint')}
      </p>
    </fieldset>
  );
}
