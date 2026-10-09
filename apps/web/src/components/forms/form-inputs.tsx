'use client';

import { canonicalCategory, categoryChoices, categoryMatchKey } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@isbp/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from 'lucide-react';
import { useMessages, useTranslations } from 'next-intl';
import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from 'react';
import { FORM_ICONS, FormIcon } from './form-meta';

const ICON_NAMES = Object.keys(FORM_ICONS);

/** Single-choice icon grid (radio group with arrow-key navigation). */
export function IconPicker({
  value,
  onChange,
  labelledBy,
}: {
  value: string;
  onChange: (icon: string) => void;
  labelledBy?: string;
}) {
  const t = useTranslations('forms.icons');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const names = ICON_NAMES.includes(value) ? ICON_NAMES : [value, ...ICON_NAMES];
  const active = Math.max(0, names.indexOf(value));
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = names.length - 1;
    const grid = e.currentTarget.parentElement;
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowLeft') next = i === 0 ? last : i - 1;
    else if (e.key === 'ArrowDown') next = Math.min(last, i + cols);
    else if (e.key === 'ArrowUp') next = Math.max(0, i - cols);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    onChange(names[next]!);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5"
    >
      {names.map((name, i) => {
        const Icon = FORM_ICONS[name];
        const checked = i === active;
        // An icon outside the curated set (from a process pack): its name in words, "server-cog" → "Server cog".
        const words = name.replace(/[-_]+/g, ' ');
        const label = t.has(name) ? t(name) : words.charAt(0).toUpperCase() + words.slice(1);
        return (
          <button
            key={name}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(name)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative grid aspect-square place-items-center rounded-lg border text-muted-foreground transition-[color,background-color,border-color,transform] outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95',
              checked && 'border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
            )}
          >
            {Icon ? <Icon className="size-4.5" aria-hidden /> : <FormIcon name={name} className="size-4.5" />}
            {checked && (
              <CheckIcon
                aria-hidden
                className="absolute -top-1 -right-1 size-3.5 rounded-full bg-primary p-0.5 text-primary-foreground"
              />
            )}
          </button>
        );
      })}
    </div>
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

/**
 * The form's category: a combobox of the categories in use (each once, whatever its case) and the portal's own
 * categories, with their translated names. Typing a name that isn't there offers to add it as a new category.
 */
export function CategoryInput({
  id,
  value,
  onChange,
  suggestions,
  describedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Categories other forms use (any spelling). */
  suggestions: readonly string[];
  describedBy?: string;
}) {
  const t = useTranslations('forms.create');
  const { known, label } = useCategoryLabel();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const options = useMemo(() => {
    const list = categoryChoices([...known, ...suggestions, value], known);
    return list.sort((a, b) => label(a).localeCompare(label(b)));
  }, [known, suggestions, value, label]);
  const query = categoryMatchKey(q);
  const shown = query
    ? options.filter((o) => categoryMatchKey(label(o)).includes(query) || categoryMatchKey(o).includes(query))
    : options;
  const exact = options.some((o) => categoryMatchKey(label(o)) === query || categoryMatchKey(o) === query);
  const pick = (next: string) => {
    onChange(canonicalCategory(next, known) ?? '');
    setOpen(false);
    setQ('');
  };
  const current = canonicalCategory(value, known);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-describedby={describedBy}
          className="w-full min-w-0 justify-between font-normal"
        >
          {current ? (
            <span className="truncate">{label(current)}</span>
          ) : (
            <span className="truncate text-muted-foreground">{t('categoryNone')}</span>
          )}
          <ChevronsUpDownIcon className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder={t('categorySearch')} maxLength={64} />
          <CommandList>
            <CommandGroup>
              {!query && (
                <CommandItem value="__none__" onSelect={() => pick('')}>
                  <CheckIcon className={cn('size-4', current ? 'opacity-0' : 'opacity-100')} aria-hidden />
                  <span className="text-muted-foreground">{t('categoryNone')}</span>
                </CommandItem>
              )}
              {shown.map((o) => (
                <CommandItem key={o} value={o} onSelect={() => pick(o)}>
                  <CheckIcon
                    className={cn(
                      'size-4',
                      current && categoryMatchKey(current) === categoryMatchKey(o)
                        ? 'opacity-100'
                        : 'opacity-0',
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{label(o)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {query && !exact && (
              <CommandGroup>
                <CommandItem value={`__new__${q}`} onSelect={() => pick(q)}>
                  <PlusIcon className="size-4" aria-hidden />
                  <span className="truncate">
                    {t('categoryNew', { name: q.trim().replace(/\s+/g, ' ') })}
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
