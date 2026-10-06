'use client';

import type { Me } from '@isbp/contracts';
import { isLocale, LOCALE_COOKIE, type Locale, localeLabels, locales } from '@isbp/i18n';
import { createApiClient } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { Hint } from '@isbp/ui/tooltip';
import { LanguagesIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from '@isbp/ui/theme';
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
  return (
    <DropdownMenu>
      <Hint label={t('language')}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size={variant === 'icon' ? 'icon' : 'sm'}
            aria-label={t('language')}
            loading={pending && variant === 'full'}
          >
            <LanguagesIcon />
            {variant === 'full' && <span>{isLocale(locale) ? localeLabels[locale] : locale}</span>}
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={(v) => isLocale(v) && change(v)}>
          {locales.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} lang={l}>
              {localeLabels[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeToggle({ onChange }: { onChange?: (theme: 'light' | 'dark' | 'system') => void }) {
  const t = useTranslations('shell.theme');
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const icon = !mounted ? 'system' : resolvedTheme === 'dark' ? 'dark' : 'light';
  const select = (value: 'light' | 'dark' | 'system') => {
    setTheme(value);
    onChange?.(value);
  };
  return (
    <DropdownMenu>
      <Hint label={t('label')}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('label')} className="overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={icon}
                initial={{ y: -14, opacity: 0, rotate: -60 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }}
                exit={{ y: 14, opacity: 0, rotate: 60 }}
                transition={{ duration: 0.22 }}
                className="grid place-items-center"
              >
                {icon === 'dark' ? <MoonIcon className="size-4" /> : <SunIcon className="size-4" />}
              </motion.span>
            </AnimatePresence>
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={mounted ? (theme ?? 'system') : 'system'}
          onValueChange={(v) => select(v as 'light' | 'dark' | 'system')}
        >
          <DropdownMenuRadioItem value="light">
            <SunIcon /> {t('light')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon /> {t('dark')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon /> {t('system')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
