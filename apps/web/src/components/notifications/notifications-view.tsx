'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Item } from '@astryxdesign/core/Item';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { Notification, NotificationPage } from '@isbp/contracts';
import { useApi } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { useInfiniteQuery } from '@tanstack/react-query';
import { BellOffIcon, CheckCheckIcon, CheckIcon, Settings2Icon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useNow, useTimeZone, useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
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

/** A list count, capped so the segment stays narrow. */
function count(value: number) {
  return value > 999 ? '999+' : String(value);
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

  // Counts for both views (cheap; refreshed with every live update like the list itself).
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

  // One list; the control above only filters it (all / unread).
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
                  <Button
                    label={t('empty.viewAll')}
                    variant="secondary"
                    size="sm"
                    onClick={() => setView('all')}
                  />
                ) : undefined
              }
            />
          ) : (
            <EmptyState icon={<BellOffIcon />} title={t('empty.allTitle')} description={t('empty.allBody')} />
          )}
        </motion.div>
      ) : (
        <VStack gap={5}>
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
                <Heading
                  level={2}
                  id={`day-${g.key}`}
                  weight="semibold"
                  color="secondary"
                  className="sticky top-14 z-10 -mx-1 mb-1 bg-background/85 px-1 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/70"
                >
                  {dayLabel(g)}
                </Heading>
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
          <VStack gap={2} hAlign="center" className="pt-2 pb-4">
            <Text type="supporting" color="secondary" aria-live="polite">
              {t('showing', { shown: items.length, total: listTotal })}
            </Text>
            {list.hasNextPage && (
              <Button
                label={t('loadMore')}
                variant="secondary"
                size="sm"
                isLoading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              />
            )}
          </VStack>
        </VStack>
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
            <Button
              label={t('settingsLink')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={Settings2Icon} />}
              href="/settings#notifications"
            />
            <Button
              label={t('markAllRead')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={CheckCheckIcon} />}
              isDisabled={!unread}
              isLoading={markAll.isPending}
              onClick={() => markAll.mutate(undefined)}
            />
          </>
        }
      />
      <SegmentedControl label={t('tabs.label')} value={view} onChange={setView} layout="fill">
        <SegmentedControlItem value="all" label={`${t('tabs.all')} ${count(total)}`} />
        <SegmentedControlItem value="unread" label={`${t('tabs.unread')} ${count(unread)}`} />
      </SegmentedControl>
      {panel}
    </div>
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
  // The title owns the row's keyboard access; the row hands clicks anywhere else on it to this control.
  const titleRef = useRef<HTMLAnchorElement | HTMLButtonElement>(null);

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <Item
        className="group"
        align="start"
        isHighlighted={unread}
        interactiveRef={titleRef}
        startContent={
          <div className="relative">
            <TypeIcon type={n.type} />
            {unread && (
              <span className="absolute -top-1 -left-1">
                <StatusDot variant="accent" label={t('unread')} aria-hidden />
              </span>
            )}
          </div>
        }
        label={
          <Link
            ref={titleRef}
            href={n.href ?? undefined}
            onClick={onOpen}
            color="primary"
            weight={unread ? 'semibold' : 'medium'}
          >
            {unread && <span className="sr-only">{t('unread')} </span>}
            {plainText(n.title)}
          </Link>
        }
        description={
          <VStack gap={1.5}>
            {n.body && (
              <Text type="supporting" color="secondary" maxLines={2}>
                {plainText(n.body)}
              </Text>
            )}
            <HStack gap={1.5} vAlign="center" wrap="wrap" className="min-w-0">
              {n.actorName && (
                <>
                  <HStack gap={1.5} vAlign="center" className="min-w-0">
                    <UserAvatar name={n.actorName} className="size-5 text-[9px]" />
                    <Text type="supporting" color="secondary" maxLines={1}>
                      {n.actorName}
                    </Text>
                  </HStack>
                  <Text type="supporting" color="secondary" aria-hidden>
                    ·
                  </Text>
                </>
              )}
              <Text type="supporting" color="secondary">
                <RelativeTime date={n.createdAt} />
              </Text>
              <Text type="supporting" color="secondary" aria-hidden>
                ·
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {typeLabel(n.type)}
              </Text>
            </HStack>
          </VStack>
        }
        endContent={
          unread ? (
            <IconButton
              label={t('markReadLabel', { title: n.title })}
              variant="ghost"
              size="sm"
              icon={<Icon icon={CheckIcon} />}
              onClick={onOpen}
              className="sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            />
          ) : undefined
        }
      />
    </motion.li>
  );
}
