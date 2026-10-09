'use client';

import type { Group } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
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
import { CheckIcon, ChevronsUpDownIcon, UsersRoundIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApiQuery } from '@/lib/api';

export interface PickedGroup {
  id: string;
  name: string;
  key?: string;
}

export function GroupGlyph({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary',
        className,
      )}
      aria-hidden
    >
      <UsersRoundIcon className="size-4" />
    </span>
  );
}

/** Async group picker (server-side search via `GET /groups?q=`). Single selection. */
export function GroupPicker({
  value,
  onChange,
  placeholder,
  id,
  className,
  invalid,
  describedBy,
  'aria-label': ariaLabel,
}: {
  value: PickedGroup | null;
  onChange: (group: PickedGroup | null) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
  /** Without a `<Label htmlFor={id}>`, name the picker here. */
  'aria-label'?: string;
}) {
  const t = useTranslations('common');
  const tr = useTranslations('roles.groupPicker');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(h);
  }, [q]);
  const { data, isFetching } = useApiQuery<Page<Group>>(open ? '/groups' : null, {
    q: debounced || undefined,
    pageSize: 8,
    sort: 'name',
  });
  const results = data?.items ?? [];

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
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="w-full justify-between font-normal"
          >
            {value ? (
              <span className="flex min-w-0 items-center gap-2">
                <GroupGlyph className="size-5 rounded [&_svg]:size-3" />
                <span className="truncate">{value.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder ?? tr('placeholder')}</span>
            )}
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t('remove')}
            className="absolute top-1/2 right-8 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder={tr('search')} />
          <CommandList>
            <CommandEmpty>{isFetching ? t('loading') : t('noResults')}</CommandEmpty>
            <CommandGroup>
              {results.map((g) => (
                <CommandItem
                  key={g.id}
                  value={g.id}
                  onSelect={() => {
                    onChange({ id: g.id, name: g.name, key: g.key });
                    setOpen(false);
                  }}
                >
                  <GroupGlyph className="size-6 rounded [&_svg]:size-3.5" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{g.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      <code className="font-mono">{g.key}</code> · {tr('members', { count: g.memberCount })}
                    </span>
                  </div>
                  {value?.id === g.id && <CheckIcon className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
