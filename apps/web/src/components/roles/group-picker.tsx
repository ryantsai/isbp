'use client';

import { type SearchableItem, Typeahead, TypeaheadItem } from '@astryxdesign/core/Typeahead';
import type { Group } from '@isbp/contracts';
import { IconTile } from '@isbp/ui/icon-tile';
import { useApiSearchSource } from '@isbp/ui/search-source';
import { UsersRoundIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface PickedGroup {
  id: string;
  name: string;
  key?: string;
}

/** What a result row keeps: the group the caller gets back, plus what the row shows under its name. */
type GroupItem = SearchableItem<PickedGroup & { memberCount?: number }>;

/** The icon tile that stands for a group (people have an avatar, groups this). */
export function GroupGlyph({ className }: { className?: string }) {
  return (
    <IconTile size="sm" className={className} aria-hidden>
      <UsersRoundIcon />
    </IconTile>
  );
}

/**
 * Async group picker (server-side search via `GET /groups?q=`). Single selection. It draws its own label, hint and
 * error like every Astryx field: without a `label` the `aria-label` (or the placeholder) becomes a visually hidden one.
 */
export function GroupPicker({
  value,
  onChange,
  placeholder,
  label,
  isLabelHidden,
  description,
  status,
  isRequired,
  isOptional,
  isDisabled,
  id,
  className,
  'aria-label': ariaLabel,
}: {
  value: PickedGroup | null;
  onChange: (group: PickedGroup | null) => void;
  placeholder?: string;
  label?: string;
  isLabelHidden?: boolean;
  description?: string;
  status?: { type: 'error' | 'warning' | 'success'; message?: string };
  isRequired?: boolean;
  isOptional?: boolean;
  isDisabled?: boolean;
  id?: string;
  className?: string;
  /** Names the picker when the page shows no caption of its own. Same as `label` + `isLabelHidden`. */
  'aria-label'?: string;
}) {
  const t = useTranslations('common');
  const tr = useTranslations('roles.groupPicker');
  const source = useApiSearchSource<Group, PickedGroup & { memberCount?: number }>({
    path: '/groups',
    query: (q) => ({ q: q || undefined, pageSize: 8, sort: 'name' }),
    toItem: (g) => ({
      id: g.id,
      label: g.name,
      auxiliaryData: { id: g.id, name: g.name, key: g.key, memberCount: g.memberCount },
    }),
  });
  const shownPlaceholder = placeholder ?? tr('placeholder');
  return (
    <Typeahead<GroupItem>
      id={id}
      className={className}
      label={label ?? ariaLabel ?? shownPlaceholder}
      isLabelHidden={isLabelHidden ?? !label}
      description={description}
      status={status}
      isRequired={isRequired}
      isOptional={isOptional}
      isDisabled={isDisabled}
      placeholder={shownPlaceholder}
      searchSource={source}
      value={value ? { id: value.id, label: value.name, auxiliaryData: value } : null}
      onChange={(item) =>
        onChange(item ? { id: item.id, name: item.label, key: item.auxiliaryData?.key } : null)
      }
      hasEntriesOnFocus
      emptySearchText={t('noResults')}
      renderItem={(item) => {
        const group = item.auxiliaryData;
        return (
          <TypeaheadItem
            item={item}
            icon={<GroupGlyph />}
            description={
              group?.memberCount === undefined
                ? undefined
                : `${group.key} · ${tr('members', { count: group.memberCount })}`
            }
          />
        );
      }}
    />
  );
}
