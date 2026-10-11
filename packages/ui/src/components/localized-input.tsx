'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { type Locale, localeLabels, locales } from '@isbp/i18n';
import type { LocalizedText } from '@isbp/sdk';
import { CheckIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { useInputAttrs } from '../lib/input-attrs';

const SHORT: Record<Locale, string> = { en: 'EN', 'zh-TW': '繁中', 'ja-JP': '日本語' };
const LANG: Record<Locale, string> = { en: 'en', 'zh-TW': 'zh-Hant-TW', 'ja-JP': 'ja' };

function clean(v: LocalizedText): LocalizedText {
  const out: LocalizedText = {};
  for (const l of locales) if (v[l]?.trim()) out[l] = v[l];
  return out;
}

/**
 * Text that admins write once per language (labels, names, help texts). Starts on the viewer's
 * language; a dot marks the languages that are filled in. Missing languages fall back to English.
 * The input's accessible name is `aria-label` (a visible label next to it ties in through `id`).
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
  const root = useRef<HTMLDivElement>(null);
  useInputAttrs(root, { id, describedBy, label: ariaLabel }, [multiline]);
  const text = value?.[active] ?? '';
  const set = (v: string) => onChange(clean({ ...(value ?? {}), [active]: v }));
  const fallback = value ? (value.en ?? locales.map((l) => value[l]).find(Boolean)) : undefined;
  const shownPlaceholder = text ? placeholder : (fallback ?? placeholder);
  const status = invalid ? { type: 'error' as const } : undefined;
  const label = ariaLabel ?? placeholder ?? '';

  return (
    <VStack gap={1.5} className={className}>
      {/* The language the text is written in, for screen readers and for the right CJK glyph shapes. */}
      <div ref={root} lang={LANG[active]}>
        {multiline ? (
          <TextArea
            label={label}
            isLabelHidden
            rows={3}
            value={text}
            onChange={set}
            placeholder={shownPlaceholder}
            isDisabled={disabled}
            status={status}
          />
        ) : (
          <TextInput
            label={label}
            isLabelHidden
            value={text}
            onChange={set}
            placeholder={shownPlaceholder}
            isDisabled={disabled}
            status={status}
          />
        )}
      </div>
      {/* Said once for the group, not on every language that is still empty. */}
      <VisuallyHidden id={`${groupId}-fallback`}>{t('fallback')}</VisuallyHidden>
      <SegmentedControl
        label={t('languages')}
        aria-describedby={`${groupId}-fallback`}
        size="sm"
        value={active}
        onChange={(l) => setActive(l as Locale)}
        isDisabled={disabled}
      >
        {locales.map((l) => {
          const filled = Boolean(value?.[l]?.trim());
          const state = t(filled ? 'filled' : 'missing', { language: localeLabels[l] });
          return (
            <SegmentedControlItem
              key={l}
              value={l}
              label={SHORT[l]}
              icon={
                <StatusDot
                  variant={filled ? 'success' : 'neutral'}
                  label={state}
                  icon={filled ? <Icon icon={CheckIcon} /> : undefined}
                />
              }
            />
          );
        })}
      </SegmentedControl>
    </VStack>
  );
}
