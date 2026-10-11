'use client';

import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { cn } from '../lib/utils';
import { duration, ease, useReducedMotion } from './motion';

/**
 * Status tones. `success` done/healthy · `info` in progress · `warning` needs attention soon · `destructive`
 * failed/blocked/overdue · `muted` inactive/draft/unknown · `primary` unread/pending counts · `neutral` a
 * non-status attribute that still needs a chip.
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

/** Our tones on Astryx `Badge` variants (the theme tints them; `primary` is the accent blue). */
const badgeVariant: Record<StatusTone, BadgeVariant> = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  destructive: 'error',
  muted: 'neutral',
  primary: 'blue',
  neutral: 'neutral',
};

/** Astryx's `Badge` has no `title`: a native tooltip needs a wrapper, which then carries the caller's `className`. */
function ChipTitle({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (!title) return children;
  return (
    <span title={title} className={cn('inline-flex max-w-full shrink-0', className)}>
      {children}
    </span>
  );
}

/**
 * The one status chip: icon + text, never colour alone. `quiet` renders muted text with the icon and no chip, for
 * the value most rows have (show chips only for the exceptions). `changeKey` cross-fades the chip when the status
 * changes in place (pass the status code).
 */
export function StatusBadge({
  tone = 'muted',
  icon,
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
  const text = label ?? children;
  const glyph = icon ? <Icon icon={icon} size="sm" /> : undefined;
  const body = quiet ? (
    <span
      data-slot="status-badge"
      data-tone={tone}
      title={title}
      className={cn('inline-flex w-fit max-w-full shrink-0 items-center gap-1 whitespace-nowrap', className)}
    >
      {icon && <Icon icon={icon} size="sm" color="secondary" />}
      <span className="min-w-0 truncate">
        <Text size="sm" weight="medium" color="secondary">
          {text}
        </Text>
      </span>
    </span>
  ) : (
    <ChipTitle title={title} className={className}>
      <Badge
        data-slot="status-badge"
        data-tone={tone}
        variant={badgeVariant[tone]}
        icon={glyph}
        label={text}
        className={cn('w-max max-w-full shrink-0', !title && className)}
      />
    </ChipTitle>
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
