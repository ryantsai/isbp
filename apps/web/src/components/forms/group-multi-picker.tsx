'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { TypeaheadItem } from '@astryxdesign/core/Typeahead';
import type { Group } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import type { SearchableItem, SearchSource } from '@isbp/ui/search-source';
import { UsersRoundIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useApiQuery } from '@/lib/api';

type GroupItem = SearchableItem<Group | null>;

/** Picks several groups by key (form audiences reference groups by their stable key). */
export function GroupMultiPicker({
  label,
  description,
  value,
  onChange,
  status,
}: {
  label: string;
  description?: string;
  value: readonly string[];
  onChange: (keys: string[]) => void;
  status?: { type: 'error'; message: string };
}) {
  const t = useTranslations('forms.settings');
  const tc = useTranslations('common');
  const { data } = useApiQuery<Page<Group>>('/groups', { pageSize: 200, sort: 'name' });
  const groups = useMemo(() => data?.items ?? [], [data]);

  const source = useMemo<SearchSource<GroupItem>>(() => {
    const available = (q: string) => {
      const needle = q.trim().toLowerCase();
      return groups
        .filter((g) => !value.includes(g.key))
        .filter((g) => !needle || `${g.name} ${g.key}`.toLowerCase().includes(needle))
        .map((g): GroupItem => ({ id: g.key, label: g.name, auxiliaryData: g }));
    };
    return { bootstrap: () => available(''), search: available };
  }, [groups, value]);

  // A key whose group is gone shows as the key itself, so it can still be taken off.
  const items = value.map((key): GroupItem => {
    const group = groups.find((g) => g.key === key);
    return { id: key, label: group?.name ?? key, auxiliaryData: group ?? null };
  });

  return (
    <Tokenizer<GroupItem>
      label={label}
      description={description}
      isRequired
      searchSource={source}
      value={items}
      onChange={(next) => onChange(next.map((item) => item.id))}
      placeholder={t('searchGroups')}
      startIcon={UsersRoundIcon}
      hasEntriesOnFocus
      minQueryLength={0}
      debounceMs={0}
      maxMenuItems={30}
      emptySearchText={tc('noResults')}
      status={status}
      renderItem={(item) => (
        <TypeaheadItem
          item={item}
          icon={<Icon icon={UsersRoundIcon} />}
          description={
            item.auxiliaryData
              ? `${item.auxiliaryData.key} · ${t('members', { count: item.auxiliaryData.memberCount })}`
              : undefined
          }
        />
      )}
    />
  );
}
