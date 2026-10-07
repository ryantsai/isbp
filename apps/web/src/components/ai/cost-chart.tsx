'use client';

import type { AiUsageReport } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import { motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useUsd } from './ai-meta';

type Day = AiUsageReport['daily'][number];
export type Measure = 'cost' | 'calls';

/** A clean axis: 0 … top in about 3 equal steps of 1 / 2 / 2.5 / 5 × 10ⁿ (1 / 2 / 5 for counts). */
function niceTicks(max: number, integer: boolean): { ticks: number[]; step: number } {
  if (max <= 0) return { ticks: [0], step: 1 };
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = (integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).find((n) => norm <= n) ?? 10;
  const step = integer ? Math.max(1, nice * mag) : Number((nice * mag).toPrecision(12));
  const top = step * Math.ceil(max / step - 1e-9);
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { ticks, step };
}

/** Decimals needed to write `n` exactly (0.0025 → 4). */
function decimalsOf(n: number): number {
  const s = String(n);
  const dot = s.indexOf('.');
  return s.includes('e-') ? Number(s.split('e-')[1]) : dot < 0 ? 0 : s.length - dot - 1;
}

/**
 * Daily columns for one measure (cost or calls — never both on one axis). Solid hairline grid with
 * round ticks, 4px rounded data-ends, a per-day hover/focus tooltip with both values, and arrow-key
 * navigation (one tab stop). The table view is the same data without the chart.
 */
export function DailyChart({
  data,
  measure,
  view,
}: {
  data: Day[];
  measure: Measure;
  view: 'chart' | 'table';
}) {
  const t = useTranslations('ai.usage.chart');
  const format = useFormatter();
  const usd = useUsd();
  const [active, setActive] = useState<number | null>(null);
  const [focusState, setFocusIndex] = useState(Math.max(0, data.length - 1));
  // A shorter range keeps one bar reachable by Tab.
  const focusIndex = Math.min(focusState, Math.max(0, data.length - 1));
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  const valueOf = (d: Day) => (measure === 'cost' ? d.costUsd : d.calls);
  const fmt = (v: number) => (measure === 'cost' ? usd(v) : format.number(v));
  const dayLabel = (iso: string, long = false) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      ...(long && { weekday: 'short' }),
    });

  if (view === 'table')
    return (
      <div
        role="region"
        aria-label={t('tableLabel')}
        tabIndex={0}
        className="max-h-80 overflow-y-auto rounded-lg border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              <TableHead>{t('date')}</TableHead>
              <TableHead className="text-right">{t('cost')}</TableHead>
              <TableHead className="text-right">{t('calls')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...data].reverse().map((d) => (
              <TableRow key={d.date}>
                <TableCell>{dayLabel(d.date, true)}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(d.costUsd)}</TableCell>
                <TableCell className="text-right tabular-nums">{format.number(d.calls)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );

  const max = Math.max(0, ...data.map(valueOf));
  const { ticks, step } = niceTicks(max, measure === 'calls');
  const top = ticks.at(-1) || 1;
  // Every tick label shares the step's precision ($0.005, $0.010, $0.015 rather than $0.00, $0.0050…).
  const digits = step >= 1 ? 0 : Math.max(2, decimalsOf(step));
  const tick = (v: number) =>
    measure === 'cost'
      ? format.number(v, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        })
      : format.number(v);
  const dense = data.length > 45;
  const tooltipText = (d: Day) =>
    t('tooltip', { date: dayLabel(d.date, true), cost: usd(d.costUsd), calls: d.calls });

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const last = data.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = Math.min(last, focusIndex + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, focusIndex - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    setFocusIndex(next);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div className="flex gap-2">
        {/* Y axis: round ticks, right-aligned, on the same scale as the gridlines. */}
        <div
          className="relative h-44 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums"
          aria-hidden
        >
          {ticks.map((v) => (
            <span
              key={v}
              className="absolute right-0 translate-y-1/2 leading-none whitespace-nowrap"
              style={{ bottom: `${(v / top) * 100}%` }}
            >
              {tick(v)}
            </span>
          ))}
          {/* Sizes the column to the widest label. */}
          <span className="invisible block leading-none whitespace-nowrap">{tick(top)}</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {ticks.map((v) => (
              <div
                key={v}
                className="absolute inset-x-0 border-t border-border"
                style={{ bottom: `${(v / top) * 100}%` }}
              />
            ))}
          </div>
          <ul
            className={cn('relative flex h-44 items-end', dense ? 'gap-px' : 'gap-[2px]')}
            aria-label={t('label', {
              measure: measure === 'cost' ? t('cost') : t('calls'),
              from: dayLabel(data[0]?.date ?? ''),
              to: dayLabel(data.at(-1)?.date ?? ''),
            })}
            onKeyDown={onKeyDown}
          >
            {data.map((d, i) => {
              const v = valueOf(d);
              const edge = i < data.length / 4 ? 'start' : i > (data.length * 3) / 4 ? 'end' : 'center';
              return (
                <li
                  key={d.date}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  tabIndex={i === focusIndex ? 0 : -1}
                  aria-label={tooltipText(d)}
                  className={cn(
                    'group relative flex h-full min-w-0 flex-1 cursor-default justify-center rounded-t-sm outline-none focus-visible:ring-[2px] focus-visible:ring-ring/60',
                    active === i && 'bg-muted/60',
                  )}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => {
                    setActive(i);
                    setFocusIndex(i);
                  }}
                  onBlur={() => setActive(null)}
                >
                  <div className="flex h-full w-full max-w-6 flex-col justify-end">
                    {v > 0 && (
                      <motion.div
                        className={cn(
                          'min-h-[2px] w-full bg-chart-1 transition-opacity',
                          dense ? 'rounded-t-[2px]' : 'rounded-t-[4px]',
                          active === i && 'opacity-85',
                        )}
                        initial={{ height: 0 }}
                        animate={{ height: `${(v / top) * 100}%` }}
                        transition={{
                          duration: 0.5,
                          delay: Math.min(i * 0.015, 0.4),
                          ease: [0.22, 1, 0.36, 1],
                        }}
                      />
                    )}
                  </div>
                  {active === i && (
                    <div
                      role="tooltip"
                      className={cn(
                        'pointer-events-none absolute bottom-full z-10 mb-2 w-max max-w-56 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md',
                        edge === 'start' && 'left-0',
                        edge === 'end' && 'right-0',
                        edge === 'center' && 'left-1/2 -translate-x-1/2',
                      )}
                    >
                      <div className="text-sm font-semibold tabular-nums">{fmt(v)}</div>
                      <div className="text-muted-foreground">{dayLabel(d.date, true)}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                        {measure === 'cost'
                          ? t('callsValue', { count: d.calls })
                          : t('costValue', { cost: usd(d.costUsd) })}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground" aria-hidden>
            <span>{data[0] && dayLabel(data[0].date)}</span>
            {data.length > 2 && <span>{dayLabel(data[Math.floor(data.length / 2)]!.date)}</span>}
            <span>{data.at(-1) && dayLabel(data.at(-1)!.date)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
