'use client';

import { SearchIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';
import { Input } from './input';

/** Debounced search box (calls `onChange` 250 ms after typing stops). */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  clearLabel,
  delay = 250,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  clearLabel?: string;
  delay?: number;
}) {
  const t = useTranslations('ui.search');
  const [draft, setDraft] = React.useState(value);
  const emit = React.useEffectEvent((next: string) => onChange(next));
  React.useEffect(() => setDraft(value), [value]);
  React.useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => emit(draft), delay);
    return () => clearTimeout(t);
  }, [draft, value, delay]);
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          aria-label={clearLabel ?? t('clear')}
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}
