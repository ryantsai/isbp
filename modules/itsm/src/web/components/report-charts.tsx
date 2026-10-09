'use client';

import { useReducedMotion } from '@isbp/ui/motion';
import { cn } from '@isbp/ui';
import { motion } from 'motion/react';
import Link from 'next/link';
import { type DateTimeFormatOptions, useFormatter, useTranslations } from 'next-intl';
import { niceTicks } from '../logic';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

/* ───────────────────────────── helpers ───────────────────────────── */

/** Container width (for crisp SVG at any size, no stretched strokes). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Day label for `YYYY-MM-DD` (a calendar date, not an instant). */
export function useDayLabel() {
  const format = useFormatter();
  return (iso: string, opts: DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), { ...opts, timeZone: 'UTC' });
}

/* ───────────────────────────── chart frame ───────────────────────────── */

/** Card body with a Chart | Table switch: every chart has its table twin. */
export function ChartFrame({
  title,
  description,
  legend,
  chart,
  table,
  busy,
}: {
  title: string;
  description?: string;
  legend?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  busy?: boolean;
}) {
  const t = useTranslations('itsm.reports');
  const id = useId();
  const [asTable, setAsTable] = useState(false);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-xs"
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
      {legend}
      <div className={cn('min-w-0 transition-opacity', busy && 'opacity-60')}>{asTable ? table : chart}</div>
    </section>
  );
}

export function DataTableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/60">
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn('px-3 py-2 text-left text-xs font-medium', i > 0 && 'text-right')}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[0])} className="border-t">
              {r.map((c, i) => (
                <td key={i} className={cn('px-3 py-1.5', i > 0 && 'text-right tabular-nums')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────────── line chart ───────────────────────────── */

export interface LineSeries {
  key: string;
  label: string;
  /** Tailwind token, e.g. `chart-1`. */
  color: 'chart-1' | 'chart-2';
  values: number[];
}

const STROKE = { 'chart-1': 'stroke-chart-1', 'chart-2': 'stroke-chart-2' } as const;
const FILL = { 'chart-1': 'fill-chart-1', 'chart-2': 'fill-chart-2' } as const;
const BG = { 'chart-1': 'bg-chart-1', 'chart-2': 'bg-chart-2' } as const;

export function LineLegend({ series }: { series: LineSeries[] }) {
  const format = useFormatter();
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-2">
          <span className={cn('h-0.5 w-4 rounded-full', BG[s.color])} aria-hidden />
          <span className="text-muted-foreground">{s.label}</span>
          <span className="font-medium tabular-nums">
            {format.number(s.values.reduce((a, b) => a + b, 0))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Multi-series line chart: 2px lines, hairline grid, crosshair + one tooltip listing every series at the
 * hovered (or keyboard-focused) day. Arrow keys move along the x axis.
 */
export function LineChart({
  labels,
  series,
  formatLabel,
  ariaLabel,
  height = 220,
}: {
  labels: string[];
  series: LineSeries[];
  formatLabel: (label: string) => string;
  ariaLabel: string;
  height?: number;
}) {
  const reduce = useReducedMotion();
  const format = useFormatter();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const pad = { top: 8, right: 12, bottom: 24, left: 36 };
  const n = labels.length;
  const { max, ticks } = niceTicks(Math.max(0, ...series.flatMap((s) => s.values)));
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const path = (values: number[]) =>
    values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = e.clientX - rect.left;
    setActive(Math.max(0, Math.min(n - 1, Math.round((rel / Math.max(1, rect.width)) * (n - 1)))));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive((cur) => {
        const c = cur ?? n - 1;
        if (e.key === 'Home') return 0;
        if (e.key === 'End') return n - 1;
        return Math.max(0, Math.min(n - 1, c + (e.key === 'ArrowRight' ? 1 : -1)));
      });
    }
  };
  const tickIdx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : labels.map((_, i) => i);
  const readout =
    active !== null
      ? `${formatLabel(labels[active]!)}: ${series.map((s) => `${s.label} ${format.number(s.values[active] ?? 0)}`).join(', ')}`
      : '';

  return (
    <div
      ref={ref}
      className="relative rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={onKey}
      onFocus={() => setActive((cur) => cur ?? n - 1)}
      onBlur={() => setActive(null)}
    >
      <span className="sr-only" aria-live="polite">
        {readout}
      </span>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          {ticks.map((tk) => (
            <g key={tk}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(tk)}
                y2={y(tk)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={y(tk)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {format.number(tk)}
              </text>
            </g>
          ))}
          {tickIdx.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              className="fill-muted-foreground text-[11px]"
            >
              {formatLabel(labels[i]!)}
            </text>
          ))}
          {series.map((s, si) => (
            <motion.path
              key={s.key}
              d={path(s.values)}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className={STROKE[s.color]}
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.25, delay: si * 0.06, ease: [0.22, 1, 0.36, 1] }}
            />
          ))}
          {active !== null && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={pad.top}
                y2={pad.top + plotH}
                className="stroke-muted-foreground/50"
                strokeWidth={1}
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={x(active)}
                  cy={y(s.values[active] ?? 0)}
                  r={4}
                  strokeWidth={2}
                  className={cn(FILL[s.color], 'stroke-card')}
                />
              ))}
            </g>
          )}
          <rect
            x={pad.left}
            y={pad.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}
      {active !== null && width > 0 && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 w-max rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          style={{
            left: Math.min(Math.max(x(active), 70), width - 70),
            top: 0,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="mb-1 text-muted-foreground">{formatLabel(labels[active]!)}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className={cn('h-0.5 w-3 rounded-full', BG[s.color])} />
              <span className="font-semibold tabular-nums">{format.number(s.values[active] ?? 0)}</span>
              <span className="text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── bars ───────────────────────────── */

/** Horizontal bars, one series (chart-1), value at the tip; hover/focus lifts the bar. */
export function HBars({
  items,
  formatValue,
  ariaLabel,
}: {
  /** `href`: the bar's label opens the matching list (e.g. the open P1 tickets). */
  items: { key: string; label: ReactNode; value: number; hint?: string; href?: string }[];
  formatValue?: (v: number) => string;
  ariaLabel: string;
}) {
  const format = useFormatter();
  const reduce = useReducedMotion();
  const max = Math.max(1, ...items.map((i) => i.value));
  const fmt = formatValue ?? ((v: number) => format.number(v));
  return (
    <ul className="grid gap-2.5" aria-label={ariaLabel}>
      {items.map((it, i) => (
        <li
          key={it.key}
          className="group grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-3 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]"
          title={it.hint}
        >
          {it.href ? (
            <Link
              href={it.href}
              className="min-w-0 truncate text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
            >
              {it.label}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-muted-foreground">{it.label}</span>
          )}
          <span className="flex min-w-0 items-center gap-2">
            <motion.span
              className="h-3.5 min-w-[2px] rounded-r-[4px] bg-chart-1 transition-opacity group-hover:opacity-80"
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${(it.value / max) * 85}%` }}
              transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.12), ease: [0.22, 1, 0.36, 1] }}
              aria-hidden
            />
            <span className="shrink-0 font-medium tabular-nums">{fmt(it.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Columns for an ordered set of buckets (backlog age): value on the cap, label underneath. */
export function Columns({
  items,
  ariaLabel,
  height = 160,
}: {
  items: { key: string; label: string; value: number }[];
  ariaLabel: string;
  height?: number;
}) {
  const reduce = useReducedMotion();
  const format = useFormatter();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div>
      <ul
        className="relative flex items-end justify-around gap-2 border-b"
        style={{ height }}
        aria-label={ariaLabel}
      >
        {items.map((it, i) => (
          <li
            key={it.key}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1 outline-none"
            tabIndex={0}
            aria-label={`${it.label}: ${format.number(it.value)}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            <span
              className={cn(
                'text-xs font-medium tabular-nums',
                hover === i ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {format.number(it.value)}
            </span>
            <motion.span
              className={cn(
                'w-6 min-h-[2px] rounded-t-[4px] bg-chart-1 transition-opacity',
                hover !== null && hover !== i && 'opacity-50',
              )}
              initial={reduce ? false : { height: 0 }}
              animate={{ height: `${(it.value / max) * (height - 28)}px` }}
              transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.12), ease: [0.22, 1, 0.36, 1] }}
              aria-hidden
            />
          </li>
        ))}
      </ul>
      <div
        className="mt-2 flex justify-around gap-2 text-center text-[11px] text-muted-foreground"
        aria-hidden
      >
        {items.map((it) => (
          <span key={it.key} className="flex-1">
            {it.label}
          </span>
        ))}
      </div>
    </div>
  );
}
