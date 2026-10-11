'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { ApiError, type WebPageProps } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { BackLink } from '@isbp/ui/page-header';
import { FileQuestionIcon, RotateCwIcon } from 'lucide-react';
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
            <Button label={t('toMyTasks')} variant="secondary" href="/projects/my-tasks" />
          ) : (
            <Button
              label={tc('retry')}
              variant="secondary"
              icon={<Icon icon={RotateCwIcon} />}
              onClick={() => void refetch()}
            />
          )
        }
        className="rounded-xl border border-dashed"
      />
    );
  }
  return (
    <div className="grid min-w-0 gap-4">
      <FadeIn y={4}>
        <BackLink
          href={`${projectHref(task.project.key)}?view=board`}
          label={t('backToProject', { key: task.project.key })}
        />
      </FadeIn>
      <TaskDetailView key={task.id} task={task} variant="page" />
    </div>
  );
}
