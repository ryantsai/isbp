'use client';

import type { Page } from '@isbp/sdk';
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
import { useApiQuery } from '@isbp/ui/query';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { CiRef, CiSummary } from '../contracts';
import { CiStatusBadge } from './badges';
import { ClassIcon } from './class-icon';

/** Searchable configuration-item picker (server-side search by name or CI number). */
export function CiPicker({
  value,
  onChange,
  excludeId,
  id,
  invalid,
  'aria-describedby': describedBy,
}: {
  value: CiRef | null;
  onChange: (ci: CiRef | null) => void;
  excludeId?: string;
  id?: string;
  invalid?: boolean;
  'aria-describedby'?: string;
}) {
  const t = useTranslations('cmdb.rel');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  const { data, isFetching } = useApiQuery<Page<CiSummary>>(open && debounced ? '/cmdb/cis' : null, {
    q: debounced,
    pageSize: 12,
  });
  const results = (data?.items ?? []).filter((c) => c.id !== excludeId);

  return (
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
          className="w-full justify-between font-normal"
        >
          {value ? (
            <span className="flex min-w-0 items-center gap-2">
              <ClassIcon name={value.class.icon} className="size-4 text-muted-foreground" />
              <span className="font-mono text-xs text-muted-foreground">{value.reference}</span>
              <span className="truncate">{value.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t('otherPlaceholder')}</span>
          )}
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder={t('otherPlaceholder')} />
          <CommandList>
            <CommandEmpty>
              {!debounced ? t('typeToSearch') : isFetching ? t('searching') : t('noMatches')}
            </CommandEmpty>
            {results.length > 0 && (
              <CommandGroup>
                {results.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => {
                      onChange(c);
                      setOpen(false);
                    }}
                  >
                    <ClassIcon name={c.class.icon} className="size-4 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{c.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{c.reference}</span>
                    </div>
                    <CiStatusBadge status={c.status} />
                    {value?.id === c.id && <CheckIcon />}
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
