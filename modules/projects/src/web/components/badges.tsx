'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { defineStatusMap, MappedStatus, StatusBadge } from '@isbp/ui/status';
import {
  BookmarkIcon,
  BugIcon,
  ChevronDownIcon,
  ChevronsUpIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  CirclePauseIcon,
  CircleSlashIcon,
  CircleXIcon,
  EqualIcon,
  EyeIcon,
  LockIcon,
  type LucideIcon,
  MountainIcon,
  PuzzleIcon,
  SquareCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type {
  ProjectHealth,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
  Visibility,
} from '../../contracts';
import { dateValue, isClosed } from '../lib';

const PROJECT_STATUS = defineStatusMap<ProjectStatus>({
  proposed: { tone: 'muted', icon: CircleDashedIcon, labelKey: 'proposed' },
  active: { tone: 'info', icon: CircleDotIcon, labelKey: 'active' },
  on_hold: { tone: 'warning', icon: CirclePauseIcon, labelKey: 'on_hold' },
  completed: { tone: 'success', icon: CircleCheckIcon, labelKey: 'completed' },
  cancelled: { tone: 'muted', icon: CircleSlashIcon, labelKey: 'cancelled' },
});

export function ProjectStatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const t = useTranslations('projects.projectStatus');
  return (
    <MappedStatus
      map={PROJECT_STATUS}
      value={status}
      t={(key) => t(key as ProjectStatus)}
      className={className}
    />
  );
}

const HEALTH: Record<
  ProjectHealth,
  { icon: LucideIcon; tone: 'success' | 'warning' | 'destructive'; color: 'success' | 'warning' | 'error' }
> = {
  on_track: { icon: CircleCheckIcon, tone: 'success', color: 'success' },
  at_risk: { icon: TriangleAlertIcon, tone: 'warning', color: 'warning' },
  off_track: { icon: CircleXIcon, tone: 'destructive', color: 'error' },
};

/** Health is always icon + text (never colour alone). */
export function HealthBadge({
  health,
  className,
  plain,
}: {
  health: ProjectHealth;
  className?: string;
  /** Text only, without the tinted chip. */
  plain?: boolean;
}) {
  const t = useTranslations('projects.health');
  const h = HEALTH[health];
  if (plain)
    return (
      <HStack gap={1} vAlign="center" className={className}>
        <Icon icon={h.icon} size="xsm" color={h.color} />
        <Text type="supporting" weight="medium">
          {t(health)}
        </Text>
      </HStack>
    );
  return <StatusBadge tone={h.tone} icon={h.icon} label={t(health)} className={className} />;
}

/**
 * A project's health, or "Not assessed yet" for a proposal nobody has assessed (no default "On track" before the
 * work started).
 */
export function ProjectHealthBadge({
  project,
  className,
  plain,
}: {
  project: { status: string; health: ProjectHealth; healthNote: string | null };
  className?: string;
  plain?: boolean;
}) {
  const t = useTranslations('projects.health');
  if (project.status === 'proposed' && !project.healthNote)
    return plain ? (
      <HStack gap={1} vAlign="center" className={className}>
        <Icon icon={CircleDashedIcon} size="xsm" color="secondary" />
        <Text type="supporting" weight="medium">
          {t('notAssessed')}
        </Text>
      </HStack>
    ) : (
      <StatusBadge tone="muted" icon={CircleDashedIcon} label={t('notAssessed')} className={className} />
    );
  return <HealthBadge health={project.health} className={className} plain={plain} />;
}

const TASK_STATUS_ICON: Record<TaskStatus, LucideIcon> = {
  backlog: CircleDashedIcon,
  todo: CircleIcon,
  in_progress: CircleDotIcon,
  in_review: EyeIcon,
  done: CircleCheckIcon,
  cancelled: CircleSlashIcon,
};

const TASK_STATUS = defineStatusMap<TaskStatus>({
  backlog: { tone: 'muted', icon: TASK_STATUS_ICON.backlog, labelKey: 'backlog' },
  todo: { tone: 'muted', icon: TASK_STATUS_ICON.todo, labelKey: 'todo' },
  in_progress: { tone: 'info', icon: TASK_STATUS_ICON.in_progress, labelKey: 'in_progress' },
  in_review: { tone: 'warning', icon: TASK_STATUS_ICON.in_review, labelKey: 'in_review' },
  done: { tone: 'success', icon: TASK_STATUS_ICON.done, labelKey: 'done' },
  cancelled: { tone: 'muted', icon: TASK_STATUS_ICON.cancelled, labelKey: 'cancelled' },
});

export function TaskStatusIcon({ status }: { status: TaskStatus }) {
  return <Icon icon={TASK_STATUS_ICON[status]} size="sm" color="secondary" />;
}

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const t = useTranslations('projects.taskStatus');
  return (
    <MappedStatus map={TASK_STATUS} value={status} t={(key) => t(key as TaskStatus)} className={className} />
  );
}

const PRIORITY: Record<TaskPriority, { icon: LucideIcon; color: 'error' | 'warning' | 'secondary' }> = {
  urgent: { icon: ChevronsUpIcon, color: 'error' },
  high: { icon: ChevronUpIcon, color: 'warning' },
  medium: { icon: EqualIcon, color: 'secondary' },
  low: { icon: ChevronDownIcon, color: 'secondary' },
};

/** The priority's icon alone (for option lists that print the name next to it). */
export function PriorityIcon({ priority }: { priority: TaskPriority }) {
  const p = PRIORITY[priority];
  return <Icon icon={p.icon} size="sm" color={p.color} />;
}

/** Priority as icon + text. `compact` hides the text of medium and low (cards show urgent/high only). */
export function PriorityLabel({
  priority,
  compact,
  className,
}: {
  priority: TaskPriority;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('projects.priority');
  const p = PRIORITY[priority];
  if (compact && (priority === 'medium' || priority === 'low')) return null;
  return (
    <HStack gap={1} vAlign="center" className={className}>
      <Icon icon={p.icon} size="xsm" color={p.color} />
      <Text type="supporting" weight="medium">
        {t(priority)}
      </Text>
    </HStack>
  );
}

const TYPE: Record<TaskType, { icon: LucideIcon; color: 'accent' | 'success' | 'error' | 'secondary' }> = {
  epic: { icon: MountainIcon, color: 'accent' },
  feature: { icon: PuzzleIcon, color: 'accent' },
  story: { icon: BookmarkIcon, color: 'success' },
  task: { icon: SquareCheckIcon, color: 'secondary' },
  bug: { icon: BugIcon, color: 'error' },
};

/** Work item type icon with an accessible name (the visible label sits next to it elsewhere). */
export function TaskTypeIcon({ type, label = true }: { type: TaskType; label?: boolean }) {
  const t = useTranslations('projects.taskType');
  const ty = TYPE[type];
  return <Icon icon={ty.icon} size="sm" color={ty.color} label={label ? t(type) : undefined} />;
}

export function KeyBadge({ projectKey }: { projectKey: string }) {
  return <Badge variant="neutral" label={projectKey} />;
}

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const t = useTranslations('projects.visibility');
  if (visibility === 'internal') return null;
  return <Badge variant="neutral" label={t(visibility)} icon={<Icon icon={LockIcon} size="xsm" />} />;
}

/** A due date; overdue open work shows as an error chip with an icon and an "Overdue" label. */
export function DueDate({
  date,
  status,
  today,
  long,
}: {
  date: string | null;
  status?: TaskStatus;
  today: string;
  long?: boolean;
}) {
  const t = useTranslations('projects.due');
  const format = useFormatter();
  if (!date) return null;
  const overdue = date < today && (!status || !isClosed(status));
  // Dates in another year say which year ("Jan 17, 2027"), not just the day.
  const otherYear = date.slice(0, 4) !== today.slice(0, 4);
  const text = format.dateTime(
    dateValue(date),
    long || otherYear ? { dateStyle: 'medium' } : { month: 'short', day: 'numeric' },
  );
  const body = (
    <>
      <time dateTime={date}>{text}</time>
      {overdue && <span className="sr-only">{t('overdue')}</span>}
    </>
  );
  if (overdue)
    return <Badge variant="error" label={body} icon={<Icon icon={CircleAlertIcon} size="xsm" />} />;
  return (
    <Text type="supporting" className="whitespace-nowrap">
      {body}
    </Text>
  );
}
