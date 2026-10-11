'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { type SearchableItem, type SearchSource, Typeahead } from '@astryxdesign/core/Typeahead';
import type { Page } from '@isbp/sdk';
import { useApi } from '@isbp/sdk/web';
import { PlusIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { TaskListItem } from '../../contracts';
import { TaskStatusIcon, TaskTypeIcon } from './badges';

type TaskItem = SearchableItem<TaskListItem>;

/**
 * Searches the project's tasks by reference or title and returns the picked one. A button opens an inline search;
 * picking a task (or the close button) puts the button back.
 */
export function TaskPicker({
  projectKey,
  excludeIds = [],
  onPick,
  label,
  disabled,
}: {
  projectKey: string;
  excludeIds?: readonly string[];
  onPick: (task: TaskListItem) => void;
  /** Visible text of the button and the search field's accessible name. */
  label: string;
  disabled?: boolean;
}) {
  const t = useTranslations('projects.picker');
  const tc = useTranslations('common');
  const api = useApi();
  const [open, setOpen] = useState(false);
  const excluded = excludeIds.join(',');
  const source = useMemo<SearchSource<TaskItem>>(() => {
    const skip = new Set(excluded ? excluded.split(',') : []);
    const load = async (q: string): Promise<TaskItem[]> => {
      try {
        const page = await api.get<Page<TaskListItem>>('/projects/tasks', {
          project: projectKey,
          q: q.trim() || undefined,
          pageSize: 20,
          sort: q.trim() ? 'reference' : '-updated',
        });
        return page.items
          .filter((x) => !skip.has(x.id))
          .map((task) => ({ id: task.id, label: `${task.reference} ${task.title}`, auxiliaryData: task }));
      } catch {
        return [];
      }
    };
    return { search: load, bootstrap: () => load('') };
  }, [api, projectKey, excluded]);

  if (!open)
    return (
      <Button
        label={label}
        variant="ghost"
        size="sm"
        icon={<Icon icon={PlusIcon} />}
        isDisabled={disabled}
        onClick={() => setOpen(true)}
      />
    );
  return (
    <HStack gap={1} vAlign="center">
      <Typeahead<TaskItem>
        label={label}
        isLabelHidden
        size="sm"
        width={280}
        hasAutoFocus
        hasEntriesOnFocus
        hasClear={false}
        placeholder={t('search')}
        emptySearchText={t('none')}
        searchSource={source}
        value={null}
        onChange={(item) => {
          if (!item?.auxiliaryData) return;
          onPick(item.auxiliaryData);
          setOpen(false);
        }}
        renderItem={(item) => {
          const task = item.auxiliaryData;
          if (!task) return item.label;
          return (
            <HStack gap={2} vAlign="center">
              <TaskTypeIcon type={task.type} label={false} />
              <Text type="code" color="secondary">
                {task.reference}
              </Text>
              <span className="min-w-0 flex-1 truncate">{task.title}</span>
              <TaskStatusIcon status={task.status} />
            </HStack>
          );
        }}
      />
      <IconButton
        label={tc('cancel')}
        variant="ghost"
        size="sm"
        icon={<Icon icon={XIcon} />}
        onClick={() => setOpen(false)}
      />
    </HStack>
  );
}
