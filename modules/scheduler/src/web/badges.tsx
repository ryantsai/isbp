'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import {
  BanIcon,
  BlocksIcon,
  CalendarClockIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  CircleXIcon,
  ClipboardCheckIcon,
  ClockIcon,
  DatabaseIcon,
  GitMergeIcon,
  GlobeIcon,
  HandIcon,
  InfoIcon,
  LoaderCircleIcon,
  type LucideIcon,
  RefreshCwIcon,
  RepeatIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  SkipForwardIcon,
  SquareTerminalIcon,
  TimerOffIcon,
  TriangleAlertIcon,
  WorkflowIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { LogLevel, RunStatus, RunTrigger, SkipReason, TriggerKind } from '../contracts';

export type Tone = 'info' | 'primary' | 'warning' | 'success' | 'muted' | 'destructive';

/** Tone classes tuned for AA on their own tints (the platform's status tokens). */
export const TONE: Record<Tone, string> = {
  info: 'border-transparent bg-info/12 text-info',
  primary: 'border-transparent bg-primary/10 text-primary',
  warning: 'border-transparent bg-warning/15 text-warning-foreground',
  success: 'border-transparent bg-success/12 text-success',
  muted: 'border-transparent bg-muted text-muted-foreground',
  destructive: 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20',
};

export const TEXT_TONE: Record<Tone, string> = {
  info: 'text-info',
  primary: 'text-primary',
  warning: 'text-warning-foreground',
  success: 'text-success',
  muted: 'text-muted-foreground',
  destructive: 'text-destructive',
};

export const RUN_STATUS: Record<RunStatus, { icon: LucideIcon; tone: Tone; spin?: boolean }> = {
  queued: { icon: ClockIcon, tone: 'muted' },
  running: { icon: LoaderCircleIcon, tone: 'info', spin: true },
  retrying: { icon: RotateCwIcon, tone: 'warning' },
  succeeded: { icon: CircleCheckIcon, tone: 'success' },
  failed: { icon: CircleXIcon, tone: 'destructive' },
  timed_out: { icon: TimerOffIcon, tone: 'destructive' },
  cancelled: { icon: BanIcon, tone: 'muted' },
  skipped: { icon: SkipForwardIcon, tone: 'muted' },
};

function useStatusLabel() {
  const t = useTranslations('scheduler');
  return (status: RunStatus, skipReason?: SkipReason | null) =>
    status === 'skipped' && skipReason
      ? t('runStatus.skippedBecause', { reason: skipReason })
      : t(`runStatus.${status}`);
}

/** Icon + text + tone: a run's status is never shown by colour alone. */
export function RunStatusBadge({
  status,
  skipReason,
  className,
}: {
  status: RunStatus;
  skipReason?: SkipReason | null;
  className?: string;
}) {
  const label = useStatusLabel();
  const meta = RUN_STATUS[status];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn(TONE[meta.tone], className)}>
      <Icon aria-hidden className={cn(meta.spin && 'motion-safe:animate-spin')} />
      {label(status, skipReason)}
    </Badge>
  );
}

/** Compact status for dense lists: icon and text in the status colour. */
export function RunStatusText({
  status,
  skipReason,
  className,
}: {
  status: RunStatus;
  skipReason?: SkipReason | null;
  className?: string;
}) {
  const label = useStatusLabel();
  const meta = RUN_STATUS[status];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1 text-xs font-medium',
        TEXT_TONE[meta.tone],
        className,
      )}
    >
      <Icon aria-hidden className={cn('size-3.5 shrink-0', meta.spin && 'motion-safe:animate-spin')} />
      <span className="truncate">{label(status, skipReason)}</span>
    </span>
  );
}

/** Enabled / disabled / disabled automatically after failures. */
export function JobStateBadge({
  enabled,
  disabledReason,
}: {
  enabled: boolean;
  disabledReason: string | null;
}) {
  const t = useTranslations('scheduler.jobs');
  if (enabled)
    return (
      <Badge variant="outline" className={TONE.success}>
        <CirclePlayIcon aria-hidden />
        {t('enabled')}
      </Badge>
    );
  if (disabledReason === 'auto')
    return (
      <Badge variant="outline" className={TONE.warning}>
        <CircleAlertIcon aria-hidden />
        {t('autoDisabled')}
      </Badge>
    );
  return (
    <Badge variant="outline" className={TONE.muted}>
      <CirclePauseIcon aria-hidden />
      {t('disabled')}
    </Badge>
  );
}

export const TRIGGER_ICON: Record<TriggerKind, LucideIcon> = {
  cron: CalendarClockIcon,
  interval: RepeatIcon,
  after: GitMergeIcon,
  manual: HandIcon,
};

const RUN_TRIGGER_ICON: Record<RunTrigger, LucideIcon> = {
  schedule: CalendarClockIcon,
  manual: HandIcon,
  dependency: GitMergeIcon,
  retry: RotateCwIcon,
};

export function RunTriggerLabel({ trigger, className }: { trigger: RunTrigger; className?: string }) {
  const t = useTranslations('scheduler.runTrigger');
  const Icon = RUN_TRIGGER_ICON[trigger];
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      {t(trigger)}
    </span>
  );
}

const TASK_ICONS: Record<string, LucideIcon> = {
  globe: GlobeIcon,
  database: DatabaseIcon,
  'square-terminal': SquareTerminalIcon,
  terminal: SquareTerminalIcon,
  workflow: WorkflowIcon,
  'refresh-cw': RefreshCwIcon,
  'shield-check': ShieldCheckIcon,
  'git-merge': GitMergeIcon,
  'clipboard-check': ClipboardCheckIcon,
};

/** A task type's icon (lucide name from its manifest), with a generic fallback. */
export function TaskIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
  const Icon = (icon && TASK_ICONS[icon]) || BlocksIcon;
  return <Icon aria-hidden className={cn('size-4 shrink-0', className)} />;
}

export const LOG_LEVEL: Record<LogLevel, { icon: LucideIcon; tone: Tone }> = {
  info: { icon: InfoIcon, tone: 'info' },
  warn: { icon: TriangleAlertIcon, tone: 'warning' },
  error: { icon: CircleXIcon, tone: 'destructive' },
};
