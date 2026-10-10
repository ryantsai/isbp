'use client';

import Link from 'next/link';
import type * as React from 'react';
import { cn } from '../lib/utils';
import { IconTile } from './icon-tile';
import { AnimatedNumber } from './motion';

export type StatTone = 'default' | 'success' | 'info' | 'warning' | 'destructive';

const iconTone: Record<StatTone, string> = {
  default: 'text-muted-foreground',
  success: 'text-success',
  info: 'text-info',
  warning: 'text-warning-foreground',
  destructive: 'text-destructive',
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
          <IconTile aria-hidden size="sm" className={iconTone[tone]}>
            {icon}
          </IconTile>
        )}
      </div>
      <div className="text-[22px] leading-7 font-semibold tracking-tight tabular-nums">
        {typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  const base = 'flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-3.5 py-3 text-card-foreground';
  if (!href) return <div className={cn(base, className)}>{body}</div>;
  return (
    <Link
      href={href}
      className={cn(
        base,
        'outline-none transition-[translate,box-shadow,border-color] duration-150 ease-move hover:-translate-y-px hover:border-primary/50 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      {body}
    </Link>
  );
}
