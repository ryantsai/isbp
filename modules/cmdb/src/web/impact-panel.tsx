'use client';

import { localize } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BriefcaseBusinessIcon,
  ListIcon,
  NetworkIcon,
  TriangleAlertIcon,
  WaypointsIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { type CiRef, type Impact, type ImpactNode, MAX_IMPACT_DEPTH } from '../contracts';
import { impactChildDirection, type ImpactDirection } from '../model';
import { CiStatusBadge } from './badges';
import { ClassIcon } from './class-icon';
import { ciHref } from './data';
import { ImpactGraph } from './impact-graph';

type View = 'graph' | 'list';

/** Fetches impact analysis (shared by the overview summary and the Impact tab). */
export function useImpact(ref: string, depth: number) {
  return useApiQuery<Impact>(`/cmdb/cis/${ref}/impact`, { depth });
}

function NodeTable({
  nodes,
  direction,
  byId,
  caption,
}: {
  nodes: Impact['impacted'];
  direction: ImpactDirection;
  byId: Map<string, CiRef>;
  caption: string;
}) {
  const t = useTranslations('cmdb');
  const locale = useLocale();
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-20">{t('impact.columns.level')}</TableHead>
          <TableHead>{t('impact.columns.ci')}</TableHead>
          <TableHead className="hidden md:table-cell">{t('impact.columns.class')}</TableHead>
          <TableHead>{t('impact.columns.status')}</TableHead>
          <TableHead>{t('impact.columns.link')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {nodes.map((n: ImpactNode) => {
          const parent = byId.get(n.parentId);
          const label = t(
            `relationships.${n.edgeType}.${impactChildDirection(n.edgeType, direction) === 'outgoing' ? 'forward' : 'reverse'}`,
          );
          return (
            <TableRow
              key={n.ci.id}
              className={cn(n.isService && direction === 'impacted' && 'bg-destructive/5')}
            >
              <TableCell className="tabular-nums text-muted-foreground">{n.depth}</TableCell>
              <TableCell className="max-w-72">
                <Link href={ciHref(n.ci)} className="flex min-w-0 items-center gap-2 hover:underline">
                  <span className="font-mono text-xs text-muted-foreground">{n.ci.reference}</span>
                  <span className="truncate font-medium">{n.ci.name}</span>
                </Link>
                {n.isService && direction === 'impacted' && (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-destructive">
                    <BriefcaseBusinessIcon className="size-3.5" aria-hidden />
                    {t('impact.service')}
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">
                <span className="inline-flex items-center gap-1.5">
                  <ClassIcon name={n.ci.class.icon} className="size-3.5" />
                  {localize(n.ci.class.name, locale)}
                </span>
              </TableCell>
              <TableCell>
                <CiStatusBadge status={n.ci.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {t('impact.via', { label, name: parent?.name ?? '—' })}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Impact tab: depth, graph or list, and how many business services an outage would reach. */
export function ImpactPanel({ ci }: { ci: CiRef }) {
  const t = useTranslations('cmdb');
  const [depth, setDepth] = useState(3);
  const [view, setView] = useState<View>('graph');
  const depthId = useId();
  const { data, isLoading, isFetching } = useImpact(ci.id, depth);
  const byId = useMemo(() => {
    const map = new Map<string, CiRef>();
    if (!data) return map;
    map.set(data.root.id, data.root);
    for (const n of [...data.impacted, ...data.dependsOn]) map.set(n.ci.id, n.ci);
    return map;
  }, [data]);

  const empty = data && !data.impacted.length && !data.dependsOn.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          {data && (
            <>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium',
                  data.impactedServices
                    ? 'bg-destructive/10 text-destructive dark:bg-destructive/20'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {data.impactedServices ? (
                  <TriangleAlertIcon className="size-4" aria-hidden />
                ) : (
                  <BriefcaseBusinessIcon className="size-4" aria-hidden />
                )}
                {t('impact.servicesImpacted', { count: data.impactedServices })}
              </span>
              <span className="text-sm text-muted-foreground">
                {t('detail.impactedCount', { count: data.impacted.length })}
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={depthId} className="text-sm text-muted-foreground">
            {t('impact.depth')}
          </label>
          <Select value={String(depth)} onValueChange={(v) => setDepth(Number(v))}>
            <SelectTrigger id={depthId} size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: MAX_IMPACT_DEPTH }, (_, i) => i + 1).map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {t('impact.levels', { count: d })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div role="group" aria-label={t('impact.view')} className="inline-flex rounded-md border p-0.5">
            {(
              [
                ['graph', WaypointsIcon],
                ['list', ListIcon],
              ] as const
            ).map(([v, Icon]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className="inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-pressed:bg-secondary aria-pressed:text-foreground"
              >
                <Icon className="size-4" aria-hidden />
                {t(`impact.${v}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {data?.truncated && (
        <p className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
          {t('impact.truncated')}
        </p>
      )}

      {isLoading || !data ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : empty ? (
        <EmptyState
          icon={<NetworkIcon />}
          title={t('impact.nothing')}
          description={t('impact.nothingHint')}
          className="rounded-xl border border-dashed"
        />
      ) : view === 'graph' ? (
        <div className={cn('space-y-2 transition-opacity', isFetching && 'opacity-60')}>
          <ImpactGraph impact={data} />
          <p className="text-xs text-muted-foreground sm:hidden">{t('impact.scrollHint')}</p>
        </div>
      ) : (
        <div className={cn('grid gap-4 transition-opacity', isFetching && 'opacity-60')}>
          {(
            [
              [
                'impacted',
                data.impacted,
                ArrowUpFromLineIcon,
                t('impact.impacted'),
                t('impact.impactedHint', { name: ci.name }),
                t('impact.noImpacted'),
              ],
              [
                'dependsOn',
                data.dependsOn,
                ArrowDownToLineIcon,
                t('impact.dependsOn'),
                t('impact.dependsOnHint', { name: ci.name }),
                t('impact.noDependencies'),
              ],
            ] as const
          ).map(([direction, nodes, Icon, title, hint, none]) => (
            <Card key={direction} className="gap-3 overflow-hidden pb-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  {title}
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">
                    {nodes.length}
                  </span>
                </CardTitle>
                <CardDescription>{hint}</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                {nodes.length ? (
                  <NodeTable nodes={nodes} direction={direction} byId={byId} caption={title} />
                ) : (
                  <p className="border-t px-5 py-4 text-sm text-muted-foreground">{none}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
