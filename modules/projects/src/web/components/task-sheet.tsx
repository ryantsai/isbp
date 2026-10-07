'use client';

import { ApiError } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { FileQuestionIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParam, useTask } from '../lib';
import { TaskDetailSkeleton, TaskDetailView } from './task-detail';

/**
 * The task sheet, driven by `?task=NET-12` in the URL (shareable, survives reloads). References inside
 * it open in the same sheet.
 */
export function TaskSheet() {
  const t = useTranslations('projects.task');
  const tc = useTranslations('common');
  const [ref, setRef] = useSearchParam('task');
  const { data: task, isLoading, isPlaceholderData, error } = useTask(ref);
  const missing = error instanceof ApiError && error.status === 404;
  return (
    <Sheet open={Boolean(ref)} onOpenChange={(open) => !open && setRef(null)}>
      <SheetContent className="sm:max-w-2xl lg:max-w-3xl" closeLabel={tc('close')}>
        <SheetHeader className="sr-only">
          <SheetTitle>{task ? `${task.reference} ${task.title}` : (ref ?? t('loading'))}</SheetTitle>
          <SheetDescription>{task?.project.name ?? ''}</SheetDescription>
        </SheetHeader>
        <SheetBody className="py-5 pr-10">
          {missing || (error && !task) ? (
            <EmptyState icon={<FileQuestionIcon />} title={t('notFound')} description={ref ?? undefined} />
          ) : isLoading || isPlaceholderData || !task ? (
            <TaskDetailSkeleton />
          ) : (
            <TaskDetailView
              key={task.id}
              task={task}
              variant="sheet"
              onOpenTask={(reference) => setRef(reference)}
              onDeleted={() => setRef(null)}
            />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
