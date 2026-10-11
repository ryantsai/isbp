'use client';

import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import { LinkProvider } from '@astryxdesign/core/Link';
import jaJP from '@astryxdesign/core/locales/ja-JP.generated.js';
import zhTW from '@astryxdesign/core/locales/zh-TW.generated.js';
import { Theme } from '@astryxdesign/core/theme';
import { useLocale } from 'next-intl';
import NextLink from 'next/link';
import type { ReactNode } from 'react';
import { telTheme } from '../theme/built/tel';
import { useTheme } from './theme';
import { ToastBridge } from './toast';

/**
 * Everything Astryx needs, mounted once at the app root (inside `ThemeProvider` and the next-intl provider):
 * - `Theme`: the built TEL theme in the person's mode (light / dark / system); the root Theme also syncs
 *   `data-theme` / `data-astryx-theme` onto `<html>`.
 * - `LinkProvider`: every Astryx `href` (Button, SideNavItem, Tab…) renders a Next.js `Link`.
 * - `InternationalizationProvider`: Astryx's own strings ("Required", "No results", calendar names…) in the UI language,
 *   next to next-intl, which keeps owning the product's copy.
 * - `ToastBridge`: the global `toast.*` calls.
 */
export function UiProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const locale = useLocale();
  return (
    <Theme theme={telTheme} mode={theme}>
      <LinkProvider component={NextLink}>
        <InternationalizationProvider locale={locale} messages={{ 'zh-TW': zhTW, 'ja-JP': jaJP }}>
          {children}
          <ToastBridge />
        </InternationalizationProvider>
      </LinkProvider>
    </Theme>
  );
}
