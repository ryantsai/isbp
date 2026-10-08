'use client';

import type { Condition } from '@isbp/sdk';
import { CheckIcon, ChevronsUpDownIcon, EyeOffIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import { Badge } from './badge';
import { Button } from './button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { useApiQuery } from './query';

/** A record of any module as the viewer sees it (`GET /records/search`, `/records/resolve`). */
export interface RecordOption {
  type: string;
  moduleId: string;
  id: string;
  reference: string | null;
  title: string;
  subtitle: string | null;
  /** `key` is an i18n key in the owning module's catalog. */
  status: { key: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' } | null;
  href: string;
  icon: string | null;
}

const TONE = {
  neutral: 'muted',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
} as const;

const refOf = (r: { type: string; id: string }) => `${r.type}:${r.id}`;
const recordName = (r: RecordOption) => (r.reference ? `${r.reference} ${r.title}` : r.title);

/** Refs held by a record field value (one ref, a list, or empty). */
export function recordRefs(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.filter((v): v is string => typeof v === 'string' && v.includes(':'));
}

/**
 * The records behind refs, resolved for the viewer (one request); refs they may not read (or that are gone) are only
 * counted as `hidden`.
 */
export function useRecords(refs: readonly string[]) {
  const key = useMemo(() => [...new Set(refs)].sort().join(','), [refs]);
  const { data, isLoading, isPlaceholderData } = useApiQuery<{ items: RecordOption[]; hidden: number }>(
    key ? '/records/resolve' : null,
    { refs: key },
  );
  // While other refs load, the previous answer is kept (no flicker) but its `hidden` count is not current.
  const loading = Boolean(key) && (isLoading || isPlaceholderData);
  return useMemo(
    () => ({
      records: new Map((key ? (data?.items ?? []) : []).map((r) => [refOf(r), r])),
      hidden: key && !loading ? (data?.hidden ?? 0) : 0,
      loading,
    }),
    [data, loading, key],
  );
}

/** A record's status from its module's catalog, with its tone — never colour-only. */
export function RecordStatus({ status }: { status: RecordOption['status'] }) {
  const root = useTranslations();
  if (!status) return null;
  return (
    <Badge variant={TONE[status.tone] ?? 'muted'}>
      {root.has(status.key) ? root(status.key) : status.key.split('.').pop()}
    </Badge>
  );
}

function RecordText({ record }: { record: RecordOption }) {
  return (
    <span className="min-w-0 truncate">
      {record.reference && (
        <span className="mr-1.5 font-mono text-xs text-muted-foreground">{record.reference}</span>
      )}
      {record.title}
    </span>
  );
}

/**
 * Read-only value of a `record` field: the records as links; those the viewer can't see are counted, never named.
 */
export function RecordValues({ refs, className }: { refs: readonly string[]; className?: string }) {
  const t = useTranslations('ui.record');
  const { records, hidden, loading } = useRecords(refs);
  if (loading) return <span className="text-muted-foreground">…</span>;
  const shown = refs.map((r) => records.get(r)).filter((r): r is RecordOption => Boolean(r));
  return (
    <span className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {shown.map((r) => (
        <span key={refOf(r)} className="inline-flex min-w-0 items-center gap-1.5">
          <Link
            href={r.href}
            className="min-w-0 truncate text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
          >
            <RecordText record={r} />
          </Link>
          <RecordStatus status={r.status} />
        </span>
      ))}
      {hidden > 0 && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <EyeOffIcon className="size-3.5" aria-hidden />
          {t('hidden', { count: hidden })}
        </span>
      )}
    </span>
  );
}

/**
 * Picks records of the given types through the platform's record search (only records the person may read; with
 * `where`, only those whose facts match). Single or multiple; keyboard operable (combobox + listbox), chosen records
 * show as removable chips.
 */
export function RecordPicker({
  value,
  onChange,
  types,
  multiple = false,
  where,
  max = 20,
  id,
  invalid,
  disabled,
  placeholder,
  className,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
}: {
  value: readonly string[];
  onChange: (refs: string[]) => void;
  types: readonly string[];
  multiple?: boolean;
  where?: Condition;
  max?: number;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const t = useTranslations('ui.record');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  const { data, isFetching } = useApiQuery<{ items: RecordOption[] }>(
    open && types.length ? '/records/search' : null,
    {
      q: debounced,
      types: types.join(','),
      limit: 15,
      where: where ? JSON.stringify(where) : undefined,
    },
  );
  const { records, hidden, loading } = useRecords(value);
  // Records picked here are shown right away (they are resolved again with the value).
  const [known, setKnown] = useState<ReadonlyMap<string, RecordOption>>(new Map());
  const picked = new Set(value);
  const results = data?.items ?? [];
  const full = multiple && value.length >= max;
  const chosen = value
    .map((r) => records.get(r) ?? known.get(r))
    .filter((r): r is RecordOption => Boolean(r));
  const single = !multiple ? chosen[0] : undefined;

  const toggle = (r: RecordOption) => {
    const ref = refOf(r);
    setKnown((m) => new Map(m).set(ref, r));
    if (!multiple) {
      onChange(picked.has(ref) ? [] : [ref]);
      setOpen(false);
      return;
    }
    if (picked.has(ref)) onChange(value.filter((v) => v !== ref));
    else if (!full) onChange([...value, ref]);
  };
  const remove = (ref: string) => onChange(value.filter((v) => v !== ref));

  return (
    <div className={cn('grid gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <div className="relative">
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              aria-label={ariaLabel}
              disabled={disabled}
              className="w-full justify-between font-normal aria-invalid:border-destructive"
            >
              {single ? (
                <RecordText record={single} />
              ) : !multiple && value.length && !loading ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <EyeOffIcon className="size-3.5" aria-hidden />
                  {t('hidden', { count: value.length })}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {placeholder ?? (multiple ? t('placeholderMany') : t('placeholder'))}
                </span>
              )}
              <ChevronsUpDownIcon className="opacity-50" />
            </Button>
          </PopoverTrigger>
          {!multiple && value.length > 0 && !disabled && (
            <button
              type="button"
              onClick={() => onChange([])}
              aria-label={t('clear')}
              className="absolute top-1/2 right-8 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder={t('search')} />
            <CommandList>
              <CommandEmpty>{isFetching ? t('loading') : t('noResults')}</CommandEmpty>
              {results.length > 0 && (
                <CommandGroup>
                  {results.map((r) => {
                    const ref = refOf(r);
                    const selected = picked.has(ref);
                    return (
                      <CommandItem
                        key={ref}
                        value={ref}
                        disabled={!selected && full}
                        onSelect={() => toggle(r)}
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <RecordText record={r} />
                          {r.subtitle && (
                            <span className="truncate text-xs text-muted-foreground">{r.subtitle}</span>
                          )}
                        </div>
                        <RecordStatus status={r.status} />
                        <CheckIcon className={cn('ml-1', !selected && 'invisible')} aria-hidden />
                        {selected && <span className="sr-only">{t('chosen')}</span>}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
            {full && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t('max', { max })}</p>}
          </Command>
        </PopoverContent>
      </Popover>
      {multiple && (value.length > 0 || hidden > 0) && (
        <ul aria-label={t('picked', { count: value.length })} className="flex flex-wrap gap-1.5">
          {chosen.map((r) => (
            <li
              key={refOf(r)}
              className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-sm"
            >
              <RecordText record={r} />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(refOf(r))}
                  aria-label={t('remove', { name: recordName(r) })}
                  className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <XIcon className="size-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
          {hidden > 0 && (
            <li className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-sm text-muted-foreground">
              <EyeOffIcon className="size-3.5" aria-hidden />
              {t('hidden', { count: hidden })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
