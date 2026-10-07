'use client';

import { ApiError, type WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { useApiMutation } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArchiveIcon,
  ArrowLeftIcon,
  CalendarIcon,
  ChevronDownIcon,
  FileQuestionIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCwIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ProjectDetail, ProjectStatus } from '../../contracts';
import { HealthBadge, KeyBadge, ProjectStatusBadge, VisibilityBadge } from '../components/badges';
import { ConfirmDialog } from '../components/inputs';
import { TaskSheet } from '../components/task-sheet';
import { WorkloadGrid } from '../components/workload-grid';
import { dateValue, INVALIDATE, projectApi, useProject, useSearchParam } from '../lib';
import { BoardTab } from '../project/board-tab';
import { HealthDialog, NewTaskDialog, StatusDialog } from '../project/dialogs';
import { ListTab } from '../project/list-tab';
import { OverviewTab } from '../project/overview-tab';
import { SettingsTab } from '../project/settings-tab';
import { TimelineTab } from '../project/timeline-tab';

const VIEWS = ['overview', 'board', 'list', 'timeline', 'workload', 'settings'] as const;
type View = (typeof VIEWS)[number];

function ProjectSkeleton() {
  return (
    <div className="grid gap-6" aria-busy>
      <Skeleton className="h-4 w-24" />
      <div className="grid gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-8 w-80 max-w-full" />
      </div>
      <Skeleton className="h-9 w-full max-w-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

function Header({ project, onNewTask }: { project: ProjectDetail; onNewTask: () => void }) {
  const t = useTranslations('projects.project');
  const ts = useTranslations('projects.statusDialog');
  const format = useFormatter();
  const [statusTarget, setStatusTarget] = useState<ProjectStatus | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [health, setHealth] = useState(false);
  const start = useApiMutation((api) => api.post<ProjectDetail>(`${projectApi(project.key)}/start`), {
    invalidate: INVALIDATE,
    success: (p) => (p.status === 'active' ? t('started') : t('submitted')),
    onSuccess: () => setConfirmStart(false),
  });
  const v = project.viewer;
  const needsApproval =
    project.budgetHours !== null && project.budgetHours > project.settings.proposalThresholdHours;
  return (
    <FadeIn y={4} className="grid gap-3">
      <Link
        href="/projects"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden />
        {t('back')}
      </Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="grid min-w-0 flex-1 gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <KeyBadge projectKey={project.key} />
            <VisibilityBadge visibility={project.visibility} />
            {project.department && <span>{project.department.name}</span>}
            {project.owner && (
              <span className="inline-flex items-center gap-1.5">
                <UserAvatar
                  name={project.owner.displayName}
                  src={project.owner.avatarUrl}
                  className="size-5 text-[9px]"
                />
                <span className="sr-only">{t('owner')}:</span>
                {project.owner.displayName}
              </span>
            )}
            {project.targetDate && (
              <span className="inline-flex items-center gap-1">
                <CalendarIcon className="size-3.5" aria-hidden />
                {t('target', {
                  date: format.dateTime(dateValue(project.targetDate), { dateStyle: 'medium' }),
                })}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">{project.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            <HealthBadge health={project.health} />
            {project.archivedAt && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ArchiveIcon className="size-3.5" aria-hidden />
                {t('archived')}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {v.canStart && (
            <Button onClick={() => setConfirmStart(true)}>
              <PlayIcon />
              {t('start')}
            </Button>
          )}
          {v.canEditTasks && (
            <Button variant={v.canStart ? 'outline' : 'default'} onClick={onNewTask}>
              <PlusIcon />
              {t('newTask')}
            </Button>
          )}
          {v.canManage && (
            <Button variant="outline" onClick={() => setHealth(true)}>
              <PencilIcon />
              {t('updateHealth')}
            </Button>
          )}
          {v.transitions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <RotateCwIcon />
                  {t('changeStatus')}
                  <ChevronDownIcon className="opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {v.transitions.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    variant={s === 'cancelled' ? 'destructive' : 'default'}
                    onSelect={() => setStatusTarget(s)}
                  >
                    {ts(`action.${s}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmStart}
        onOpenChange={setConfirmStart}
        title={t('startTitle', { key: project.key })}
        description={
          needsApproval
            ? t('startNeedsApproval', {
                hours: project.budgetHours ?? 0,
                threshold: project.settings.proposalThresholdHours,
              })
            : t('startAutomatic', { threshold: project.settings.proposalThresholdHours })
        }
        confirmLabel={t('start')}
        loading={start.isPending}
        onConfirm={() => start.mutate(undefined)}
      />
      {v.canManage && (
        <>
          <StatusDialog
            key={statusTarget ?? 'none'}
            project={project}
            target={statusTarget}
            onOpenChange={(o) => !o && setStatusTarget(null)}
          />
          <HealthDialog project={project} open={health} onOpenChange={setHealth} />
        </>
      )}
    </FadeIn>
  );
}

/** One project: overview, board, list, timeline, workload and settings (`?view=`), plus the task sheet. */
export default function ProjectPage({ params }: WebPageProps) {
  const t = useTranslations('projects.project');
  const tc = useTranslations('common');
  const key = (params.key ?? '').toUpperCase();
  const { data: project, isLoading, isPlaceholderData, error, refetch } = useProject(key);
  const [viewParam, setView] = useSearchParam('view');
  const [, setTask] = useSearchParam('task');
  const [creating, setCreating] = useState(false);

  if (isLoading || (isPlaceholderData && project?.key !== key)) return <ProjectSkeleton />;
  if (error || !project) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <EmptyState
        icon={<FileQuestionIcon />}
        title={status === 404 ? t('notFound') : t('loadFailed')}
        description={status === 404 ? t('notFoundHint', { key }) : undefined}
        action={
          status !== 404 ? (
            <Button variant="outline" onClick={() => void refetch()}>
              <RotateCwIcon />
              {tc('retry')}
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href="/projects">{t('back')}</Link>
            </Button>
          )
        }
        className="rounded-xl border border-dashed"
      />
    );
  }

  const views = VIEWS.filter((v) => v !== 'settings' || project.viewer.canManage);
  const view: View = views.includes(viewParam as View) ? (viewParam as View) : 'overview';

  return (
    <div className="grid min-w-0 gap-6">
      <Header project={project} onNewTask={() => setCreating(true)} />
      <Tabs
        value={view}
        onValueChange={(v) => setView(v === 'overview' ? null : v, { push: true })}
        className="min-w-0 gap-5"
      >
        <TabsList aria-label={t('views')}>
          {views.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`tabs.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Only the active panel renders its (data-fetching) content; each tab still has its panel. */}
        {views.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {v !== view ? null : v === 'overview' ? (
              <OverviewTab project={project} onManage={() => setView('settings', { push: true })} />
            ) : v === 'board' ? (
              <BoardTab project={project} />
            ) : v === 'list' ? (
              <ListTab project={project} />
            ) : v === 'timeline' ? (
              <TimelineTab project={project} />
            ) : v === 'workload' ? (
              <WorkloadGrid path={`${projectApi(project.key)}/workload`} inSheet />
            ) : (
              <SettingsTab project={project} />
            )}
          </TabsContent>
        ))}
      </Tabs>
      {project.viewer.canEditTasks && (
        <NewTaskDialog
          project={project}
          open={creating}
          onOpenChange={setCreating}
          onCreated={(task) => setTask(task.reference)}
        />
      )}
      <TaskSheet />
    </div>
  );
}
