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
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import type { TaskListItem } from '../../contracts';
import { TaskStatusIcon, TaskTypeIcon } from './badges';

/** Searches the project's tasks by reference or title and returns the picked one. */
export function TaskPicker({
  projectKey,
  excludeIds = [],
  onPick,
  label,
  trigger,
  disabled,
}: {
  projectKey: string;
  excludeIds?: readonly string[];
  onPick: (task: TaskListItem) => void;
  /** Visible text of the default trigger and the dialog's accessible name. */
  label: string;
  trigger?: ReactNode;
  disabled?: boolean;
}) {
  const t = useTranslations('projects.picker');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  const { data, isFetching } = useApiQuery<Page<TaskListItem>>(open ? '/projects/tasks' : null, {
    project: projectKey,
    q: debounced || undefined,
    pageSize: 20,
    sort: debounced ? 'reference' : '-updated',
  });
  const items = (data?.items ?? []).filter((x) => !excludeIds.includes(x.id));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" disabled={disabled}>
            <PlusIcon />
            {label}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" aria-label={label}>
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder={t('search')} />
          <CommandList>
            <CommandEmpty>{isFetching ? t('loading') : t('none')}</CommandEmpty>
            {items.length > 0 && (
              <CommandGroup>
                {items.map((task) => (
                  <CommandItem
                    key={task.id}
                    value={task.id}
                    onSelect={() => {
                      onPick(task);
                      setOpen(false);
                      setQ('');
                    }}
                  >
                    <TaskTypeIcon type={task.type} label={false} />
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.reference}</span>
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    <TaskStatusIcon status={task.status} className="text-muted-foreground" />
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
