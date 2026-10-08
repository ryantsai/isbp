'use client';

import type { SessionResponse } from '@isbp/contracts';
import { PlatformProvider } from '@isbp/sdk/web';
import { type ReactNode, useMemo } from 'react';

/**
 * The platform context (who is signed in, their grants, the CSRF token) for pages outside the app shell, such as the
 * print views: the data hooks (`useApiQuery`) and permission checks need it, the shell's navigation doesn't.
 */
export function PrintShell({ session, children }: { session: SessionResponse; children: ReactNode }) {
  const platform = useMemo(
    () => ({
      user: session.user,
      grants: session.grants,
      csrfToken: session.csrfToken,
      enabledModules: session.enabledModules,
    }),
    [session],
  );
  return <PlatformProvider value={platform}>{children}</PlatformProvider>;
}
