'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Typeahead } from '@astryxdesign/core/Typeahead';
import { useTranslations } from 'next-intl';
import { useMemo, useRef } from 'react';
import { useInputAttrs } from '../lib/input-attrs';
import { UserAvatar } from './avatar';
import { useApiQuery } from './query';
import { type SearchableItem, useApiSearchSource } from './search-source';

/** Minimal colleague profile from `GET /people/lookup` (available to every signed-in person). */
export interface PersonOption {
  id: string;
  displayName: string;
  email?: string;
  jobTitle?: string | null;
  avatarUrl?: string | null;
  department?: string | null;
  /** `pending` = pre-boarded (hasn't started yet); only found with `includePreboarded`. */
  status?: 'active' | 'pending';
}

/** Resolves display names for person ids (e.g. "person" field values). */
export function usePeople(ids: readonly (string | null | undefined)[]) {
  const wanted = useMemo(() => [...new Set(ids.filter((x): x is string => Boolean(x)))].sort(), [ids]);
  const { data } = useApiQuery<{ items: PersonOption[] }>(wanted.length ? '/people/lookup' : null, {
    ids: wanted,
  });
  return useMemo(() => new Map((data?.items ?? []).map((p) => [p.id, p])), [data]);
}

type PersonItem = SearchableItem<PersonOption>;

const toItem = (p: PersonOption): PersonItem => ({ id: p.id, label: p.displayName, auxiliaryData: p });

/**
 * Searchable single-person picker for any signed-in user (active people only; with `includePreboarded`, also the
 * pre-boarded people the caller may request access for, marked as such). Built on Astryx `Typeahead`: the accessible
 * name is `aria-label`, else the placeholder (a visible label next to it ties in through `id`).
 */
export function PersonPicker({
  value,
  onChange,
  placeholder,
  excludeIds = [],
  id,
  invalid,
  disabled,
  clearable = true,
  includePreboarded = false,
  className,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
}: {
  value: PersonOption | null;
  onChange: (person: PersonOption | null) => void;
  placeholder?: string;
  excludeIds?: readonly string[];
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** False for required fields: no clear button, so the value can only be replaced. */
  clearable?: boolean;
  /** Also find pre-boarded people (not started yet) the caller may request access for. */
  includePreboarded?: boolean;
  className?: string;
  'aria-describedby'?: string;
  /** Name for pickers without a `<label htmlFor={id}>` (e.g. filters); defaults to the placeholder. */
  'aria-label'?: string;
}) {
  const t = useTranslations('ui.person');
  const root = useRef<HTMLDivElement>(null);
  useInputAttrs(root, { id, describedBy, label: ariaLabel });
  const source = useApiSearchSource<PersonOption>({
    path: '/people/lookup',
    query: (q) => ({ q, includePreboarded: includePreboarded ? 'true' : undefined }),
    toItem,
    hasInitialList: false,
    exclude: (item) => excludeIds.includes(item.id),
  });
  const item = useMemo(() => (value ? toItem(value) : null), [value]);

  return (
    <Typeahead
      ref={root}
      className={className}
      label={ariaLabel ?? placeholder ?? t('placeholder')}
      isLabelHidden
      placeholder={placeholder ?? t('search')}
      searchSource={source}
      value={item}
      onChange={(next) => onChange(next?.auxiliaryData ?? null)}
      hasClear={clearable}
      isDisabled={disabled}
      status={invalid ? { type: 'error' } : undefined}
      emptySearchText={t('noResults')}
      renderItem={(p) => <PersonRow person={p.auxiliaryData} />}
    />
  );
}

function PersonRow({ person }: { person: PersonOption | undefined }) {
  const t = useTranslations('ui.person');
  if (!person) return null;
  return (
    <HStack gap={2} vAlign="center">
      <UserAvatar name={person.displayName} src={person.avatarUrl} className="size-6 text-[10px]" />
      <VStack gap={0}>
        <Text maxLines={1}>{person.displayName}</Text>
        <Text type="supporting" color="secondary" maxLines={1}>
          {[person.jobTitle, person.department].filter(Boolean).join(' · ') || person.email}
        </Text>
      </VStack>
      {person.status === 'pending' && <Badge variant="neutral" label={t('preboarded')} />}
    </HStack>
  );
}
