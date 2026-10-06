'use client';

import type { Me } from '@isbp/contracts';
import { type Locale, localeLabels, locales } from '@isbp/i18n';
import { usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Label } from '@isbp/ui/label';
import { Spinner } from '@isbp/ui/spinner';
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from '@isbp/ui/theme';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useChangeLocale } from '@/components/shell/preferences';
import { useApiMutation } from '@/lib/api';
import { TimezonePicker } from './timezone-picker';

type Theme = 'light' | 'dark' | 'system';
const THEMES: { value: Theme; icon: typeof SunIcon }[] = [
  { value: 'light', icon: SunIcon },
  { value: 'dark', icon: MoonIcon },
  { value: 'system', icon: MonitorIcon },
];

/* Illustration colours (match the light/dark tokens in globals.css). */
const SWATCH = {
  light: {
    bg: 'oklch(0.985 0.003 264)',
    side: 'oklch(0.955 0.006 264)',
    panel: 'oklch(1 0 0)',
    line: 'oklch(0.9 0.008 264)',
    accent: 'oklch(0.51 0.2 268)',
  },
  dark: {
    bg: 'oklch(0.155 0.008 264)',
    side: 'oklch(0.185 0.009 264)',
    panel: 'oklch(0.215 0.011 264)',
    line: 'oklch(0.32 0.012 264)',
    accent: 'oklch(0.7 0.15 268)',
  },
};

function MiniWindow({ c }: { c: (typeof SWATCH)['light'] }) {
  return (
    <div className="absolute inset-0 flex" style={{ background: c.bg }}>
      <div className="w-1/4 space-y-1.5 p-1.5" style={{ background: c.side }}>
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: c.accent }} />
        <div className="h-1 w-full rounded-full" style={{ background: c.line }} />
        <div className="h-1 w-2/3 rounded-full" style={{ background: c.line }} />
      </div>
      <div className="flex-1 space-y-1.5 p-2">
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: c.line }} />
        <div className="h-6 rounded-sm border" style={{ background: c.panel, borderColor: c.line }} />
        <div className="flex gap-1">
          <div className="h-2 w-6 rounded-sm" style={{ background: c.accent }} />
          <div className="h-2 w-4 rounded-sm" style={{ background: c.line }} />
        </div>
      </div>
    </div>
  );
}

function ThemePreview({ mode }: { mode: Theme }) {
  return (
    <div aria-hidden className="relative h-20 overflow-hidden rounded-md border">
      {mode === 'system' ? (
        <>
          <MiniWindow c={SWATCH.light} />
          <div className="absolute inset-0" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}>
            <MiniWindow c={SWATCH.dark} />
          </div>
        </>
      ) : (
        <MiniWindow c={SWATCH[mode]} />
      )}
    </div>
  );
}

function SelectedMark({ show, pending }: { show: boolean; pending?: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
        >
          {pending ? <Spinner className="size-3" /> : <CheckIcon className="size-3" strokeWidth={3} />}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** Native radio inside a card-like label: arrow keys, focus ring and screen readers work as usual. */
function RadioCard({
  name,
  value,
  checked,
  disabled,
  onSelect,
  children,
  className,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer rounded-lg border p-3 transition-[border-color,background-color,box-shadow] duration-200 hover:bg-accent/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-default',
        checked && 'border-primary bg-primary/5 hover:bg-primary/5',
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="sr-only"
      />
      {children}
    </label>
  );
}

function Group({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <div className="space-y-1">
        <legend className="text-sm font-medium">{legend}</legend>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </fieldset>
  );
}

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
      <CardContent className="space-y-8">
        <Group legend={t('language.label')} hint={t('language.hint')}>
          <div className="grid gap-2 sm:grid-cols-3">
            {locales.map((l) => {
              const selected = (requested ?? locale) === l;
              const translated = languageNames?.of(l);
              return (
                <RadioCard
                  key={l}
                  name="locale"
                  value={l}
                  checked={selected}
                  disabled={localePending}
                  onSelect={() => {
                    setRequested(l);
                    change(l);
                  }}
                  className="items-center gap-3"
                >
                  <span className="min-w-0 flex-1">
                    <span lang={l} className="block truncate text-sm font-medium">
                      {localeLabels[l]}
                    </span>
                    {translated && translated !== localeLabels[l] && (
                      <span className="block truncate text-xs text-muted-foreground">{translated}</span>
                    )}
                  </span>
                  <SelectedMark show={selected} pending={localePending && requested === l} />
                </RadioCard>
              );
            })}
          </div>
        </Group>

        <Group legend={ts('label')} hint={t('theme.hint')}>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {THEMES.map(({ value, icon: Icon }) => (
              <RadioCard
                key={value}
                name="theme"
                value={value}
                checked={currentTheme === value}
                onSelect={() => selectTheme(value)}
                className="flex-col gap-2.5 p-2.5"
              >
                <ThemePreview mode={value} />
                <span className="flex items-center gap-2 px-0.5">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate text-sm font-medium">{ts(value)}</span>
                  <SelectedMark show={currentTheme === value} />
                </span>
              </RadioCard>
            ))}
          </div>
        </Group>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="settings-timezone">{t('timezone.label')}</Label>
            <p className="text-xs text-muted-foreground">{t('timezone.hint')}</p>
          </div>
          <TimezonePicker
            id="settings-timezone"
            value={timezone}
            onChange={(z) => saveZone.mutate(z)}
            pending={saveZone.isPending}
          />
          {browserZone && browserZone !== timezone && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => saveZone.mutate(browserZone)}
              disabled={saveZone.isPending}
            >
              {t('timezone.useBrowser', { zone: browserZone.replaceAll('_', ' ') })}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
