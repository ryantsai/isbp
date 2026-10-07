'use client';

import { cn } from '@isbp/ui';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import {
  TriangleAlertIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarXIcon,
  FlagIcon,
} from 'lucide-react';
import { useDay, useMoney } from './lib';
import { renewalTimeline, usage, type UsageTone } from './logic';

const BAR: Record<UsageTone, string> = {
  over: 'bg-destructive',
  full: 'bg-warning',
  ok: 'bg-primary',
  low: 'bg-info',
  unlimited: 'bg-primary/60',
};

/**
 * "42 / 50 used": a meter with the numbers in text (the colour only reinforces them; over-deployment also
 * gets an icon).
 */
export function UsageMeter({
  used,
  quantity,
  size = 'sm',
  className,
  underUsedPercent,
}: {
  used: number;
  quantity: number | null;
  size?: 'sm' | 'lg';
  className?: string;
  underUsedPercent?: number;
}) {
  const t = useTranslations('itam.usage');
  const { percent, tone } = usage(used, quantity, underUsedPercent);
  const text = quantity === null ? t('unlimited', { used }) : t('used', { used, quantity });
  return (
    <div className={cn('grid min-w-0 gap-1', size === 'lg' ? 'gap-2' : '', className)}>
      <div
        role="meter"
        aria-label={t('label')}
        aria-valuemin={0}
        aria-valuemax={quantity ?? Math.max(used, 1)}
        aria-valuenow={used}
        aria-valuetext={text}
        className={cn('w-full overflow-hidden rounded-full bg-muted', size === 'lg' ? 'h-3' : 'h-1.5')}
      >
        <motion.div
          className={cn('h-full rounded-full', BAR[tone])}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span
        className={cn(
          'flex items-center gap-1 tabular-nums',
          size === 'lg' ? 'text-sm' : 'text-xs',
          tone === 'over' ? 'font-medium text-destructive' : 'text-muted-foreground',
        )}
        aria-hidden
      >
        {tone === 'over' && <TriangleAlertIcon className="size-3.5 shrink-0" />}
        {text}
      </span>
    </div>
  );
}

/** Book value against the purchase cost (straight-line), with the percentages in text. */
export function DepreciationBar({
  cost,
  bookValue,
  depreciatedPercent,
  currency,
}: {
  cost: number;
  bookValue: number;
  depreciatedPercent: number;
  currency: string;
}) {
  const t = useTranslations('itam.finance');
  const money = useMoney();
  const remaining = Math.max(0, 100 - depreciatedPercent);
  return (
    <div className="grid gap-1.5">
      <div
        role="meter"
        aria-label={t('bookValue')}
        aria-valuemin={0}
        aria-valuemax={cost}
        aria-valuenow={bookValue}
        aria-valuetext={t('remaining', { percent: Math.round(remaining), value: money(bookValue, currency) })}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <motion.div
          className="h-full rounded-full bg-chart-2"
          initial={{ width: 0 }}
          animate={{ width: `${remaining}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums" aria-hidden>
        {t('remaining', { percent: Math.round(remaining), value: money(bookValue, currency) })}
      </p>
    </div>
  );
}

/**
 * The renewal timeline of a contract: start → notice date → end, with today marked. The track is
 * decorative; the milestones below it carry the same information as text.
 */
export function RenewalTimeline({
  startDate,
  noticeDate,
  endDate,
  today,
  autoRenew,
}: {
  startDate: string | null;
  noticeDate: string | null;
  endDate: string | null;
  today: string;
  autoRenew: boolean;
}) {
  const t = useTranslations('itam.timeline');
  const day = useDay();
  const tl = renewalTimeline({ startDate, noticeDate, endDate, today });
  if (!tl) return <p className="text-sm text-muted-foreground">{t('openEnded')}</p>;
  const milestones = [
    { key: 'start', icon: CalendarCheckIcon, date: startDate, label: t('start') },
    { key: 'notice', icon: CalendarClockIcon, date: noticeDate, label: t('notice') },
    {
      key: 'end',
      icon: autoRenew ? FlagIcon : CalendarXIcon,
      date: endDate,
      label: autoRenew ? t('renews') : t('end'),
    },
  ].filter((m) => m.date);
  return (
    <figure className="grid gap-3" aria-label={t('label')}>
      <div className="relative mx-2 h-10" aria-hidden>
        <div className="absolute inset-x-0 top-4 h-2 rounded-full bg-muted" />
        {tl.notice !== null && (
          <div
            className={cn(
              'absolute top-4 h-2 rounded-r-full',
              tl.phase === 'ended' ? 'bg-destructive/40' : 'bg-warning/60',
            )}
            style={{ left: `${tl.notice}%`, right: 0 }}
          />
        )}
        <motion.div
          className={cn(
            'absolute top-4 left-0 h-2 rounded-l-full',
            tl.phase === 'ended' ? 'bg-destructive' : 'bg-primary',
          )}
          initial={{ width: 0 }}
          animate={{ width: `${tl.today}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
        <span className="absolute top-3 left-0 size-4 -translate-x-1/2 rounded-full border-2 border-card bg-primary" />
        {tl.notice !== null && (
          <span
            className="absolute top-3 size-4 -translate-x-1/2 rounded-full border-2 border-card bg-warning"
            style={{ left: `${tl.notice}%` }}
          />
        )}
        <span className="absolute top-3 right-0 size-4 translate-x-1/2 rounded-full border-2 border-card bg-foreground/70" />
        <span
          className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${tl.today}%` }}
        >
          <span className="h-10 w-0.5 rounded-full bg-foreground" />
        </span>
      </div>
      <ol className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        {milestones.map((m) => {
          const Icon = m.icon;
          return (
            <li key={m.key} className="flex min-w-0 items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">{m.label}</span>
                <span className="block font-medium">{day(m.date)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <figcaption className="text-sm text-muted-foreground">
        {t('today', { date: day(today) })} · {t(`phase.${tl.phase}`)}
      </figcaption>
    </figure>
  );
}
