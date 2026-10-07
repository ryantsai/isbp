'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
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

type Variant = 'info' | 'success' | 'warning' | 'destructive' | 'muted' | 'secondary' | 'outline';

const PROJECT_STATUS: Record<ProjectStatus, { variant: Variant; icon: LucideIcon }> = {
  proposed: { variant: 'muted', icon: CircleDashedIcon },
  active: { variant: 'info', icon: CircleDotIcon },
  on_hold: { variant: 'warning', icon: CirclePauseIcon },
  completed: { variant: 'success', icon: CircleCheckIcon },
  cancelled: { variant: 'muted', icon: CircleSlashIcon },
};

export function ProjectStatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const t = useTranslations('projects.projectStatus');
  const s = PROJECT_STATUS[status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} className={className}>
      <Icon aria-hidden />
      {t(status)}
    </Badge>
  );
}

const HEALTH: Record<ProjectHealth, { icon: LucideIcon; text: string; bg: string }> = {
  on_track: { icon: CircleCheckIcon, text: 'text-success', bg: 'bg-success/12' },
  at_risk: { icon: TriangleAlertIcon, text: 'text-warning-foreground', bg: 'bg-warning/15' },
  off_track: { icon: CircleXIcon, text: 'text-destructive', bg: 'bg-destructive/10 dark:bg-destructive/20' },
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
  const Icon = h.icon;
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap',
        plain ? h.text : cn('rounded-md px-2 py-0.5', h.bg, h.text),
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(health)}
    </span>
  );
}

const TASK_STATUS: Record<TaskStatus, { variant: Variant; icon: LucideIcon }> = {
  backlog: { variant: 'muted', icon: CircleDashedIcon },
  todo: { variant: 'secondary', icon: CircleIcon },
  in_progress: { variant: 'info', icon: CircleDotIcon },
  in_review: { variant: 'warning', icon: EyeIcon },
  done: { variant: 'success', icon: CircleCheckIcon },
  cancelled: { variant: 'muted', icon: CircleSlashIcon },
};

export function TaskStatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const Icon = TASK_STATUS[status].icon;
  return <Icon className={cn('size-4 shrink-0', className)} aria-hidden />;
}

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const t = useTranslations('projects.taskStatus');
  const s = TASK_STATUS[status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} className={className}>
      <Icon aria-hidden />
      {t(status)}
    </Badge>
  );
}

const PRIORITY: Record<TaskPriority, { icon: LucideIcon; className: string }> = {
  urgent: { icon: ChevronsUpIcon, className: 'text-destructive' },
  high: { icon: ChevronUpIcon, className: 'text-warning-foreground' },
  medium: { icon: EqualIcon, className: 'text-muted-foreground' },
  low: { icon: ChevronDownIcon, className: 'text-muted-foreground' },
};

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
  const Icon = p.icon;
  if (compact && (priority === 'medium' || priority === 'low')) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', p.className, className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {t(priority)}
    </span>
  );
}

const TYPE: Record<TaskType, { icon: LucideIcon; className: string }> = {
  epic: { icon: MountainIcon, className: 'text-[oklch(0.5_0.16_300)] dark:text-[oklch(0.78_0.12_300)]' },
  feature: { icon: PuzzleIcon, className: 'text-[oklch(0.5_0.13_250)] dark:text-[oklch(0.78_0.1_250)]' },
  story: { icon: BookmarkIcon, className: 'text-success' },
  task: { icon: SquareCheckIcon, className: 'text-info' },
  bug: { icon: BugIcon, className: 'text-destructive' },
};

/** Work item type icon with an accessible name (the visible label sits next to it elsewhere). */
export function TaskTypeIcon({
  type,
  className,
  label = true,
}: {
  type: TaskType;
  className?: string;
  label?: boolean;
}) {
  const t = useTranslations('projects.taskType');
  const ty = TYPE[type];
  const Icon = ty.icon;
  return label ? (
    <Icon className={cn('size-4 shrink-0', ty.className, className)} role="img" aria-label={t(type)} />
  ) : (
    <Icon className={cn('size-4 shrink-0', ty.className, className)} aria-hidden />
  );
}

export function KeyBadge({ projectKey, className }: { projectKey: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-mono tracking-wide', className)}>
      {projectKey}
    </Badge>
  );
}

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const t = useTranslations('projects.visibility');
  if (visibility === 'internal') return null;
  return (
    <Badge variant="muted">
      <LockIcon aria-hidden />
      {t(visibility)}
    </Badge>
  );
}

/** A due date; overdue open work shows in destructive text with an icon and an "Overdue" label. */
export function DueDate({
  date,
  status,
  today,
  className,
  long,
}: {
  date: string | null;
  status?: TaskStatus;
  today: string;
  className?: string;
  long?: boolean;
}) {
  const t = useTranslations('projects.due');
  const format = useFormatter();
  if (!date) return null;
  const overdue = date < today && (!status || !isClosed(status));
  const text = format.dateTime(
    dateValue(date),
    long ? { dateStyle: 'medium' } : { month: 'short', day: 'numeric' },
  );
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs whitespace-nowrap',
        overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {overdue && <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />}
      <time dateTime={date}>{text}</time>
      {overdue && <span className="sr-only">{t('overdue')}</span>}
    </span>
  );
}

/** Accessible progress bar ("18 of 42 tasks done"). */
export function ProgressBar({
  value,
  label,
  className,
  tone = 'primary',
}: {
  value: number;
  label: string;
  className?: string;
  tone?: 'primary' | 'success';
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-out',
          tone === 'success' ? 'bg-success' : 'bg-primary',
        )}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
