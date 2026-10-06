'use client';

import type { Dashboard } from '@isbp/contracts';
import { motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * 14-day stacked bars: security events (chart-1) + other events (chart-2), 2px surface gap between
 * segments, rounded data ends, per-bar hover/focus tooltip and an always-visible legend with totals.
 */
export function ActivityChart({ data }: { data: Dashboard['activity'] }) {
  const t = useTranslations('dashboard.activity');
  const format = useFormatter();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.total));
  const totals = data.reduce(
    (acc, d) => ({ total: acc.total + d.total, security: acc.security + d.security }),
    { total: 0, security: 0 },
  );
  const dayLabel = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00`), { month: 'short', day: 'numeric' });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm bg-chart-1" aria-hidden />
          <span className="text-muted-foreground">{t('security')}</span>
          <span className="font-medium tabular-nums">{format.number(totals.security)}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm bg-chart-2" aria-hidden />
          <span className="text-muted-foreground">{t('other')}</span>
          <span className="font-medium tabular-nums">{format.number(totals.total - totals.security)}</span>
        </span>
        <span className="ml-auto text-muted-foreground">
          {t('total')}{' '}
          <span className="font-medium text-foreground tabular-nums">{format.number(totals.total)}</span>
        </span>
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-t border-dashed border-border/70" />
          ))}
        </div>
        <ul className="relative flex h-44 items-end gap-1.5 sm:gap-2" aria-label={t('title')}>
          {data.map((d, i) => {
            const other = d.total - d.security;
            const label = t('tooltip', { date: dayLabel(d.date), total: d.total, security: d.security });
            return (
              <li
                key={d.date}
                className="group relative flex h-full flex-1 cursor-default flex-col justify-end outline-none"
                tabIndex={0}
                aria-label={label}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <motion.div
                  className="flex flex-col justify-end gap-[2px]"
                  initial={{ height: 0 }}
                  animate={{ height: `${(d.total / max) * 100}%` }}
                  transition={{ duration: 0.6, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                >
                  {other > 0 && (
                    <div
                      className="min-h-[2px] rounded-t-[4px] bg-chart-2 transition-opacity group-hover:opacity-90"
                      style={{ flexGrow: other }}
                    />
                  )}
                  {d.security > 0 && (
                    <div
                      className={`min-h-[2px] bg-chart-1 transition-opacity group-hover:opacity-90 ${other > 0 ? '' : 'rounded-t-[4px]'}`}
                      style={{ flexGrow: d.security }}
                    />
                  )}
                </motion.div>
                {hover === i && (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
                  >
                    <div className="font-medium">{dayLabel(d.date)}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                      <span className="size-2 rounded-sm bg-chart-1" /> {t('security')}{' '}
                      <span className="ml-auto pl-3 font-medium text-foreground tabular-nums">
                        {d.security}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="size-2 rounded-sm bg-chart-2" /> {t('other')}{' '}
                      <span className="ml-auto pl-3 font-medium text-foreground tabular-nums">{other}</span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground" aria-hidden>
        <span>{data[0] && dayLabel(data[0].date)}</span>
        <span>{data.at(-1) && dayLabel(data.at(-1)!.date)}</span>
      </div>
    </div>
  );
}
