'use client';

import { TextInput } from '@astryxdesign/core/TextInput';
import { SearchIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Debounced search box (calls `onChange` 250 ms after typing stops). The accessible name is the placeholder (or
 * "Search"). Astryx names the clear button after the field ("Clear <label>"), so `clearLabel` is accepted for
 * compatibility but no longer used.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  delay = 250,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** @deprecated Astryx's text field labels its clear button itself. */
  clearLabel?: string;
  delay?: number;
}) {
  const t = useTranslations('common');
  const [draft, setDraft] = React.useState(value);
  const emit = React.useEffectEvent((next: string) => onChange(next));
  React.useEffect(() => setDraft(value), [value]);
  React.useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => emit(draft), delay);
    return () => clearTimeout(timer);
  }, [draft, value, delay]);
  return (
    <div className={cn('w-full sm:w-72', className)}>
      <TextInput
        // `type="search"` is not offered by Astryx; the role gives the same landmark-free "searchbox" semantics.
        role="searchbox"
        label={placeholder ?? t('search')}
        isLabelHidden
        placeholder={placeholder}
        startIcon={SearchIcon}
        hasClear
        width="100%"
        value={draft}
        onChange={(next) => {
          setDraft(next);
          // Clearing is immediate; typing waits for a pause.
          if (next === '') onChange('');
        }}
      />
    </div>
  );
}
