'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
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
  ShieldCheckIcon,
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

function StatusBadge({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  const Icon = tone.icon;
  return (
    <Badge variant={tone.variant} className={cn('gap-1', className)}>
      <Icon aria-hidden className="size-3" />
      {label}
    </Badge>
  );
}

const ASSET: Record<(typeof ASSET_STATUSES)[number], Tone> = {
  active: { variant: 'success', icon: CheckCircle2Icon },
  missing: { variant: 'destructive', icon: SearchXIcon },
  disposed: { variant: 'muted', icon: ArchiveIcon },
};
export function AssetStatusBadge({ status }: { status: (typeof ASSET_STATUSES)[number] }) {
  const t = useTranslations('isms.assetStatus');
  return <StatusBadge tone={ASSET[status]} label={t(status)} />;
}

/** Asset value 1–4: the number and its meaning, never colour alone. */
const VALUE_TONE: Record<number, Variant> = { 1: 'muted', 2: 'info', 3: 'warning', 4: 'destructive' };
export function ValueBadge({ value, className }: { value: number; className?: string }) {
  const t = useTranslations('isms.value');
  return (
    <Badge variant={VALUE_TONE[value] ?? 'outline'} className={cn('gap-1 tabular-nums', className)}>
      <ShieldCheckIcon aria-hidden className="size-3" />
      {t('badge', { value })}
    </Badge>
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
    <span className="text-sm text-muted-foreground">{t('user')}</span>
  );
}

export function AccountStateText({ state }: { state: (typeof ACCOUNT_STATES)[number] }) {
  const t = useTranslations('isms.accountState');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-sm',
        state === 'disabled' && 'text-muted-foreground',
      )}
    >
      {state === 'enabled' ? (
        <CheckCircle2Icon aria-hidden className="size-3.5 text-success" />
      ) : (
        <BanIcon aria-hidden className="size-3.5" />
      )}
      {t(state)}
    </span>
  );
}

export function PasswordDueBadge() {
  const t = useTranslations('isms.accounts');
  return <StatusBadge tone={{ variant: 'destructive', icon: KeyRoundIcon }} label={t('passwordDue')} />;
}

export function SharedAccountStatusBadge({ status }: { status: 'active' | 'retired' }) {
  const t = useTranslations('isms.accountStatus');
  return status === 'active' ? (
    <StatusBadge tone={{ variant: 'success', icon: CheckCircle2Icon }} label={t('active')} />
  ) : (
    <StatusBadge tone={{ variant: 'muted', icon: ArchiveIcon }} label={t('retired')} />
  );
}

/** A progress bar with its numbers as text. */
export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total ? Math.floor((done / total) * 100) : 100;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-2 w-full min-w-16 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {done}/{total}
      </span>
    </div>
  );
}
