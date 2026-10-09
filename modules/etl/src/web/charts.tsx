'use client';

import { cn } from '@isbp/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';

/** Card with a Chart | Table switch: every chart has its table twin (dataviz convention). */
export function ChartFrame({
  title,
  description,
  legend,
  chart,
  table,
  actions,
  className,
}: {
  title: string;
  description?: string;
  legend?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('etl.charts');
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
        <div className="flex flex-wrap items-center gap-2">
          {actions}
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

export function Legend({ items }: { items: { key: string; label: string; className: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {items.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-sm', s.className)} aria-hidden />
          <span className="text-muted-foreground">{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Vertical stacked bars over time: successful calls (bottom) and errors (top). Each bar is focusable and
 * announces its numbers; the table twin carries the same data.
 */
export function CallBars({
  buckets,
  label,
  ariaLabel,
}: {
  buckets: { at: string; calls: number; errors: number }[];
  label: (at: string) => string;
  ariaLabel: string;
}) {
  const t = useTranslations('etl.stats');
  const format = useFormatter();
  const reduce = useReducedMotion();
  const max = Math.max(1, ...buckets.map((b) => b.calls));
  const height = 112;
  return (
    <figure className="grid min-w-0 gap-2">
      <ul className="flex h-32 min-w-0 items-end gap-0.5 sm:gap-1" aria-label={ariaLabel}>
        {buckets.map((b, i) => {
          const ok = ((b.calls - b.errors) / max) * height;
          const bad = (b.errors / max) * height;
          const text = t('barLabel', {
            at: label(b.at),
            calls: format.number(b.calls),
            errors: format.number(b.errors),
          });
          return (
            <li
              key={b.at}
              tabIndex={0}
              aria-label={text}
              title={text}
              className="flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {b.errors > 0 && (
                <motion.span
                  className="block w-full rounded-t-sm bg-destructive"
                  initial={reduce ? false : { height: 0 }}
                  animate={{ height: Math.max(bad, 2) }}
                  transition={{ duration: 0.4, delay: i * 0.01 }}
                />
              )}
              <motion.span
                className={cn('block w-full bg-chart-5', b.errors === 0 && 'rounded-t-sm')}
                initial={reduce ? false : { height: 0 }}
                animate={{ height: b.calls - b.errors > 0 ? Math.max(ok, 2) : 0 }}
                transition={{ duration: 0.4, delay: i * 0.01 }}
              />
              {b.calls === 0 && <span className="block h-0.5 w-full rounded-full bg-border" />}
            </li>
          );
        })}
      </ul>
      <figcaption className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{buckets[0] && label(buckets[0].at)}</span>
        <span>{buckets.at(-1) && label(buckets.at(-1)!.at)}</span>
      </figcaption>
    </figure>
  );
}
