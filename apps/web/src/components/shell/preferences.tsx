'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { DropdownMenu, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@astryxdesign/core/DropdownMenu';
import type { Me } from '@isbp/contracts';
import { isLocale, LOCALE_COOKIE, type Locale, localeLabels, locales } from '@isbp/i18n';
import { createApiClient } from '@isbp/sdk/web';
import { useTheme } from '@isbp/ui/theme';
import { LanguagesIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';

/** Changes the UI language: persists to the profile when signed in, otherwise just the cookie. */
export function useChangeLocale(csrfToken?: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const change = (locale: Locale) =>
    start(async () => {
      if (csrfToken) await createApiClient(csrfToken).patch<Me>('/me', { locale });
      document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    });
  return { change, pending };
}

export function LocaleSwitcher({
  csrfToken,
  variant = 'icon',
}: {
  csrfToken?: string;
  variant?: 'icon' | 'full';
}) {
  const t = useTranslations('shell');
  const locale = useLocale();
  const { change, pending } = useChangeLocale(csrfToken);
  const full = variant === 'full';
  const current = full ? (isLocale(locale) ? localeLabels[locale] : locale) : t('language');
  return (
    <DropdownMenu
      hasChevron={false}
      placement="below"
      alignment="end"
      menuWidth={192}
      button={{
        label: current,
        // The visible text is only the language's own name: say what the button is, keeping that text in the name.
        'aria-label': full ? `${t('language')}: ${current}` : undefined,
        variant: 'ghost',
        size: full ? 'sm' : 'md',
        icon: <Icon icon={LanguagesIcon} />,
        isIconOnly: !full,
        isLoading: pending && full,
        tooltip: t('language'),
      }}
    >
      <DropdownMenuRadioGroup label={t('language')} value={locale} onChange={(v) => isLocale(v) && change(v)}>
        {locales.map((l) => (
          <DropdownMenuRadioItem key={l} value={l} label={<span lang={l}>{localeLabels[l]}</span>} />
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
}

export function ThemeToggle({ onChange }: { onChange?: (theme: 'light' | 'dark' | 'system') => void }) {
  const t = useTranslations('shell.theme');
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';
  const select = (value: 'light' | 'dark' | 'system') => {
    setTheme(value);
    onChange?.(value);
  };
  return (
    <DropdownMenu
      hasChevron={false}
      placement="below"
      alignment="end"
      menuWidth={160}
      button={{
        label: t('label'),
        variant: 'ghost',
        isIconOnly: true,
        icon: <Icon icon={dark ? MoonIcon : SunIcon} />,
        tooltip: t('label'),
      }}
    >
      <DropdownMenuRadioGroup
        label={t('label')}
        value={mounted ? (theme ?? 'system') : 'system'}
        onChange={(v) => select(v as 'light' | 'dark' | 'system')}
      >
        <DropdownMenuRadioItem value="light" icon={SunIcon} label={t('light')} />
        <DropdownMenuRadioItem value="dark" icon={MoonIcon} label={t('dark')} />
        <DropdownMenuRadioItem value="system" icon={MonitorIcon} label={t('system')} />
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
}
