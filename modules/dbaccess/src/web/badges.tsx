'use client';

import { HStack } from '@astryxdesign/core/Layout';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { cn } from '@isbp/ui';
import { StatusBadge, type StatusTone } from '@isbp/ui/status';
import {
  AlarmClockIcon,
  BanIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleXIcon,
  ClockIcon,
  DatabaseIcon,
  FlameIcon,
  HourglassIcon,
  LoaderCircleIcon,
  type LucideIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type {
  Environment,
  GrantViewStatus,
  RequestStatus,
  ReviewDecision,
  ReviewStatus,
  Risk,
} from '../contracts';

type Variant = Extract<StatusTone, 'info' | 'success' | 'warning' | 'destructive' | 'muted'>;

/** A spinning loader for work in flight (honours reduced motion). */
function SpinnerIcon({ className }: { className?: string }) {
  return <LoaderCircleIcon aria-hidden className={cn(className, 'motion-safe:animate-spin')} />;
}

/** Icon + text + tone: status is never shown by colour alone. */
function ToneBadge({
  variant,
  icon,
  label,
  className,
  spin,
}: {
  variant: Variant;
  icon: LucideIcon;
  label: string;
  className?: string;
  spin?: boolean;
}) {
  return <StatusBadge tone={variant} icon={spin ? SpinnerIcon : icon} label={label} className={className} />;
}

export const GRANT_META: Record<GrantViewStatus, { variant: Variant; icon: LucideIcon; spin?: boolean }> = {
  provisioning: { variant: 'info', icon: LoaderCircleIcon, spin: true },
  active: { variant: 'success', icon: CircleCheckIcon },
  expiring: { variant: 'warning', icon: AlarmClockIcon },
  revoking: { variant: 'info', icon: LoaderCircleIcon, spin: true },
  revoked: { variant: 'muted', icon: BanIcon },
  expired: { variant: 'muted', icon: HourglassIcon },
  failed: { variant: 'destructive', icon: TriangleAlertIcon },
};

export function GrantStatusBadge({ status, className }: { status: GrantViewStatus; className?: string }) {
  const t = useTranslations('dbaccess.status');
  const m = GRANT_META[status];
  return (
    <ToneBadge variant={m.variant} icon={m.icon} spin={m.spin} label={t(status)} className={className} />
  );
}

const REQUEST_META: Record<RequestStatus, { variant: Variant; icon: LucideIcon }> = {
  pending: { variant: 'info', icon: ClockIcon },
  approved: { variant: 'success', icon: CircleCheckIcon },
  rejected: { variant: 'destructive', icon: CircleXIcon },
  cancelled: { variant: 'muted', icon: BanIcon },
};

export function RequestStatusBadge({ status, className }: { status: RequestStatus; className?: string }) {
  const t = useTranslations('dbaccess.requestStatus');
  const m = REQUEST_META[status];
  return <ToneBadge variant={m.variant} icon={m.icon} label={t(status)} className={className} />;
}

const RISK_META: Record<Risk, { variant: Variant; icon: LucideIcon }> = {
  low: { variant: 'muted', icon: ShieldCheckIcon },
  medium: { variant: 'warning', icon: ShieldIcon },
  high: { variant: 'destructive', icon: ShieldAlertIcon },
};

export function RiskBadge({ risk, className }: { risk: Risk; className?: string }) {
  const t = useTranslations('dbaccess.risk');
  const m = RISK_META[risk];
  return <ToneBadge variant={m.variant} icon={m.icon} label={t(risk)} className={className} />;
}

const REVIEW_META: Record<ReviewStatus, { variant: Variant; icon: LucideIcon }> = {
  scheduled: { variant: 'muted', icon: CircleDashedIcon },
  active: { variant: 'info', icon: CircleDotIcon },
  closed: { variant: 'success', icon: CircleCheckIcon },
};

export function ReviewStatusBadge({ status, className }: { status: ReviewStatus; className?: string }) {
  const t = useTranslations('dbaccess.reviewStatus');
  const m = REVIEW_META[status];
  return <ToneBadge variant={m.variant} icon={m.icon} label={t(status)} className={className} />;
}

export function DecisionBadge({
  decision,
  className,
}: {
  decision: ReviewDecision | null;
  className?: string;
}) {
  const t = useTranslations('dbaccess.decision');
  if (!decision)
    return <ToneBadge variant="muted" icon={CircleDashedIcon} label={t('none')} className={className} />;
  return decision === 'keep' ? (
    <ToneBadge variant="success" icon={ThumbsUpIcon} label={t('keep')} className={className} />
  ) : (
    <ToneBadge variant="destructive" icon={ThumbsDownIcon} label={t('revoke')} className={className} />
  );
}

/** Engine name with a database icon (the engine is text, not a logo). */
export function EngineLabel({ engine, className }: { engine: string; className?: string }) {
  const t = useTranslations('dbaccess.engine');
  return (
    <HStack as="span" gap={1} vAlign="center" className={cn('min-w-0', className)}>
      <Icon icon={DatabaseIcon} size="sm" color="secondary" />
      <Text type="supporting" maxLines={1}>
        {t.has(engine) ? t(engine) : engine}
      </Text>
    </HStack>
  );
}

export function EnvironmentBadge({
  environment,
  className,
}: {
  environment: Environment;
  className?: string;
}) {
  const t = useTranslations('dbaccess.environment');
  return environment === 'production' ? (
    <ToneBadge variant="warning" icon={FlameIcon} label={t(environment)} className={className} />
  ) : (
    <StatusBadge tone="neutral" label={t(environment)} className={className} />
  );
}

export function SyncStatus({ status, className }: { status: 'ok' | 'error' | null; className?: string }) {
  const t = useTranslations('dbaccess.sync');
  if (status === 'ok')
    return <ToneBadge variant="success" icon={CircleCheckIcon} label={t('ok')} className={className} />;
  if (status === 'error')
    return (
      <ToneBadge variant="destructive" icon={CircleAlertIcon} label={t('error')} className={className} />
    );
  return <ToneBadge variant="muted" icon={CircleDashedIcon} label={t('never')} className={className} />;
}
