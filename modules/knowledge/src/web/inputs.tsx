'use client';

import type { Page } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@isbp/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { useApiQuery } from '@isbp/ui/query';
import { ChevronsUpDownIcon, LinkIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { ArticleListItem } from '../contracts';
import { LocaleChip, StatusBadge } from './parts';

/** Tags as removable chips; Enter or comma adds, Backspace on an empty input removes the last one. */
export function TagsInput({
  id,
  value,
  onChange,
  max = 10,
  invalid,
  'aria-describedby': describedBy,
}: {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  max?: number;
  invalid?: boolean;
  'aria-describedby'?: string;
}) {
  const t = useTranslations('knowledge.editor');
  const [draft, setDraft] = useState('');
  const addAll = (raw: string[]) => {
    const next = [...value];
    for (const r of raw) {
      const tag = r.trim().toLowerCase().slice(0, 40);
      if (tag && !next.includes(tag) && next.length < max) next.push(tag);
    }
    if (next.length !== value.length) onChange(next);
  };
  const add = (raw: string) => {
    addAll([raw]);
    setDraft('');
  };
  return (
    <div
      className={cn(
        'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30',
        invalid && 'border-destructive',
      )}
    >
      <ul className="contents" aria-label={t('tags')}>
        {value.map((tag) => (
          <li
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pr-1 pl-2 text-xs font-medium"
          >
            #{tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== tag))}
              aria-label={t('removeTag', { tag })}
              className="rounded-sm p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <XIcon className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <input
        id={id}
        value={draft}
        disabled={value.length >= max}
        onChange={(e) => {
          const v = e.target.value;
          if (!v.includes(',')) return setDraft(v);
          const parts = v.split(',');
          addAll(parts.slice(0, -1));
          setDraft(parts[parts.length - 1] ?? '');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={value.length >= max ? t('tagsFull', { max }) : t('tagsPlaceholder')}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** Picks the article this one translates (searches articles you can see). */
export function ArticlePicker({
  id,
  value,
  selected,
  onChange,
  excludeId,
}: {
  id?: string;
  value: string | null;
  /** Label of the current value (when known). */
  selected?: { reference: string; title: string } | null;
  onChange: (article: ArticleListItem | null) => void;
  excludeId?: string;
}) {
  const t = useTranslations('knowledge.editor');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(timer);
  }, [q]);
  const { data, isFetching } = useApiQuery<Page<ArticleListItem>>(open ? '/knowledge/articles' : null, {
    q: debounced || undefined,
    pageSize: 10,
    sort: '-views',
  });
  const items = (data?.items ?? []).filter((a) => a.id !== excludeId && a.status !== 'retired');

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="min-w-0 flex-1 justify-between font-normal"
          >
            <span className={cn('flex min-w-0 items-center gap-2', !value && 'text-muted-foreground')}>
              <LinkIcon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">
                {value && selected ? `${selected.reference} · ${selected.title}` : t('translationOfNone')}
              </span>
            </span>
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder={t('translationOfSearch')} />
            <CommandList aria-busy={isFetching}>
              <CommandEmpty>{t('translationOfEmpty')}</CommandEmpty>
              <CommandGroup>
                {items.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={a.id}
                    onSelect={() => {
                      onChange(a);
                      setOpen(false);
                    }}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <LocaleChip locale={a.locale} />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate">{a.title}</span>
                      <span className="font-mono text-xs text-muted-foreground">{a.reference}</span>
                    </span>
                    {a.status !== 'published' && <StatusBadge status={a.status} />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onChange(null)}
          aria-label={t('translationOfClear')}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}
