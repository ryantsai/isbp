'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { cn } from '@isbp/ui';
import { StatusBadge, type StatusTone } from '@isbp/ui/status';
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

type Tone = Exclude<StatusTone, 'neutral'>;

/** Icon + text + tone: status is never shown by colour alone. */
function ToneBadge({ tone, icon, label }: { tone: Tone; icon: LucideIcon; label: string }) {
  return <StatusBadge tone={tone} icon={icon} label={label} />;
}

/* ───────────── application ───────────── */

export const STAGE_META: Record<AppStage, { tone: Tone; icon: LucideIcon }> = {
  planned: { tone: 'muted', icon: CircleDashedIcon },
  development: { tone: 'info', icon: HammerIcon },
  production: { tone: 'success', icon: CircleCheckIcon },
  sunsetting: { tone: 'warning', icon: SunsetIcon },
  retired: { tone: 'muted', icon: ArchiveIcon },
};

export function StageBadge({ stage }: { stage: AppStage }) {
  const t = useTranslations('alm.stage');
  const m = STAGE_META[stage];
  return <ToneBadge tone={m.tone} icon={m.icon} label={t(stage)} />;
}

export const CRITICALITY_META: Record<
  Criticality,
  { icon: LucideIcon; variant: 'error' | 'warning' | 'info' | 'neutral' }
> = {
  critical: { icon: ChevronsUpIcon, variant: 'error' },
  high: { icon: ChevronUpIcon, variant: 'warning' },
  medium: { icon: EqualIcon, variant: 'info' },
  low: { icon: ChevronDownIcon, variant: 'neutral' },
};

export function CriticalityBadge({ criticality }: { criticality: Criticality }) {
  const t = useTranslations('alm.criticality');
  const { icon, variant } = CRITICALITY_META[criticality];
  return <Badge variant={variant} label={t(criticality)} icon={<Icon icon={icon} size="xsm" />} />;
}

export function DispositionBadge({ disposition }: { disposition: Disposition | null }) {
  const t = useTranslations('alm.disposition');
  if (!disposition) return <Text color="secondary">—</Text>;
  return <Badge variant="neutral" label={t(disposition)} />;
}

export const HOSTING_ICON: Record<Hosting, LucideIcon> = {
  on_prem: Building2Icon,
  cloud: CloudIcon,
  saas: CloudCogIcon,
  hybrid: CombineIcon,
};

export function HostingLabel({ hosting, className }: { hosting: Hosting; className?: string }) {
  const t = useTranslations('alm.hosting');
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <Icon icon={HOSTING_ICON[hosting]} size="xsm" color="secondary" />
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
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <Icon icon={ENV_ICON[kind]} size="xsm" color="secondary" />
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

export function ReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  const t = useTranslations('alm.releaseStatus');
  const m = RELEASE_META[status];
  return <ToneBadge tone={m.tone} icon={m.icon} label={t(status)} />;
}

export const DEPLOYMENT_META: Record<DeploymentStatus, { tone: Tone; icon: LucideIcon }> = {
  in_progress: { tone: 'info', icon: ClockIcon },
  succeeded: { tone: 'success', icon: CircleCheckIcon },
  failed: { tone: 'destructive', icon: CircleXIcon },
  rolled_back: { tone: 'warning', icon: Undo2Icon },
};

export function DeploymentStatusBadge({ status }: { status: DeploymentStatus }) {
  const t = useTranslations('alm.deploymentStatus');
  const m = DEPLOYMENT_META[status];
  return <ToneBadge tone={m.tone} icon={m.icon} label={t(status)} />;
}

const TONE_ICON_COLOR = {
  info: 'accent',
  primary: 'accent',
  warning: 'warning',
  success: 'success',
  muted: 'secondary',
  destructive: 'error',
} as const;

/** Inline status icon + text (tables, cards) without the badge chrome. The text size follows its surroundings. */
export function DeploymentStatusText({
  status,
  className,
}: {
  status: DeploymentStatus;
  className?: string;
}) {
  const t = useTranslations('alm.deploymentStatus');
  const m = DEPLOYMENT_META[status];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', className)}>
      <Icon icon={m.icon} size="xsm" color={TONE_ICON_COLOR[m.tone]} />
      <Text type="inherit" weight="medium">
        {t(status)}
      </Text>
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
export function ChangeStatusChip({ reference, status }: { reference?: string; status: string }) {
  const t = useTranslations('itsm.status');
  const Glyph = isAuthorizedChange(status)
    ? CircleCheckIcon
    : status === 'authorization'
      ? GavelIcon
      : status === 'rejected' || status === 'cancelled'
        ? CircleXIcon
        : CircleDotIcon;
  return (
    <StatusBadge tone={changeTone(status)} icon={Glyph}>
      {reference && <span className="font-mono">{reference} </span>}
      <span>{t.has(status) ? t(status) : status}</span>
    </StatusBadge>
  );
}
