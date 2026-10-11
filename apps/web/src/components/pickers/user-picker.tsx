'use client';

import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Typeahead } from '@astryxdesign/core/Typeahead';
import type { UserSummary } from '@isbp/contracts';
import { UserAvatar } from '@isbp/ui/avatar';
import { useInputAttrs } from '@isbp/ui/lib/input-attrs';
import { type SearchableItem, useApiSearchSource } from '@isbp/ui/search-source';
import { useTranslations } from 'next-intl';
import { useMemo, useRef } from 'react';
import { useLabelledBy } from './use-labelled-by';

export interface PickedUser {
  id: string;
  displayName: string;
  email?: string;
}

type UserOption = PickedUser & { avatarUrl?: string | null };
type UserItem = SearchableItem<UserOption>;

const toItem = (u: UserOption): UserItem => ({ id: u.id, label: u.displayName, auxiliaryData: u });

/**
 * Async person picker (server-side search). Single selection; `value` carries the display name. Give it a visible
 * `label` (with `description` / `error` / `isRequired`: it draws its own field frame, so no wrapping `Field`), or name it
 * with `id` plus an external `<label htmlFor>`, or with `aria-label` / `aria-labelledby`. Unnamed, its accessible name
 * is "Search people".
 */
export function UserPicker({
  value,
  onChange,
  placeholder,
  excludeIds = [],
  status = 'active',
  label,
  description,
  error,
  isRequired,
  id,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: {
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  placeholder?: string;
  excludeIds?: string[];
  /** Which users to offer (`active`, `pending`…): the user status filter of the list, not a validation status. */
  status?: string;
  /** A visible label (the picker draws the field frame itself). */
  label?: string;
  description?: string;
  /** Validation message (red border + text under the field). */
  error?: string | null;
  isRequired?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  const t = useTranslations('common');
  const tu = useTranslations('users.picker');
  const root = useRef<HTMLDivElement>(null);
  useInputAttrs(root, { id, describedBy, label: label ? undefined : ariaLabel });
  useLabelledBy(root, label ? undefined : labelledBy);
  const source = useApiSearchSource<UserSummary, UserOption>({
    path: '/users',
    query: (q) => ({ q: q || undefined, pageSize: 8, status }),
    toItem: (u) => toItem({ id: u.id, displayName: u.displayName, email: u.email, avatarUrl: u.avatarUrl }),
    exclude: (item) => excludeIds.includes(item.id),
  });
  const item = useMemo(() => (value ? toItem(value) : null), [value]);
  const shown = placeholder ?? t('searchPlaceholder');

  return (
    <Typeahead
      ref={root}
      className={className}
      label={label ?? ariaLabel ?? tu('search')}
      isLabelHidden={!label}
      description={description}
      isRequired={isRequired}
      status={error ? { type: 'error', message: error } : undefined}
      placeholder={shown}
      searchSource={source}
      value={item}
      hasEntriesOnFocus
      onChange={(next) =>
        onChange(
          next
            ? {
                id: next.id,
                displayName: next.label,
                email: next.auxiliaryData?.email,
              }
            : null,
        )
      }
      emptySearchText={t('noResults')}
      renderItem={(u) => <UserRow user={u.auxiliaryData} />}
    />
  );
}

function UserRow({ user }: { user: UserOption | undefined }) {
  if (!user) return null;
  return (
    <HStack gap={2} vAlign="center">
      <UserAvatar name={user.displayName} src={user.avatarUrl} className="size-6 text-[10px]" />
      <VStack gap={0}>
        <Text maxLines={1}>{user.displayName}</Text>
        <Text type="supporting" color="secondary" maxLines={1}>
          {user.email}
        </Text>
      </VStack>
    </HStack>
  );
}
