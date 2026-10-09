'use client';

import Link from 'next/link';
import type * as React from 'react';
import { cn } from '../lib/utils';
import { AnimatedNumber } from './motion';

export type StatTone = 'default' | 'success' | 'info' | 'warning' | 'destructive';

const iconTone: Record<StatTone, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-success/12 text-success',
  info: 'bg-info/12 text-info',
  warning: 'bg-warning/15 text-warning-foreground',
  destructive: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
};

/**
 * A KPI tile: label, number (rendered at once; animates only when it changes later), one line of context. With
 * `href` the whole tile is a link to the filtered list behind the number (counts of problems must be links), and it
 * lifts on hover. `tone` colours the icon only: the label says what the number means.
 */
export function StatTile({
  label,
  value,
  format,
  hint,
  href,
  icon,
  tone = 'default',
  className,
}: {
  label: React.ReactNode;
  value: number | React.ReactNode;
  format?: (n: number) => string;
  hint?: React.ReactNode;
  href?: string;
  icon?: React.ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm text-muted-foreground">{label}</div>
        {icon && (
          <span
            aria-hidden
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4',
              iconTone[tone],
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">
        {typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  const base = 'flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card p-4 text-card-foreground shadow-xs';
  if (!href) return <div className={cn(base, className)}>{body}</div>;
  return (
    <Link
      href={href}
      className={cn(
        base,
        'outline-none transition-[translate,box-shadow,border-color] duration-150 ease-move hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      {body}
    </Link>
  );
}
