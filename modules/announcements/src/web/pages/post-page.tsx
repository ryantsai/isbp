'use client';

import { useCan, type WebPageProps } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArchiveIcon,
  ArrowLeftIcon,
  FileQuestionIcon,
  PencilIcon,
  PinIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Post } from '../../contracts';
import { PostEditor } from '../post-editor';
import { SeverityBadge } from '../severity';
import { WindowLabel } from '../window-label';

export default function PostPage({ params }: WebPageProps) {
  const t = useTranslations('announcements');
  const tc = useTranslations('common');
  const router = useRouter();
  const canManage = useCan('announcements.posts.manage');
  const [editing, setEditing] = useState(false);
  const path = `/announcements/posts/${params.id}`;
  const { data: post, isLoading, error } = useApiQuery<Post>(path);
  const opts = { invalidate: ['/announcements/'] };
  const publish = useApiMutation((api) => api.post<Post>(`${path}/publish`), {
    ...opts,
    success: t('publishedToast'),
  });
  const archive = useApiMutation((api) => api.post<Post>(`${path}/archive`), {
    ...opts,
    success: t('archivedToast'),
  });
  const remove = useApiMutation((api) => api.delete(path), {
    ...opts,
    success: t('deletedToast'),
    onSuccess: () => router.push('/announcements'),
  });

  if (isLoading) return <Skeleton className="mx-auto h-64 max-w-3xl rounded-xl" />;
  if (error || !post) return <EmptyState icon={<FileQuestionIcon />} title={t('notFound')} />;

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/announcements">
          <ArrowLeftIcon /> {t('meta.name')}
        </Link>
      </Button>
      <FadeIn y={4} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={post.severity} />
          {post.pinned && (
            <Badge variant="outline" className="gap-1">
              <PinIcon /> {t('pinned')}
            </Badge>
          )}
          {post.status !== 'published' && <Badge variant="muted">{t(`status.${post.status}`)}</Badge>}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{post.title}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <WindowLabel startsAt={post.startsAt} endsAt={post.endsAt} />
          {post.publishedAt && (
            <span>
              {t('publishedAt')} <DateTime date={post.publishedAt} />
            </span>
          )}
          {post.author && <span>{t('by', { name: post.author.displayName })}</span>}
        </div>
      </FadeIn>
      <Card>
        <CardContent>
          <p className="leading-relaxed whitespace-pre-wrap">{post.body || '—'}</p>
        </CardContent>
      </Card>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          {post.status === 'draft' && (
            <Button onClick={() => publish.mutate(undefined)} loading={publish.isPending}>
              <SendIcon /> {t('editor.publish')}
            </Button>
          )}
          <Button variant="outline" onClick={() => setEditing(true)}>
            <PencilIcon /> {tc('edit')}
          </Button>
          {post.status === 'published' && (
            <Button variant="outline" onClick={() => archive.mutate(undefined)} loading={archive.isPending}>
              <ArchiveIcon /> {t('archive')}
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => remove.mutate(undefined)}
            loading={remove.isPending}
          >
            <Trash2Icon /> {tc('delete')}
          </Button>
        </div>
      )}
      <PostEditor open={editing} onOpenChange={setEditing} post={post} />
    </article>
  );
}
