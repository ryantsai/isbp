'use client';

import type { Page } from '@isbp/sdk';
import type { UserSummary } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
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
import { CheckIcon, ChevronsUpDownIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApiQuery } from '@/lib/api';

export interface PickedUser {
  id: string;
  displayName: string;
  email?: string;
}

/**
 * Async person picker (server-side search). Single selection; `value` carries the display name. Name it with `id`
 * plus a `<Label htmlFor>`, or with `aria-label` / `aria-labelledby`.
 */
export function UserPicker({
  value,
  onChange,
  placeholder,
  excludeIds = [],
  status = 'active',
  id,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: {
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  placeholder?: string;
  excludeIds?: string[];
  status?: string;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  const t = useTranslations('common');
  const tu = useTranslations('users.picker');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(h);
  }, [q]);
  const { data, isFetching } = useApiQuery<Page<UserSummary>>(open ? '/users' : null, {
    q: debounced || undefined,
    pageSize: 8,
    status,
  });
  const results = (data?.items ?? []).filter((u) => !excludeIds.includes(u.id));

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
            aria-label={ariaLabel}
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            className="w-full justify-between font-normal"
          >
            {value ? (
              <span className="flex min-w-0 items-center gap-2">
                <UserAvatar name={value.displayName} className="size-5 text-[9px]" />
                <span className="truncate">{value.displayName}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder ?? t('searchPlaceholder')}</span>
            )}
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={tu('clear', { name: value.displayName })}
            className="absolute top-1/2 right-8 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder={t('searchPlaceholder')}
            aria-label={tu('search')}
          />
          <CommandList>
            <CommandEmpty>{isFetching ? t('loading') : t('noResults')}</CommandEmpty>
            <CommandGroup>
              {results.map((u) => (
                <CommandItem
                  key={u.id}
                  value={u.id}
                  onSelect={() => {
                    onChange({ id: u.id, displayName: u.displayName, email: u.email });
                    setOpen(false);
                  }}
                >
                  <UserAvatar name={u.displayName} src={u.avatarUrl} className="size-6 text-[10px]" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{u.displayName}</span>
                    <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                  </div>
                  {value?.id === u.id && <CheckIcon className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
