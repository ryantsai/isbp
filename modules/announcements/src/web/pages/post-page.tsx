'use client';

import { ApiError, useCan, type WebPageProps } from '@isbp/sdk/web';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { Collapse } from '@isbp/ui/motion';
import { BackLink, type DetailAction, DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArchiveIcon, ClockIcon, PencilIcon, PinIcon, SendIcon, Trash2Icon, UndoIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Post } from '../../contracts';
import { PostEditor } from '../post-editor';
import { PostStatusBadge, SeverityBadge } from '../severity';
import { WindowLabel } from '../window-label';

const FEED = '/announcements';

export default function PostPage({ params }: WebPageProps) {
  const t = useTranslations('announcements');
  const tc = useTranslations('common');
  const router = useRouter();
  const canManage = useCan('announcements.posts.manage');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const path = `/announcements/posts/${params.id}`;
  const { data: post, isLoading, error, refetch } = useApiQuery<Post>(path);
  const opts = { invalidate: ['/announcements/'] };
  const publish = useApiMutation((api) => api.post<Post>(`${path}/publish`), {
    ...opts,
    success: (p) => (p.status === 'pending' ? t('submittedToast') : t('publishedToast')),
  });
  const withdraw = useApiMutation((api) => api.post<Post>(`${path}/withdraw`), {
    ...opts,
    success: t('withdrawnToast'),
  });
  const archive = useApiMutation((api) => api.post<Post>(`${path}/archive`), {
    ...opts,
    success: t('archivedToast'),
  });
  const remove = useApiMutation((api) => api.delete(path), {
    ...opts,
    success: t('deletedToast'),
    onSuccess: () => router.push(FEED),
  });

  const back = { href: FEED, label: t('meta.name'), highlight: post?.id };

  if (isLoading)
    return (
      <div className="max-w-3xl space-y-4" aria-busy="true">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  // An error only replaces the page when there is nothing to show (a refetch that fails right after a delete keeps
  // the record on screen until the page moves on).
  if (!post) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div className="space-y-5">
        <BackLink href={back.href} label={back.label} />
        <ErrorState
          kind="page"
          error={error}
          title={missing ? t('notFound') : undefined}
          onRetry={() => refetch()}
          className="max-w-3xl rounded-xl border"
        />
      </div>
    );
  }

  // The next step is the primary button; the rest are secondary, delete is last in "More".
  const primary =
    post.status === 'draft' ? (
      <Button onClick={() => publish.mutate(undefined)} loading={publish.isPending}>
        <SendIcon /> {t('editor.publish')}
      </Button>
    ) : post.status === 'pending' ? (
      <Button variant="outline" onClick={() => withdraw.mutate(undefined)} loading={withdraw.isPending}>
        <UndoIcon /> {t('withdraw')}
      </Button>
    ) : undefined;
  const actions: DetailAction[] = [];
  if (post.status !== 'pending')
    actions.push({ id: 'edit', label: tc('edit'), icon: <PencilIcon />, onSelect: () => setEditing(true) });
  if (post.status === 'published')
    actions.push({
      id: 'archive',
      label: t('archive'),
      icon: <ArchiveIcon />,
      disabled: archive.isPending,
      onSelect: () => archive.mutate(undefined),
    });
  const menu: DetailAction[] = [
    {
      id: 'delete',
      label: tc('delete'),
      icon: <Trash2Icon />,
      destructive: true,
      onSelect: () => setDeleting(true),
    },
  ];

  return (
    <article>
      <DetailHeader
        back={back}
        title={post.title}
        status={<SeverityBadge severity={post.severity} />}
        badges={
          <>
            {post.pinned && (
              <Badge variant="outline" className="gap-1">
                <PinIcon aria-hidden /> {t('pinned')}
              </Badge>
            )}
            {post.status !== 'published' && <PostStatusBadge status={post.status} animate />}
          </>
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <WindowLabel startsAt={post.startsAt} endsAt={post.endsAt} />
            {post.publishedAt && (
              <span>
                {t('publishedAt')} <DateTime date={post.publishedAt} />
              </span>
            )}
            {post.author && <span>{t('by', { name: post.author.displayName })}</span>}
          </span>
        }
        primaryAction={canManage ? primary : undefined}
        actions={canManage ? actions : []}
        menu={canManage ? menu : []}
      />
      {/* A reading column, aligned with the title. */}
      <div className="max-w-3xl space-y-4">
        <Collapse open={post.status === 'pending'}>
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <ClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{t('pendingHint')}</p>
          </div>
        </Collapse>
        <Card>
          <CardContent>
            <p className="leading-relaxed wrap-break-word whitespace-pre-wrap">{post.body || '—'}</p>
          </CardContent>
        </Card>
      </div>

      {canManage && (
        <>
          <PostEditor open={editing} onOpenChange={setEditing} post={post} />
          <AlertDialog open={deleting} onOpenChange={setDeleting}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('deleteTitle', { title: post.title })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {post.status === 'published' ? t('deleteBodyPublished') : t('deleteBody')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={remove.isPending}>{tc('cancel')}</AlertDialogCancel>
                <Button
                  variant="destructive"
                  loading={remove.isPending}
                  onClick={() => remove.mutate(undefined)}
                >
                  {tc('delete')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </article>
  );
}
