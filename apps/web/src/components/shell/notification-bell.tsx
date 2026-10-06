'use client';

import type { NotificationPage } from '@isbp/contracts';
import { Button } from '@isbp/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Spinner } from '@isbp/ui/spinner';
import { cn } from '@isbp/ui';
import { BellIcon, CheckCheckIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { BADGES_PATH, useBadges } from './live';

/** Topbar bell: unread count (live), the latest notifications, mark as read. */
export function NotificationBell() {
  const t = useTranslations('shell.notifications');
  const unread = useBadges().notifications;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useApiQuery<NotificationPage>(open ? '/me/notifications' : null, {
    pageSize: 8,
  });
  const markRead = useApiMutation(
    (api, body: { ids?: string[]; all?: boolean }) => api.post('/me/notifications/read', body),
    {
      invalidate: ['/me/notifications', BADGES_PATH],
    },
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? t('labelUnread', { count: unread }) : t('label')}
        >
          <motion.span
            key={unread}
            initial={unread ? { rotate: -12 } : false}
            animate={{ rotate: [-12, 10, -6, 0] }}
            transition={{ duration: 0.5 }}
            className="grid place-items-center"
          >
            <BellIcon />
          </motion.span>
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                aria-hidden
                className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white tabular-nums dark:text-background"
              >
                {unread > 99 ? '99+' : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={!unread || markRead.isPending}
            onClick={() => markRead.mutate({ all: true })}
          >
            <CheckCheckIcon />
            {t('markAllRead')}
          </Button>
        </div>
        <div className="max-h-[min(28rem,60vh)] overflow-y-auto">
          {isLoading ? (
            <div className="grid place-items-center py-10">
              <Spinner />
            </div>
          ) : !data?.items.length ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="divide-y">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.readAt) markRead.mutate({ ids: [n.id] });
                      setOpen(false);
                      if (n.href) router.push(n.href);
                    }}
                    className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        n.readAt ? 'bg-transparent' : 'bg-primary',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn('line-clamp-2 text-sm', !n.readAt && 'font-medium')}>
                        {!n.readAt && <span className="sr-only">{t('unread')} </span>}
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                      )}
                      <RelativeTime
                        date={n.createdAt}
                        className="mt-1 block text-[11px] text-muted-foreground"
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t p-2">
          <Button asChild variant="ghost" size="sm" className="w-full" onClick={() => setOpen(false)}>
            <Link href="/notifications">{t('viewAll')}</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
