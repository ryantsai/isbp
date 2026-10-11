'use client';

import { Typeahead } from '@astryxdesign/core/Typeahead';
import { type SearchableItem, useApiSearchSource } from '@isbp/ui/search-source';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { Option } from '../../contracts';

const toItem = (o: Option): SearchableItem<Option> => ({ id: o.id, label: o.label, auxiliaryData: o });

/** Where synced records live in ISBP (a project for tasks): records of the container entity you can see. */
export function ContainerPicker({
  entity,
  value,
  valueLabel,
  label,
  onChange,
  disabled,
  status,
}: {
  entity: string;
  /** The picked container's id. */
  value: string | null;
  /** The picked container's name. */
  valueLabel: string | null;
  /** The field's label. */
  label: string;
  onChange: (option: Option) => void;
  disabled?: boolean;
  status?: { type: 'error'; message: string };
}) {
  const t = useTranslations('integrations.editor');
  const source = useApiSearchSource<Option>({
    path: `/integrations/entities/${entity}/containers`,
    query: (q) => ({ q }),
    toItem,
  });
  const item = useMemo<SearchableItem<Option> | null>(
    () => (value ? { id: value, label: valueLabel ?? value } : null),
    [value, valueLabel],
  );
  return (
    <Typeahead
      label={label}
      isRequired
      placeholder={t('chooseContainer')}
      searchSource={source}
      value={item}
      onChange={(next) => next?.auxiliaryData && onChange(next.auxiliaryData)}
      hasClear={false}
      hasEntriesOnFocus
      minQueryLength={0}
      isDisabled={disabled}
      status={status}
      emptySearchText={t('noContainers')}
    />
  );
}
