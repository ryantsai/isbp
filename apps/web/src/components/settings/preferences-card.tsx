'use client';

import type { Me } from '@isbp/contracts';
import { type Locale, localeLabels, locales } from '@isbp/i18n';
import { usePlatform } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useTheme } from '@isbp/ui/theme';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useChangeLocale } from '@/components/shell/preferences';
import { useApiMutation } from '@/lib/api';
import { TimezonePicker } from './timezone-picker';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Spinner } from '@astryxdesign/core/Spinner';

type Theme = 'light' | 'dark' | 'system';
const THEMES: Theme[] = ['light', 'dark', 'system'];

export function PreferencesCard({ me }: { me: Me | undefined }) {
  const t = useTranslations('settings.preferences');
  const ts = useTranslations('shell.theme');
  const { csrfToken, user } = usePlatform();
  const router = useRouter();
  const locale = useLocale();

  /* language — same logic as the shell's switcher (PATCH /me, cookie, refresh) */
  const { change, pending: localePending } = useChangeLocale(csrfToken);
  const [requested, setRequested] = useState<Locale | null>(null);
  useEffect(() => {
    if (!localePending) setRequested(null);
  }, [localePending]);
  const languageNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'language' });
    } catch {
      return null;
    }
  }, [locale]);

  /* theme — applied instantly, remembered on the profile */
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const currentTheme: Theme = mounted
    ? ((theme as Theme | undefined) ?? 'system')
    : (me?.preferences.theme ?? 'system');
  const saveTheme = useApiMutation(
    (api, value: Theme) => api.patch<Me>('/me', { preferences: { theme: value } }),
    { invalidate: ['/me'] },
  );
  const selectTheme = (value: Theme) => {
    setTheme(value);
    saveTheme.mutate(value);
  };

  /* time zone */
  const timezone = me?.timezone ?? user.timezone;
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  useEffect(() => setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null), []);
  const saveZone = useApiMutation((api, value: string) => api.patch<Me>('/me', { timezone: value }), {
    invalidate: ['/me'],
    success: (r) => t('timezone.saved', { zone: r.timezone.replaceAll('_', ' ') }),
    // Dates across the app are formatted in the profile's zone (set by the server layout).
    onSuccess: () => router.refresh(),
  });

  return (
    <Card id="preferences" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <VStack gap={5}>
          <RadioList
            label={t('language.label')}
            description={t('language.hint')}
            value={requested ?? locale}
            isDisabled={localePending}
            onChange={(value) => {
              const next = locales.find((l) => l === value);
              if (!next) return;
              setRequested(next);
              change(next);
            }}
          >
            {locales.map((l) => {
              const translated = languageNames?.of(l);
              return (
                <RadioListItem
                  key={l}
                  value={l}
                  label={<span lang={l}>{localeLabels[l]}</span>}
                  aria-label={localeLabels[l]}
                  description={translated && translated !== localeLabels[l] ? translated : undefined}
                  endContent={localePending && requested === l ? <Spinner size="sm" /> : undefined}
                />
              );
            })}
          </RadioList>

          <RadioList
            label={ts('label')}
            description={t('theme.hint')}
            orientation="horizontal"
            value={currentTheme}
            onChange={(value) => {
              const next = THEMES.find((m) => m === value);
              if (next) selectTheme(next);
            }}
          >
            {THEMES.map((value) => (
              <RadioListItem key={value} value={value} label={ts(value)} />
            ))}
          </RadioList>

          <VStack gap={2} hAlign="start">
            <TimezonePicker
              label={t('timezone.label')}
              description={t('timezone.hint')}
              value={timezone}
              onChange={(z) => saveZone.mutate(z)}
              pending={saveZone.isPending}
            />
            {browserZone && browserZone !== timezone && (
              <Button
                label={t('timezone.useBrowser', { zone: browserZone.replaceAll('_', ' ') })}
                variant="ghost"
                size="sm"
                isDisabled={saveZone.isPending}
                onClick={() => saveZone.mutate(browserZone)}
              />
            )}
          </VStack>
        </VStack>
      </CardContent>
    </Card>
  );
}
