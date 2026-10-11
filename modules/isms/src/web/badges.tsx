'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Meter } from '@isbp/ui/meter';
import { StatusBadge as SharedStatusBadge, type StatusTone } from '@isbp/ui/status';
import {
  ArchiveIcon,
  BanIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleHelpIcon,
  ClockIcon,
  KeyRoundIcon,
  type LucideIcon,
  PencilLineIcon,
  SearchXIcon,
  ShieldAlertIcon,
  SignalHighIcon,
  SignalIcon,
  SignalLowIcon,
  SignalMediumIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type {
  ACCOUNT_STATES,
  ASSET_STATUSES,
  PRIVILEGES,
  REVIEW_DECISIONS,
  REVIEW_STATUSES,
  STOCKTAKE_RESULTS,
  STOCKTAKE_STATUSES,
} from '../contracts';

type Variant = 'success' | 'info' | 'warning' | 'destructive' | 'muted' | 'secondary' | 'outline';
type Tone = { variant: Variant; icon: LucideIcon };
const TONE: Record<Variant, StatusTone> = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  destructive: 'destructive',
  muted: 'muted',
  secondary: 'muted',
  outline: 'neutral',
};

/** The shared status chip (icon + text); `changeKey` cross-fades it when the status changes in place. */
function StatusBadge({
  tone,
  label,
  className,
  changeKey,
  quiet,
}: {
  tone: Tone;
  label: string;
  className?: string;
  changeKey?: string;
  quiet?: boolean;
}) {
  return (
    <SharedStatusBadge
      tone={TONE[tone.variant]}
      icon={tone.icon}
      label={label}
      className={className}
      changeKey={changeKey}
      quiet={quiet}
    />
  );
}

const ASSET: Record<(typeof ASSET_STATUSES)[number], Tone> = {
  active: { variant: 'success', icon: CheckCircle2Icon },
  missing: { variant: 'destructive', icon: SearchXIcon },
  disposed: { variant: 'muted', icon: ArchiveIcon },
};
/** `inList`: "In use" is what most rows say, so it is quiet text there and only exceptions get a chip. */
export function AssetStatusBadge({
  status,
  animate,
  inList,
}: {
  status: (typeof ASSET_STATUSES)[number];
  animate?: boolean;
  inList?: boolean;
}) {
  const t = useTranslations('isms.assetStatus');
  return (
    <StatusBadge
      tone={ASSET[status]}
      label={t(status)}
      changeKey={animate ? status : undefined}
      quiet={inList && status === 'active'}
    />
  );
}

/** The four-step gauge of an asset value 1–4 (Lucide's signal bars: one to four). */
const GAUGE = [SignalLowIcon, SignalMediumIcon, SignalHighIcon, SignalIcon] as const;

/**
 * Asset value 1–4 as text with a four-step gauge. A value is not a status: the chip is neutral, and only the highest
 * value stands out (warning), so a register of mostly 2s and 3s doesn't look like a list of alarms.
 */
export function ValueBadge({ value }: { value: number }) {
  const t = useTranslations('isms.value');
  return (
    <Badge
      variant={value >= 4 ? 'warning' : 'neutral'}
      icon={<Icon icon={GAUGE[Math.min(Math.max(value, 1), 4) - 1]!} />}
      label={t('badge', { value })}
    />
  );
}

const STOCKTAKE: Record<(typeof STOCKTAKE_STATUSES)[number], Tone> = {
  scheduled: { variant: 'muted', icon: CalendarClockIcon },
  open: { variant: 'info', icon: ClockIcon },
  signed_off: { variant: 'success', icon: CheckCircle2Icon },
  cancelled: { variant: 'muted', icon: XCircleIcon },
};
export function StocktakeStatusBadge({
  status,
  overdue,
}: {
  status: (typeof STOCKTAKE_STATUSES)[number];
  overdue?: boolean;
}) {
  const t = useTranslations('isms');
  if (overdue)
    return <StatusBadge tone={{ variant: 'destructive', icon: ShieldAlertIcon }} label={t('overdue')} />;
  return <StatusBadge tone={STOCKTAKE[status]} label={t(`stocktakeStatus.${status}`)} />;
}

const RESULT: Record<(typeof STOCKTAKE_RESULTS)[number] | 'pending', Tone> = {
  pending: { variant: 'outline', icon: CircleDashedIcon },
  confirmed: { variant: 'success', icon: CheckCircle2Icon },
  changed: { variant: 'info', icon: PencilLineIcon },
  missing: { variant: 'destructive', icon: CircleHelpIcon },
  disposed: { variant: 'muted', icon: Trash2Icon },
};
export function ResultBadge({ result }: { result: (typeof STOCKTAKE_RESULTS)[number] | null }) {
  const t = useTranslations('isms.stocktakeResult');
  const key = result ?? 'pending';
  return <StatusBadge tone={RESULT[key]} label={t(key)} />;
}

const REVIEW: Record<(typeof REVIEW_STATUSES)[number], Tone> = {
  scheduled: { variant: 'muted', icon: CalendarClockIcon },
  open: { variant: 'info', icon: ClockIcon },
  completed: { variant: 'warning', icon: CircleDotIcon },
  signed_off: { variant: 'success', icon: CheckCircle2Icon },
  cancelled: { variant: 'muted', icon: XCircleIcon },
};
export function ReviewStatusBadge({
  status,
  overdue,
}: {
  status: (typeof REVIEW_STATUSES)[number];
  overdue?: boolean;
}) {
  const t = useTranslations('isms');
  if (overdue)
    return <StatusBadge tone={{ variant: 'destructive', icon: ShieldAlertIcon }} label={t('overdue')} />;
  return <StatusBadge tone={REVIEW[status]} label={t(`reviewStatus.${status}`)} />;
}

const DECISION: Record<(typeof REVIEW_DECISIONS)[number], Tone> = {
  keep: { variant: 'success', icon: CheckCircle2Icon },
  disable: { variant: 'warning', icon: BanIcon },
  delete: { variant: 'destructive', icon: Trash2Icon },
};
export function DecisionBadge({ decision }: { decision: (typeof REVIEW_DECISIONS)[number] | null }) {
  const t = useTranslations('isms');
  if (!decision)
    return (
      <StatusBadge
        tone={{ variant: 'outline', icon: CircleDashedIcon }}
        label={t('reviewDecision.undecided')}
      />
    );
  return <StatusBadge tone={DECISION[decision]} label={t(`reviewDecision.${decision}`)} />;
}

export function PrivilegeBadge({ privilege }: { privilege: (typeof PRIVILEGES)[number] }) {
  const t = useTranslations('isms.privilege');
  return privilege === 'admin' ? (
    <StatusBadge tone={{ variant: 'warning', icon: KeyRoundIcon }} label={t('admin')} />
  ) : (
    <Text color="secondary">{t('user')}</Text>
  );
}

export function AccountStateText({ state }: { state: (typeof ACCOUNT_STATES)[number] }) {
  const t = useTranslations('isms.accountState');
  return (
    <HStack gap={1} vAlign="center">
      <Icon
        icon={state === 'enabled' ? CheckCircle2Icon : BanIcon}
        color={state === 'enabled' ? 'success' : 'secondary'}
      />
      <Text type="supporting" color={state === 'disabled' ? 'secondary' : 'primary'}>
        {t(state)}
      </Text>
    </HStack>
  );
}

export function PasswordDueBadge({ animate }: { animate?: boolean }) {
  const t = useTranslations('isms.accounts');
  return (
    <StatusBadge
      tone={{ variant: 'destructive', icon: KeyRoundIcon }}
      label={t('passwordDue')}
      changeKey={animate ? 'due' : undefined}
    />
  );
}

export function SharedAccountStatusBadge({
  status,
  animate,
}: {
  status: 'active' | 'retired';
  animate?: boolean;
}) {
  const t = useTranslations('isms.accountStatus');
  return status === 'active' ? (
    <StatusBadge
      tone={{ variant: 'success', icon: CheckCircle2Icon }}
      label={t('active')}
      changeKey={animate ? status : undefined}
    />
  ) : (
    <StatusBadge
      tone={{ variant: 'muted', icon: ArchiveIcon }}
      label={t('retired')}
      changeKey={animate ? status : undefined}
    />
  );
}

/** A progress bar with its numbers as text (lists of stocktakes and reviews). */
export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <Meter
      kind="progress"
      value={done}
      max={Math.max(total, 1)}
      label={label}
      valueText={`${done}/${total}`}
      showValue
      size="sm"
      className="min-w-24"
    />
  );
}
