'use client';

import { motion } from 'motion/react';
import { useLocale } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';
import { ease, useEntranceMotion, useReducedMotion } from './motion';

export type MeterTone = 'primary' | 'neutral' | 'success' | 'info' | 'warning' | 'destructive';

const toneClass: Record<MeterTone, string> = {
  primary: 'bg-primary',
  neutral: 'bg-foreground/55',
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
};

/**
 * A horizontal bar for a value in a range (usage, progress, score). The width animates from 0 when it appears and
 * from the old value when it changes (250 ms). Status tones only for status; scores and values use `primary` or
 * `neutral`. `kind="progress"` for task progress (role `progressbar`), otherwise role `meter`.
 */
export function Meter({
  value,
  max = 100,
  label,
  'aria-labelledby': labelledBy,
  valueText,
  showValue = false,
  tone = 'primary',
  size = 'md',
  kind = 'meter',
  className,
}: {
  value: number;
  max?: number;
  /** Accessible name; required unless `aria-labelledby` points at a visible label. */
  label?: string;
  'aria-labelledby'?: string;
  /** How the value reads (e.g. "34 of 50 seats"); defaults to a percentage. */
  valueText?: string;
  /** Show `valueText` (or the percentage) next to the bar. */
  showValue?: boolean;
  tone?: MeterTone;
  size?: 'sm' | 'md';
  kind?: 'meter' | 'progress';
  className?: string;
}) {
  const locale = useLocale();
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const percent = React.useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(ratio),
    [locale, ratio],
  );
  const text = valueText ?? percent;
  const play = useEntranceMotion();
  const reduce = useReducedMotion();
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div
        role={kind === 'progress' ? 'progressbar' : 'meter'}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-muted',
          size === 'sm' ? 'h-1.5' : 'h-2',
        )}
      >
        <motion.div
          className={cn('h-full rounded-full', toneClass[tone])}
          initial={play ? { width: 0 } : false}
          animate={{ width: `${ratio * 100}%` }}
          transition={reduce ? { duration: 0 } : { duration: 0.25, ease: ease.enter }}
        />
      </div>
      {showValue && (
        <span aria-hidden className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {text}
        </span>
      )}
    </div>
  );
}
