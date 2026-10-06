'use client';

import { type Locale, localeLabels, locales } from '@isbp/i18n';
import type { LocalizedText } from '@isbp/sdk';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { cn } from '../lib/utils';
import { Input } from './input';
import { Textarea } from './textarea';

const SHORT: Record<Locale, string> = { en: 'EN', 'zh-TW': '繁中', 'ja-JP': '日本語' };

function clean(v: LocalizedText): LocalizedText {
  const out: LocalizedText = {};
  for (const l of locales) if (v[l]?.trim()) out[l] = v[l];
  return out;
}

/**
 * Text that admins write once per language (labels, names, help texts). Starts on the viewer's
 * language; a dot marks the languages that are filled in. Missing languages fall back to English.
 */
export function LocalizedInput({
  value,
  onChange,
  multiline,
  id,
  placeholder,
  invalid,
  disabled,
  className,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
}: {
  value: LocalizedText | null | undefined;
  onChange: (value: LocalizedText) => void;
  multiline?: boolean;
  id?: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const t = useTranslations('ui.localized');
  const current = useLocale() as Locale;
  const [active, setActive] = useState<Locale>(locales.includes(current) ? current : 'en');
  const groupId = useId();
  const text = value?.[active] ?? '';
  const set = (v: string) => onChange(clean({ ...(value ?? {}), [active]: v }));
  const fallback = value ? (value.en ?? locales.map((l) => value[l]).find(Boolean)) : undefined;
  const common = {
    id,
    value: text,
    disabled,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    'aria-label': ariaLabel,
    lang: active === 'en' ? 'en' : active === 'zh-TW' ? 'zh-Hant-TW' : 'ja',
    placeholder: text ? placeholder : (fallback ?? placeholder),
  };

  return (
    <div className={cn('grid gap-1.5', className)}>
      {multiline ? (
        <Textarea {...common} rows={3} onChange={(e) => set(e.target.value)} />
      ) : (
        <Input {...common} onChange={(e) => set(e.target.value)} />
      )}
      <div role="group" aria-labelledby={`${groupId}-label`} className="flex items-center gap-1">
        <span id={`${groupId}-label`} className="sr-only">
          {t('languages')}
        </span>
        {locales.map((l) => {
          const filled = Boolean(value?.[l]?.trim());
          return (
            <button
              key={l}
              type="button"
              disabled={disabled}
              aria-pressed={active === l}
              title={t(filled ? 'filled' : 'missing', { language: localeLabels[l] })}
              onClick={() => setActive(l)}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                active === l && 'bg-secondary text-secondary-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  filled ? 'bg-success' : 'border border-muted-foreground/50',
                )}
              />
              {SHORT[l]}
              <span className="sr-only">
                {t(filled ? 'filled' : 'missing', { language: localeLabels[l] })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
