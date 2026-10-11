'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { cn } from '@isbp/ui';
import { StatusBadge, type StatusIcon, type StatusTone } from '@isbp/ui/status';
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

export type Tone = Exclude<StatusTone, 'neutral'>;

/** Tailwind text classes for a tone: the `tone` of a `RunTimeline` step (`@isbp/ui/run-detail`) takes a class. */
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

/** The spinner of a running run as a badge icon (a module-level component, so it keeps its identity). */
const SpinningLoader: StatusIcon = ({ className, ...props }) => (
  <LoaderCircleIcon {...props} className={cn(className, 'motion-safe:animate-spin')} />
);

/** Icon + text + tone: a run's status is never shown by colour alone. */
export function RunStatusBadge({
  status,
  skipReason,
}: {
  status: RunStatus;
  skipReason?: SkipReason | null;
}) {
  const label = useStatusLabel();
  const meta = RUN_STATUS[status];
  return (
    <StatusBadge
      tone={meta.tone}
      icon={meta.spin ? SpinningLoader : meta.icon}
      label={label(status, skipReason)}
    />
  );
}

const ICON_COLOR = {
  info: 'accent',
  primary: 'accent',
  warning: 'warning',
  success: 'success',
  muted: 'secondary',
  destructive: 'error',
} as const;

/** Compact status for dense lists: the icon carries the status colour, the text follows its surroundings. */
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
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <Icon
        icon={meta.icon}
        size="xsm"
        color={ICON_COLOR[meta.tone]}
        className={cn(meta.spin && 'motion-safe:animate-spin')}
      />
      <Text type="inherit" weight="medium" maxLines={1}>
        {label(status, skipReason)}
      </Text>
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
  if (enabled) return <StatusBadge tone="success" icon={CirclePlayIcon} label={t('enabled')} />;
  if (disabledReason === 'auto')
    return <StatusBadge tone="warning" icon={CircleAlertIcon} label={t('autoDisabled')} />;
  return <StatusBadge tone="muted" icon={CirclePauseIcon} label={t('disabled')} />;
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

export function RunTriggerLabel({ trigger }: { trigger: RunTrigger }) {
  const t = useTranslations('scheduler.runTrigger');
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon icon={RUN_TRIGGER_ICON[trigger]} size="xsm" color="secondary" />
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
export function TaskIcon({
  icon,
  color,
}: {
  icon: string | null | undefined;
  color?: 'accent' | 'secondary';
}) {
  return <Icon icon={(icon && TASK_ICONS[icon]) || BlocksIcon} color={color} />;
}

export const LOG_LEVEL: Record<LogLevel, { icon: LucideIcon; tone: Tone }> = {
  info: { icon: InfoIcon, tone: 'info' },
  warn: { icon: TriangleAlertIcon, tone: 'warning' },
  error: { icon: CircleXIcon, tone: 'destructive' },
};
