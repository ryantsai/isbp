'use client';

import { Badge } from '@isbp/ui/badge';
import {
  AlertTriangleIcon,
  BanIcon,
  CheckCircle2Icon,
  ClockIcon,
  SendIcon,
  UndoIcon,
  XCircleIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

type Variant = 'info' | 'success' | 'destructive' | 'muted' | 'warning';

const STATUS: Record<string, { variant: Variant; icon: ReactNode }> = {
  running: { variant: 'info', icon: <ClockIcon aria-hidden /> },
  pending: { variant: 'warning', icon: <ClockIcon aria-hidden /> },
  submitted: { variant: 'info', icon: <SendIcon aria-hidden /> },
  approved: { variant: 'success', icon: <CheckCircle2Icon aria-hidden /> },
  rejected: { variant: 'destructive', icon: <XCircleIcon aria-hidden /> },
  cancelled: { variant: 'muted', icon: <BanIcon aria-hidden /> },
  failed: { variant: 'destructive', icon: <AlertTriangleIcon aria-hidden /> },
  delegated: { variant: 'muted', icon: <UndoIcon aria-hidden /> },
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
  const s = STATUS[status] ?? { variant: 'muted' as const, icon: null };
  const key = `${kind}.${status}`;
  return (
    <Badge variant={s.variant}>
      {s.icon}
      {t.has(key) ? t(key) : status}
    </Badge>
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
      <Badge variant="destructive">
        <AlertTriangleIcon aria-hidden />
        {t(`overdue_${unit.u}`, { n: unit.n })}
      </Badge>
    );
  return (
    <Badge variant={ms < 8 * 3_600_000 ? 'warning' : 'muted'}>
      <ClockIcon aria-hidden />
      {t(`in_${unit.u}`, { n: unit.n })}
    </Badge>
  );
}
