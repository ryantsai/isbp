'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card as SurfaceCard } from '@astryxdesign/core/Card';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { IconTile } from '@isbp/ui/icon-tile';
import { Markdown } from '@isbp/ui/markdown';
import { Meter } from '@isbp/ui/meter';
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
import { HealthBadge, ProjectHealthBadge, ProjectStatusBadge, TaskStatusIcon } from '../components/badges';
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
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {[...BOARD_COLUMNS, 'cancelled' as const].map((s) => (
            <div key={s} className="flex min-w-0 items-center gap-2">
              <span className={cn('size-2.5 shrink-0 rounded-full', STATUS_COLOR[s])} aria-hidden />
              <dt className="flex min-w-0 items-center gap-1.5">
                <TaskStatusIcon status={s} />
                <Text type="supporting" maxLines={1}>
                  {ts(s)}
                </Text>
              </dt>
              <dd className="ml-auto">
                <Text weight="medium" hasTabularNumbers>
                  {project.taskCounts[s]}
                </Text>
              </dd>
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
            <Button
              label={t('updateHealth')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={PencilIcon} />}
              onClick={() => setEditing(true)}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        <VStack gap={2}>
          <ProjectHealthBadge project={project} />
          {project.healthNote ? (
            <span className="wrap-anywhere">
              <Text>{project.healthNote}</Text>
            </span>
          ) : (
            <Text type="supporting">{t('noHealthNote')}</Text>
          )}
          <Link href={`${projectHref(project.key)}?view=updates`} color="primary">
            {t('statusUpdates')}
          </Link>
        </VStack>
        {history.length > 0 && (
          <section className="grid gap-2 border-t pt-3">
            <Heading level={3}>{t('history')}</Heading>
            <ol className="grid gap-2.5">
              {history.map((u) => (
                <li key={u.id} className="grid gap-0.5">
                  <HStack as="span" gap={2} vAlign="center" wrap="wrap">
                    {u.kind === 'health' ? (
                      <HealthBadge health={u.to as ProjectDetail['health']} plain />
                    ) : (
                      <ProjectStatusBadge status={u.to as ProjectDetail['status']} />
                    )}
                    <Text type="supporting">
                      {u.author?.displayName ?? u.authorName ?? t('system')} ·{' '}
                      {u.via && (
                        <>
                          <Via via={u.via} /> ·{' '}
                        </>
                      )}
                      <RelativeTime date={u.createdAt} />
                    </Text>
                  </HStack>
                  {u.note && (
                    <span className="wrap-anywhere">
                      <Text type="supporting">{u.note}</Text>
                    </span>
                  )}
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
            <Button
              label={t('addMilestone')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => onAdding(!adding)}
              aria-expanded={adding}
            />
            {project.milestones.length > 0 && (
              <Button
                label={t('manage')}
                variant="ghost"
                size="sm"
                icon={<Icon icon={SettingsIcon} />}
                onClick={() => onManage('milestones')}
              />
            )}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {canManage && (
          <Collapse open={adding}>
            <SurfaceCard variant="muted" padding={3}>
              <AddMilestoneForm project={project} autoFocus={adding} />
            </SurfaceCard>
          </Collapse>
        )}
        {project.milestones.length ? (
          <AnimatedList as="ol" className="grid">
            {project.milestones.map((m) => {
              const pct = m.taskCount ? (m.doneCount / m.taskCount) * 100 : m.status === 'done' ? 100 : 0;
              return (
                <AnimatedItem as="li" key={m.id} className="grid gap-1.5 pb-4 last:pb-0">
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Icon icon={DiamondIcon} size="xsm" color={m.status === 'done' ? 'success' : 'accent'} />
                    <span className="min-w-0 truncate">
                      <Text weight="medium">{m.name}</Text>
                    </span>
                    {m.status === 'done' && (
                      <Badge
                        variant="success"
                        label={t('milestoneDone')}
                        icon={<Icon icon={CircleCheckIcon} size="xsm" />}
                      />
                    )}
                    {m.dueDate && (
                      <span className="ml-auto">
                        <Text type="supporting">
                          {format.dateTime(dateValue(m.dueDate), { dateStyle: 'medium' })}
                        </Text>
                      </span>
                    )}
                  </HStack>
                  <Meter
                    kind="progress"
                    size="sm"
                    value={pct}
                    tone={m.status === 'done' ? 'success' : 'primary'}
                    label={t('milestoneProgress', { name: m.name, done: m.doneCount, total: m.taskCount })}
                  />
                  <Text type="supporting">{t('doneOf', { done: m.doneCount, total: m.taskCount })}</Text>
                </AnimatedItem>
              );
            })}
          </AnimatedList>
        ) : (
          !adding && <Text type="supporting">{t('noMilestones')}</Text>
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
            <Button
              label={t('manage')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={SettingsIcon} />}
              onClick={() => onManage('members')}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2.5">
          {project.members.map((m) => (
            <li key={m.userId}>
              <HStack gap={2} vAlign="center" className="min-w-0">
                <UserAvatar name={m.displayName} src={m.avatarUrl} className="size-7 text-[10px]" />
                <StackItem size="fill" className="min-w-0">
                  <VStack>
                    <Text
                      weight="medium"
                      maxLines={1}
                      color={m.active ? 'primary' : 'secondary'}
                      hasStrikethrough={!m.active}
                    >
                      {m.displayName}
                    </Text>
                    <Text type="supporting" maxLines={1}>
                      {tr(m.role)}
                      {m.isOwner && ` · ${t('owner')}`}
                    </Text>
                    {m.via && (
                      <span title={ts('addedVia', { system: m.via.connection, reference: m.via.ref })}>
                        <Text type="supporting" maxLines={1}>
                          {ts('addedFrom', { system: m.via.connection })}
                        </Text>
                      </span>
                    )}
                  </VStack>
                </StackItem>
                {m.role !== 'viewer' && (
                  <Text type="supporting" hasTabularNumbers>
                    {t('allocation', { pct: m.allocationPct })}
                  </Text>
                )}
              </HStack>
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
        <Button
          label={t('addMilestone')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          onClick={onAddMilestone}
        />
      ) : undefined,
    },
    {
      id: 'tasks',
      done: project.totalTasks > 0,
      label: t('tasks'),
      hint: t('tasksHint'),
      action: v.canEditTasks ? (
        <Button
          label={t('newTask')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          onClick={onNewTask}
        />
      ) : undefined,
    },
    {
      id: 'members',
      done: project.members.length > 1,
      label: t('members'),
      hint: t('membersHint'),
      action: v.canManage ? (
        <Button
          label={t('addMembers')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={UserPlusIcon} />}
          onClick={() => onManage('members')}
        />
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
              <Button
                label={starter.label}
                variant="primary"
                size="sm"
                icon={<Icon icon={starter.needsApproval ? SendIcon : PlayIcon} />}
                onClick={starter.open}
              />
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
              <IconTile
                size="xs"
                variant="outline"
                className={s.done ? 'text-success' : 'text-muted-foreground'}
              >
                {s.done ? <SuccessMark label={t('done')} /> : <CircleIcon aria-hidden />}
              </IconTile>
              <VStack gap={0.5} className="min-w-0 flex-1">
                <Text weight="medium" hasStrikethrough={s.done} color={s.done ? 'secondary' : 'primary'}>
                  {s.label}
                </Text>
                {!s.done && <Text type="supporting">{s.hint}</Text>}
              </VStack>
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
              <Text type="supporting">{t('noDescription')}</Text>
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
