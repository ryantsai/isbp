'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { Token } from '@astryxdesign/core/Token';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { createStaticSource, type SearchableItem, TypeaheadItem } from '@astryxdesign/core/Typeahead';
import type { Group } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { UsersRoundIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useApiQuery } from '@/lib/api';

/** Groups a person can be put into by hand: not "Everyone" (implicit) and not kept by a directory sync. */
export const isAssignableGroup = (g: Pick<Group, 'isSystem' | 'source'>) =>
  !g.isSystem && g.source === 'local';

/** The assignable groups (cached; shared by the pickers on a page). */
export function useAssignableGroups(enabled = true) {
  const query = useApiQuery<Page<Group>>(enabled ? '/groups' : null, { pageSize: 200, sort: 'name' });
  return { ...query, groups: (query.data?.items ?? []).filter(isAssignableGroup) };
}

type GroupItem = SearchableItem<Group>;

/**
 * Picks several groups by id: the chosen ones as removable chips, and a searchable list to add from. Give it a visible
 * `label` (with `description` / `error`: it draws its own field frame, so no wrapping `Field`), or keep an external
 * label and pass its id as `labelledBy` (it then names the group; the input stays named `addLabel`, default "Add
 * groups"). `exclude` hides groups (e.g. ones the person is in).
 */
export function GroupMultiSelect({
  value,
  onChange,
  label,
  description,
  error,
  labelledBy,
  exclude = [],
  addLabel,
  className,
}: {
  value: readonly string[];
  onChange: (ids: string[]) => void;
  /** A visible label (the picker draws the field frame itself). */
  label?: string;
  description?: string;
  /** Validation message (red border + text under the field). */
  error?: string | null;
  /** The id of an external visible label: names the group of chips and input. */
  labelledBy?: string;
  exclude?: readonly string[];
  addLabel?: string;
  className?: string;
}) {
  const t = useTranslations('users.groupPicker');
  const tc = useTranslations('common');
  const { groups, isLoading } = useAssignableGroups();
  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const options = useMemo<GroupItem[]>(
    () =>
      groups
        .filter((g) => !exclude.includes(g.id))
        .map((g) => ({ id: g.id, label: g.name, auxiliaryData: g })),
    [groups, exclude],
  );
  const source = useMemo(
    () => createStaticSource(options, { keywords: (item) => [item.auxiliaryData?.description ?? ''] }),
    [options],
  );
  const chosen = useMemo<GroupItem[]>(
    () =>
      value.map((id) => {
        const g = byId.get(id);
        return { id, label: g?.name ?? t('unknown'), auxiliaryData: g };
      }),
    [value, byId, t],
  );

  return (
    <Tokenizer
      className={className}
      role={labelledBy && !label ? 'group' : undefined}
      aria-labelledby={label ? undefined : labelledBy}
      label={label ?? addLabel ?? t('add')}
      isLabelHidden={!label}
      description={description}
      status={error ? { type: 'error', message: error } : undefined}
      placeholder={t('search')}
      searchSource={source}
      value={chosen}
      hasEntriesOnFocus
      debounceMs={0}
      maxMenuItems={50}
      emptySearchText={isLoading ? tc('loading') : t('none')}
      onChange={(next) => onChange(next.map((item) => item.id))}
      renderItem={(item) => (
        <TypeaheadItem
          item={item}
          icon={<Icon icon={UsersRoundIcon} />}
          description={
            item.auxiliaryData ? t('members', { count: item.auxiliaryData.memberCount }) : undefined
          }
        />
      )}
      renderToken={(item, onRemove) => (
        <Token label={item.label} icon={<Icon icon={UsersRoundIcon} />} onRemove={onRemove} />
      )}
    />
  );
}
