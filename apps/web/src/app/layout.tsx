import { htmlLang, type Locale } from '@isbp/i18n';
import { Toaster } from '@isbp/ui/sonner';
import { themeInitScript } from '@isbp/ui/theme';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
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
    { media: '(prefers-color-scheme: light)', color: '#fafafc' },
    { media: '(prefers-color-scheme: dark)', color: '#121318' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = (await getLocale()) as Locale;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang={htmlLang[locale]}
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
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
