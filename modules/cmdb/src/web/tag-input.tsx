'use client';

import { cn } from '@isbp/ui';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

const MAX_TAGS = 20;

/** Free-text tags: Enter or comma adds one, Backspace on an empty input removes the last. */
export function TagInput({
  value,
  onChange,
  id,
  placeholder,
  'aria-describedby': describedBy,
  invalid,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  id?: string;
  placeholder?: string;
  'aria-describedby'?: string;
  invalid?: boolean;
}) {
  const t = useTranslations('cmdb.form');
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const tag = raw.trim().replace(/,/g, '').slice(0, 50);
    if (tag && !value.includes(tag) && value.length < MAX_TAGS) onChange([...value, tag]);
    setDraft('');
  };
  return (
    <div
      className={cn(
        'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30',
        invalid && 'border-destructive',
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x !== tag))}
            aria-label={t('removeTag', { tag })}
            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        placeholder={value.length ? undefined : placeholder}
        disabled={value.length >= MAX_TAGS}
        onChange={(e) => {
          const next = e.target.value;
          if (next.endsWith(',')) add(next);
          else setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft && add(draft)}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
