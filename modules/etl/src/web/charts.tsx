'use client';

import { HStack, VStack } from '@astryxdesign/core/Layout';
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { ToggleButton, ToggleButtonGroup } from '@astryxdesign/core/ToggleButton';
import { cn } from '@isbp/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
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
    <Card role="region" aria-labelledby={`${id}-title`} className={cn('min-w-0', className)}>
      <CardHeader>
        <HStack gap={2} hAlign="between" vAlign="start" wrap="wrap">
          <VStack gap={0.5} className="min-w-0">
            <CardTitle id={`${id}-title`} role="heading" aria-level={2}>
              {title}
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </VStack>
          <HStack gap={2} wrap="wrap" vAlign="center">
            {actions}
            <ToggleButtonGroup
              label={t('viewAs')}
              size="sm"
              value={asTable ? 'table' : 'chart'}
              onChange={(v) => {
                if (typeof v === 'string') setAsTable(v === 'table');
              }}
            >
              <ToggleButton value="chart" label={t('chart')} />
              <ToggleButton value="table" label={t('table')} />
            </ToggleButtonGroup>
          </HStack>
        </HStack>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        {!asTable && legend}
        <div className="min-w-0">{asTable ? table : chart}</div>
      </CardContent>
    </Card>
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
  const data = rows.map((r) => ({ key: r.key, ...r.cells }));
  return (
    <ScrollableArea label={caption ?? ''} role="region" className="max-h-80">
      <Table
        aria-label={caption}
        density="compact"
        data={data}
        idKey="key"
        columns={head.map((h, i) => ({
          key: String(i),
          header: h,
          align: i > 0 ? ('end' as const) : undefined,
          renderCell: (r: Record<string, unknown>) => (
            <Text hasTabularNumbers={i > 0}>{r[String(i)] as string | number}</Text>
          ),
        }))}
      />
    </ScrollableArea>
  );
}

export function Legend({ items }: { items: { key: string; label: string; className: string }[] }) {
  return (
    <HStack as="ul" gap={4} wrap="wrap" vAlign="center">
      {items.map((s) => (
        <HStack as="li" key={s.key} gap={1.5} vAlign="center">
          <span className={cn('size-2.5 rounded-sm', s.className)} aria-hidden />
          <Text type="supporting">{s.label}</Text>
        </HStack>
      ))}
    </HStack>
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
      <HStack as="figcaption" hAlign="between" gap={2}>
        <Text type="supporting">{buckets[0] && label(buckets[0].at)}</Text>
        <Text type="supporting">{buckets.at(-1) && label(buckets.at(-1)!.at)}</Text>
      </HStack>
    </figure>
  );
}
