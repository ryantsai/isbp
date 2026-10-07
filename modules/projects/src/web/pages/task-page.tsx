'use client';

import { ApiError, type WebPageProps } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { ArrowLeftIcon, FileQuestionIcon, RotateCwIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { TaskDetailSkeleton, TaskDetailView } from '../components/task-detail';
import { projectHref, useTask } from '../lib';

/** One task as a full page (`/projects/tasks/NET-12`). */
export default function TaskPage({ params }: WebPageProps) {
  const t = useTranslations('projects.task');
  const tc = useTranslations('common');
  const ref = (params.ref ?? '').toUpperCase();
  const { data: task, isLoading, isPlaceholderData, error, refetch } = useTask(ref);
  if (isLoading || (isPlaceholderData && task?.reference !== ref)) return <TaskDetailSkeleton />;
  if (error || !task) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <EmptyState
        icon={<FileQuestionIcon />}
        title={status === 404 ? t('notFound') : t('loadFailed')}
        description={status === 404 ? t('notFoundHint', { reference: ref }) : undefined}
        action={
          status === 404 ? (
            <Button variant="outline" asChild>
              <Link href="/projects/my-tasks">{t('toMyTasks')}</Link>
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void refetch()}>
              <RotateCwIcon />
              {tc('retry')}
            </Button>
          )
        }
        className="rounded-xl border border-dashed"
      />
    );
  }
  return (
    <div className="grid min-w-0 gap-4">
      <FadeIn y={4}>
        <Link
          href={`${projectHref(task.project.key)}?view=board`}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
          {t('backToProject', { key: task.project.key })}
        </Link>
      </FadeIn>
      <TaskDetailView key={task.id} task={task} variant="page" />
    </div>
  );
}
