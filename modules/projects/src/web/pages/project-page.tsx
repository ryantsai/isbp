'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { ApiError, type WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { EmptyState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
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
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { ProjectDetail, ProjectStatus } from '../../contracts';
import { KeyBadge, ProjectHealthBadge, ProjectStatusBadge, VisibilityBadge } from '../components/badges';
import { TaskSheet } from '../components/task-sheet';
import { WorkloadGrid } from '../components/workload-grid';
import { dateValue, projectApi, projectHref, useProject, useSearchParam } from '../lib';
import { BoardTab } from '../project/board-tab';
import { HealthDialog, NewTaskDialog, StatusDialog } from '../project/dialogs';
import { ListTab } from '../project/list-tab';
import { OverviewTab } from '../project/overview-tab';
import { SettingsTab } from '../project/settings-tab';
import { useStartProject } from '../project/start';
import { TimelineTab } from '../project/timeline-tab';
import { UpdatesTab } from '../project/updates-tab';

const VIEWS = ['overview', 'updates', 'board', 'list', 'timeline', 'workload', 'settings'] as const;
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
          <HStack as="span" gap={2} vAlign="center" wrap="wrap">
            <KeyBadge projectKey={project.key} />
            <VisibilityBadge visibility={project.visibility} />
            {project.department && <span>{project.department.name}</span>}
            {project.owner && (
              <HStack as="span" gap={1.5} vAlign="center">
                <UserAvatar
                  name={project.owner.displayName}
                  src={project.owner.avatarUrl}
                  className="size-5 text-[9px]"
                />
                <span className="sr-only">{t('owner')}:</span>
                {project.owner.displayName}
              </HStack>
            )}
            {project.targetDate && (
              <HStack as="span" gap={1} vAlign="center">
                <Icon icon={CalendarIcon} size="xsm" />
                {t('target', {
                  date: format.dateTime(dateValue(project.targetDate), { dateStyle: 'medium' }),
                })}
              </HStack>
            )}
          </HStack>
        }
        title={project.name}
        status={
          <>
            <ProjectStatusBadge status={project.status} />
            <ProjectHealthBadge project={project} />
            {project.archivedAt && (
              <HStack as="span" gap={1} vAlign="center">
                <Icon icon={ArchiveIcon} size="xsm" color="secondary" />
                <Text type="supporting">{t('archived')}</Text>
              </HStack>
            )}
          </>
        }
        primaryAction={
          v.canStart ? (
            <Button
              label={starter.label}
              variant="primary"
              icon={<Icon icon={starter.needsApproval ? SendIcon : PlayIcon} />}
              onClick={starter.open}
            />
          ) : v.canEditTasks ? (
            <Button
              label={t('newTask')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={onNewTask}
            />
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

/** One project: overview, status updates, board, list, timeline, workload and settings (`?view=`), plus the task sheet. */
export default function ProjectPage({ params }: WebPageProps) {
  const t = useTranslations('projects.project');
  const tc = useTranslations('common');
  const panelId = useId();
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
            <Button
              label={tc('retry')}
              variant="secondary"
              icon={<Icon icon={RotateCwIcon} />}
              onClick={() => void refetch()}
            />
          ) : (
            <Button label={t('back')} variant="secondary" href="/projects" />
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
      <div className="grid min-w-0 gap-5">
        <TabList
          role="tablist"
          aria-label={t('views')}
          value={view}
          onChange={(v) => setView(v === 'overview' ? null : v, { push: true })}
          hasDivider
        >
          {views.map((v) => (
            <Tab key={v} value={v} label={t(`tabs.${v}`)} panelId={`${panelId}-${v}`} />
          ))}
        </TabList>
        {/* Only the active panel renders its (data-fetching) content; each tab still has its panel. */}
        {views.map((v) => (
          <div
            key={v}
            role="tabpanel"
            id={`${panelId}-${v}`}
            aria-label={t(`tabs.${v}`)}
            hidden={v !== view}
            className="min-w-0"
          >
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
            ) : v === 'updates' ? (
              <UpdatesTab project={project} />
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
          </div>
        ))}
      </div>
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
