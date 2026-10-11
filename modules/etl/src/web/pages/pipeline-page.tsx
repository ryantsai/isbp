'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Table } from '@astryxdesign/core/Table';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { usePlatform, type WebPageProps } from '@isbp/sdk/web';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { CodeEditor } from '@isbp/ui/code-editor';
import { useListState } from '@isbp/ui/data-table';
import { ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { RunProblemBanner } from '@isbp/ui/run-detail';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatTile } from '@isbp/ui/stat-tile';
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CirclePauseIcon,
  PlayIcon,
  Trash2Icon,
  WorkflowIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { parseTransform, type PipelineDetail, type RunDto } from '../../contracts';
import { ConnectionLabel, RunStatusBadge, ToneBadge } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { INVALIDATE, pipelineHref, runHref, scheduleHref } from '../lib';
import { PipelineEditor } from '../pipeline/editor';
import { RunsTable } from '../pipeline/runs-table';
import { LinksAndFiles } from '../record-panels';

const TABS = ['overview', 'runs', 'definition', 'links'] as const;
type Tab = (typeof TABS)[number];

interface MappingRow extends Record<string, unknown> {
  target: string;
  source: string;
  isKey: boolean;
  transform: string;
}

function DefinitionSummary({ pipeline }: { pipeline: PipelineDetail }) {
  const t = useTranslations('etl');
  const id = useId();
  const d = pipeline.definition;
  const rows: MappingRow[] = d.mappings.map((m) => {
    const tr = parseTransform(m.transform);
    return {
      target: m.target,
      source: m.source,
      isKey: d.target.keys.includes(m.target),
      transform: `${t(`mapping.transforms.${tr.kind}`)}${tr.arg !== null && tr.arg !== '' ? ` ${tr.arg}` : ''}`,
    };
  });
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {t('pipeline.definition')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack gap={4} className="min-w-0">
          <VStack gap={1.5} className="min-w-0">
            <Text type="label" id={`${id}-sql`}>
              {t('pipelineEditor.source')}
            </Text>
            <CodeEditor
              value={d.source.sql}
              language="sql"
              readOnly
              lineNumbers={false}
              aria-labelledby={`${id}-sql`}
              maxHeight="16rem"
            />
          </VStack>
          {d.incremental && (
            <Text color="secondary" as="p" display="block">
              {t('pipeline.incrementalSummary', {
                column: d.incremental.column,
                watermark: pipeline.watermark ?? d.incremental.initial,
              })}
            </Text>
          )}
          <div role="region" aria-label={t('pipelineEditor.mapping')} className="min-w-0">
            <Table
              aria-label={t('pipelineEditor.mapping')}
              density="compact"
              data={rows}
              idKey="target"
              columns={[
                {
                  key: 'source',
                  header: t('mapping.source'),
                  renderCell: (r) => <Text type="code">{r.source}</Text>,
                },
                {
                  key: 'target',
                  header: t('mapping.target'),
                  renderCell: (r) => (
                    <HStack gap={1} wrap="wrap" vAlign="center">
                      <Text type="code">{r.target}</Text>
                      {r.isKey && <Text color="secondary">{t('pipeline.key')}</Text>}
                    </HStack>
                  ),
                },
                { key: 'transform', header: t('mapping.transform') },
              ]}
            />
          </div>
        </VStack>
      </CardContent>
    </Card>
  );
}

/** One pipeline: last run, runs, definition, links and files; "Run now" and "Schedule". */
export default function PipelinePage({ params }: WebPageProps) {
  const t = useTranslations('etl');
  const format = useFormatter();
  const router = useRouter();
  const panelId = useId();
  const { enabledModules } = usePlatform();
  const pipelineId = params.id ?? '';
  const [state, set] = useListState();
  const [deleting, setDeleting] = useState(false);
  const [polling, setPolling] = useState(false);
  const {
    data: p,
    isLoading,
    error,
  } = useApiQuery<PipelineDetail>(`/etl/pipelines/${pipelineId}`, undefined, {
    refetchInterval: polling ? 2_000 : undefined,
  });
  const active = Boolean(p?.lastRun && (p.lastRun.status === 'queued' || p.lastRun.status === 'running'));
  useEffect(() => setPolling(active), [active]);
  const run = useApiMutation((api, id: string) => api.post<RunDto>(`/etl/pipelines/${id}/run`, {}), {
    invalidate: INVALIDATE,
    success: t('pipeline.queued'),
    onSuccess: (r) => router.push(runHref(r.pipelineId, r.id)),
  });
  const remove = useApiMutation((api, id: string) => api.delete(`/etl/pipelines/${id}`), {
    invalidate: INVALIDATE,
    success: t('pipeline.deleted'),
    onSuccess: () => router.push('/etl/pipelines'),
  });

  if (isLoading)
    return (
      <VStack gap={5}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </VStack>
    );
  if (error || !p) return <ErrorState error={error} kind="page" />;

  const visible = TABS.filter((tab) => tab !== 'definition' || p.viewer.canManage);
  const tab: Tab = visible.includes(state.tab as Tab) ? (state.tab as Tab) : 'overview';
  const missing = p.source?.status === 'missing' || p.target?.status === 'missing';
  const lastFailed = p.lastRun?.status === 'failed';

  return (
    <VStack gap={5}>
      <DetailHeader
        className="pb-0"
        back={{ href: '/etl/pipelines', label: t('pipelines.title'), highlight: p.id }}
        icon={<WorkflowIcon />}
        reference={
          <HStack gap={1.5} wrap="wrap" vAlign="center" className="min-w-0">
            <ConnectionLabel connection={p.source} />
            <Icon icon={ArrowRightIcon} color="secondary" />
            <span className="sr-only">{t('pipelines.into')}</span>
            <ConnectionLabel connection={p.target} />
            <Text type="code">{p.targetTable}</Text>
          </HStack>
        }
        title={p.name}
        status={
          <>
            {p.lastRun ? (
              <RunStatusBadge status={p.lastRun.status} />
            ) : (
              <Text color="secondary">{t('pipelines.never')}</Text>
            )}
            {!p.enabled && <ToneBadge tone="muted" icon={CirclePauseIcon} label={t('pipelines.disabled')} />}
          </>
        }
        meta={
          <>
            {t(`writeMode.${p.mode}`)}
            {p.incremental ? ` · ${t('pipelines.incremental')}` : ''}
            {p.owner ? ` · ${t('pipeline.ownedBy', { name: p.owner.displayName })}` : ''}
            {p.description && <span className="mt-1 block max-w-3xl">{p.description}</span>}
          </>
        }
        primaryAction={
          p.viewer.canRun && (
            <Button
              label={t('pipeline.runNow')}
              variant="primary"
              icon={<Icon icon={PlayIcon} />}
              isLoading={run.isPending}
              isDisabled={active || !p.enabled}
              onClick={() => run.mutate(p.id)}
            />
          )
        }
        actions={
          enabledModules.includes('scheduler') && p.viewer.canRun && !p.schedule
            ? [{ label: t('pipeline.schedule'), icon: <CalendarClockIcon />, href: scheduleHref(p) }]
            : []
        }
        menu={
          p.viewer.canManage
            ? [
                {
                  label: t('pipeline.delete'),
                  icon: <Trash2Icon />,
                  destructive: true,
                  onSelect: () => setDeleting(true),
                },
              ]
            : []
        }
      />

      {lastFailed && p.lastRun && (
        <RunProblemBanner
          problem={p.lastRun.problem}
          error={p.lastRun.error}
          actions={
            <Button
              label={t('pipeline.seeLastRun')}
              variant="secondary"
              size="sm"
              href={runHref(p.id, p.lastRun.id)}
            />
          }
        />
      )}
      {p.schedule && enabledModules.includes('scheduler') && (
        <HStack gap={2} wrap="wrap" vAlign="center">
          <Icon icon={CalendarClockIcon} color="secondary" />
          <Text color="secondary">{t('pipeline.onSchedule')}</Text>
          <Link href={`/scheduler/jobs/${p.schedule.jobId}`} weight="medium">
            {t('pipeline.openJob')}
          </Link>
          <Text color="secondary">
            · {t('pipeline.lastScheduled')} <RelativeTime date={p.schedule.lastRunAt} />
          </Text>
        </HStack>
      )}

      {missing && <Banner status="error" title={t('pipeline.connectionMissing')} collapsible={false} />}
      {active && p.lastRun && (
        <HStack gap={2} vAlign="center">
          <Spinner size="sm" />
          <Link href={runHref(p.id, p.lastRun.id)}>
            {t('pipeline.runningNow', {
              read: format.number(p.lastRun.rowsRead),
              written: format.number(p.lastRun.rowsWritten),
            })}
          </Link>
        </HStack>
      )}

      <VStack gap={3}>
        <TabList
          role="tablist"
          value={tab}
          onChange={(v) => set({ tab: v === 'overview' ? undefined : v, page: undefined, status: undefined })}
          hasDivider
        >
          {visible.map((v) => (
            <Tab key={v} value={v} label={t(`pipeline.tabs.${v}`)} panelId={panelId} />
          ))}
        </TabList>

        <div
          role="tabpanel"
          id={panelId}
          aria-label={t(`pipeline.tabs.${tab}`)}
          className={tab === 'overview' ? 'grid min-w-0 gap-4' : 'min-w-0'}
        >
          {tab === 'overview' && (
            <>
              <div
                className="grid grid-cols-2 gap-3 xl:grid-cols-4"
                role="group"
                aria-label={t('pipeline.last30')}
              >
                <StatTile label={t('pipeline.tiles.runs')} value={p.stats.runs} />
                <StatTile label={t('pipeline.tiles.succeeded')} value={p.stats.succeeded} />
                <StatTile
                  label={t('pipeline.tiles.failed')}
                  value={p.stats.failed}
                  href={p.stats.failed > 0 ? `${pipelineHref(p.id)}?tab=runs&status=failed` : undefined}
                />
                <StatTile label={t('pipeline.tiles.rowsWritten')} value={p.stats.rowsWritten} />
              </div>
              <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-2">
                <DefinitionSummary pipeline={p} />
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle role="heading" aria-level={2}>
                      {t('runs.recent')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="min-w-0">
                    <RunsTable pipelineId={p.id} pageSize={8} />
                  </CardContent>
                </Card>
              </div>
            </>
          )}
          {tab === 'runs' && (
            <RunsTable
              pipelineId={p.id}
              pageSize={25}
              status={typeof state.status === 'string' ? state.status : undefined}
            />
          )}
          {tab === 'definition' && p.viewer.canManage && (
            <PipelineEditor key={p.updatedAt} pipeline={p} onSaved={() => undefined} />
          )}
          {tab === 'links' && <LinksAndFiles type="etl.pipeline" id={p.id} />}
        </div>
      </VStack>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('pipeline.deleteTitle', { name: p.name })}
        description={t('pipeline.deleteBody')}
        confirmLabel={t('pipeline.delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(p.id)}
      />
    </VStack>
  );
}
