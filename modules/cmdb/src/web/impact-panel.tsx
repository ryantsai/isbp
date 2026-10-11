'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { localize } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BriefcaseBusinessIcon,
  CircleCheckIcon,
  ListIcon,
  NetworkIcon,
  TriangleAlertIcon,
  WaypointsIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
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

/**
 * The answer in one sentence: "8 items affected, 7 of them business services" — icon + text, in the destructive tone
 * when business services are hit, quiet otherwise.
 */
export function ImpactSentence({ impact, className }: { impact: Impact; className?: string }) {
  const t = useTranslations('cmdb');
  const services = impact.impactedServices > 0;
  const Icon = services
    ? TriangleAlertIcon
    : impact.impacted.length
      ? BriefcaseBusinessIcon
      : CircleCheckIcon;
  return (
    <p
      className={cn(
        'flex items-start gap-2 text-sm font-medium',
        services ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{t('impact.summary', { count: impact.impacted.length, services: impact.impactedServices })}</span>
    </p>
  );
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
    <Table aria-label={caption}>
      <TableHeader>
        <TableRow isHeaderRow>
          <TableHeaderCell className="max-w-none whitespace-nowrap">
            {t('impact.columns.level')}
          </TableHeaderCell>
          <TableHeaderCell className="whitespace-nowrap">{t('impact.columns.ci')}</TableHeaderCell>
          <TableHeaderCell className="hidden md:table-cell max-w-none whitespace-nowrap">
            {t('impact.columns.class')}
          </TableHeaderCell>
          <TableHeaderCell className="max-w-none whitespace-nowrap">
            {t('impact.columns.status')}
          </TableHeaderCell>
          <TableHeaderCell className="max-w-none whitespace-nowrap">
            {t('impact.columns.link')}
          </TableHeaderCell>
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
              <TableCell className="max-w-none tabular-nums text-muted-foreground">{n.depth}</TableCell>
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
              <TableCell className="hidden max-w-none whitespace-nowrap text-muted-foreground md:table-cell">
                <span className="inline-flex items-center gap-1.5">
                  <ClassIcon name={n.ci.class.icon} className="size-3.5" />
                  {localize(n.ci.class.name, locale)}
                </span>
              </TableCell>
              <TableCell className="max-w-none whitespace-nowrap">
                <CiStatusBadge status={n.ci.status} />
              </TableCell>
              <TableCell className="max-w-none whitespace-nowrap text-muted-foreground">
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
  const { data, isLoading, isFetching, error, refetch } = useImpact(ci.id, depth);
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
        <div aria-live="polite" className="min-w-0">
          {data && <ImpactSentence impact={data} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HStack gap={2} vAlign="center">
            <Text color="secondary" aria-hidden>
              {t('impact.depth')}
            </Text>
            <Selector
              label={t('impact.depth')}
              isLabelHidden
              size="sm"
              width={120}
              value={String(depth)}
              onChange={(v) => setDepth(Number(v))}
              options={Array.from({ length: MAX_IMPACT_DEPTH }, (_, i) => i + 1).map((d) => ({
                value: String(d),
                label: t('impact.levels', { count: d }),
              }))}
            />
          </HStack>
          <SegmentedControl
            label={t('impact.view')}
            size="sm"
            value={view}
            onChange={(v) => setView(v as View)}
          >
            <SegmentedControlItem
              value="graph"
              label={t('impact.graph')}
              icon={<AstryxIcon icon={WaypointsIcon} />}
            />
            <SegmentedControlItem
              value="list"
              label={t('impact.list')}
              icon={<AstryxIcon icon={ListIcon} />}
            />
          </SegmentedControl>
        </div>
      </div>

      {data?.truncated && <Banner status="warning" title={t('impact.truncated')} collapsible={false} />}

      {error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} className="rounded-xl border" />
      ) : isLoading || !data ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : empty ? (
        <EmptyState
          icon={<NetworkIcon />}
          title={t('impact.nothing')}
          description={t('impact.nothingHint')}
          className="rounded-xl border border-dashed"
        />
      ) : view === 'graph' ? (
        <div
          className={cn(
            'space-y-2 transition-opacity motion-reduce:transition-none',
            isFetching && 'opacity-60',
          )}
        >
          <ImpactGraph impact={data} />
          <p className="text-xs text-muted-foreground sm:hidden">{t('impact.scrollHint')}</p>
        </div>
      ) : (
        <div
          className={cn(
            'grid gap-4 transition-opacity motion-reduce:transition-none',
            isFetching && 'opacity-60',
          )}
        >
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
