'use client';

import { cn } from '@isbp/ui';
import { motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';

/** Card with a Chart | Table switch: every chart has its table twin. */
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
  const t = useTranslations('scheduler.charts');
  const id = useId();
  const [asTable, setAsTable] = useState(false);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-xs',
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
        <thead className="sticky top-0 bg-muted">
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
                  <th key={i} scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap">
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
 * Vertical stacked columns over time (one per bucket, segments per series in a fixed order). Columns are
 * focusable and announce their breakdown; hovering or focusing one dims the others.
 */
export function StackedColumns<K extends string>({
  buckets,
  series,
  ariaLabel,
  tickEvery = 3,
}: {
  buckets: { key: string; label: string; text: string; counts: Partial<Record<K, number>> }[];
  series: readonly SeriesDef<K>[];
  ariaLabel: string;
  tickEvery?: number;
}) {
  const format = useFormatter();
  const [active, setActive] = useState<string | null>(null);
  const totals = buckets.map((b) => series.reduce((n, s) => n + (b.counts[s.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2">
      <div
        className="flex h-44 flex-col justify-between text-right text-[11px] text-muted-foreground tabular-nums"
        aria-hidden
      >
        <span>{format.number(max)}</span>
        <span>{format.number(Math.round(max / 2))}</span>
        <span>0</span>
      </div>
      <div className="min-w-0">
        <ul
          className="flex h-44 items-end gap-[2px] border-b border-l px-0.5 sm:gap-1"
          aria-label={ariaLabel}
        >
          {buckets.map((b, i) => {
            const total = totals[i]!;
            const parts = series.filter((s) => (b.counts[s.key] ?? 0) > 0);
            const summary = `${b.text}: ${
              parts.length
                ? parts.map((s) => `${s.label} ${format.number(b.counts[s.key] ?? 0)}`).join(', ')
                : format.number(0)
            }`;
            return (
              <li
                key={b.key}
                tabIndex={0}
                aria-label={summary}
                title={summary}
                onMouseEnter={() => setActive(b.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(b.key)}
                onBlur={() => setActive(null)}
                className={cn(
                  'flex h-full min-w-0 flex-1 flex-col justify-end rounded-t-sm outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/50',
                  active && active !== b.key && 'opacity-50',
                )}
              >
                <motion.span
                  className="flex w-full flex-col-reverse overflow-hidden rounded-t-[3px]"
                  initial={{ height: 0 }}
                  animate={{ height: `${(total / max) * 100}%` }}
                  transition={{ duration: 0.5, delay: i * 0.015, ease: [0.22, 1, 0.36, 1] }}
                  aria-hidden
                >
                  {parts.map((s) => (
                    <span
                      key={s.key}
                      className={cn('w-full border-t border-card first:border-t-0', s.className)}
                      style={{ height: `${((b.counts[s.key] ?? 0) / Math.max(1, total)) * 100}%` }}
                    />
                  ))}
                </motion.span>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-[2px] px-0.5 pt-1 text-[11px] text-muted-foreground sm:gap-1" aria-hidden>
          {buckets.map((b, i) => (
            <span key={b.key} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
              {i % tickEvery === 0 ? b.label : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
