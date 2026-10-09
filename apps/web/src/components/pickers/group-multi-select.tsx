'use client';

import type { Group } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
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
import { duration, ease, useReducedMotion } from '@isbp/ui/motion';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { CheckIcon, PlusIcon, UsersRoundIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiQuery } from '@/lib/api';

/** Groups a person can be put into by hand: not "Everyone" (implicit) and not kept by a directory sync. */
export const isAssignableGroup = (g: Pick<Group, 'isSystem' | 'source'>) =>
  !g.isSystem && g.source === 'local';

/** The assignable groups (cached; shared by the pickers on a page). */
export function useAssignableGroups(enabled = true) {
  const query = useApiQuery<Page<Group>>(enabled ? '/groups' : null, { pageSize: 200, sort: 'name' });
  return { ...query, groups: (query.data?.items ?? []).filter(isAssignableGroup) };
}

/**
 * Picks several groups by id: the chosen ones as removable chips, and a searchable list behind "Add groups". Name
 * the field with `labelledBy` (the id of its visible label); `exclude` hides groups (e.g. ones the person is in).
 */
export function GroupMultiSelect({
  value,
  onChange,
  labelledBy,
  exclude = [],
  addLabel,
  className,
}: {
  value: readonly string[];
  onChange: (ids: string[]) => void;
  labelledBy?: string;
  exclude?: readonly string[];
  addLabel?: string;
  className?: string;
}) {
  const t = useTranslations('users.groupPicker');
  const tc = useTranslations('common');
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const { groups, isLoading } = useAssignableGroups();
  const byId = new Map(groups.map((g) => [g.id, g]));
  const options = groups.filter((g) => !exclude.includes(g.id));
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const chip = reduce
    ? { initial: false as const, exit: { opacity: 0, transition: { duration: 0 } } }
    : {
        initial: { opacity: 0, scale: 0.92 },
        exit: { opacity: 0, scale: 0.92, transition: { duration: duration.fast, ease: ease.exit } },
      };

  return (
    <div role="group" aria-labelledby={labelledBy} className={cn('grid gap-2', className)}>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('selected')}>
          <AnimatePresence initial={false}>
            {value.map((id) => {
              const name = byId.get(id)?.name ?? t('unknown');
              return (
                <motion.li
                  key={id}
                  layout={reduce ? false : 'position'}
                  {...chip}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: duration.fast, ease: ease.enter }}
                  className="min-w-0"
                >
                  <Badge
                    variant="secondary"
                    className="max-w-full gap-1.5 py-1 pr-1 pl-2 text-sm font-normal"
                  >
                    <UsersRoundIcon aria-hidden className="text-muted-foreground" />
                    <span className="truncate">{name}</span>
                    <button
                      type="button"
                      onClick={() => toggle(id)}
                      aria-label={t('remove', { name })}
                      className="rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="w-fit" aria-haspopup="listbox">
            <PlusIcon /> {addLabel ?? t('add')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0" align="start">
          <Command>
            <CommandInput placeholder={t('search')} aria-label={t('search')} />
            <CommandList aria-label={t('options')}>
              <CommandEmpty>{isLoading ? tc('loading') : t('none')}</CommandEmpty>
              <CommandGroup>
                {options.map((g) => {
                  const checked = value.includes(g.id);
                  return (
                    <CommandItem
                      key={g.id}
                      value={`${g.name} ${g.description ?? ''}`}
                      onSelect={() => toggle(g.id)}
                      aria-selected={checked}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'grid size-4 shrink-0 place-items-center rounded-[4px] border',
                          checked && 'border-primary bg-primary text-primary-foreground',
                        )}
                      >
                        {checked && <CheckIcon className="size-3" />}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{g.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {t('members', { count: g.memberCount })}
                        </span>
                      </span>
                      {checked && <span className="sr-only">{t('chosen')}</span>}
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
