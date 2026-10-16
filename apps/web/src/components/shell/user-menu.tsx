'use client';

import {
  DropdownMenu,
  DropdownMenuDivider,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSubMenu,
} from '@astryxdesign/core/DropdownMenu';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { isLocale, localeLabels, locales } from '@isbp/i18n';
import { usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { useHydrated } from '@isbp/ui/motion';
import { useTheme } from '@isbp/ui/theme';
import {
  BookOpenIcon,
  CompassIcon,
  LanguagesIcon,
  LifeBuoyIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UserCogIcon,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { tourAvailable } from '../tour/locales';
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
  const ThemeIcon = current === 'dark' ? MoonIcon : current === 'light' ? SunIcon : MonitorIcon;
  return (
    <DropdownMenu
      placement="below"
      alignment="end"
      menuWidth={256}
      renderTrigger={(props) => (
        <UserAvatar
          name={user.displayName}
          src={user.avatarUrl}
          aria-label={t('userMenu', { name: user.displayName })}
          {...(props as object)}
        />
      )}
    >
      <DropdownMenuGroup
        title={
          <HStack gap={3} vAlign="center">
            <UserAvatar name={user.displayName} src={user.avatarUrl} className="size-9" />
            <VStack gap={0}>
              <Text weight="medium" maxLines={1}>
                {user.displayName}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {user.email}
              </Text>
            </VStack>
          </HStack>
        }
      >
        <DropdownMenuItem icon={UserCogIcon} label={t('profile')} href="/settings" />
        {canHelp && <DropdownMenuItem icon={LifeBuoyIcon} label={t('help')} href={helpHrefFor(pathname)} />}
        {tourAvailable(locale) && <DropdownMenuItem icon={CompassIcon} label={t('tour')} href="/tour" />}
      </DropdownMenuGroup>
      <DropdownMenuSubMenu
        icon={ThemeIcon}
        label={t('theme.label')}
        description={t(`theme.${current}`)}
        menuWidth={176}
      >
        <DropdownMenuRadioGroup
          label={t('theme.label')}
          value={current}
          onChange={(v) => {
            setTheme(v as ThemeChoice);
            onThemeChange(v as ThemeChoice);
          }}
        >
          <DropdownMenuRadioItem value="light" icon={SunIcon} label={t('theme.light')} />
          <DropdownMenuRadioItem value="dark" icon={MoonIcon} label={t('theme.dark')} />
          <DropdownMenuRadioItem value="system" icon={MonitorIcon} label={t('theme.system')} />
        </DropdownMenuRadioGroup>
      </DropdownMenuSubMenu>
      <DropdownMenuSubMenu
        icon={LanguagesIcon}
        label={t('language')}
        description={isLocale(locale) ? localeLabels[locale] : locale}
        menuWidth={208}
      >
        <DropdownMenuRadioGroup
          label={t('language')}
          value={locale}
          onChange={(v) => isLocale(v) && change(v)}
        >
          {locales.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} label={<span lang={l}>{localeLabels[l]}</span>} />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubMenu>
      {developer && (
        <DropdownMenuItem icon={BookOpenIcon} label={t('apiDocs')} href="/api/docs" target="_blank" />
      )}
      <DropdownMenuDivider />
      <DropdownMenuItem
        icon={LogOutIcon}
        label={t('signOut')}
        variant="destructive"
        onClick={() => void signOut()}
      />
    </DropdownMenu>
  );
}
