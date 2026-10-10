'use client';

import { cn } from '@isbp/ui';
import { motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { stackSegments } from './logic';

/** Card with a Chart | Table switch: every chart has its table twin (same style as the service desk reports). */
export function ChartFrame({
  title,
  description,
  legend,
  chart,
  table,
  className,
}: {
  title: string;
  description?: string;
  legend?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  className?: string;
}) {
  const t = useTranslations('itam.charts');
  const id = useId();
  const [asTable, setAsTable] = useState(false);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-semibold">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <div
          className="flex items-center gap-0.5 rounded-md border p-0.5"
          role="group"
          aria-label={t('viewAs')}
        >
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={(v === 'table') === asTable}
              onClick={() => setAsTable(v === 'table')}
              className="rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-secondary aria-pressed:font-medium aria-pressed:text-secondary-foreground"
            >
              {t(v)}
            </button>
          ))}
        </div>
      </div>
      {!asTable && legend}
      <div className="min-w-0">{asTable ? table : chart}</div>
    </section>
  );
}

export function DataTableView({
  head,
  rows,
  caption,
}: {
  head: string[];
  rows: { key: string; cells: (string | number)[] }[];
  caption?: string;
}) {
  return (
    // Focusable so keyboard users can scroll it (axe: scrollable-region-focusable).
    <div
      className="max-h-80 overflow-auto rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 bg-muted/60">
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  'px-3 py-2 text-left text-xs font-medium whitespace-nowrap',
                  i > 0 && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              {r.cells.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="px-3 py-1.5 text-left font-normal">
                    {c}
                  </th>
                ) : (
                  <td key={i} className="px-3 py-1.5 text-right tabular-nums">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface SeriesDef<K extends string> {
  key: K;
  label: string;
  /** Tailwind background class, e.g. `bg-chart-1`. */
  className: string;
}

export function Legend<K extends string>({
  series,
  totals,
}: {
  series: readonly SeriesDef<K>[];
  totals?: Partial<Record<K, number>>;
}) {
  const format = useFormatter();
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-sm', s.className)} aria-hidden />
          <span className="text-muted-foreground">{s.label}</span>
          {totals && <span className="font-medium tabular-nums">{format.number(totals[s.key] ?? 0)}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Horizontal stacked bars (one row per item, segments per series). Rows are focusable and announce their
 * breakdown; hovering a row dims the others.
 */
export function StackedBars<K extends string>({
  rows,
  series,
  ariaLabel,
}: {
  rows: { key: string; label: ReactNode; text: string; counts: Partial<Record<K, number>> }[];
  series: readonly SeriesDef<K>[];
  ariaLabel: string;
}) {
  const format = useFormatter();
  const [active, setActive] = useState<string | null>(null);
  const totals = rows.map((r) => series.reduce((n, s) => n + (r.counts[s.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const order = series.map((s) => s.key);
  const cls = new Map(series.map((s) => [s.key, s.className]));
  const name = new Map(series.map((s) => [s.key, s.label]));
  return (
    <ul className="grid gap-2.5" aria-label={ariaLabel}>
      {rows.map((r, i) => {
        const total = totals[i]!;
        const segments = stackSegments(r.counts, order);
        const summary = `${r.text}: ${segments.map((s) => `${name.get(s.key)} ${format.number(s.value)}`).join(', ')}`;
        return (
          <li
            key={r.key}
            tabIndex={0}
            aria-label={summary}
            title={summary}
            onMouseEnter={() => setActive(r.key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(r.key)}
            onBlur={() => setActive(null)}
            className={cn(
              'grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-3 rounded-md text-sm outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/50 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]',
              active && active !== r.key && 'opacity-50',
            )}
          >
            <span className="min-w-0 truncate text-muted-foreground" aria-hidden>
              {r.label}
            </span>
            <span className="flex min-w-0 items-center gap-2" aria-hidden>
              <motion.span
                className="flex h-3.5 min-w-[2px] overflow-hidden rounded-r-[4px]"
                initial={{ width: 0 }}
                animate={{ width: `${(total / max) * 85}%` }}
                transition={{ duration: 0.6, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
              >
                {segments.map((s) => (
                  <span
                    key={s.key}
                    className={cn('h-full border-r border-card last:border-r-0', cls.get(s.key))}
                    style={{ width: `${s.percent}%` }}
                  />
                ))}
              </motion.span>
              <span className="shrink-0 font-medium tabular-nums">{format.number(total)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Horizontal bars for one series (spend by vendor), the formatted value at the tip. */
export function HBars({
  items,
  formatValue,
  ariaLabel,
}: {
  items: { key: string; label: ReactNode; text: string; value: number }[];
  formatValue: (v: number) => string;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="grid gap-2.5" aria-label={ariaLabel}>
      {items.map((it, i) => (
        <li
          key={it.key}
          className="group grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-3 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]"
        >
          <span className="min-w-0 truncate text-muted-foreground">{it.label}</span>
          <span className="flex min-w-0 items-center gap-2">
            <motion.span
              className="h-3.5 min-w-[2px] rounded-r-[4px] bg-chart-1 transition-opacity group-hover:opacity-80"
              initial={{ width: 0 }}
              animate={{ width: `${(it.value / max) * 75}%` }}
              transition={{ duration: 0.6, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              aria-hidden
            />
            <span className="shrink-0 text-xs font-medium tabular-nums">{formatValue(it.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
