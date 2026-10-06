import { redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { currentPath, getNavigation, getSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    const path = await currentPath();
    redirect(path === '/' ? '/login' : `/login?next=${encodeURIComponent(path)}`);
  }
  const nav = await getNavigation();
  return (
    <NextIntlClientProvider timeZone={session.user.timezone}>
      <AppShell session={session} nav={nav}>
        {children}
      </AppShell>
    </NextIntlClientProvider>
  );
}
