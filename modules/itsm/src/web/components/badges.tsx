'use client';

import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { StatusBadge } from '@isbp/ui/status';
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
  RepeatIcon,
  SearchIcon,
  ShieldAlertIcon,
  SirenIcon,
  StampIcon,
  XCircleIcon,
  ZapIcon,
} from 'lucide-react';
import { useNow, useTranslations } from 'next-intl';
import type { PersonRef, TicketStatus, TicketType } from '../../contracts';
import { useDuration } from '../lib';
import { type SlaState, slaState } from '../logic';

export { slaState };
import type { ChangeType, Risk, SlaMetric, SlaStatus } from '../types';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { StatusDot } from '@astryxdesign/core/StatusDot';

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
  return (
    <AstryxIcon
      icon={Icon}
      size="sm"
      label={label ? t(type) : undefined}
      className={cn('shrink-0', className)}
    />
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

export function statusIcon(status: TicketStatus): LucideIcon {
  return STATUS[status]?.icon ?? CircleDotIcon;
}

/**
 * Ticket status: icon + text + tone (never colour alone). `signOff`: a resolution waiting for its sign-off shows as
 * "Waiting for sign-off" instead of "Pending approval". `requester`: the requester's words ("Received" for new).
 * `animate`: cross-fades when the status changes in place (the ticket page header).
 */
export function TicketStatusBadge({
  status,
  signOff,
  requester,
  animate,
  className,
}: {
  status: TicketStatus;
  signOff?: boolean;
  requester?: boolean;
  animate?: boolean;
  className?: string;
}) {
  const t = useTranslations('itsm');
  const s = STATUS[status] ?? { tone: 'muted' as const, icon: CircleDotIcon };
  const signingOff = signOff && status === 'pending_approval';
  const label = signingOff
    ? requester
      ? t('requesterStatus.pending_approval')
      : t('signOff.status')
    : requester && t.has(`requesterStatus.${status}`)
      ? t(`requesterStatus.${status}`)
      : t.has(`status.${status}`)
        ? t(`status.${status}`)
        : status;
  return (
    <StatusBadge
      tone={s.tone}
      icon={signingOff ? StampIcon : s.icon}
      label={label}
      changeKey={animate ? `${status}${signingOff ? ':sign-off' : ''}` : undefined}
      className={className}
    />
  );
}

/* ───────────────────────────── priority ───────────────────────────── */

const PRIORITY_DOT = { 1: 'error', 2: 'warning', 3: 'accent', 4: 'neutral' } as const;

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
      variant={priority === 1 ? 'error' : 'neutral'}
      className={className}
      icon={<StatusDot aria-hidden variant={PRIORITY_DOT[priority as 1 | 2 | 3 | 4] ?? 'neutral'} label="" />}
      label={
        long ? (
          t(`priority.${key}`)
        ) : (
          <>
            <span aria-hidden>{t(`priorityShort.${key}`)}</span>
            <span className="sr-only">{t(`priority.${key}`)}</span>
          </>
        )
      }
    />
  );
}

/* ───────────────────────────── SLA ───────────────────────────── */

const SLA_STYLE: Record<
  SlaState,
  { icon: LucideIcon; variant: 'error' | 'warning' | 'neutral' | 'success' }
> = {
  breached: { icon: AlarmClockOffIcon, variant: 'error' },
  at_risk: { icon: ClockAlertIcon, variant: 'warning' },
  running: { icon: ClockIcon, variant: 'neutral' },
  paused: { icon: PauseCircleIcon, variant: 'neutral' },
  met: { icon: CheckCircle2Icon, variant: 'success' },
  cancelled: { icon: BanIcon, variant: 'neutral' },
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
  const { icon: Icon, variant } = SLA_STYLE[state];
  const left = new Date(sla.dueAt).getTime() - now.getTime();
  const text =
    state === 'breached'
      ? t('common.sla.breachedAgo', { time: duration(left) })
      : state === 'running' || state === 'at_risk'
        ? t('common.sla.left', { time: duration(left) })
        : t(`slaStatus.${state}`);
  const metric = t(`slaMetric.${sla.metric}`);
  return (
    <Badge
      variant={variant}
      className={className}
      icon={<AstryxIcon icon={Icon} />}
      label={
        <>
          {showMetric ? <span>{metric} ·</span> : <span className="sr-only">{metric}: </span>} {text}
        </>
      }
    />
  );
}

/* ───────────────────────────── misc ───────────────────────────── */

export function MajorBadge({ className }: { className?: string }) {
  const t = useTranslations('itsm.common');
  return (
    <Badge
      variant="error"
      label={t('major')}
      icon={<AstryxIcon icon={SirenIcon} size="xsm" />}
      className={className}
    />
  );
}

/** Change types are attributes, not statuses: an icon each, no status colours (emergency is not "failed"). */
export const CHANGE_TYPE_ICON: Record<ChangeType, LucideIcon> = {
  standard: RepeatIcon,
  normal: GitCompareArrowsIcon,
  emergency: ZapIcon,
};

export function ChangeTypeBadge({ type, className }: { type: ChangeType; className?: string }) {
  const t = useTranslations('itsm.changeType');
  return <StatusBadge tone="neutral" icon={CHANGE_TYPE_ICON[type]} label={t(type)} className={className} />;
}

export function RiskBadge({ risk, className }: { risk: Risk; className?: string }) {
  const t = useTranslations('itsm.risk');
  const variant = risk === 'high' ? 'error' : risk === 'medium' ? 'warning' : 'neutral';
  return (
    <Badge
      variant={variant}
      className={className}
      icon={<AstryxIcon icon={ShieldAlertIcon} />}
      label={t(risk)}
    />
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
