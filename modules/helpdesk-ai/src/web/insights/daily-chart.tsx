'use client';

import { cn } from '@isbp/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { Overview } from '../../contracts';

type Day = Overview['daily'][number];

const HEIGHT = 208;
const PAD = { top: 12, right: 4, bottom: 22, left: 34 };
const GAP = 2;
const RADIUS = 4;

/** A clean axis maximum and step (1 / 2 / 5 × 10ⁿ, four intervals). */
export function niceScale(max: number): { max: number; step: number } {
  const raw = Math.max(1, max) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { max: Math.max(step * 4, Math.ceil(max / step) * step), step: Math.max(1, step) };
}

/** A column with a rounded top (data end) and a square base. */
function columnPath(x: number, y: number, w: number, h: number, rounded: boolean) {
  if (h <= 0) return '';
  const r = rounded ? Math.min(RADIUS, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${
    r ? `Q${x + w},${y} ${x + w},${y + r}` : ''
  }V${y + h}Z`;
}

/**
 * Daily conversations, split into those escalated to a ticket (chart-1, at the base) and the rest
 * (chart-2). Hover or arrow keys show a day's values; the same numbers are in the table view.
 */
export function DailyChart({ data }: { data: Day[] }) {
  const t = useTranslations('helpdesk-ai');
  const format = useFormatter();
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const label = (iso: string, long = false) =>
    format.dateTime(
      new Date(`${iso}T00:00:00`),
      long ? { dateStyle: 'medium' } : { month: 'short', day: 'numeric' },
    );
  const totals = data.reduce(
    (a, d) => ({
      conversations: a.conversations + d.conversations,
      escalations: a.escalations + d.escalations,
    }),
    { conversations: 0, escalations: 0 },
  );
  const scale = niceScale(Math.max(...data.map((d) => d.conversations), 1));
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const band = data.length ? innerW / data.length : 0;
  const barW = Math.max(1, Math.min(24, band * 0.62));
  const y = (v: number) => PAD.top + innerH * (1 - v / scale.max);
  const ticks = Array.from({ length: Math.round(scale.max / scale.step) + 1 }, (_, i) => i * scale.step);
  const at = active !== null ? data[active] : null;

  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !band) return;
    const i = Math.floor((clientX - rect.left - PAD.left) / band);
    setActive(i >= 0 && i < data.length ? i : null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!data.length) return;
    const next =
      e.key === 'ArrowRight'
        ? (active ?? -1) + 1
        : e.key === 'ArrowLeft'
          ? (active ?? data.length) - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? data.length - 1
              : e.key === 'Escape'
                ? null
                : undefined;
    if (next === undefined) return;
    e.preventDefault();
    setActive(next === null ? null : Math.min(data.length - 1, Math.max(0, next)));
  };

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" aria-label={t('chart.legend')}>
        <li className="flex items-center gap-2">
          <span className="size-2.5 rounded-[3px] bg-chart-2" aria-hidden />
          <span className="text-muted-foreground">{t('chart.answered')}</span>
          <span className="font-medium tabular-nums">
            {format.number(totals.conversations - totals.escalations)}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="size-2.5 rounded-[3px] bg-chart-1" aria-hidden />
          <span className="text-muted-foreground">{t('chart.escalated')}</span>
          <span className="font-medium tabular-nums">{format.number(totals.escalations)}</span>
        </li>
      </ul>

      <div
        ref={box}
        role="group"
        tabIndex={0}
        aria-roledescription={t('chart.roledescription')}
        aria-label={t('chart.aria', { days: data.length })}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        className="relative rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        style={{ height: HEIGHT }}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} aria-hidden className="block overflow-visible">
            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(v)}
                  y2={y(v)}
                  className="stroke-border"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={PAD.left - 8}
                  y={y(v)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {format.number(v)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = PAD.left + i * band + (band - barW) / 2;
              const esc = Math.min(d.escalations, d.conversations);
              const rest = d.conversations - esc;
              const escH = (innerH * esc) / scale.max;
              const restH = Math.max(0, (innerH * rest) / scale.max - (esc && rest ? GAP : 0));
              const base = PAD.top + innerH;
              const dim = active !== null && active !== i;
              return (
                // No entrance replay on every visit; only the hover dimming moves.
                <motion.g
                  key={d.date}
                  initial={false}
                  animate={{ opacity: dim ? 0.45 : 1 }}
                  transition={{ duration: reduce ? 0 : 0.12 }}
                >
                  {esc > 0 && (
                    <path d={columnPath(x, base - escH, barW, escH, rest === 0)} className="fill-chart-1" />
                  )}
                  {rest > 0 && (
                    <path
                      d={columnPath(x, base - escH - (esc ? GAP : 0) - restH, barW, restH, true)}
                      className="fill-chart-2"
                    />
                  )}
                </motion.g>
              );
            })}
            {data.length > 0 &&
              [0, Math.floor((data.length - 1) / 2), data.length - 1]
                .filter((v, i, a) => a.indexOf(v) === i)
                .map((i) => (
                  <text
                    key={i}
                    x={PAD.left + i * band + band / 2}
                    y={HEIGHT - 4}
                    textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
                    className="fill-muted-foreground text-[11px]"
                  >
                    {label(data[i]!.date)}
                  </text>
                ))}
          </svg>
        )}
        {at && active !== null && (
          <div
            role="presentation"
            className="pointer-events-none absolute z-10 w-max -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
            style={{
              left: Math.min(Math.max(PAD.left + active * band + band / 2, 70), width - 70),
              top: Math.max(0, y(at.conversations) - 72),
            }}
          >
            <div className="font-medium">{label(at.date, true)}</div>
            <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
              <span className="h-0.5 w-3 rounded-full bg-chart-2" /> {t('chart.answered')}
              <span className="ml-auto pl-3 font-semibold text-foreground tabular-nums">
                {at.conversations - at.escalations}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-0.5 w-3 rounded-full bg-chart-1" /> {t('chart.escalated')}
              <span className="ml-auto pl-3 font-semibold text-foreground tabular-nums">
                {at.escalations}
              </span>
            </div>
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {at
            ? t('chart.point', {
                date: label(at.date, true),
                total: at.conversations,
                escalated: at.escalations,
              })
            : ''}
        </p>
      </div>

      <details className="group text-sm">
        <summary className="w-fit cursor-pointer rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {t('chart.table')}
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border">
          <table id={tableId} className="w-full text-xs">
            <caption className="sr-only">{t('chart.caption')}</caption>
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  {t('chart.date')}
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  {t('chart.conversations')}
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  {t('chart.escalated')}
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  {t('chart.deflected')}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date} className={cn('border-t', !d.conversations && 'text-muted-foreground')}>
                  <th scope="row" className="px-3 py-1 text-left font-normal">
                    {label(d.date, true)}
                  </th>
                  <td className="px-3 py-1 text-right tabular-nums">{d.conversations}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{d.escalations}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{d.deflections}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
