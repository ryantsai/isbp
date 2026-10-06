'use client';

import { cn } from '@isbp/ui';
import { Input } from '@isbp/ui/input';
import { CheckIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useRef } from 'react';
import { FORM_ICONS } from './form-meta';

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
        const label = t.has(name) ? t(name) : name;
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
            {Icon ? (
              <Icon className="size-4.5" aria-hidden />
            ) : (
              <span className="text-[10px]">{name.slice(0, 3)}</span>
            )}
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

/** Free-text category with one-click suggestions from existing forms. */
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
  suggestions: readonly string[];
  describedBy?: string;
}) {
  const t = useTranslations('forms.create');
  const options = suggestions.filter((s) => s && s !== value.trim());
  return (
    <div className="grid gap-2">
      <Input
        id={id}
        value={value}
        maxLength={64}
        autoComplete="off"
        placeholder={t('categoryPlaceholder')}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      {options.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t('categorySuggestions')}</span>
          {options.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              className="rounded-full border px-2 py-0.5 transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
