'use client';

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { cn } from '../lib/utils';
import { duration, ease, useReducedMotion } from './motion';

/**
 * Status tones. `success` done/healthy · `info` in progress · `warning` needs attention soon · `destructive`
 * failed/blocked/overdue · `muted` inactive/draft/unknown · `primary` unread/pending counts · `neutral` a
 * non-status attribute that still needs a chip (outline).
 */
export type StatusTone = 'success' | 'info' | 'warning' | 'destructive' | 'muted' | 'primary' | 'neutral';

export type StatusIcon = React.ComponentType<{
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}>;

export interface StatusDef {
  tone: StatusTone;
  icon?: StatusIcon;
  /** Catalog key of the label, relative to the namespace the module reads it with. */
  labelKey: string;
  /** The usual value of its column (Active, In use): render quietly, as muted text. */
  quiet?: boolean;
}

/** Declares a module's status map once (status → tone, icon, label key). Identity function for typing. */
export function defineStatusMap<K extends string>(map: Record<K, StatusDef>): Record<K, StatusDef> {
  return map;
}

const toneClass: Record<StatusTone, string> = {
  success: 'border-transparent bg-success/12 text-success',
  info: 'border-transparent bg-info/12 text-info',
  warning: 'border-transparent bg-warning/15 text-warning-foreground',
  destructive: 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20',
  muted: 'border-transparent bg-muted text-muted-foreground',
  primary: 'border-transparent bg-primary/10 text-primary dark:bg-primary/20',
  neutral: 'text-foreground',
};

/**
 * The one status chip: icon + text, never colour alone. `quiet` renders muted text with the icon and no chip, for
 * the value most rows have (show chips only for the exceptions). `changeKey` cross-fades the chip when the status
 * changes in place (pass the status code).
 */
export function StatusBadge({
  tone = 'muted',
  icon: Icon,
  label,
  children,
  quiet,
  changeKey,
  title,
  className,
}: {
  tone?: StatusTone;
  icon?: StatusIcon | null;
  label?: React.ReactNode;
  children?: React.ReactNode;
  quiet?: boolean;
  changeKey?: string;
  title?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const body = (
    <span
      data-slot="status-badge"
      data-tone={tone}
      title={title}
      className={cn(
        'inline-flex w-fit max-w-full shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap [&>svg]:size-3.5 [&>svg]:shrink-0',
        quiet ? 'text-muted-foreground' : cn('rounded-md border px-2 py-0.5', toneClass[tone]),
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
      <span className="truncate">{label ?? children}</span>
    </span>
  );
  if (changeKey === undefined) return body;
  return (
    <span className="relative inline-flex">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={changeKey}
          className="inline-flex"
          initial={reduce ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: reduce ? 0 : duration.fast } }}
          transition={{ duration: duration.base, ease: ease.enter }}
        >
          {body}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Renders a status from a `defineStatusMap` map. `t` translates the map's `labelKey`s. Unknown values fall back to
 * a muted chip with the raw value's `fallbackLabel` (or the value itself).
 */
export function MappedStatus<K extends string>({
  map,
  value,
  t,
  fallbackLabel,
  quiet,
  animate,
  className,
}: {
  map: Record<K, StatusDef>;
  value: K | (string & {});
  t: (key: string) => string;
  fallbackLabel?: string;
  /** Override the map's `quiet`. */
  quiet?: boolean;
  /** Cross-fade when the value changes in place. */
  animate?: boolean;
  className?: string;
}) {
  const def = (map as Record<string, StatusDef | undefined>)[value];
  if (!def) return <StatusBadge tone="muted" label={fallbackLabel ?? value} className={className} />;
  return (
    <StatusBadge
      tone={def.tone}
      icon={def.icon}
      label={t(def.labelKey)}
      quiet={quiet ?? def.quiet}
      changeKey={animate ? value : undefined}
      className={className}
    />
  );
}
