'use client';

import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { pixel, proportional, Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
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
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  showError: boolean;
}) {
  const bad = showError && parseDuration(value) === null;
  return (
    <TextInput
      label={label}
      isLabelHidden
      value={value}
      onChange={onChange}
      autoComplete="off"
      status={bad ? { type: 'error' } : undefined}
      width="100%"
    />
  );
}

/** One row of the editor: the priority (or "all priorities") and what is typed for it. */
interface TargetRow extends Record<string, unknown> {
  key: Prio | 'all';
  label: string;
  response: string;
  resolution: string;
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
  const data: TargetRow[] = rows.map((r) => {
    const row = value[r === 'all' ? first : r];
    return { key: r, label: rowLabel(r), response: row.response, resolution: row.resolution };
  });

  return (
    <Field
      label={t('targets')}
      isGroupLabel
      labelID={`${id}-label`}
      inputID={`${id}-targets`}
      description={invalid ? undefined : t('durationHint')}
      status={invalid ? { type: 'error', message: t('durationInvalid') } : undefined}
      statusVariant="detached"
    >
      <VStack gap={2} role="group" aria-labelledby={`${id}-label`}>
        <HStack gap={2} wrap="wrap" hAlign="between" vAlign="center">
          {visible.length > 1 && (
            <CheckboxInput
              label={t('samePriorities')}
              value={same}
              onChange={(on) => {
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
          )}
          {copiedFrom && (
            <HStack gap={1.5} vAlign="center">
              <Icon icon={CopyIcon} size="sm" color="secondary" />
              <Text type="supporting">{t('copiedFrom', { name: copiedFrom })}</Text>
            </HStack>
          )}
        </HStack>
        <Table
          data={data}
          idKey="key"
          density="compact"
          columns={[
            {
              key: 'label',
              header: t('priority'),
              width: proportional(1, { minWidth: 120 }),
              renderCell: (r) => <Text weight="medium">{r.label}</Text>,
            },
            {
              key: 'response',
              header: tt('slaMetric.response'),
              width: pixel(140),
              renderCell: (r) => (
                <DurationField
                  value={r.response}
                  onChange={(v) => set(r.key, 'response', v)}
                  label={`${r.label}: ${tt('slaMetric.response')}`}
                  showError={showErrors}
                />
              ),
            },
            {
              key: 'resolution',
              header: tt('slaMetric.resolution'),
              width: pixel(140),
              renderCell: (r) => (
                <DurationField
                  value={r.resolution}
                  onChange={(v) => set(r.key, 'resolution', v)}
                  label={`${r.label}: ${tt('slaMetric.resolution')}`}
                  showError={showErrors}
                />
              ),
            },
          ]}
        />
        {visible.length < PRIORITIES.length && (
          <Text type="supporting">
            {t('onlyPriorities', {
              priorities: format.list(
                visible.map((p) => tt(`priorityShort.${p}`)),
                { type: 'conjunction' },
              ),
            })}
          </Text>
        )}
      </VStack>
    </Field>
  );
}
