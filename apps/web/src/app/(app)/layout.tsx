import { redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { passwordChangeHref } from '@/lib/password-change';
import { currentPath, getNavigation, getSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    const path = await currentPath();
    redirect(path === '/' ? '/login' : `/login?next=${encodeURIComponent(path)}`);
  }
  // "Require a new password at next sign-in": straight to the password card after sign-in (and on every full page
  // load until it's changed; the shell keeps a banner up during client-side navigation).
  if (session.user.mustChangePassword && session.user.authSource === 'local') {
    const path = await currentPath();
    if (path !== '/settings' && !path.startsWith('/settings?')) redirect(passwordChangeHref(path));
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
