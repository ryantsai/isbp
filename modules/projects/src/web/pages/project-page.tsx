'use client';

import { ApiError, type WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArchiveIcon,
  CalendarIcon,
  FileQuestionIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCwIcon,
  SendIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ProjectDetail, ProjectStatus } from '../../contracts';
import { KeyBadge, ProjectHealthBadge, ProjectStatusBadge, VisibilityBadge } from '../components/badges';
import { TaskSheet } from '../components/task-sheet';
import { WorkloadGrid } from '../components/workload-grid';
import { dateValue, projectApi, projectHref, useProject, useSearchParam } from '../lib';
import { BoardTab } from '../project/board-tab';
import { useStartProject } from '../project/start';
import { HealthDialog, NewTaskDialog, StatusDialog } from '../project/dialogs';
import { ListTab } from '../project/list-tab';
import { OverviewTab } from '../project/overview-tab';
import { SettingsTab } from '../project/settings-tab';
import { TimelineTab } from '../project/timeline-tab';

const VIEWS = ['overview', 'board', 'list', 'timeline', 'workload', 'settings'] as const;
type View = (typeof VIEWS)[number];

function ProjectSkeleton() {
  return (
    <div className="grid gap-4" aria-busy>
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
  const [health, setHealth] = useState(false);
  const starter = useStartProject(project);
  const v = project.viewer;
  const newTask = { id: 'new-task', label: t('newTask'), icon: <PlusIcon />, onSelect: onNewTask };
  return (
    <div className="grid gap-3">
      <DetailHeader
        className="pb-0"
        back={{ href: '/projects', label: t('back'), highlight: project.key }}
        reference={
          <span className="flex flex-wrap items-center gap-2">
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
          </span>
        }
        title={project.name}
        status={
          <>
            <ProjectStatusBadge status={project.status} />
            <ProjectHealthBadge project={project} />
            {project.archivedAt && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ArchiveIcon className="size-3.5" aria-hidden />
                {t('archived')}
              </span>
            )}
          </>
        }
        primaryAction={
          v.canStart ? (
            <Button onClick={starter.open}>
              {starter.needsApproval ? <SendIcon /> : <PlayIcon />}
              {starter.label}
            </Button>
          ) : v.canEditTasks ? (
            <Button onClick={onNewTask}>
              <PlusIcon />
              {t('newTask')}
            </Button>
          ) : undefined
        }
        actions={[
          ...(v.canStart && v.canEditTasks ? [newTask] : []),
          ...(v.canManage
            ? [
                {
                  id: 'health',
                  label: t('updateHealth'),
                  icon: <PencilIcon />,
                  onSelect: () => setHealth(true),
                },
              ]
            : []),
        ]}
        menu={v.transitions.map((st) => ({
          id: st,
          label: ts(`action.${st}`),
          destructive: st === 'cancelled',
          onSelect: () => setStatusTarget(st),
        }))}
      />
      {starter.dialog}
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
    </div>
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
  const router = useRouter();

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
    <div className="grid min-w-0 gap-4">
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
              <OverviewTab
                project={project}
                onNewTask={() => setCreating(true)}
                onManage={(section) =>
                  router.push(`${projectHref(project.key)}?view=settings&section=${section}`, {
                    scroll: false,
                  })
                }
              />
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
