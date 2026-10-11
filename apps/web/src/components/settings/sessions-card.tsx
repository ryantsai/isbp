'use client';

import type { SessionInfo } from '@isbp/contracts';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  LogOutIcon,
  MonitorIcon,
  SmartphoneIcon,
  SquareTerminalIcon,
  TabletIcon,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { type DeviceKind, parseUserAgent } from './user-agent';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';

const ICONS: Record<DeviceKind, LucideIcon> = {
  desktop: MonitorIcon,
  mobile: SmartphoneIcon,
  tablet: TabletIcon,
  cli: SquareTerminalIcon,
  unknown: MonitorIcon,
};

export function SessionsCard() {
  const t = useTranslations('settings.sessions');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { data, isLoading } = useApiQuery<{ items: SessionInfo[] }>('/me/sessions');
  const [confirmAll, setConfirmAll] = useState(false);

  const sessions = [...(data?.items ?? [])].sort(
    (a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt),
  );
  const others = sessions.filter((s) => !s.current);

  const revoke = useApiMutation((api, id: string) => api.delete(`/me/sessions/${id}`), {
    invalidate: ['/me/sessions'],
    success: t('revoked'),
  });
  const revokeOthers = useApiMutation(
    async (api) => {
      const results = await Promise.allSettled(others.map((s) => api.delete(`/me/sessions/${s.id}`)));
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length === results.length && failed[0]) throw (failed[0] as PromiseRejectedResult).reason;
      return results.length - failed.length;
    },
    {
      invalidate: ['/me/sessions'],
      success: (n) => t('revokedOthers', { count: n }),
      onSuccess: () => setConfirmAll(false),
    },
  );

  const describe = (s: SessionInfo) => {
    const ua = parseUserAgent(s.userAgent);
    if (ua.browser && ua.os) return t('device', { browser: ua.browser, os: ua.os });
    return ua.browser ?? ua.os ?? t('unknownDevice');
  };

  return (
    <Card id="sessions" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        {others.length > 0 && (
          <CardAction>
            <Button
              label={t('revokeOthers')}
              variant="secondary"
              size="sm"
              icon={<AstryxIcon icon={LogOutIcon} />}
              onClick={() => setConfirmAll(true)}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="divide-y">
            <AnimatePresence initial={false}>
              {sessions.map((s) => {
                const Icon = ICONS[parseUserAgent(s.userAgent).kind];
                return (
                  <motion.li
                    key={s.id}
                    layout
                    exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span
                      className={
                        s.current
                          ? 'grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary'
                          : 'grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground'
                      }
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="truncate" title={s.userAgent ?? undefined}>
                          {describe(s)}
                        </span>
                        {s.current && <Badge variant="success" label={t('thisDevice')} />}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        {s.ip && <span className="font-mono">{s.ip}</span>}
                        {s.ip && <span aria-hidden>·</span>}
                        {s.current ? (
                          <span>{t('activeNow')}</span>
                        ) : (
                          <time
                            dateTime={s.lastSeenAt}
                            title={format.dateTime(new Date(s.lastSeenAt), {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          >
                            {t('lastActive', { time: format.relativeTime(new Date(s.lastSeenAt), now) })}
                          </time>
                        )}
                        <span aria-hidden>·</span>
                        <span>
                          {t('signedIn', {
                            date: format.dateTime(new Date(s.createdAt), { dateStyle: 'medium' }),
                          })}
                        </span>
                      </div>
                    </div>
                    {!s.current && (
                      <Button
                        label={t('revoke')}
                        aria-label={t('revokeLabel', { device: describe(s) })}
                        variant="ghost"
                        size="sm"
                        isLoading={revoke.isPending && revoke.variables === s.id}
                        onClick={() => revoke.mutate(s.id)}
                      />
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t('revokeOthersTitle')}
        description={t('revokeOthersBody', { count: others.length })}
        confirmLabel={t('revokeOthers')}
        destructive
        loading={revokeOthers.isPending}
        onConfirm={() => revokeOthers.mutate(undefined)}
      />
    </Card>
  );
}
