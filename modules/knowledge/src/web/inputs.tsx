'use client';

import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { Typeahead } from '@astryxdesign/core/Typeahead';
import { useApiSearchSource } from '@isbp/ui/search-source';
import { LinkIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { ArticleListItem } from '../contracts';
import { LocaleChip, StatusBadge } from './parts';

type InputStatus = { type: 'error'; message: string } | undefined;

/** Tags as removable tokens; Enter adds the typed text, Backspace on an empty input removes the last one. */
export function TagsInput({
  label,
  description,
  value,
  onChange,
  max = 10,
  status,
}: {
  label: string;
  description?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  max?: number;
  status?: InputStatus;
}) {
  const t = useTranslations('knowledge.editor');
  // Tags are free text: nothing to look up, the typed text becomes the token ("Create …").
  const source = useMemo(() => ({ search: () => [], bootstrap: () => [] }), []);
  return (
    <Tokenizer
      label={label}
      description={value.length >= max ? t('tagsFull', { max }) : description}
      hasCreate
      searchSource={source}
      value={value.map((tag) => ({ id: tag, label: `#${tag}` }))}
      maxEntries={max}
      placeholder={t('tagsPlaceholder')}
      status={status}
      onChange={(items) => {
        const next: string[] = [];
        for (const item of items) {
          const tag = item.id.replace(/^#/, '').trim().toLowerCase().slice(0, 40);
          if (tag && !next.includes(tag) && next.length < max) next.push(tag);
        }
        onChange(next);
      }}
    />
  );
}

/** Picks the article this one translates (searches articles you can see). */
export function ArticlePicker({
  label,
  description,
  value,
  selected,
  onChange,
  excludeId,
  status,
}: {
  label: string;
  description?: string;
  value: string | null;
  /** Label of the current value (when known). */
  selected?: { reference: string; title: string } | null;
  onChange: (article: ArticleListItem | null) => void;
  excludeId?: string;
  status?: InputStatus;
}) {
  const t = useTranslations('knowledge.editor');
  const source = useApiSearchSource<ArticleListItem>({
    path: '/knowledge/articles',
    query: (q) => ({ q: q || undefined, pageSize: 10, sort: '-views' }),
    toItem: (a) => ({ id: a.id, label: a.title, auxiliaryData: a }),
    exclude: (item) => item.id === excludeId || item.auxiliaryData?.status === 'retired',
  });
  return (
    <Typeahead
      label={label}
      description={description}
      searchSource={source}
      value={value && selected ? { id: value, label: `${selected.reference} · ${selected.title}` } : null}
      onChange={(item) => onChange(item?.auxiliaryData ?? null)}
      placeholder={t('translationOfNone')}
      startIcon={LinkIcon}
      hasEntriesOnFocus
      emptySearchText={t('translationOfEmpty')}
      status={status}
      renderItem={(item) => {
        const a = item.auxiliaryData;
        return (
          <HStack gap={2} vAlign="center">
            {a && <LocaleChip locale={a.locale} />}
            <StackItem size="fill">
              <VStack gap={0}>
                <Text maxLines={1}>{item.label}</Text>
                {a && <Text type="code">{a.reference}</Text>}
              </VStack>
            </StackItem>
            {a && a.status !== 'published' && <StatusBadge status={a.status} />}
          </HStack>
        );
      }}
    />
  );
}
