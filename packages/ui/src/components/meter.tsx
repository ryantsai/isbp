'use client';

import { HStack } from '@astryxdesign/core/Layout';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { useLocale } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';

export type MeterTone = 'primary' | 'neutral' | 'success' | 'info' | 'warning' | 'destructive';

/** Our tones on Astryx `ProgressBar` variants (it has no separate `info`: that is the accent too). */
const barVariant = {
  primary: 'accent',
  neutral: 'neutral',
  success: 'success',
  info: 'accent',
  warning: 'warning',
  destructive: 'error',
} as const satisfies Record<MeterTone, 'accent' | 'neutral' | 'success' | 'warning' | 'error'>;

/**
 * A horizontal bar for a value in a range (usage, progress, score). Astryx's `ProgressBar` draws it; the wrapper
 * carries the ARIA role Astryx lacks: `meter` for a value in a range (usage, scores), `progressbar` with
 * `kind="progress"` for task progress. Status tones only for status; scores and values use `primary` or `neutral`.
 * (`size` is accepted for compatibility: Astryx has one bar height.)
 */
export function Meter({
  value,
  max = 100,
  label,
  'aria-labelledby': labelledBy,
  valueText,
  showValue = false,
  tone = 'primary',
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
  return (
    <HStack gap={2} vAlign="center" className={cn('min-w-0', className)}>
      <div
        role={kind === 'progress' ? 'progressbar' : 'meter'}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        className="min-w-0 flex-1"
      >
        {/* The bar is decorative: the wrapper above is what assistive technology reads. */}
        <ProgressBar
          aria-hidden
          isLabelHidden
          label={label ?? text}
          value={value}
          max={max}
          variant={barVariant[tone]}
        />
      </div>
      {showValue && (
        <Text aria-hidden type="supporting" hasTabularNumbers className="shrink-0">
          {text}
        </Text>
      )}
    </HStack>
  );
}
