'use client';

import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import {
  AlarmClockOffIcon,
  ArchiveIcon,
  BanIcon,
  BugIcon,
  CalendarCheckIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDotIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  ClockAlertIcon,
  ClockIcon,
  FilePenLineIcon,
  GavelIcon,
  GitCompareArrowsIcon,
  HammerIcon,
  type LucideIcon,
  PackageIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  SearchIcon,
  ShieldAlertIcon,
  SirenIcon,
  XCircleIcon,
} from 'lucide-react';
import { useNow, useTranslations } from 'next-intl';
import type { PersonRef, TicketStatus, TicketType } from '../../contracts';
import { useDuration } from '../lib';
import { type SlaState, slaState } from '../logic';

export { slaState };
import type { ChangeType, Risk, SlaMetric, SlaStatus } from '../types';

/* ───────────────────────────── type ───────────────────────────── */

export const TYPE_ICON: Record<TicketType, LucideIcon> = {
  incident: CircleAlertIcon,
  service_request: PackageIcon,
  problem: BugIcon,
  change: GitCompareArrowsIcon,
};

/** The ticket type's icon (decorative unless `label` is set). */
export function TypeIcon({
  type,
  className,
  label,
}: {
  type: TicketType;
  className?: string;
  label?: boolean;
}) {
  const t = useTranslations('itsm.types');
  const Icon = TYPE_ICON[type];
  return label ? (
    <Icon className={cn('size-4 shrink-0', className)} role="img" aria-label={t(type)} />
  ) : (
    <Icon className={cn('size-4 shrink-0', className)} aria-hidden />
  );
}

/* ───────────────────────────── status ───────────────────────────── */

type Tone = 'info' | 'primary' | 'warning' | 'success' | 'muted' | 'destructive';

const STATUS: Record<TicketStatus, { tone: Tone; icon: LucideIcon }> = {
  new: { tone: 'info', icon: CircleDotIcon },
  pending_approval: { tone: 'warning', icon: ClockIcon },
  in_progress: { tone: 'primary', icon: PlayCircleIcon },
  on_hold: { tone: 'warning', icon: PauseCircleIcon },
  resolved: { tone: 'success', icon: CheckCircle2Icon },
  fulfilled: { tone: 'success', icon: CheckCircle2Icon },
  closed: { tone: 'muted', icon: ArchiveIcon },
  cancelled: { tone: 'muted', icon: BanIcon },
  investigating: { tone: 'primary', icon: SearchIcon },
  known_error: { tone: 'warning', icon: BugIcon },
  draft: { tone: 'muted', icon: FilePenLineIcon },
  assessment: { tone: 'info', icon: ClipboardCheckIcon },
  authorization: { tone: 'warning', icon: GavelIcon },
  scheduled: { tone: 'info', icon: CalendarCheckIcon },
  implementing: { tone: 'primary', icon: HammerIcon },
  review: { tone: 'info', icon: ClipboardListIcon },
  rejected: { tone: 'destructive', icon: XCircleIcon },
};

const TONE: Record<Tone, string> = {
  info: 'border-transparent bg-info/12 text-info',
  primary: 'border-transparent bg-primary/10 text-primary',
  warning: 'border-transparent bg-warning/15 text-warning-foreground',
  success: 'border-transparent bg-success/12 text-success',
  muted: 'border-transparent bg-muted text-muted-foreground',
  destructive: 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20',
};

export function statusIcon(status: TicketStatus): LucideIcon {
  return STATUS[status]?.icon ?? CircleDotIcon;
}

/** Ticket status: icon + text + tone (never colour alone). */
export function TicketStatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const t = useTranslations('itsm.status');
  const s = STATUS[status] ?? { tone: 'muted' as const, icon: CircleDotIcon };
  const Icon = s.icon;
  return (
    <Badge variant="outline" className={cn(TONE[s.tone], className)}>
      <Icon aria-hidden />
      {t.has(status) ? t(status) : status}
    </Badge>
  );
}

/* ───────────────────────────── priority ───────────────────────────── */

const PRIORITY_DOT: Record<number, string> = {
  1: 'bg-destructive',
  2: 'bg-warning',
  3: 'bg-info',
  4: 'bg-muted-foreground/60',
};

/** P1–P4: a coloured dot **and** the text. `long` shows "P1 · Critical". */
export function PriorityBadge({
  priority,
  long,
  className,
}: {
  priority: number;
  long?: boolean;
  className?: string;
}) {
  const t = useTranslations('itsm');
  const key = String(priority);
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 font-medium',
        priority === 1 && 'border-destructive/30 bg-destructive/10 text-destructive dark:bg-destructive/20',
        className,
      )}
      title={t(`priority.${key}`)}
    >
      <span className={cn('size-2 rounded-full', PRIORITY_DOT[priority])} aria-hidden />
      {long ? (
        t(`priority.${key}`)
      ) : (
        <>
          <span aria-hidden>{t(`priorityShort.${key}`)}</span>
          <span className="sr-only">{t(`priority.${key}`)}</span>
        </>
      )}
    </Badge>
  );
}

/* ───────────────────────────── SLA ───────────────────────────── */

const SLA_STYLE: Record<SlaState, { icon: LucideIcon; className: string }> = {
  breached: {
    icon: AlarmClockOffIcon,
    className: 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20',
  },
  at_risk: { icon: ClockAlertIcon, className: 'border-transparent bg-warning/15 text-warning-foreground' },
  running: { icon: ClockIcon, className: 'text-muted-foreground' },
  paused: { icon: PauseCircleIcon, className: 'border-transparent bg-muted text-muted-foreground' },
  met: { icon: CheckCircle2Icon, className: 'border-transparent bg-success/12 text-success' },
  cancelled: { icon: BanIcon, className: 'border-transparent bg-muted text-muted-foreground' },
};

/**
 * "2h 10m left" / "Breached 3h ago" — icon + text, coloured by state, re-rendered every minute.
 * The metric is spelled out for screen readers (and in the tooltip).
 */
export function SlaChip({
  sla,
  warnAt,
  showMetric,
  className,
}: {
  sla: { metric: SlaMetric; status: SlaStatus; dueAt: string; elapsedRatio: number } | null | undefined;
  warnAt?: number;
  showMetric?: boolean;
  className?: string;
}) {
  const t = useTranslations('itsm');
  const now = useNow({ updateInterval: 60_000 });
  const duration = useDuration();
  if (!sla) return <span className="text-muted-foreground">—</span>;
  const state = slaState(sla, now, warnAt);
  const { icon: Icon, className: tone } = SLA_STYLE[state];
  const left = new Date(sla.dueAt).getTime() - now.getTime();
  const text =
    state === 'breached'
      ? t('common.sla.breachedAgo', { time: duration(left) })
      : state === 'running' || state === 'at_risk'
        ? t('common.sla.left', { time: duration(left) })
        : t(`slaStatus.${state}`);
  const metric = t(`slaMetric.${sla.metric}`);
  return (
    <Badge variant="outline" className={cn('tabular-nums', tone, className)} title={`${metric}: ${text}`}>
      <Icon aria-hidden />
      {showMetric ? <span>{metric} ·</span> : <span className="sr-only">{metric}: </span>}
      {text}
    </Badge>
  );
}

/* ───────────────────────────── misc ───────────────────────────── */

export function MajorBadge({ className }: { className?: string }) {
  const t = useTranslations('itsm.common');
  return (
    <Badge variant="destructive" className={className}>
      <SirenIcon aria-hidden />
      {t('major')}
    </Badge>
  );
}

const CHANGE_TYPE: Record<ChangeType, { dot: string; className: string }> = {
  standard: { dot: 'bg-success', className: '' },
  normal: { dot: 'bg-info', className: '' },
  emergency: {
    dot: 'bg-destructive',
    className: 'border-destructive/30 bg-destructive/10 text-destructive dark:bg-destructive/20',
  },
};

export function changeTypeDot(type: ChangeType) {
  return CHANGE_TYPE[type].dot;
}

export function ChangeTypeBadge({ type, className }: { type: ChangeType; className?: string }) {
  const t = useTranslations('itsm.changeType');
  return (
    <Badge variant="outline" className={cn('gap-1.5', CHANGE_TYPE[type].className, className)}>
      <span className={cn('size-2 rounded-full', CHANGE_TYPE[type].dot)} aria-hidden />
      {t(type)}
    </Badge>
  );
}

export function RiskBadge({ risk, className }: { risk: Risk; className?: string }) {
  const t = useTranslations('itsm.risk');
  const variant = risk === 'high' ? 'destructive' : risk === 'medium' ? 'warning' : 'muted';
  return (
    <Badge variant={variant} className={className}>
      <ShieldAlertIcon aria-hidden />
      {t(risk)}
    </Badge>
  );
}

/** Avatar + name; "—" for nobody. */
export function PersonChip({
  person,
  className,
  size = 'sm',
}: {
  person: PersonRef | { displayName: string; avatarUrl?: string | null } | null | undefined;
  className?: string;
  size?: 'sm' | 'md';
}) {
  if (!person) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <UserAvatar
        name={person.displayName}
        src={person.avatarUrl}
        className={size === 'sm' ? 'size-5 text-[9px]' : 'size-7 text-[11px]'}
      />
      <span className="truncate">{person.displayName}</span>
    </span>
  );
}
