import { redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { PrintShell } from '@/components/shell/print-shell';
import { currentPath, getSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/**
 * Print-friendly pages (a request as audit evidence): signed in like the app, without its shell, always in the light
 * theme (`data-force-light`) whatever the viewer's setting, so the paper and the screen look the same.
 */
export default async function PrintLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    const path = await currentPath();
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return (
    <NextIntlClientProvider timeZone={session.user.timezone}>
      <PrintShell session={session}>
        <div data-force-light className="min-h-dvh bg-background text-foreground print:bg-white">
          {children}
        </div>
      </PrintShell>
    </NextIntlClientProvider>
  );
}
