'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { Typeahead } from '@astryxdesign/core/Typeahead';
import { type SearchableItem, useApiSearchSource } from '@isbp/ui/search-source';
import { NetworkIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { LookupItem } from '../contracts';
import { useLookup } from './lib';

export const NONE = '__none__';

/** Lists longer than this get a search box in the dropdown. */
const SEARCH_FROM = 8;

/** Group or department select with a "none" option. */
export function LookupSelect({
  kind,
  value,
  onChange,
  noneLabel,
  label,
  status,
}: {
  kind: 'groups' | 'departments';
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  noneLabel: string;
  label: string;
  status?: { type: 'error' | 'warning' | 'success'; message?: string };
}) {
  const { items } = useLookup(kind);
  return (
    <Selector
      label={label}
      status={status}
      width="100%"
      hasSearch={items.length > SEARCH_FROM}
      value={value ?? NONE}
      onChange={(v) => onChange(v === NONE ? null : v)}
      options={[{ value: NONE, label: noneLabel }, ...items.map((g) => ({ value: g.id, label: g.name }))]}
    />
  );
}

const toItem = (ci: LookupItem): SearchableItem<LookupItem> => ({
  id: ci.id,
  label: ci.name,
  auxiliaryData: ci,
});

/** Single configuration item picker (`/alm/lookups/cis?q=`): by name or CI number. */
export function CiPicker({
  value,
  onChange,
  label,
  description,
}: {
  value: LookupItem | null;
  onChange: (ci: LookupItem | null) => void;
  label: string;
  description?: string;
}) {
  const t = useTranslations('alm.ciPicker');
  const source = useApiSearchSource<LookupItem>({
    path: '/alm/lookups/cis',
    query: (q) => ({ q: q.trim() || undefined }),
    toItem,
  });
  const item = useMemo(() => (value ? toItem(value) : null), [value]);
  return (
    <Typeahead
      label={label}
      description={description}
      placeholder={t('placeholder')}
      searchSource={source}
      value={item}
      onChange={(next) => onChange(next?.auxiliaryData ?? null)}
      startIcon={NetworkIcon}
      hasEntriesOnFocus
      hasClear
      width="100%"
      emptySearchText={t('noResults')}
      renderItem={(next) => {
        const ci = next.auxiliaryData;
        if (!ci) return next.label;
        return (
          <HStack gap={2} vAlign="center">
            <Icon icon={NetworkIcon} color="secondary" />
            <StackItem size="fill">
              <VStack>
                <Text maxLines={1}>{ci.name}</Text>
                {ci.hint && (
                  <Text type="supporting" maxLines={1}>
                    {ci.hint}
                  </Text>
                )}
              </VStack>
            </StackItem>
          </HStack>
        );
      }}
    />
  );
}
