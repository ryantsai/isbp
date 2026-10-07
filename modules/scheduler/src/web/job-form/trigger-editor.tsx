'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@isbp/ui/command';
import { Input } from '@isbp/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { CheckIcon, ChevronsUpDownIcon, GlobeIcon, XIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { type JobRef, type Preview, TRIGGER_KINDS, type TriggerKind } from '../../contracts';
import { TRIGGER_ICON } from '../badges';
import { localTimeZone, timeZones, useDebounced, useJobOptions } from '../lib';
import { useCronText } from '../trigger-text';
import { type Errors, FormRow, NumberInput } from './fields';

export interface TriggerState {
  kind: TriggerKind;
  cron: string;
  timezone: string;
  intervalMinutes: string;
  upstream: JobRef[];
  mode: 'all' | 'any';
}

const PRESETS = ['*/15 * * * *', '0 * * * *', '0 7 * * *', '30 8 * * 1-5', '0 3 * * 0', '0 2 1 * *'];

/** Searchable IANA time zone picker. */
function TimezonePicker({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (tz: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('scheduler.form');
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => timeZones(), []);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <GlobeIcon className="text-muted-foreground" aria-hidden />
            <span className="truncate">{value}</span>
          </span>
          <ChevronsUpDownIcon className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={t('searchZone')} />
          <CommandList>
            <CommandEmpty>{t('noZone')}</CommandEmpty>
            <CommandGroup>
              {zones.map((z) => (
                <CommandItem
                  key={z}
                  value={z}
                  onSelect={() => {
                    onChange(z);
                    setOpen(false);
                  }}
                >
                  {z}
                  {z === value && <CheckIcon className="ml-auto" aria-hidden />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Jobs this one runs after (searchable, multiple). */
function UpstreamPicker({
  id,
  value,
  onChange,
  excludeId,
  invalid,
  describedBy,
  disabled,
}: {
  id: string;
  value: JobRef[];
  onChange: (jobs: JobRef[]) => void;
  excludeId?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('scheduler.form');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const { items, isFetching } = useJobOptions(debounced, open);
  const chosen = new Set(value.map((j) => j.id));
  const options = items.filter((j) => j.id !== excludeId);
  return (
    <div className="grid min-w-0 gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="truncate text-muted-foreground">
              {value.length ? t('upstreamCount', { count: value.length }) : t('pickUpstream')}
            </span>
            <ChevronsUpDownIcon className="opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder={t('searchJobs')} />
            <CommandList>
              <CommandEmpty>{isFetching ? t('loading') : t('noJobs')}</CommandEmpty>
              {options.length > 0 && (
                <CommandGroup>
                  {options.map((j) => (
                    <CommandItem
                      key={j.id}
                      value={j.id}
                      onSelect={() =>
                        onChange(chosen.has(j.id) ? value.filter((v) => v.id !== j.id) : [...value, j])
                      }
                    >
                      <span className="truncate">{j.name}</span>
                      {chosen.has(j.id) && <CheckIcon className="ml-auto" aria-hidden />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('upstreamChosen')}>
          {value.map((j) => (
            <li key={j.id}>
              <Badge variant="secondary" className="max-w-full gap-1 pr-1 font-normal">
                <span className="truncate">{j.name}</span>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((v) => v.id !== j.id))}
                  aria-label={t('removeUpstream', { name: j.name })}
                  disabled={disabled}
                  className="rounded-sm p-0.5 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  if (!data) return isFetching ? <p className="text-xs text-muted-foreground">{t('loading')}</p> : null;
  if (!data.valid)
    return (
      <p className="text-xs font-medium text-destructive" role="alert">
        {onError ?? data.error}
      </p>
    );
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{t('nextRuns')}</p>
      <ol className="grid gap-0.5 text-xs tabular-nums" aria-label={t('nextRuns')}>
        {data.next.map((at) => (
          <li key={at}>
            <time dateTime={at}>
              {format.dateTime(new Date(at), { dateStyle: 'full', timeStyle: 'short', timeZone: timezone })}
            </time>
          </li>
        ))}
      </ol>
    </div>
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
  const cronText = useCronText();
  const id = useId();
  const set = (patch: Partial<TriggerState>) => onChange({ ...value, ...patch });
  const cron = useDebounced(value.cron, 350);
  const minutes = useDebounced(value.intervalMinutes, 350);

  return (
    <div className="grid min-w-0 gap-5">
      <div
        role="radiogroup"
        aria-label={t('fields.trigger')}
        className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4"
      >
        {TRIGGER_KINDS.map((k) => {
          const Icon = TRIGGER_ICON[k];
          return (
            <label
              key={k}
              className={cn(
                'flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-accent/50',
                'has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name={`${id}-kind`}
                value={k}
                checked={value.kind === k}
                onChange={() => set({ kind: k })}
                disabled={disabled}
                className="sr-only"
              />
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">
                <span className="block font-medium">{t(`triggerKind.${k}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`triggerKindHint.${k}`)}</span>
              </span>
            </label>
          );
        })}
      </div>

      {value.kind === 'cron' && (
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <FormRow label={t('form.cron')} hint={t('form.cronHint')} error={errors['trigger.cron']}>
              {({ id: fid, describedBy, invalid }) => (
                <Input
                  id={fid}
                  value={value.cron}
                  onChange={(e) => set({ cron: e.target.value })}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  className="font-mono"
                  placeholder="0 7 * * *"
                  spellCheck={false}
                  disabled={disabled}
                />
              )}
            </FormRow>
            <FormRow label={t('form.timezone')} error={errors['trigger.timezone']}>
              {({ id: fid }) => (
                <TimezonePicker
                  id={fid}
                  value={value.timezone}
                  onChange={(timezone) => set({ timezone })}
                  disabled={disabled}
                />
              )}
            </FormRow>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('form.presets')}>
            <span className="text-xs text-muted-foreground">{t('form.presets')}:</span>
            {PRESETS.map((p) => (
              <Button
                key={p}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => set({ cron: p })}
                disabled={disabled}
              >
                {cronText(p)}
              </Button>
            ))}
          </div>
          {cron && (
            <div className="grid min-w-0 gap-2 rounded-lg border bg-muted/30 p-3">
              <p className="text-sm font-medium">{cronText(cron)}</p>
              <NextRuns query={{ kind: 'cron', cron, timezone: value.timezone }} timezone={value.timezone} />
            </div>
          )}
        </div>
      )}

      {value.kind === 'interval' && (
        <div className="grid min-w-0 gap-4">
          <FormRow
            label={t('form.intervalMinutes')}
            hint={t('form.intervalHint')}
            error={errors['trigger.intervalMinutes']}
          >
            {({ id: fid, describedBy, invalid }) => (
              <NumberInput
                id={fid}
                value={value.intervalMinutes}
                onChange={(intervalMinutes) => set({ intervalMinutes })}
                min={1}
                describedBy={describedBy}
                invalid={invalid}
                disabled={disabled}
              />
            )}
          </FormRow>
          {Number(minutes) >= 1 && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <NextRuns
                query={{ kind: 'interval', intervalMinutes: Math.floor(Number(minutes)) }}
                timezone={localTimeZone()}
              />
            </div>
          )}
        </div>
      )}

      {value.kind === 'after' && (
        <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
          <FormRow
            label={t('form.upstream')}
            hint={t('form.upstreamHint')}
            error={errors['trigger.upstreamIds'] ?? errors.trigger}
          >
            {({ id: fid, describedBy, invalid }) => (
              <UpstreamPicker
                id={fid}
                value={value.upstream}
                onChange={(upstream) => set({ upstream })}
                excludeId={jobId}
                invalid={invalid}
                describedBy={describedBy}
                disabled={disabled}
              />
            )}
          </FormRow>
          <FormRow label={t('form.mode')} hint={t(`form.modeHint.${value.mode}`)}>
            {({ id: fid, describedBy }) => (
              <Select
                value={value.mode}
                onValueChange={(v) => set({ mode: v as 'all' | 'any' })}
                disabled={disabled}
              >
                <SelectTrigger id={fid} className="w-full" aria-describedby={describedBy}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('form.modes.all')}</SelectItem>
                  <SelectItem value="any">{t('form.modes.any')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormRow>
        </div>
      )}

      {value.kind === 'manual' && <p className="text-sm text-muted-foreground">{t('form.manualHint')}</p>}
    </div>
  );
}
