'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { ChevronLeftIcon, ChevronRightIcon, MegaphoneIcon, PinIcon, PlusIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Post } from '../../contracts';
import { PostEditor } from '../post-editor';
import { severityBar, SeverityBadge } from '../severity';
import { WindowLabel } from '../window-label';

type View = 'current' | 'drafts' | 'archive';

function PostCard({ post, index }: { post: Post; index: number }) {
  const t = useTranslations('announcements');
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.04, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link
        href={`/announcements/${post.id}`}
        className="group relative flex overflow-hidden rounded-xl border bg-card shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:hover:translate-y-0"
      >
        <span className={cn('w-1 shrink-0', severityBar(post.severity))} aria-hidden />
        <div className="min-w-0 flex-1 space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={post.severity} />
            {post.pinned && (
              <Badge variant="outline" className="gap-1">
                <PinIcon /> {t('pinned')}
              </Badge>
            )}
            {post.status === 'draft' && <Badge variant="muted">{t('status.draft')}</Badge>}
            {post.status === 'pending' && <Badge variant="warning">{t('status.pending')}</Badge>}
            {post.status === 'archived' && <Badge variant="muted">{t('status.archived')}</Badge>}
            <span className="ml-auto text-xs text-muted-foreground">
              <RelativeTime date={post.publishedAt ?? post.updatedAt} />
            </span>
          </div>
          <h2 className="text-base font-semibold tracking-tight group-hover:underline">{post.title}</h2>
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
    </motion.li>
  );
}

export default function FeedPage() {
  const t = useTranslations('announcements');
  const router = useRouter();
  const canManage = useCan('announcements.posts.manage');
  const [state, set] = useListState({ pageSize: 10 });
  const view = ((state.view as View) ?? 'current') satisfies View;
  const [writing, setWriting] = useState(false);
  const { data, isLoading } = useApiQuery<Page<Post>>('/announcements/posts', {
    view,
    q: state.q,
    page: state.page,
    pageSize: state.pageSize,
  });
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / state.pageSize));

  return (
    <div className="mx-auto max-w-3xl">
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
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={view} onValueChange={(v) => set({ view: v === 'current' ? undefined : v })}>
          <TabsList>
            <TabsTrigger value="current">{t('views.current')}</TabsTrigger>
            {canManage && <TabsTrigger value="drafts">{t('views.drafts')}</TabsTrigger>}
            <TabsTrigger value="archive">{t('views.archive')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <SearchInput value={state.q ?? ''} onChange={(q) => set({ q })} placeholder={t('search')} />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : data?.items.length ? (
        <ul className="space-y-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {data.items.map((p, i) => (
              <PostCard key={p.id} post={p} index={i} />
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <EmptyState
          icon={<MegaphoneIcon />}
          title={t(`empty.${view}`)}
          className="rounded-xl border border-dashed"
        />
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={state.page <= 1}
            onClick={() => set({ page: state.page - 1 })}
            aria-label={t('previous')}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="tabular-nums">
            {state.page} / {pages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={state.page >= pages}
            onClick={() => set({ page: state.page + 1 })}
            aria-label={t('next')}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      )}

      <PostEditor
        open={writing}
        onOpenChange={setWriting}
        onSaved={(p) => router.push(`/announcements/${p.id}`)}
      />
    </div>
  );
}
