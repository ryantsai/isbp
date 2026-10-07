'use client';

import { cn } from '@isbp/ui';
import { ClockAlertIcon, RefreshCwIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ContractListItem } from '../contracts';
import { endPhase } from './logic';

/** "Renews in 23 days" / "Ended 4 days ago", with an icon when it's close. */
export function RenewsIn({ c }: { c: Pick<ContractListItem, 'daysToEnd' | 'autoRenew' | 'status'> }) {
  const t = useTranslations('itam.contracts');
  const phase = endPhase(c.daysToEnd);
  if (phase === 'none' || c.status === 'cancelled' || c.status === 'draft')
    return <span className="text-muted-foreground">—</span>;
  const days = Math.abs(c.daysToEnd ?? 0);
  const soon = phase === 'soon' || phase === 'today';
  const Icon = c.autoRenew ? RefreshCwIcon : ClockAlertIcon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        phase === 'ended'
          ? 'text-destructive'
          : soon
            ? 'font-medium text-warning-foreground'
            : 'text-muted-foreground',
      )}
    >
      {(soon || phase === 'ended') && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {phase === 'ended'
        ? t('endedAgo', { days })
        : phase === 'today'
          ? t('endsToday')
          : c.autoRenew
            ? t('renewsIn', { days })
            : t('endsIn', { days })}
    </span>
  );
}
