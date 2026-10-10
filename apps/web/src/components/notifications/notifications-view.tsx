'use client';

import type { Notification, NotificationPage } from '@isbp/contracts';
import { useApi } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Hint } from '@isbp/ui/tooltip';
import { useInfiniteQuery } from '@tanstack/react-query';
import { BellOffIcon, CheckCheckIcon, CheckIcon, Settings2Icon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useNow, useTimeZone, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { RelativeTime } from '@/components/relative-time';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { TypeIcon, useTypeLabel } from './notification-meta';

const PATH = '/me/notifications';
const PAGE_SIZE = 20;
type View = 'all' | 'unread';

/** `YYYY-MM-DD` of an instant in a time zone (the profile's, so "Today" matches the times shown). */
function dayKey(d: Date, timeZone: string | undefined) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function previousDay(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
}

interface DayGroup {
  key: string;
  first: Date;
  items: Notification[];
}

/** The personal inbox: everything notified to me, grouped by day, live-updated by the shell's SSE. */
export function NotificationsView() {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const timeZone = useTimeZone();
  const now = useNow({ updateInterval: 60_000 });
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const view: View = sp.get('view') === 'unread' ? 'unread' : 'all';
  // Optimistic "read" marks so the dot disappears before the refetch lands.
  const [readLocally, setReadLocally] = useState<ReadonlySet<string>>(new Set());

  // Counts for both tabs (cheap; refreshed with every live update like the list itself).
  const counts = useApiQuery<NotificationPage>(PATH, { pageSize: 1 });
  const list = useInfiniteQuery({
    queryKey: [PATH, { view, pageSize: PAGE_SIZE, infinite: true }],
    queryFn: ({ pageParam }) =>
      api.get<NotificationPage>(PATH, {
        page: pageParam,
        pageSize: PAGE_SIZE,
        unread: view === 'unread' ? true : undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: Notification[] = [];
    for (const page of list.data?.pages ?? [])
      for (const n of page.items) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        out.push(n);
      }
    return out;
  }, [list.data]);

  const total = counts.data?.total ?? list.data?.pages[0]?.total ?? 0;
  const unread = counts.data?.unread ?? list.data?.pages[0]?.unread ?? 0;
  const listTotal = list.data?.pages.at(-1)?.total ?? 0;

  const today = dayKey(now, timeZone);
  const yesterday = previousDay(today);
  const groups = useMemo(() => {
    const out: DayGroup[] = [];
    for (const n of items) {
      const d = new Date(n.createdAt);
      const key = dayKey(d, timeZone);
      const last = out.at(-1);
      if (last?.key === key) last.items.push(n);
      else out.push({ key, first: d, items: [n] });
    }
    return out;
  }, [items, timeZone]);

  const dayLabel = (g: DayGroup) => {
    if (g.key === today) return t('today');
    if (g.key === yesterday) return t('yesterday');
    const sameYear = g.key.slice(0, 4) === today.slice(0, 4);
    return format.dateTime(g.first, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: sameYear ? undefined : 'numeric',
    });
  };

  const markRead = useApiMutation(
    (a, body: { ids?: string[]; all?: boolean }) => a.post<{ unread: number }>(`${PATH}/read`, body),
    {
      invalidate: [PATH, '/me/badges'],
      onSuccess: (_r, body) => {
        if (body.all) setReadLocally(new Set());
      },
    },
  );
  const markAll = useApiMutation((a) => a.post<{ unread: number }>(`${PATH}/read`, { all: true }), {
    invalidate: [PATH, '/me/badges'],
    success: t('markedAllRead'),
  });

  const markOne = (n: Notification) => {
    if (n.readAt || readLocally.has(n.id)) return;
    setReadLocally((s) => new Set(s).add(n.id));
    markRead.mutate(
      { ids: [n.id] },
      {
        onError: () =>
          setReadLocally((s) => {
            const next = new Set(s);
            next.delete(n.id);
            return next;
          }),
      },
    );
  };

  const setView = (v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v === 'unread') next.set('view', 'unread');
    else next.delete('view');
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const loading = list.isLoading;

  // One panel per tab (Radix renders only the active one), so each trigger controls a real panel.
  const panel = (
    <div aria-busy={loading} className="pt-2">
      {loading && !items.length ? (
        <ListSkeleton />
      ) : !items.length ? (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {view === 'unread' ? (
            <EmptyState
              icon={<CheckCheckIcon />}
              title={t('empty.unreadTitle')}
              description={t('empty.unreadBody')}
              action={
                total > 0 ? (
                  <Button variant="outline" size="sm" onClick={() => setView('all')}>
                    {t('empty.viewAll')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState icon={<BellOffIcon />} title={t('empty.allTitle')} description={t('empty.allBody')} />
          )}
        </motion.div>
      ) : (
        <div className="space-y-5">
          <AnimatePresence initial={false}>
            {groups.map((g) => (
              <motion.section
                key={g.key}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                aria-labelledby={`day-${g.key}`}
              >
                <h2
                  id={`day-${g.key}`}
                  className="sticky top-14 z-10 -mx-1 mb-1 bg-background/85 px-1 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/70"
                >
                  {dayLabel(g)}
                </h2>
                <ul className="space-y-1">
                  <AnimatePresence initial={false}>
                    {g.items.map((n) => (
                      <NotificationRow
                        key={n.id}
                        n={n}
                        unread={!n.readAt && !readLocally.has(n.id)}
                        onOpen={() => markOne(n)}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </motion.section>
            ))}
          </AnimatePresence>
          <div className="flex flex-col items-center gap-2 pt-2 pb-4">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {t('showing', { shown: items.length, total: listTotal })}
            </p>
            {list.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void list.fetchNextPage()}
                loading={list.isFetchingNextPage}
              >
                {t('loadMore')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings#notifications">
                <Settings2Icon /> {t('settingsLink')}
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!unread}
              loading={markAll.isPending}
              onClick={() => markAll.mutate(undefined)}
            >
              {!markAll.isPending && <CheckCheckIcon />} {t('markAllRead')}
            </Button>
          </>
        }
      />
      <Tabs value={view} onValueChange={setView} className="gap-0">
        <TabsList aria-label={t('tabs.label')} className="w-full">
          <TabsTrigger value="all">
            {t('tabs.all')}
            <CountPill value={total} active={view === 'all'} />
          </TabsTrigger>
          <TabsTrigger value="unread">
            {t('tabs.unread')}
            <CountPill value={unread} active={view === 'unread'} highlight={unread > 0} />
          </TabsTrigger>
        </TabsList>
        {(['all', 'unread'] as const).map((v) => (
          <TabsContent key={v} value={v}>
            {panel}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function CountPill({ value, active, highlight }: { value: number; active: boolean; highlight?: boolean }) {
  return (
    <motion.span
      key={value}
      initial={{ scale: 0.8, opacity: 0.4 }}
      animate={{ scale: 1, opacity: 1 }}
      className={cn(
        'min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-medium tabular-nums',
        highlight ? 'bg-primary text-primary-foreground' : active ? 'bg-accent text-foreground' : 'bg-muted',
      )}
    >
      {value > 999 ? '999+' : value}
    </motion.span>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1 pt-8">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3 px-3 py-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Notices are plain text: senders' Markdown (bold, code, links, list marks) is shown as its words. */
export function plainText(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .trim();
}

function NotificationRow({ n, unread, onOpen }: { n: Notification; unread: boolean; onOpen: () => void }) {
  const t = useTranslations('notifications');
  const typeLabel = useTypeLabel();
  const label = (
    <>
      {unread && <span className="sr-only">{t('unread')} </span>}
      {plainText(n.title)}
    </>
  );
  // The title is the row's main control; its ::after stretches over the row so the whole card clicks.
  const titleClass =
    'rounded-sm outline-none after:absolute after:inset-0 after:rounded-lg after:content-[""] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50';

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group relative flex gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted/60',
        unread && 'bg-primary/[0.04] dark:bg-primary/[0.07]',
      )}
    >
      <div className="relative">
        <TypeIcon type={n.type} />
        <AnimatePresence initial={false}>
          {unread && (
            <motion.span
              aria-hidden
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -left-1 size-2.5 rounded-full bg-primary ring-2 ring-background"
            />
          )}
        </AnimatePresence>
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn('text-sm leading-snug', unread ? 'font-semibold' : 'font-medium text-foreground/90')}
        >
          {n.href ? (
            <Link href={n.href} onClick={onOpen} className={titleClass}>
              {label}
            </Link>
          ) : (
            <button type="button" onClick={onOpen} className={cn(titleClass, 'text-left')}>
              {label}
            </button>
          )}
        </p>
        {n.body && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{plainText(n.body)}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {n.actorName && (
            <>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <UserAvatar name={n.actorName} className="size-5 text-[9px]" />
                <span className="truncate">{n.actorName}</span>
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          <RelativeTime date={n.createdAt} />
          <span aria-hidden>·</span>
          <span className="truncate">{typeLabel(n.type)}</span>
        </div>
      </div>
      {unread && (
        <Hint label={t('markRead')}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpen}
            aria-label={t('markReadLabel', { title: n.title })}
            className="relative z-10 shrink-0 self-center sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          >
            <CheckIcon />
          </Button>
        </Hint>
      )}
    </motion.li>
  );
}
