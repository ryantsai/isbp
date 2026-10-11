'use client';

import { Selector } from '@astryxdesign/core/Selector';
import { Typeahead } from '@astryxdesign/core/Typeahead';
import { canonicalCategory, categoryChoices, categoryMatchKey } from '@isbp/contracts';
import type { SearchableItem, SearchSource } from '@isbp/ui/search-source';
import { useMessages, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { FORM_ICONS, formIconOf } from './form-meta';

const ICON_NAMES = Object.keys(FORM_ICONS);

/** Single-choice icon list (a searchable selector; every option shows its icon). */
export function IconPicker({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: string;
  onChange: (icon: string) => void;
  description?: string;
}) {
  const t = useTranslations('forms.icons');
  const names = ICON_NAMES.includes(value) ? ICON_NAMES : [value, ...ICON_NAMES];
  const options = names.map((name) => {
    // An icon outside the curated set (from a process pack): its name in words, "server-cog" → "Server cog".
    const words = name.replace(/[-_]+/g, ' ');
    return {
      value: name,
      label: t.has(name) ? t(name) : words.charAt(0).toUpperCase() + words.slice(1),
      icon: formIconOf(name),
    };
  });
  return (
    <Selector
      label={label}
      description={description}
      value={value}
      onChange={(next) => next && onChange(next)}
      options={options}
      hasSearch
      searchPlaceholder={label}
      width="100%"
    />
  );
}

/**
 * Category labels as the portal shows them: the known keys translated (`requests.categories.<key>`, any case), other
 * categories as typed. `known` lists those keys.
 */
export function useCategoryLabel() {
  const messages = useMessages();
  const t = useTranslations('requests.categories');
  const known = useMemo(
    () =>
      Object.keys(
        (
          (messages as Record<string, unknown>).requests as
            { categories?: Record<string, string> } | undefined
        )?.categories ?? {},
      ),
    [messages],
  );
  const label = useCallback(
    (value: string) => {
      const key = canonicalCategory(value, known);
      return key && known.includes(key) ? t(key) : value;
    },
    [known, t],
  );
  return { known, label };
}

/** What a result row stands for: an existing category, or "add what was typed". */
type CategoryItem = SearchableItem<{ create: boolean }>;

/**
 * The form's category: a searchable pick among the categories in use (each once, whatever its case) and the portal's
 * own categories, with their translated names. Typing a name that isn't there offers to add it as a new category.
 */
export function CategoryInput({
  label,
  description,
  value,
  onChange,
  suggestions,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  /** Categories other forms use (any spelling). */
  suggestions: readonly string[];
}) {
  const t = useTranslations('forms.create');
  const { known, label: labelOf } = useCategoryLabel();
  const options = useMemo(() => {
    const list = categoryChoices([...known, ...suggestions, value], known);
    return list.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  }, [known, suggestions, value, labelOf]);

  const source = useMemo<SearchSource<CategoryItem>>(() => {
    const existing = (o: string): CategoryItem => ({
      id: o,
      label: labelOf(o),
      auxiliaryData: { create: false },
    });
    return {
      bootstrap: () => options.map(existing),
      search: (q) => {
        const query = categoryMatchKey(q);
        if (!query) return options.map(existing);
        const shown = options.filter(
          (o) => categoryMatchKey(labelOf(o)).includes(query) || categoryMatchKey(o).includes(query),
        );
        const exact = options.some(
          (o) => categoryMatchKey(labelOf(o)) === query || categoryMatchKey(o) === query,
        );
        const rows = shown.map(existing);
        if (!exact) {
          const name = q.trim().replace(/\s+/g, ' ').slice(0, 64);
          rows.push({
            id: `__new__${name}`,
            label: t('categoryNew', { name }),
            auxiliaryData: { create: true },
          });
        }
        return rows;
      },
    };
  }, [options, labelOf, t]);

  const current = canonicalCategory(value, known);
  const item: CategoryItem | null = current
    ? { id: current, label: labelOf(current), auxiliaryData: { create: false } }
    : null;

  return (
    <Typeahead<CategoryItem>
      label={label}
      description={description}
      searchSource={source}
      value={item}
      onChange={(next) => {
        if (!next) return onChange('');
        const picked = next.auxiliaryData?.create ? next.id.slice('__new__'.length) : next.id;
        onChange(canonicalCategory(picked, known) ?? '');
      }}
      placeholder={t('categorySearch')}
      hasEntriesOnFocus
      minQueryLength={0}
      debounceMs={0}
      maxMenuItems={12}
      hasClear
      width="100%"
    />
  );
}
