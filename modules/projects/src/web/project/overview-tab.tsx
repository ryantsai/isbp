'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Markdown } from '@isbp/ui/markdown';
import { AnimatedNumber, Stagger, StaggerItem } from '@isbp/ui/motion';
import { RelativeTime } from '@isbp/ui/relative-time';
import {
  BanIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  DiamondIcon,
  type LucideIcon,
  PencilIcon,
  SettingsIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { BOARD_COLUMNS, type ProjectDetail, type TaskStatus } from '../../contracts';
import { HealthBadge, ProgressBar, ProjectStatusBadge, TaskStatusIcon } from '../components/badges';
import { CustomFieldsCard } from '../components/custom-fields';
import { dateValue, projectApi } from '../lib';
import { ApprovalCard } from './approval-card';
import { HealthDialog } from './dialogs';

const STATUS_COLOR: Record<TaskStatus, string> = {
  backlog: 'bg-muted-foreground/30',
  todo: 'bg-muted-foreground/60',
  in_progress: 'bg-info',
  in_review: 'bg-warning',
  done: 'bg-success',
  cancelled: 'bg-muted',
};

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: 'destructive' | 'warning' | 'success';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-4 py-3 shadow-xs">
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            tone === 'destructive' && value > 0 && 'text-destructive',
            tone === 'warning' && value > 0 && 'text-warning-foreground',
            tone === 'success' && 'text-success',
          )}
          aria-hidden
        />
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          'text-2xl font-semibold tracking-tight',
          tone === 'destructive' && value > 0 && 'text-destructive',
        )}
      >
        <AnimatedNumber value={value} />
      </span>
    </div>
  );
}

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
  const history = project.updates.slice(0, 6);
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
          <HealthBadge health={project.health} className="text-sm" />
          {project.healthNote ? (
            <p className="text-sm leading-relaxed wrap-anywhere">{project.healthNote}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noHealthNote')}</p>
          )}
        </div>
        {history.length > 0 && (
          <section className="grid gap-2 border-t pt-3">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('history')}
            </h3>
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
                      {u.author?.displayName ?? t('system')} · <RelativeTime date={u.createdAt} />
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

function MilestonesCard({ project, onManage }: { project: ProjectDetail; onManage: () => void }) {
  const t = useTranslations('projects.overview');
  const format = useFormatter();
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('milestones')}</CardTitle>
        {project.viewer.canManage && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={onManage}>
              <SettingsIcon />
              {t('manage')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {project.milestones.length ? (
          <ol className="grid gap-4">
            {project.milestones.map((m) => {
              const pct = m.taskCount ? (m.doneCount / m.taskCount) * 100 : m.status === 'done' ? 100 : 0;
              return (
                <li key={m.id} className="grid gap-1.5">
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
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noMilestones')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MembersCard({ project, onManage }: { project: ProjectDetail; onManage: () => void }) {
  const t = useTranslations('projects.overview');
  const tr = useTranslations('projects.roles');
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('members', { count: project.members.length })}</CardTitle>
        {project.viewer.canManage && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={onManage}>
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

export function OverviewTab({ project, onManage }: { project: ProjectDetail; onManage: () => void }) {
  const t = useTranslations('projects.overview');
  const record = { type: 'projects.project', id: project.id };
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <div className="grid min-w-0 gap-6 lg:col-span-2">
        <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StaggerItem className="min-w-0">
            <Kpi icon={CircleDotIcon} label={t('kpi.open')} value={project.kpis.open} />
          </StaggerItem>
          <StaggerItem className="min-w-0">
            <Kpi
              icon={CircleAlertIcon}
              label={t('kpi.overdue')}
              value={project.kpis.overdue}
              tone="destructive"
            />
          </StaggerItem>
          <StaggerItem className="min-w-0">
            <Kpi
              icon={CircleCheckIcon}
              label={t('kpi.doneThisWeek')}
              value={project.kpis.doneThisWeek}
              tone="success"
            />
          </StaggerItem>
          <StaggerItem className="min-w-0">
            <Kpi icon={BanIcon} label={t('kpi.blocked')} value={project.kpis.blocked} tone="warning" />
          </StaggerItem>
        </Stagger>
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
        <StatusBreakdown project={project} />
        <MilestonesCard project={project} onManage={onManage} />
      </div>
      <div className="grid min-w-0 gap-6">
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
