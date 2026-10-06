'use client';

import type { Badges } from '@isbp/contracts';
import { invalidatePaths, useApiQuery } from '@isbp/ui/query';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, use, useEffect } from 'react';

export const BADGES_PATH = '/me/badges';

/**
 * Navigation counters, kept live by Server-Sent Events (`/me/notifications/stream`). Each `badges`
 * event updates the cache and refreshes the notification and approval lists; a slow poll is the
 * fallback when the stream is unavailable (EventSource reconnects on its own).
 */
function useLiveBadges(): Badges {
  const client = useQueryClient();
  const { data } = useApiQuery<Badges>(BADGES_PATH, undefined, { refetchInterval: 120_000 });

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/v1/me/notifications/stream');
    const onBadges = (e: MessageEvent<string>) => {
      try {
        const next = JSON.parse(e.data) as Badges;
        const prev = client.getQueryData<Badges>([BADGES_PATH, {}]);
        client.setQueryData([BADGES_PATH, {}], next);
        if (prev && (prev.notifications !== next.notifications || prev.approvals !== next.approvals))
          void invalidatePaths(client, ['/me/notifications', '/me/approvals', '/me/requests']);
      } catch {
        /* ignore malformed events */
      }
    };
    source.addEventListener('badges', onBadges as EventListener);
    return () => {
      source.removeEventListener('badges', onBadges as EventListener);
      source.close();
    };
  }, [client]);

  return data ?? { approvals: 0, notifications: 0 };
}

const BadgesContext = createContext<Badges>({ approvals: 0, notifications: 0 });

/** One live stream per tab, shared by the sidebar, the mobile drawer and the bell. */
export function BadgesProvider({ children }: { children: ReactNode }) {
  return <BadgesContext value={useLiveBadges()}>{children}</BadgesContext>;
}

export function useBadges(): Badges {
  return use(BadgesContext);
}
