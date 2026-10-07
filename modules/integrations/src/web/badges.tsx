'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowUpFromLineIcon,
  BanIcon,
  CalendarClockIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CirclePauseIcon,
  CircleXIcon,
  ClockIcon,
  GitCompareArrowsIcon,
  HandIcon,
  HourglassIcon,
  InfoIcon,
  LinkIcon,
  LoaderCircleIcon,
  type LucideIcon,
  LockOpenIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UnlinkIcon,
  WebhookIcon,
  ZapIcon,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { useTranslations } from 'next-intl';
import type {
  ConflictStatus,
  Direction,
  Health,
  LinkState,
  LogLevel,
  RunKind,
  RunStatus,
  RunTrigger,
} from '../contracts';

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

interface Meta {
  icon: LucideIcon;
  tone: Tone;
  spin?: boolean;
}

/** Icon + text + tone, never colour alone. */
export function ToneBadge({ meta, label, className }: { meta: Meta; label: string; className?: string }) {
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn(TONE[meta.tone], className)}>
      <Icon aria-hidden className={cn(meta.spin && 'motion-safe:animate-spin')} />
      {label}
    </Badge>
  );
}

/** Compact status for dense rows: icon and text in the status colour. */
export function ToneText({ meta, label, className }: { meta: Meta; label: string; className?: string }) {
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
      <span className="truncate">{label}</span>
    </span>
  );
}

export const HEALTH: Record<Health, Meta> = {
  ok: { icon: CircleCheckIcon, tone: 'success' },
  failing: { icon: CircleXIcon, tone: 'destructive' },
  unknown: { icon: CircleHelpIcon, tone: 'muted' },
};

export function HealthBadge({ health, enabled = true }: { health: Health; enabled?: boolean }) {
  const t = useTranslations('integrations');
  if (!enabled)
    return <ToneBadge meta={{ icon: CirclePauseIcon, tone: 'muted' }} label={t('common.disabled')} />;
  return <ToneBadge meta={HEALTH[health]} label={t(`health.${health}`)} />;
}

/** "Not encrypted": the connection allows plain HTTP. */
export function InsecureBadge({ className }: { className?: string }) {
  const t = useTranslations('integrations.security');
  return (
    <ToneBadge meta={{ icon: LockOpenIcon, tone: 'warning' }} label={t('badge')} className={className} />
  );
}

export const RUN_STATUS: Record<RunStatus, Meta> = {
  queued: { icon: ClockIcon, tone: 'muted' },
  running: { icon: LoaderCircleIcon, tone: 'info', spin: true },
  waiting: { icon: HourglassIcon, tone: 'warning' },
  succeeded: { icon: CircleCheckIcon, tone: 'success' },
  partial: { icon: TriangleAlertIcon, tone: 'warning' },
  failed: { icon: CircleXIcon, tone: 'destructive' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const t = useTranslations('integrations.runStatus');
  return <ToneBadge meta={RUN_STATUS[status]} label={t(status)} />;
}

export function RunStatusText({ status }: { status: RunStatus }) {
  const t = useTranslations('integrations.runStatus');
  return <ToneText meta={RUN_STATUS[status]} label={t(status)} />;
}

const TRIGGER_ICON: Record<RunTrigger, LucideIcon> = {
  schedule: CalendarClockIcon,
  manual: HandIcon,
  webhook: WebhookIcon,
  event: ZapIcon,
};

const KIND_ICON: Record<RunKind, LucideIcon> = {
  pull: ArrowDownToLineIcon,
  push: ArrowUpFromLineIcon,
  webhook: WebhookIcon,
  resync: RefreshCwIcon,
  export: ArrowUpFromLineIcon,
};

export function TriggerLabel({ trigger, className }: { trigger: RunTrigger; className?: string }) {
  const t = useTranslations('integrations.runTrigger');
  const Icon = TRIGGER_ICON[trigger];
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      {t(trigger)}
    </span>
  );
}

export function KindLabel({ kind, className }: { kind: RunKind; className?: string }) {
  const t = useTranslations('integrations.runKind');
  const Icon = KIND_ICON[kind];
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      {t(kind)}
    </span>
  );
}

export const LINK_STATE: Record<LinkState, Meta> = {
  ok: { icon: LinkIcon, tone: 'success' },
  conflict: { icon: GitCompareArrowsIcon, tone: 'warning' },
  error: { icon: CircleAlertIcon, tone: 'destructive' },
  orphaned: { icon: UnlinkIcon, tone: 'muted' },
};

export function LinkStateBadge({ state }: { state: LinkState }) {
  const t = useTranslations('integrations.linkState');
  return <ToneBadge meta={LINK_STATE[state]} label={t(state)} />;
}

export const CONFLICT_STATUS: Record<ConflictStatus, Meta> = {
  open: { icon: GitCompareArrowsIcon, tone: 'warning' },
  resolved: { icon: CircleCheckIcon, tone: 'success' },
  dismissed: { icon: BanIcon, tone: 'muted' },
};

export function ConflictStatusBadge({ status }: { status: ConflictStatus }) {
  const t = useTranslations('integrations.conflictStatus');
  return <ToneBadge meta={CONFLICT_STATUS[status]} label={t(status)} />;
}

export const DIRECTION_ICON: Record<Direction, LucideIcon> = {
  pull: ArrowDownToLineIcon,
  push: ArrowUpFromLineIcon,
  both: ArrowLeftRightIcon,
};

export const LOG_LEVEL: Record<LogLevel, Meta> = {
  info: { icon: InfoIcon, tone: 'info' },
  warn: { icon: TriangleAlertIcon, tone: 'warning' },
  error: { icon: CircleXIcon, tone: 'destructive' },
};

export const PENDING: Meta = { icon: CircleDashedIcon, tone: 'muted' };

/** A connector's or entity's lucide icon (from its manifest), with a generic fallback. */
export function ModuleIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  if (!name) return <ArrowLeftRightIcon aria-hidden className={className} />;
  return (
    <DynamicIcon
      name={name as IconName}
      aria-hidden
      className={className}
      fallback={() => <ArrowLeftRightIcon aria-hidden className={className} />}
    />
  );
}
