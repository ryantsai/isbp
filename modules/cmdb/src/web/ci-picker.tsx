'use client';

import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Typeahead } from '@astryxdesign/core/Typeahead';
import { type SearchableItem, useApiSearchSource } from '@isbp/ui/search-source';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { CiRef, CiSummary } from '../contracts';
import { CiStatusBadge } from './badges';
import { ClassIcon } from './class-icon';

type CiItem = SearchableItem<CiSummary | CiRef>;

const toItem = (c: CiSummary | CiRef): CiItem => ({
  id: c.id,
  label: `${c.reference} · ${c.name}`,
  auxiliaryData: c,
});

/** Searchable configuration-item picker (server-side search by name or CI number). */
export function CiPicker({
  value,
  onChange,
  excludeId,
  label,
  isLabelHidden,
  description,
  status,
  isRequired,
  isDisabled,
}: {
  value: CiRef | null;
  onChange: (ci: CiRef | null) => void;
  excludeId?: string;
  /** The field's label; without one the placeholder names the field (visually hidden). */
  label?: string;
  isLabelHidden?: boolean;
  description?: string;
  status?: { type: 'error' | 'warning' | 'success'; message?: string };
  isRequired?: boolean;
  isDisabled?: boolean;
}) {
  const t = useTranslations('cmdb.rel');
  const source = useApiSearchSource<CiSummary, CiSummary | CiRef>({
    path: '/cmdb/cis',
    query: (q) => ({ q: q.trim() || undefined, pageSize: 12 }),
    toItem,
    exclude: (item) => item.id === excludeId,
    hasInitialList: false,
  });
  const selected = useMemo(() => (value ? toItem(value) : null), [value]);
  return (
    <Typeahead<CiItem>
      label={label ?? t('otherPlaceholder')}
      isLabelHidden={isLabelHidden ?? !label}
      placeholder={t('otherPlaceholder')}
      description={description}
      status={status}
      isRequired={isRequired}
      isDisabled={isDisabled}
      searchSource={source}
      value={selected}
      onChange={(item) => onChange(item ? (item.auxiliaryData as CiRef) : null)}
      emptySearchText={t('noMatches')}
      renderItem={(item) => {
        const c = item.auxiliaryData as CiSummary;
        return (
          <HStack gap={2} vAlign="center">
            <ClassIcon name={c.class.icon} className="size-4 shrink-0 text-muted-foreground" />
            <StackItem size="fill">
              <VStack>
                <Text maxLines={1}>{c.name}</Text>
                <Text type="code" color="secondary">
                  {c.reference}
                </Text>
              </VStack>
            </StackItem>
            {c.status ? <CiStatusBadge status={c.status} /> : null}
          </HStack>
        );
      }}
    />
  );
}
