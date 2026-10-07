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
import { useApiQuery } from '@isbp/ui/query';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Option } from '../../contracts';
import { useDebounced } from '../lib';

/** Where synced records live in ISBP (a project for tasks): records of the container entity you can see. */
export function ContainerPicker({
  id,
  entity,
  value,
  label,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  entity: string;
  value: string | null;
  label: string | null;
  onChange: (option: Option) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('integrations.editor');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const { data, isFetching } = useApiQuery<{ items: Option[] }>(
    open ? `/integrations/entities/${entity}/containers` : null,
    { q: query },
  );
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
          disabled={disabled}
          className="w-full min-w-0 justify-between font-normal"
        >
          <span className={cn('truncate', !label && 'text-muted-foreground')}>
            {label ?? t('chooseContainer')}
          </span>
          <ChevronsUpDownIcon className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder={t('searchContainer')} />
          <CommandList>
            <CommandEmpty>{isFetching ? t('searching') : t('noContainers')}</CommandEmpty>
            <CommandGroup>
              {(data?.items ?? []).map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  onSelect={() => {
                    onChange(o);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn('size-4', value === o.id ? 'opacity-100' : 'opacity-0')}
                    aria-hidden
                  />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
