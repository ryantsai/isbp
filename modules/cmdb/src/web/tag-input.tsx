'use client';

import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { createStaticSource, type SearchableItem } from '@astryxdesign/core/Typeahead';
import { useMemo } from 'react';

const MAX_TAGS = 20;
const NO_SUGGESTIONS = createStaticSource<SearchableItem>([]);

const toItem = (tag: string): SearchableItem => ({ id: tag, label: tag });

/** Free-text tags: type one and press Enter; a token's remove button (or Backspace) takes it away again. */
export function TagInput({
  value,
  onChange,
  label,
  isLabelHidden,
  description,
  placeholder,
  status,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  label: string;
  isLabelHidden?: boolean;
  description?: string;
  placeholder?: string;
  status?: { type: 'error' | 'warning' | 'success'; message?: string };
}) {
  const items = useMemo(() => value.map(toItem), [value]);
  return (
    <Tokenizer<SearchableItem>
      label={label}
      isLabelHidden={isLabelHidden}
      description={description}
      placeholder={placeholder}
      status={status}
      searchSource={NO_SUGGESTIONS}
      value={items}
      hasCreate
      maxEntries={MAX_TAGS}
      emptySearchText=""
      debounceMs={0}
      onChange={(next) => {
        const tags: string[] = [];
        for (const item of next) {
          // A typed tag is cleaned the way the API stores it: no commas, at most 50 characters, no duplicates.
          const tag = item.label.trim().replace(/,/g, '').slice(0, 50);
          if (tag && !tags.includes(tag)) tags.push(tag);
        }
        onChange(tags.slice(0, MAX_TAGS));
      }}
    />
  );
}
