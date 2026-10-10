'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { rememberOpenedRow, takeOpenedRow } from '@isbp/ui/lib/list-memory';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { ChevronLeftIcon, ChevronRightIcon, MegaphoneIcon, PinIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { Post } from '../../contracts';
import { PostEditor } from '../post-editor';
import { PostStatusBadge, severityBar, SeverityBadge } from '../severity';
import { WindowLabel } from '../window-label';

const FEED = '/announcements';
type View = 'current' | 'drafts' | 'archive';

function PostCard({ post, highlight }: { post: Post; highlight?: boolean }) {
  const t = useTranslations('announcements');
  return (
    <Link
      href={`${FEED}/${post.id}`}
      onClick={() => rememberOpenedRow(FEED, post.id)}
      className="group relative flex overflow-hidden rounded-xl border bg-card transition-[translate,box-shadow] duration-(--motion-base) hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span className={cn('w-1 shrink-0', severityBar(post.severity))} aria-hidden />
      {highlight && <span aria-hidden className="highlight-flash pointer-events-none absolute inset-0" />}
      <div className="min-w-0 flex-1 space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={post.severity} />
          {post.pinned && (
            <Badge variant="outline" className="gap-1">
              <PinIcon aria-hidden /> {t('pinned')}
            </Badge>
          )}
          {post.status !== 'published' && <PostStatusBadge status={post.status} />}
          <span className="ml-auto text-xs text-muted-foreground">
            <RelativeTime date={post.publishedAt ?? post.updatedAt} />
          </span>
        </div>
        <h2 className="text-base font-semibold tracking-tight wrap-break-word group-hover:underline">
          {post.title}
        </h2>
        {post.body && <p className="line-clamp-2 text-sm text-muted-foreground">{post.body}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <WindowLabel startsAt={post.startsAt} endsAt={post.endsAt} />
          {post.author && (
            <span className="text-xs text-muted-foreground">
              {t('by', { name: post.author.displayName })}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/** The post a person opened (or just wrote) flashes once when they come back to the feed. */
function useReturnHighlight() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const opened = takeOpenedRow(FEED);
    if (opened) setId(opened);
  }, []);
  useEffect(() => {
    if (!id) return;
    const timer = setTimeout(() => setId(null), 1200);
    return () => clearTimeout(timer);
  }, [id]);
  return id;
}

export default function FeedPage() {
  const t = useTranslations('announcements');
  const router = useRouter();
  const canManage = useCan('announcements.posts.manage');
  const [state, set] = useListState({ pageSize: 10 });
  const view = ((state.view as View) ?? 'current') satisfies View;
  const [writing, setWriting] = useState(false);
  const highlight = useReturnHighlight();
  const { data, isLoading, isPlaceholderData, error, refetch } = useApiQuery<Page<Post>>(
    '/announcements/posts',
    { view, q: state.q, page: state.page, pageSize: state.pageSize },
  );
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / state.pageSize));

  // Another tab, search or page shows a new list (no motion); posts added, edited or removed while the same list
  // is on screen animate in and out. While the next page loads, the previous one stays.
  const listKey = `${view}|${state.q ?? ''}|${state.page}`;
  const [shownKey, setShownKey] = useState(listKey);
  if (data && !isPlaceholderData && shownKey !== listKey) setShownKey(listKey);

  const views: View[] = canManage ? ['current', 'drafts', 'archive'] : ['current', 'archive'];

  const content =
    error && !data ? (
      <ErrorState kind="list" error={error} onRetry={() => refetch()} className="rounded-xl border" />
    ) : isLoading || !data ? (
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    ) : data.items.length ? (
      <AnimatedList key={shownKey}>
        {data.items.map((p) => (
          <AnimatedItem key={p.id} className="pb-3">
            <PostCard post={p} highlight={p.id === highlight} />
          </AnimatedItem>
        ))}
      </AnimatedList>
    ) : (
      <EmptyState
        icon={<MegaphoneIcon />}
        title={state.q ? t('empty.search') : t(`empty.${view}`)}
        className="rounded-xl border border-dashed"
      />
    );

  return (
    <div>
      <PageHeader
        title={t('meta.name')}
        description={t('meta.description')}
        actions={
          canManage && (
            <Button onClick={() => setWriting(true)}>
              <PlusIcon /> {t('new')}
            </Button>
          )
        }
      />
      {/* A reading column, aligned with the page title like every other page. */}
      <Tabs
        value={view}
        onValueChange={(v) => set({ view: v === 'current' ? undefined : v })}
        className="max-w-3xl gap-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            {views.map((v) => (
              <TabsTrigger key={v} value={v}>
                {t(`views.${v}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <SearchInput value={state.q ?? ''} onChange={(q) => set({ q })} placeholder={t('search')} />
        </div>
        {/* Each tab only filters the same list. */}
        {views.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {content}
          </TabsContent>
        ))}

        {pages > 1 && (
          <nav
            aria-label={t('pagination')}
            className="flex items-center justify-end gap-2 text-sm text-muted-foreground"
          >
            <Button
              variant="outline"
              size="icon-sm"
              disabled={state.page <= 1}
              onClick={() => set({ page: state.page - 1 })}
              aria-label={t('previous')}
            >
              <ChevronLeftIcon />
            </Button>
            <span className="tabular-nums">{t('pageOf', { page: state.page, pages })}</span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={state.page >= pages}
              onClick={() => set({ page: state.page + 1 })}
              aria-label={t('next')}
            >
              <ChevronRightIcon />
            </Button>
          </nav>
        )}
      </Tabs>

      <PostEditor open={writing} onOpenChange={setWriting} onSaved={(p) => router.push(`${FEED}/${p.id}`)} />
    </div>
  );
}
