'use client';

import { Card } from '@astryxdesign/core/Card';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import type * as React from 'react';
import { cn } from '../lib/utils';
import { IconTile } from './icon-tile';
import { AnimatedNumber } from './motion';

export type StatTone = 'default' | 'success' | 'info' | 'warning' | 'destructive';

/** The tone tints the icon tile only (it takes its colour from the text colour). */
const iconTone: Record<StatTone, string> = {
  default: 'text-(--color-text-secondary)',
  success: 'text-(--color-success)',
  info: 'text-(--color-text-blue)',
  warning: 'text-(--color-text-yellow)',
  destructive: 'text-(--color-error)',
};

/** Plain text of a node when it is one, for the accessible name of a linked tile. */
function textOf(node: React.ReactNode): string | undefined {
  return typeof node === 'string' || typeof node === 'number' ? String(node) : undefined;
}

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
    <VStack gap={1}>
      <HStack gap={3} hAlign="between" vAlign="start">
        <Text as="div" type="supporting" className="min-w-0">
          {label}
        </Text>
        {icon && (
          <IconTile aria-hidden size="sm" className={iconTone[tone]}>
            {icon}
          </IconTile>
        )}
      </HStack>
      <Text as="div" size="2xl" weight="semibold" hasTabularNumbers>
        {typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value}
      </Text>
      {hint && (
        <Text as="div" type="supporting" size="xsm">
          {hint}
        </Text>
      )}
    </VStack>
  );
  if (!href)
    return (
      <Card padding={3} className={cn('min-w-0', className)}>
        {body}
      </Card>
    );
  // The link's name carries the number and context too, as the whole tile used to be the link.
  const name = [
    textOf(label),
    typeof value === 'number' ? (format ? format(value) : String(value)) : textOf(value),
    textOf(hint),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <ClickableCard href={href} label={name} padding={3} className={cn('min-w-0', className)}>
      {body}
    </ClickableCard>
  );
}
