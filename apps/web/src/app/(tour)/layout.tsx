import plexTc from '@ibm/plex-sans-tc/package.json';
import { redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PrintShell } from '@/components/shell/print-shell';
import '@/components/tour/tour.css';
import { currentPath, getSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * The product tour: signed in like the app, without its shell (it has its own bar), in the viewer's theme. It is
 * written in Traditional Chinese only for now, so a reader whose language loads another Han font gets this one too.
 */
export default async function TourLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(await currentPath())}`);
  const locale = await getLocale();
  return (
    <NextIntlClientProvider timeZone={session.user.timezone}>
      <PrintShell session={session}>
        {locale !== 'zh-TW' && (
          <link
            rel="stylesheet"
            href={`/fonts/plex-sans-tc-${plexTc.version}/plex-sans-tc.css`}
            precedence="default"
          />
        )}
        {children}
      </PrintShell>
    </NextIntlClientProvider>
  );
}
