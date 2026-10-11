'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { ToggleButton, ToggleButtonGroup } from '@astryxdesign/core/ToggleButton';
import { cn } from '@isbp/ui';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ActivityIcon, RocketIcon, TimerIcon, TriangleAlertIcon, Undo2Icon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { Dora } from '../contracts';
import { dateOnly, useHours } from './lib';

/** The four DORA-style production metrics with a weekly chart (and its table twin). */
export function DoraCard({ code, days = 90 }: { code: string; days?: number }) {
  const t = useTranslations('alm.dora');
  const format = useFormatter();
  const hours = useHours();
  const { data } = useApiQuery<Dora>(`/alm/applications/${code}/metrics`, { days });
  const id = useId();
  const [asTable, setAsTable] = useState(false);

  const tiles = data
    ? [
        {
          key: 'frequency',
          icon: RocketIcon,
          value: t('perWeek', {
            n: format.number(data.deploymentFrequency.perWeek, { maximumFractionDigits: 1 }),
          }),
          hint: t('frequencyHint', { count: data.deploymentFrequency.total }),
        },
        {
          key: 'failureRate',
          icon: TriangleAlertIcon,
          value:
            data.changeFailureRate.rate === null
              ? '—'
              : format.number(data.changeFailureRate.rate, { style: 'percent', maximumFractionDigits: 1 }),
          hint: t('failureRateHint', {
            failures: data.changeFailureRate.failures,
            finished: data.changeFailureRate.finished,
          }),
        },
        {
          key: 'leadTime',
          icon: TimerIcon,
          value: hours(data.leadTime.medianHours),
          hint: t('samplesLead', { count: data.leadTime.samples }),
        },
        {
          key: 'restore',
          icon: Undo2Icon,
          value: hours(data.timeToRestore.medianHours),
          hint: t('samplesRestore', { count: data.timeToRestore.samples }),
        },
      ]
    : [];

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle id={`${id}-title`} role="heading" aria-level={2}>
          <HStack gap={2} vAlign="center">
            <Icon icon={ActivityIcon} color="accent" />
            {t('title')}
          </HStack>
        </CardTitle>
        <CardDescription>{t('description', { days })}</CardDescription>
        <CardAction>
          <ToggleButtonGroup
            label={t('viewAs')}
            size="sm"
            value={asTable ? 'table' : 'chart'}
            onChange={(v) => v && setAsTable(v === 'table')}
          >
            <ToggleButton value="chart" label={t('chart')} />
            <ToggleButton value="table" label={t('table')} />
          </ToggleButtonGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-5">
        {!data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {tiles.map((tile) => (
                <div key={tile.key} className="min-w-0 rounded-lg border bg-background p-3">
                  <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <tile.icon className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{t(`tiles.${tile.key}`)}</span>
                  </dt>
                  <dd className="mt-1 truncate text-xl font-semibold tracking-tight">{tile.value}</dd>
                  <dd className="truncate text-xs text-muted-foreground">{tile.hint}</dd>
                  <dd className="mt-1 text-xs text-muted-foreground">{t(`tileHints.${tile.key}`)}</dd>
                </div>
              ))}
            </dl>
            {asTable ? <WeeklyTable data={data} /> : <WeeklyBars data={data} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function useWeekLabel() {
  const format = useFormatter();
  return (week: string) =>
    format.dateTime(dateOnly(week), { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Stacked weekly bars: successful (bottom) and failed or rolled back (top) production deployments. */
function WeeklyBars({ data }: { data: Dora }) {
  const t = useTranslations('alm.dora');
  const label = useWeekLabel();
  const reduce = useReducedMotion();
  const max = Math.max(1, ...data.weekly.map((w) => w.succeeded + w.failed));
  const height = 112;
  return (
    <figure className="grid min-w-0 gap-2">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success" aria-hidden />
          {t('succeeded')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-destructive" aria-hidden />
          {t('failed')}
        </span>
      </div>
      <div className="flex h-32 min-w-0 items-end gap-1" aria-hidden>
        {data.weekly.map((w, i) => {
          const ok = (w.succeeded / max) * height;
          const bad = (w.failed / max) * height;
          return (
            <div
              key={w.week}
              className="flex min-w-0 flex-1 flex-col justify-end"
              title={`${label(w.week)}: ${w.succeeded} / ${w.failed}`}
            >
              {w.failed > 0 && (
                <motion.div
                  className="w-full rounded-t-sm bg-destructive"
                  initial={reduce ? false : { height: 0 }}
                  animate={{ height: bad }}
                  transition={{ duration: 0.4, delay: i * 0.015 }}
                />
              )}
              <motion.div
                className={cn('w-full bg-success', w.failed === 0 && 'rounded-t-sm')}
                initial={reduce ? false : { height: 0 }}
                animate={{ height: Math.max(ok, w.succeeded ? 2 : 0) }}
                transition={{ duration: 0.4, delay: i * 0.015 }}
              />
              {w.succeeded + w.failed === 0 && <div className="h-0.5 w-full rounded-full bg-border" />}
            </div>
          );
        })}
      </div>
      <figcaption className="flex justify-between text-xs text-muted-foreground">
        <span>{data.weekly[0] && label(data.weekly[0].week)}</span>
        <span>{t('weeklyCaption')}</span>
        <span>{data.weekly.at(-1) && label(data.weekly.at(-1)!.week)}</span>
      </figcaption>
    </figure>
  );
}

function WeeklyTable({ data }: { data: Dora }) {
  const t = useTranslations('alm.dora');
  const label = useWeekLabel();
  return (
    <div className="max-h-72 overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">{t('weeklyCaption')}</caption>
        <thead className="sticky top-0 bg-muted/60">
          <tr>
            <th scope="col" className="px-3 py-2 text-left text-xs font-medium">
              {t('weekOf')}
            </th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-medium">
              {t('succeeded')}
            </th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-medium">
              {t('failed')}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.weekly.map((w) => (
            <tr key={w.week} className="border-t">
              <th scope="row" className="px-3 py-1.5 text-left font-normal">
                {label(w.week)}
              </th>
              <td className="px-3 py-1.5 text-right tabular-nums">{w.succeeded}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{w.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
