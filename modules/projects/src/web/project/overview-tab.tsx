'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Markdown } from '@isbp/ui/markdown';
import { AnimatedItem, AnimatedList, Collapse, SuccessMark } from '@isbp/ui/motion';
import { RelativeTime } from '@isbp/ui/relative-time';
import { StatTile } from '@isbp/ui/stat-tile';
import {
  BanIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  DiamondIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  UserPlusIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { BOARD_COLUMNS, type ProjectDetail, type TaskStatus } from '../../contracts';
import {
  HealthBadge,
  ProgressBar,
  ProjectHealthBadge,
  ProjectStatusBadge,
  TaskStatusIcon,
} from '../components/badges';
import { CustomFieldsCard } from '../components/custom-fields';
import { Via } from '../components/via';
import { dateValue, projectApi, projectHref } from '../lib';
import { ApprovalCard } from './approval-card';
import { HealthDialog } from './dialogs';
import { AddMilestoneForm } from './milestone-form';
import { useStartProject } from './start';

const STATUS_COLOR: Record<TaskStatus, string> = {
  backlog: 'bg-muted-foreground/30',
  todo: 'bg-muted-foreground/60',
  in_progress: 'bg-info',
  in_review: 'bg-warning',
  done: 'bg-success',
  cancelled: 'bg-muted',
};

/** Tasks by status: a stacked bar (decorative) with the same numbers as a list. */
function StatusBreakdown({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.overview');
  const ts = useTranslations('projects.taskStatus');
  const total = BOARD_COLUMNS.reduce((n, s) => n + project.taskCounts[s], 0);
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('byStatus')}</CardTitle>
        <CardDescription>
          {t('doneOf', { done: project.doneTasks, total: project.totalTasks })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          {total > 0 &&
            BOARD_COLUMNS.map((s) =>
              project.taskCounts[s] ? (
                <span
                  key={s}
                  className={cn('h-full', STATUS_COLOR[s])}
                  style={{ width: `${(project.taskCounts[s] / total) * 100}%` }}
                />
              ) : null,
            )}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {[...BOARD_COLUMNS, 'cancelled' as const].map((s) => (
            <div key={s} className="flex min-w-0 items-center gap-2">
              <span className={cn('size-2.5 shrink-0 rounded-full', STATUS_COLOR[s])} aria-hidden />
              <dt className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <TaskStatusIcon status={s} className="size-3.5" />
                <span className="truncate">{ts(s)}</span>
              </dt>
              <dd className="ml-auto font-medium tabular-nums">{project.taskCounts[s]}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function HealthCard({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.overview');
  const th = useTranslations('projects.health');
  const ts = useTranslations('projects.projectStatus');
  const [editing, setEditing] = useState(false);
  // The newest health update is what the card already shows: the history starts from the one before it.
  const first = project.updates[0];
  const repeatsCurrent =
    first?.kind === 'health' &&
    first.to === project.health &&
    (first.note ?? null) === (project.healthNote ?? null);
  const history = project.updates.slice(repeatsCurrent ? 1 : 0, (repeatsCurrent ? 1 : 0) + 6);
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('health')}</CardTitle>
        {project.healthUpdatedAt && (
          <CardDescription>
            {t('updated')} <RelativeTime date={project.healthUpdatedAt} />
          </CardDescription>
        )}
        {project.viewer.canManage && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon />
              {t('updateHealth')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <ProjectHealthBadge project={project} className="text-sm" />
          {project.healthNote ? (
            <p className="text-sm leading-relaxed wrap-anywhere">{project.healthNote}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noHealthNote')}</p>
          )}
        </div>
        {history.length > 0 && (
          <section className="grid gap-2 border-t pt-3">
            <h3 className="text-xs font-semibold text-muted-foreground">{t('history')}</h3>
            <ol className="grid gap-2.5">
              {history.map((u) => (
                <li key={u.id} className="grid gap-0.5 text-sm">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {u.kind === 'health' ? (
                      <HealthBadge health={u.to as ProjectDetail['health']} plain />
                    ) : (
                      <ProjectStatusBadge status={u.to as ProjectDetail['status']} />
                    )}
                    <span className="text-xs text-muted-foreground">
                      {u.author?.displayName ?? u.authorName ?? t('system')} ·{' '}
                      {u.via && (
                        <>
                          <Via via={u.via} /> ·{' '}
                        </>
                      )}
                      <RelativeTime date={u.createdAt} />
                    </span>
                  </span>
                  {u.note && <span className="text-muted-foreground wrap-anywhere">{u.note}</span>}
                  <span className="sr-only">
                    {u.kind === 'health'
                      ? t('healthChange', { from: u.from ? th(u.from as never) : '—', to: th(u.to as never) })
                      : t('statusChange', {
                          from: u.from ? ts(u.from as never) : '—',
                          to: ts(u.to as never),
                        })}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </CardContent>
      {project.viewer.canManage && (
        <HealthDialog project={project} open={editing} onOpenChange={setEditing} />
      )}
    </Card>
  );
}

function MilestonesCard({
  project,
  onManage,
  adding,
  onAdding,
}: {
  project: ProjectDetail;
  onManage: (section: ManageSection) => void;
  adding: boolean;
  onAdding: (open: boolean) => void;
}) {
  const t = useTranslations('projects.overview');
  const format = useFormatter();
  const canManage = project.viewer.canManage && !project.archivedAt;
  return (
    <Card className="min-w-0 gap-4" id="overview-milestones">
      <CardHeader>
        <CardTitle>{t('milestones')}</CardTitle>
        {canManage && (
          <CardAction className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => onAdding(!adding)} aria-expanded={adding}>
              <PlusIcon />
              {t('addMilestone')}
            </Button>
            {project.milestones.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onManage('milestones')}>
                <SettingsIcon />
                {t('manage')}
              </Button>
            )}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {canManage && (
          <Collapse open={adding}>
            <AddMilestoneForm
              project={project}
              autoFocus={adding}
              className="rounded-lg border bg-muted/20 p-3"
            />
          </Collapse>
        )}
        {project.milestones.length ? (
          <AnimatedList as="ol" className="grid">
            {project.milestones.map((m) => {
              const pct = m.taskCount ? (m.doneCount / m.taskCount) * 100 : m.status === 'done' ? 100 : 0;
              return (
                <AnimatedItem as="li" key={m.id} className="grid gap-1.5 pb-4 last:pb-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <DiamondIcon
                      className={cn(
                        'size-3.5 shrink-0',
                        m.status === 'done' ? 'text-success' : 'text-primary',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 truncate font-medium">{m.name}</span>
                    {m.status === 'done' && (
                      <Badge variant="success">
                        <CircleCheckIcon aria-hidden />
                        {t('milestoneDone')}
                      </Badge>
                    )}
                    {m.dueDate && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {format.dateTime(dateValue(m.dueDate), { dateStyle: 'medium' })}
                      </span>
                    )}
                  </div>
                  <ProgressBar
                    value={pct}
                    tone={m.status === 'done' ? 'success' : 'primary'}
                    label={t('milestoneProgress', { name: m.name, done: m.doneCount, total: m.taskCount })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {t('doneOf', { done: m.doneCount, total: m.taskCount })}
                  </span>
                </AnimatedItem>
              );
            })}
          </AnimatedList>
        ) : (
          !adding && <p className="text-sm text-muted-foreground">{t('noMilestones')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MembersCard({
  project,
  onManage,
}: {
  project: ProjectDetail;
  onManage: (section: ManageSection) => void;
}) {
  const t = useTranslations('projects.overview');
  const tr = useTranslations('projects.roles');
  const ts = useTranslations('projects.sync');
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('members', { count: project.members.length })}</CardTitle>
        {project.viewer.canManage && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => onManage('members')}>
              <SettingsIcon />
              {t('manage')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2.5">
          {project.members.map((m) => (
            <li key={m.userId} className="flex min-w-0 items-center gap-2.5 text-sm">
              <UserAvatar name={m.displayName} src={m.avatarUrl} className="size-7 text-[10px]" />
              <span className="grid min-w-0 flex-1">
                <span
                  className={cn('truncate font-medium', !m.active && 'text-muted-foreground line-through')}
                >
                  {m.displayName}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {tr(m.role)}
                  {m.isOwner && ` · ${t('owner')}`}
                </span>
                {m.via && (
                  <span
                    className="truncate text-xs text-muted-foreground"
                    title={ts('addedVia', { system: m.via.connection, reference: m.via.ref })}
                  >
                    {ts('addedFrom', { system: m.via.connection })}
                  </span>
                )}
              </span>
              {m.role !== 'viewer' && (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t('allocation', { pct: m.allocationPct })}
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** What a new project needs, as a checklist that does each step (instead of a page of zeros). */
function GetStarted({
  project,
  onNewTask,
  onManage,
  onAddMilestone,
}: {
  project: ProjectDetail;
  onNewTask: () => void;
  onManage: (section: ManageSection) => void;
  onAddMilestone: () => void;
}) {
  const t = useTranslations('projects.getStarted');
  const starter = useStartProject(project);
  const v = project.viewer;
  const steps: { id: string; done: boolean; label: string; hint: string; action?: ReactNode }[] = [
    {
      id: 'milestones',
      done: project.milestones.length > 0,
      label: t('milestones'),
      hint: t('milestonesHint'),
      action: v.canManage ? (
        <Button size="sm" variant="outline" onClick={onAddMilestone}>
          <PlusIcon /> {t('addMilestone')}
        </Button>
      ) : undefined,
    },
    {
      id: 'tasks',
      done: project.totalTasks > 0,
      label: t('tasks'),
      hint: t('tasksHint'),
      action: v.canEditTasks ? (
        <Button size="sm" variant="outline" onClick={onNewTask}>
          <PlusIcon /> {t('newTask')}
        </Button>
      ) : undefined,
    },
    {
      id: 'members',
      done: project.members.length > 1,
      label: t('members'),
      hint: t('membersHint'),
      action: v.canManage ? (
        <Button size="sm" variant="outline" onClick={() => onManage('members')}>
          <UserPlusIcon /> {t('addMembers')}
        </Button>
      ) : undefined,
    },
    ...(project.status === 'proposed'
      ? [
          {
            id: 'start',
            done: project.approval?.status === 'pending' || project.approval?.status === 'approved',
            label: starter.needsApproval ? t('submit') : t('start'),
            hint: starter.needsApproval ? t('submitHint') : t('startHint'),
            action: v.canStart ? (
              <Button size="sm" onClick={starter.open}>
                {starter.needsApproval ? <SendIcon /> : <PlayIcon />} {starter.label}
              </Button>
            ) : undefined,
          },
        ]
      : []),
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('progress', { done, total: steps.length })}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-1">
          {steps.map((s) => (
            <li key={s.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg px-2 py-2">
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full border transition-colors duration-(--motion-fast) motion-reduce:transition-none',
                  s.done ? 'border-success bg-success/12 text-success' : 'text-muted-foreground',
                )}
              >
                {s.done ? (
                  <SuccessMark className="size-3.5" label={t('done')} />
                ) : (
                  <CircleIcon className="size-3" aria-hidden />
                )}
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className={cn('text-sm font-medium', s.done && 'text-muted-foreground line-through')}>
                  {s.label}
                </span>
                {!s.done && <span className="text-xs text-muted-foreground">{s.hint}</span>}
              </span>
              {!s.done && s.action}
            </li>
          ))}
        </ol>
      </CardContent>
      {starter.dialog}
    </Card>
  );
}

export type ManageSection = 'members' | 'milestones';

export function OverviewTab({
  project,
  onManage,
  onNewTask,
}: {
  project: ProjectDetail;
  onManage: (section: ManageSection) => void;
  onNewTask: () => void;
}) {
  const t = useTranslations('projects.overview');
  const [adding, setAdding] = useState(false);
  const record = { type: 'projects.project', id: project.id };
  // A new project (no tasks yet, or a proposal) gets the Get started checklist; ticked steps stay until all are done.
  const fresh = !project.archivedAt && (project.totalTasks === 0 || project.status === 'proposed');
  const noTasks = project.totalTasks === 0;
  const addMilestone = () => {
    setAdding(true);
    document.getElementById('overview-milestones')?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="grid min-w-0 gap-4 lg:col-span-2">
        {fresh && (
          <GetStarted
            project={project}
            onNewTask={onNewTask}
            onManage={onManage}
            onAddMilestone={addMilestone}
          />
        )}
        {!noTasks && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile icon={<CircleDotIcon />} label={t('kpi.open')} value={project.kpis.open} />
            <StatTile
              icon={<CircleAlertIcon />}
              tone={project.kpis.overdue > 0 ? 'destructive' : 'default'}
              label={t('kpi.overdue')}
              value={project.kpis.overdue}
              href={project.kpis.overdue > 0 ? `${projectHref(project.key)}?view=list&sort=due` : undefined}
            />
            <StatTile
              icon={<CircleCheckIcon />}
              tone="success"
              label={t('kpi.doneThisWeek')}
              value={project.kpis.doneThisWeek}
            />
            <StatTile
              icon={<BanIcon />}
              tone={project.kpis.blocked > 0 ? 'warning' : 'default'}
              label={t('kpi.blocked')}
              value={project.kpis.blocked}
            />
          </div>
        )}
        <Card className="min-w-0 gap-4">
          <CardHeader>
            <CardTitle>{t('description')}</CardTitle>
          </CardHeader>
          <CardContent>
            {project.description ? (
              <Markdown>{project.description}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noDescription')}</p>
            )}
          </CardContent>
        </Card>
        {!noTasks && <StatusBreakdown project={project} />}
        <MilestonesCard project={project} onManage={onManage} adding={adding} onAdding={setAdding} />
      </div>
      <div className="grid min-w-0 gap-4">
        <ApprovalCard project={project} />
        <HealthCard project={project} />
        <MembersCard project={project} onManage={onManage} />
        <CustomFieldsCard
          entity="project"
          path={projectApi(project.key)}
          subtitle={`${project.key} · ${project.name}`}
          attributes={project.attributes}
          canEdit={project.viewer.canManage}
        />
        <Slot name="core.record.links" props={{ record } satisfies RecordPanelSlotProps} />
      </div>
    </div>
  );
}
