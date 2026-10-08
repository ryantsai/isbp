'use client';

import { CheckIcon, ChevronsUpDownIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import { UserAvatar } from './avatar';
import { Badge } from './badge';
import { Button } from './button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { useApiQuery } from './query';

/** Minimal colleague profile from `GET /people/lookup` (available to every signed-in person). */
export interface PersonOption {
  id: string;
  displayName: string;
  email?: string;
  jobTitle?: string | null;
  avatarUrl?: string | null;
  department?: string | null;
  /** `pending` = pre-boarded (hasn't started yet); only found with `includePreboarded`. */
  status?: 'active' | 'pending';
}

/** Resolves display names for person ids (e.g. "person" field values). */
export function usePeople(ids: readonly (string | null | undefined)[]) {
  const wanted = useMemo(() => [...new Set(ids.filter((x): x is string => Boolean(x)))].sort(), [ids]);
  const { data } = useApiQuery<{ items: PersonOption[] }>(wanted.length ? '/people/lookup' : null, {
    ids: wanted,
  });
  return useMemo(() => new Map((data?.items ?? []).map((p) => [p.id, p])), [data]);
}

/**
 * Searchable single-person picker for any signed-in user (active people only; with `includePreboarded`, also the
 * pre-boarded people the caller may request access for, marked as such).
 */
export function PersonPicker({
  value,
  onChange,
  placeholder,
  excludeIds = [],
  id,
  invalid,
  disabled,
  clearable = true,
  includePreboarded = false,
  className,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
}: {
  value: PersonOption | null;
  onChange: (person: PersonOption | null) => void;
  placeholder?: string;
  excludeIds?: readonly string[];
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** False for required fields: no clear button, so the value can only be replaced. */
  clearable?: boolean;
  /** Also find pre-boarded people (not started yet) the caller may request access for. */
  includePreboarded?: boolean;
  className?: string;
  'aria-describedby'?: string;
  /** Name for pickers without a `<label htmlFor={id}>` (e.g. filters); defaults to the placeholder. */
  'aria-label'?: string;
}) {
  const t = useTranslations('ui.person');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  const { data, isFetching } = useApiQuery<{ items: PersonOption[] }>(
    open && debounced ? '/people/lookup' : null,
    { q: debounced, includePreboarded: includePreboarded ? 'true' : undefined },
  );
  const results = (data?.items ?? []).filter((p) => !excludeIds.includes(p.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('relative', className)}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-label={ariaLabel ?? (id ? undefined : (placeholder ?? t('placeholder')))}
            disabled={disabled}
            className="w-full justify-between font-normal aria-invalid:border-destructive"
          >
            {value ? (
              <span className="flex min-w-0 items-center gap-2">
                <UserAvatar name={value.displayName} src={value.avatarUrl} className="size-5 text-[9px]" />
                <span className="truncate">{value.displayName}</span>
                {value.status === 'pending' && <Badge variant="muted">{t('preboarded')}</Badge>}
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder ?? t('placeholder')}</span>
            )}
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        {value && clearable && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
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
                {results.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => {
                      onChange(p);
                      setOpen(false);
                    }}
                  >
                    <UserAvatar name={p.displayName} src={p.avatarUrl} className="size-6 text-[10px]" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{p.displayName}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[p.jobTitle, p.department].filter(Boolean).join(' · ') || p.email}
                      </span>
                    </div>
                    {p.status === 'pending' && (
                      <Badge variant="muted" className="ml-auto">
                        {t('preboarded')}
                      </Badge>
                    )}
                    {value?.id === p.id && (
                      <CheckIcon className={p.status === 'pending' ? undefined : 'ml-auto'} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
