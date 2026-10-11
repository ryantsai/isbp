'use client';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import {
  AlertTriangleIcon,
  BanIcon,
  CheckCircle2Icon,
  ClockIcon,
  type LucideIcon,
  SendIcon,
  UndoIcon,
  XCircleIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

type Variant = 'info' | 'success' | 'error' | 'neutral' | 'warning';

const STATUS: Record<string, { variant: Variant; icon: LucideIcon }> = {
  running: { variant: 'info', icon: ClockIcon },
  pending: { variant: 'warning', icon: ClockIcon },
  submitted: { variant: 'info', icon: SendIcon },
  approved: { variant: 'success', icon: CheckCircle2Icon },
  rejected: { variant: 'error', icon: XCircleIcon },
  cancelled: { variant: 'neutral', icon: BanIcon },
  failed: { variant: 'error', icon: AlertTriangleIcon },
  delegated: { variant: 'neutral', icon: UndoIcon },
};

/** Request, submission, instance and task statuses — icon + text, never colour alone. */
export function StatusBadge({
  status,
  kind = 'request',
}: {
  status: string;
  kind?: 'request' | 'instance' | 'task';
}) {
  const t = useTranslations('workflows.status');
  const s = STATUS[status];
  const key = `${kind}.${status}`;
  return (
    <Badge
      variant={s?.variant ?? 'neutral'}
      label={t.has(key) ? t(key) : status}
      icon={s ? <Icon icon={s.icon} size="xsm" /> : undefined}
    />
  );
}

/** "Due in 5 hours" / "Overdue by 2 hours" chip for approval deadlines. */
export function DueBadge({ dueAt, now }: { dueAt: string | null | undefined; now: Date }) {
  const t = useTranslations('workflows.due');
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - now.getTime();
  const hours = Math.round(Math.abs(ms) / 3_600_000);
  const unit =
    hours >= 48
      ? { n: Math.round(hours / 24), u: 'days' as const }
      : { n: Math.max(hours, 1), u: 'hours' as const };
  if (ms < 0)
    return (
      <Badge
        variant="error"
        label={t(`overdue_${unit.u}`, { n: unit.n })}
        icon={<Icon icon={AlertTriangleIcon} size="xsm" />}
      />
    );
  return (
    <Badge
      variant={ms < 8 * 3_600_000 ? 'warning' : 'neutral'}
      label={t(`in_${unit.u}`, { n: unit.n })}
      icon={<Icon icon={ClockIcon} size="xsm" />}
    />
  );
}
