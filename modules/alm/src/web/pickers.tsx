'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@isbp/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { CheckIcon, ChevronsUpDownIcon, NetworkIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { LookupItem } from '../contracts';
import { useDebounced, useLookup } from './lib';

export const NONE = '__none__';

/** Group or department select with a "none" option. */
export function LookupSelect({
  kind,
  value,
  onChange,
  noneLabel,
  id,
  className,
  'aria-label': ariaLabel,
}: {
  kind: 'groups' | 'departments';
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  noneLabel: string;
  id?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const { items } = useLookup(kind);
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn('w-full min-w-0', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <span className="text-muted-foreground">{noneLabel}</span>
        </SelectItem>
        {items.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            {g.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Single configuration item combobox (`/alm/lookups/cis?q=`): by name or CI number. */
export function CiPicker({
  value,
  onChange,
  id,
  'aria-describedby': describedBy,
}: {
  value: LookupItem | null;
  onChange: (ci: LookupItem | null) => void;
  id?: string;
  'aria-describedby'?: string;
}) {
  const t = useTranslations('alm.ciPicker');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const { items, isFetching } = useLookup('cis', { q: debounced, enabled: open });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative min-w-0">
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-describedby={describedBy}
            className="h-auto min-h-9 w-full justify-between py-2 pr-14 text-left font-normal"
          >
            {value ? (
              <span className="flex min-w-0 items-center gap-2">
                <NetworkIcon className="text-muted-foreground" aria-hidden />
                <span className="truncate">{value.name}</span>
                {value.hint && (
                  <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                    {value.hint}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">{t('placeholder')}</span>
            )}
            <ChevronsUpDownIcon className="absolute right-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        {value && (
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
            {items.length > 0 && (
              <CommandGroup>
                {items.map((ci) => (
                  <CommandItem
                    key={ci.id}
                    value={ci.id}
                    onSelect={() => {
                      onChange(ci);
                      setOpen(false);
                    }}
                  >
                    <NetworkIcon />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{ci.name}</span>
                      {ci.hint && <span className="truncate text-xs text-muted-foreground">{ci.hint}</span>}
                    </div>
                    {value?.id === ci.id && <CheckIcon className="ml-auto" />}
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
