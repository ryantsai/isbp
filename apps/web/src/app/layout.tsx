import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import plexJp from '@ibm/plex-sans-jp/package.json';
import plexTc from '@ibm/plex-sans-tc/package.json';
import { htmlLang, type Locale } from '@isbp/i18n';
import { Toaster } from '@isbp/ui/sonner';
import { themeInitScript } from '@isbp/ui/theme';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { RootProviders } from '@/components/root-providers';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: 'Unified resource management for IT operations',
    icons: { icon: '/icon.svg' },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f6f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1218' },
  ],
};

/** Han glyphs of the UI language (scripts/fonts.mjs publishes them): IBM Plex Sans TC or JP, never both. */
const cjkFonts: Partial<Record<Locale, string>> = {
  'zh-TW': `/fonts/plex-sans-tc-${plexTc.version}/plex-sans-tc.css`,
  'ja-JP': `/fonts/plex-sans-jp-${plexJp.version}/plex-sans-jp.css`,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = (await getLocale()) as Locale;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang={htmlLang[locale]} suppressHydrationWarning>
      <head>
        {cjkFonts[locale] && <link rel="stylesheet" href={cjkFonts[locale]} />}
        {/* Applies the saved theme before first paint (server-rendered, CSP nonce). */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh font-sans">
        <NextIntlClientProvider>
          <RootProviders>
            {children}
            <Toaster position="bottom-right" />
          </RootProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
