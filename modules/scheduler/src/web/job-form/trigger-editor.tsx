'use client';

import { Button } from '@astryxdesign/core/Button';
import { FieldStatus } from '@astryxdesign/core/FieldStatus';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { type ISOTimeString, TimeInput } from '@astryxdesign/core/TimeInput';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { Card, CardContent } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { type SearchableItem, useApiSearchSource } from '@isbp/ui/search-source';
import { GlobeIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  cronOf,
  type JobRef,
  type Preview,
  REPEATS,
  type Repeat,
  type RepeatSpec,
  repeatOf,
  TRIGGER_KINDS,
  type TriggerKind,
} from '../../contracts';
import { localTimeZone, timeZones, useDebounced } from '../lib';
import { useCronText } from '../trigger-text';
import { type Errors, errorStatus } from './fields';

export interface TriggerState {
  kind: TriggerKind;
  cron: string;
  timezone: string;
  intervalMinutes: string;
  upstream: JobRef[];
  mode: 'all' | 'any';
}

const PRESETS = ['*/15 * * * *', '0 * * * *', '0 7 * * *', '30 8 * * 1-5', '0 3 * * 0', '0 2 1 * *'];

const jobItem = (j: JobRef): SearchableItem<JobRef> => ({ id: j.id, label: j.name, auxiliaryData: j });

/** Jobs this one runs after (searchable, multiple). */
function UpstreamPicker({
  value,
  onChange,
  excludeId,
  error,
  disabled,
}: {
  value: JobRef[];
  onChange: (jobs: JobRef[]) => void;
  excludeId?: string;
  error?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('scheduler.form');
  const source = useApiSearchSource<JobRef>({
    path: '/scheduler/lookups/jobs',
    query: (q) => ({ q: q.trim() || undefined }),
    toItem: jobItem,
    exclude: (item) => item.id === excludeId,
  });
  const items = useMemo(() => value.map(jobItem), [value]);
  return (
    <Tokenizer<SearchableItem<JobRef>>
      label={t('upstream')}
      description={t('upstreamHint')}
      placeholder={t('pickUpstream')}
      emptySearchText={t('noJobs')}
      searchSource={source}
      value={items}
      onChange={(next) => onChange(next.flatMap((item) => (item.auxiliaryData ? [item.auxiliaryData] : [])))}
      hasEntriesOnFocus
      status={errorStatus(error)}
      isDisabled={disabled}
    />
  );
}

/** Next run times from the server (the job's time zone), or why the schedule is invalid. */
function NextRuns({
  query,
  timezone,
  onError,
}: {
  query: Record<string, string | number | undefined>;
  timezone: string;
  onError?: string;
}) {
  const t = useTranslations('scheduler.form');
  const format = useFormatter();
  const { data, isFetching } = useApiQuery<Preview>('/scheduler/schedule/preview', query);
  if (!data)
    return isFetching ? (
      <Text size="xsm" color="secondary">
        {t('loading')}
      </Text>
    ) : null;
  if (!data.valid)
    return <FieldStatus type="error" message={onError ?? data.error ?? ''} variant="detached" />;
  return (
    <VStack gap={1}>
      <Text size="xsm" weight="medium" color="secondary">
        {t('nextRuns')}
      </Text>
      <ol className="grid gap-0.5" aria-label={t('nextRuns')}>
        {data.next.map((at) => (
          <li key={at}>
            <Text size="xsm" hasTabularNumbers>
              <time dateTime={at}>
                {format.dateTime(new Date(at), { dateStyle: 'full', timeStyle: 'short', timeZone: timezone })}
              </time>
            </Text>
          </li>
        ))}
      </ol>
    </VStack>
  );
}

/** Weekday names (0 = Sunday) and month names in the viewer's language. */
function useCalendarNames() {
  const format = useFormatter();
  return useMemo(
    () => ({
      weekdays: Array.from({ length: 7 }, (_, d) =>
        format.dateTime(new Date(Date.UTC(2023, 0, 1 + d)), { weekday: 'long', timeZone: 'UTC' }),
      ),
      months: Array.from({ length: 12 }, (_, m) =>
        format.dateTime(new Date(Date.UTC(2024, m, 1)), { month: 'long', timeZone: 'UTC' }),
      ),
    }),
    [format],
  );
}

/**
 * "Repeats [Every month] on day [1] at [08:00]" for the usual schedules; a cron expression only behind
 * "Custom (cron)". The sentence and the next run times below confirm what was picked.
 */
function RepeatEditor({
  value,
  onChange,
  errors,
  disabled,
  cron,
}: {
  value: TriggerState;
  onChange: (patch: Partial<TriggerState>) => void;
  errors: Errors;
  disabled?: boolean;
  cron: string;
}) {
  const t = useTranslations('scheduler');
  const cronText = useCronText();
  const names = useCalendarNames();
  const parsed = repeatOf(value.cron);
  const [custom, setCustom] = useState(parsed.repeat === 'custom');
  const spec: RepeatSpec = custom ? { ...parsed, repeat: 'custom' } : parsed;
  const zones = useMemo(() => {
    const all = timeZones();
    return all.includes(value.timezone) ? all : [value.timezone, ...all];
  }, [value.timezone]);
  const update = (patch: Partial<RepeatSpec>) => {
    const next = { ...spec, ...patch };
    if (next.repeat === 'custom') {
      setCustom(true);
      return;
    }
    setCustom(false);
    const expr = cronOf(next);
    if (expr) onChange({ cron: expr });
  };
  const minute = spec.time.split(':')[1] ?? '00';

  return (
    <VStack gap={4}>
      <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={4} align="end">
        <Selector
          label={t('form.repeats')}
          width="100%"
          value={spec.repeat}
          onChange={(v) => update({ repeat: v as Repeat })}
          options={REPEATS.map((r) => ({ value: r, label: t(`form.repeat.${r}`) }))}
          isDisabled={disabled}
        />
        {spec.repeat === 'weekly' && (
          <Selector
            label={t('form.onWeekday')}
            width="100%"
            value={String(spec.weekday)}
            onChange={(v) => update({ weekday: Number(v) })}
            options={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: names.weekdays[d]! }))}
            isDisabled={disabled}
          />
        )}
        {spec.repeat === 'yearly' && (
          <Selector
            label={t('form.inMonth')}
            width="100%"
            value={String(spec.month)}
            onChange={(v) => update({ month: Number(v) })}
            options={names.months.map((m, i) => ({ value: String(i + 1), label: m }))}
            isDisabled={disabled}
          />
        )}
        {(spec.repeat === 'monthly' || spec.repeat === 'quarterly' || spec.repeat === 'yearly') && (
          <NumberInput
            label={t('form.onDay')}
            description={spec.repeat === 'quarterly' ? t('form.onDayQuarterHint') : undefined}
            width="100%"
            min={1}
            max={31}
            value={spec.monthDay}
            onChange={(v) => update({ monthDay: v || 1 })}
            isDisabled={disabled}
          />
        )}
        {spec.repeat === 'hourly' && (
          <NumberInput
            label={t('form.atMinute')}
            width="100%"
            min={0}
            max={59}
            value={Number(minute)}
            onChange={(v) => update({ time: `00:${String(v || 0).padStart(2, '0')}` })}
            isDisabled={disabled}
          />
        )}
        {spec.repeat !== 'hourly' && spec.repeat !== 'custom' && (
          <TimeInput
            label={t('form.atTime')}
            width="100%"
            hourFormat="24h"
            value={spec.time as ISOTimeString}
            onChange={(v) => v && update({ time: v })}
            isDisabled={disabled}
          />
        )}
        {/* A searchable Selector's trigger is a plain button: aria-required (the job form's default) is not allowed on it. */}
        <FormLayout defaultOptionality="optional">
          <Selector
            label={t('form.timezone')}
            width="100%"
            hasSearch
            startIcon={GlobeIcon}
            searchPlaceholder={t('form.searchZone')}
            emptySearchText={t('form.noZone')}
            value={value.timezone}
            onChange={(timezone) => onChange({ timezone })}
            options={zones}
            status={errorStatus(errors['trigger.timezone'])}
            isDisabled={disabled}
          />
        </FormLayout>
      </Grid>
      {spec.repeat === 'custom' && (
        <VStack gap={3}>
          <TextInput
            label={t('form.cron')}
            description={t('form.cronHint')}
            width="100%"
            placeholder="0 7 * * *"
            autoComplete="off"
            value={value.cron}
            onChange={(v) => onChange({ cron: v })}
            status={errorStatus(errors['trigger.cron'])}
            isDisabled={disabled}
          />
          <HStack gap={1.5} wrap="wrap" vAlign="center" role="group" aria-label={t('form.presets')}>
            <Text size="xsm" color="secondary">
              {t('form.presets')}:
            </Text>
            {PRESETS.map((p) => (
              <Button
                key={p}
                label={cronText(p)}
                variant="secondary"
                size="sm"
                isDisabled={disabled}
                onClick={() => onChange({ cron: p })}
              />
            ))}
          </HStack>
        </VStack>
      )}
      {spec.repeat !== 'custom' && errors['trigger.cron'] && (
        <FieldStatus type="error" message={errors['trigger.cron']} variant="detached" />
      )}
      {cron && (
        <Card>
          <CardContent>
            <VStack gap={2}>
              <Text weight="medium">{cronText(cron)}</Text>
              <NextRuns query={{ kind: 'cron', cron, timezone: value.timezone }} timezone={value.timezone} />
            </VStack>
          </CardContent>
        </Card>
      )}
    </VStack>
  );
}

export function TriggerEditor({
  value,
  onChange,
  errors,
  jobId,
  disabled,
}: {
  value: TriggerState;
  onChange: (v: TriggerState) => void;
  errors: Errors;
  jobId?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('scheduler');
  const set = (patch: Partial<TriggerState>) => onChange({ ...value, ...patch });
  const cron = useDebounced(value.cron, 350);
  const minutes = useDebounced(value.intervalMinutes, 350);

  return (
    <VStack gap={5}>
      <RadioList
        label={t('fields.trigger')}
        isLabelHidden
        value={value.kind}
        onChange={(k) => set({ kind: k as TriggerKind })}
        isDisabled={disabled}
      >
        {TRIGGER_KINDS.map((k) => (
          <RadioListItem
            key={k}
            value={k}
            label={t(`triggerKind.${k}`)}
            description={t(`triggerKindHint.${k}`)}
          />
        ))}
      </RadioList>

      {value.kind === 'cron' && (
        <RepeatEditor value={value} onChange={set} errors={errors} disabled={disabled} cron={cron} />
      )}

      {value.kind === 'interval' && (
        <VStack gap={4}>
          <NumberInput
            label={t('form.intervalMinutes')}
            description={t('form.intervalHint')}
            width={240}
            min={1}
            value={Number(value.intervalMinutes) || null}
            onChange={(n) => set({ intervalMinutes: String(n) })}
            status={errorStatus(errors['trigger.intervalMinutes'])}
            isDisabled={disabled}
          />
          {Number(minutes) >= 1 && (
            <Card>
              <CardContent>
                <NextRuns
                  query={{ kind: 'interval', intervalMinutes: Math.floor(Number(minutes)) }}
                  timezone={localTimeZone()}
                />
              </CardContent>
            </Card>
          )}
        </VStack>
      )}

      {value.kind === 'after' && (
        <Grid columns={{ minWidth: 260, repeat: 'fit' }} gap={4} align="end">
          <UpstreamPicker
            value={value.upstream}
            onChange={(upstream) => set({ upstream })}
            excludeId={jobId}
            error={errors['trigger.upstreamIds'] ?? errors.trigger}
            disabled={disabled}
          />
          <Selector
            label={t('form.mode')}
            description={t(`form.modeHint.${value.mode}`)}
            width="100%"
            value={value.mode}
            onChange={(v) => set({ mode: v as 'all' | 'any' })}
            options={[
              { value: 'all', label: t('form.modes.all') },
              { value: 'any', label: t('form.modes.any') },
            ]}
            isDisabled={disabled}
          />
        </Grid>
      )}

      {value.kind === 'manual' && <Text color="secondary">{t('form.manualHint')}</Text>}
    </VStack>
  );
}
