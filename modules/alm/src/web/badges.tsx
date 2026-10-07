'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import {
  ArchiveIcon,
  BanIcon,
  Building2Icon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronsUpIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleXIcon,
  ClockIcon,
  CloudCogIcon,
  CloudIcon,
  CodeIcon,
  CombineIcon,
  EqualIcon,
  FlaskConicalIcon,
  GavelIcon,
  GlobeIcon,
  HammerIcon,
  LayersIcon,
  type LucideIcon,
  PlayCircleIcon,
  RocketIcon,
  ShieldCheckIcon,
  SunsetIcon,
  Undo2Icon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type {
  AppStage,
  Criticality,
  DeploymentStatus,
  Disposition,
  EnvironmentKind,
  Hosting,
  ReleaseStatus,
} from '../contracts';
import { isAuthorizedChange } from '../model';

type Tone = 'info' | 'primary' | 'warning' | 'success' | 'muted' | 'destructive';

/** Tone classes tuned for AA on their own tints (the platform's status tokens). */
export const TONE: Record<Tone, string> = {
  info: 'border-transparent bg-info/12 text-info',
  primary: 'border-transparent bg-primary/10 text-primary',
  warning: 'border-transparent bg-warning/15 text-warning-foreground',
  success: 'border-transparent bg-success/12 text-success',
  muted: 'border-transparent bg-muted text-muted-foreground',
  destructive: 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20',
};

/** Icon + text + tone: status is never shown by colour alone. */
function ToneBadge({
  tone,
  icon: Icon,
  label,
  className,
}: {
  tone: Tone;
  icon: LucideIcon;
  label: string;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(TONE[tone], className)}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

/* ───────────── application ───────────── */

export const STAGE_META: Record<AppStage, { tone: Tone; icon: LucideIcon }> = {
  planned: { tone: 'muted', icon: CircleDashedIcon },
  development: { tone: 'info', icon: HammerIcon },
  production: { tone: 'success', icon: CircleCheckIcon },
  sunsetting: { tone: 'warning', icon: SunsetIcon },
  retired: { tone: 'muted', icon: ArchiveIcon },
};

export function StageBadge({ stage, className }: { stage: AppStage; className?: string }) {
  const t = useTranslations('alm.stage');
  const m = STAGE_META[stage];
  return <ToneBadge tone={m.tone} icon={m.icon} label={t(stage)} className={className} />;
}

const CRITICALITY: Record<Criticality, { icon: LucideIcon; className: string }> = {
  critical: { icon: ChevronsUpIcon, className: 'bg-destructive/10 text-destructive dark:bg-destructive/20' },
  high: { icon: ChevronUpIcon, className: 'bg-warning/15 text-warning-foreground' },
  medium: { icon: EqualIcon, className: 'bg-info/12 text-info' },
  low: { icon: ChevronDownIcon, className: 'bg-muted text-muted-foreground' },
};

export function CriticalityBadge({
  criticality,
  className,
}: {
  criticality: Criticality;
  className?: string;
}) {
  const t = useTranslations('alm.criticality');
  const { icon: Icon, className: tone } = CRITICALITY[criticality];
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tone,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(criticality)}
    </span>
  );
}

export function DispositionBadge({ disposition }: { disposition: Disposition | null }) {
  const t = useTranslations('alm.disposition');
  if (!disposition) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className="font-normal">
      {t(disposition)}
    </Badge>
  );
}

export const HOSTING_ICON: Record<Hosting, LucideIcon> = {
  on_prem: Building2Icon,
  cloud: CloudIcon,
  saas: CloudCogIcon,
  hybrid: CombineIcon,
};

export function HostingLabel({ hosting, className }: { hosting: Hosting; className?: string }) {
  const t = useTranslations('alm.hosting');
  const Icon = HOSTING_ICON[hosting];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      {t(hosting)}
    </span>
  );
}

/* ───────────── environments ───────────── */

export const ENV_ICON: Record<EnvironmentKind, LucideIcon> = {
  development: CodeIcon,
  test: FlaskConicalIcon,
  staging: LayersIcon,
  production: GlobeIcon,
  dr: ShieldCheckIcon,
};

export function EnvKindLabel({ kind, className }: { kind: EnvironmentKind; className?: string }) {
  const t = useTranslations('alm.envKind');
  const Icon = ENV_ICON[kind];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      {t(kind)}
    </span>
  );
}

/* ───────────── releases & deployments ───────────── */

export const RELEASE_META: Record<ReleaseStatus, { tone: Tone; icon: LucideIcon }> = {
  planned: { tone: 'muted', icon: CalendarIcon },
  in_progress: { tone: 'info', icon: PlayCircleIcon },
  ready: { tone: 'success', icon: CircleCheckIcon },
  released: { tone: 'primary', icon: RocketIcon },
  cancelled: { tone: 'muted', icon: BanIcon },
};

export function ReleaseStatusBadge({ status, className }: { status: ReleaseStatus; className?: string }) {
  const t = useTranslations('alm.releaseStatus');
  const m = RELEASE_META[status];
  return <ToneBadge tone={m.tone} icon={m.icon} label={t(status)} className={className} />;
}

export const DEPLOYMENT_META: Record<DeploymentStatus, { tone: Tone; icon: LucideIcon }> = {
  in_progress: { tone: 'info', icon: ClockIcon },
  succeeded: { tone: 'success', icon: CircleCheckIcon },
  failed: { tone: 'destructive', icon: CircleXIcon },
  rolled_back: { tone: 'warning', icon: Undo2Icon },
};

export function DeploymentStatusBadge({
  status,
  className,
}: {
  status: DeploymentStatus;
  className?: string;
}) {
  const t = useTranslations('alm.deploymentStatus');
  const m = DEPLOYMENT_META[status];
  return <ToneBadge tone={m.tone} icon={m.icon} label={t(status)} className={className} />;
}

/** Inline status icon + text (tables, cards) without the badge chrome. */
export function DeploymentStatusText({
  status,
  className,
}: {
  status: DeploymentStatus;
  className?: string;
}) {
  const t = useTranslations('alm.deploymentStatus');
  const m = DEPLOYMENT_META[status];
  const color = {
    info: 'text-info',
    primary: 'text-primary',
    warning: 'text-warning-foreground',
    success: 'text-success',
    muted: 'text-muted-foreground',
    destructive: 'text-destructive',
  }[m.tone];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap font-medium', color, className)}>
      <m.icon className="size-3.5 shrink-0" aria-hidden />
      {t(status)}
    </span>
  );
}

/* ───────────── ITSM changes ───────────── */

function changeTone(status: string): Tone {
  if (isAuthorizedChange(status)) return 'success';
  if (status === 'authorization') return 'warning';
  if (status === 'rejected') return 'destructive';
  if (status === 'review' || status === 'assessment') return 'info';
  return 'muted';
}

/** An ITSM change's status with ITSM's own labels (`itsm.status.*`). */
export function ChangeStatusChip({
  reference,
  status,
  className,
}: {
  reference?: string;
  status: string;
  className?: string;
}) {
  const t = useTranslations('itsm.status');
  const tone = changeTone(status);
  const Icon = isAuthorizedChange(status)
    ? CircleCheckIcon
    : status === 'authorization'
      ? GavelIcon
      : status === 'rejected' || status === 'cancelled'
        ? CircleXIcon
        : CircleDotIcon;
  return (
    <Badge variant="outline" className={cn(TONE[tone], 'gap-1', className)}>
      <Icon aria-hidden />
      {reference && <span className="font-mono">{reference}</span>}
      <span>{t.has(status) ? t(status) : status}</span>
    </Badge>
  );
}
