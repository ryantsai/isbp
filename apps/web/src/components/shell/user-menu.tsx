'use client';

import { isLocale, localeLabels, locales } from '@isbp/i18n';
import { usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { useHydrated } from '@isbp/ui/motion';
import { useTheme } from '@isbp/ui/theme';
import {
  BookOpenIcon,
  LanguagesIcon,
  LifeBuoyIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UserCogIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { helpHrefFor, useCanHelp } from './help-link';
import { useChangeLocale } from './preferences';
import { useSignOut } from './use-sign-out';

type ThemeChoice = 'light' | 'dark' | 'system';

/**
 * The avatar menu: profile, help for this area, appearance and language (they apply at once and follow the person
 * to other devices), developer links for the people who integrate, and sign out.
 */
export function UserMenu({
  csrfToken,
  onThemeChange,
}: {
  csrfToken: string;
  onThemeChange: (theme: ThemeChoice) => void;
}) {
  const t = useTranslations('shell');
  const { user, permissions } = usePlatform();
  const pathname = usePathname();
  const locale = useLocale();
  const { theme, setTheme } = useTheme();
  const { change } = useChangeLocale(csrfToken);
  const mounted = useHydrated();
  const signOut = useSignOut();
  const developer = permissions.hasAny('core.api-clients.manage');
  const canHelp = useCanHelp();
  const current: ThemeChoice = mounted ? ((theme as ThemeChoice | undefined) ?? 'system') : 'system';
  const themeIcon = current === 'dark' ? <MoonIcon /> : current === 'light' ? <SunIcon /> : <MonitorIcon />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-full p-0.5 outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:ring-2 data-[state=open]:ring-primary/30"
        aria-label={t('userMenu', { name: user.displayName })}
      >
        <UserAvatar name={user.displayName} src={user.avatarUrl} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
          <UserAvatar name={user.displayName} src={user.avatarUrl} className="size-9" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{user.displayName}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <UserCogIcon /> {t('profile')}
          </Link>
        </DropdownMenuItem>
        {canHelp && (
          <DropdownMenuItem asChild>
            <Link href={helpHrefFor(pathname)}>
              <LifeBuoyIcon /> {t('help')}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {themeIcon}
            <span className="flex-1">{t('theme.label')}</span>
            <span className="text-xs text-muted-foreground">{t(`theme.${current}`)}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuRadioGroup
              value={current}
              onValueChange={(v) => {
                setTheme(v as ThemeChoice);
                onThemeChange(v as ThemeChoice);
              }}
            >
              <DropdownMenuRadioItem value="light">
                <SunIcon /> {t('theme.light')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <MoonIcon /> {t('theme.dark')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <MonitorIcon /> {t('theme.system')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <LanguagesIcon />
            <span className="flex-1">{t('language')}</span>
            <span className="text-xs text-muted-foreground" lang={locale}>
              {isLocale(locale) ? localeLabels[locale] : locale}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuRadioGroup value={locale} onValueChange={(v) => isLocale(v) && change(v)}>
              {locales.map((l) => (
                <DropdownMenuRadioItem key={l} value={l} lang={l}>
                  {localeLabels[l]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {developer && (
          <DropdownMenuItem asChild>
            <a href="/api/docs" target="_blank" rel="noreferrer">
              <BookOpenIcon /> {t('apiDocs')}
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
          <LogOutIcon /> {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
