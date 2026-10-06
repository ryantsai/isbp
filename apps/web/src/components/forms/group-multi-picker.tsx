'use client';

import type { Group } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
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
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { CheckIcon, PlusIcon, UsersRoundIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiQuery } from '@/lib/api';

/** Picks several groups by key (form audiences reference groups by their stable key). */
export function GroupMultiPicker({
  value,
  onChange,
  id,
  invalid,
  describedBy,
}: {
  value: readonly string[];
  onChange: (keys: string[]) => void;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('forms.settings');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useApiQuery<Page<Group>>('/groups', { pageSize: 200, sort: 'name' });
  const groups = data?.items ?? [];
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);

  return (
    <div className="grid gap-2">
      <ul className="flex flex-wrap gap-1.5" aria-label={t('selectedGroups')}>
        <AnimatePresence initial={false}>
          {value.map((key) => (
            <motion.li
              key={key}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <Badge variant="secondary" className="gap-1.5 py-1 pr-1 pl-2 text-sm font-normal">
                <UsersRoundIcon aria-hidden className="text-muted-foreground" />
                {byKey.get(key)?.name ?? key}
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-label={t('removeGroup', { name: byKey.get(key)?.name ?? key })}
                  className="rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
          >
            <PlusIcon /> {t('addGroups')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command>
            <CommandInput placeholder={t('searchGroups')} />
            <CommandList>
              <CommandEmpty>{isLoading ? tc('loading') : tc('noResults')}</CommandEmpty>
              <CommandGroup>
                {groups.map((g) => {
                  const checked = value.includes(g.key);
                  return (
                    <CommandItem key={g.id} value={`${g.name} ${g.key}`} onSelect={() => toggle(g.key)}>
                      <span
                        aria-hidden
                        className={`grid size-4 shrink-0 place-items-center rounded-[4px] border ${checked ? 'border-primary bg-primary text-primary-foreground' : ''}`}
                      >
                        {checked && <CheckIcon className="size-3" />}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{g.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          <code className="font-mono">{g.key}</code> ·{' '}
                          {t('members', { count: g.memberCount })}
                        </span>
                      </span>
                      <span className="sr-only">{checked ? t('selected') : ''}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
