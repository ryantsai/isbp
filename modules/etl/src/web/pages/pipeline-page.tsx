'use client';

import { usePlatform, type WebPageProps } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CirclePauseIcon,
  LoaderCircleIcon,
  PlayIcon,
  Trash2Icon,
  UnplugIcon,
  WorkflowIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { parseTransform, type PipelineDetail, type RunDto } from '../../contracts';
import { ConnectionLabel, RunStatusBadge, TONE, ToneBadge } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { INVALIDATE, pipelineHref, runHref, scheduleHref } from '../lib';
import { PipelineEditor } from '../pipeline/editor';
import { RunsTable } from '../pipeline/runs-table';
import { LinksAndFiles } from '../record-panels';

const TABS = ['overview', 'runs', 'definition', 'links'] as const;
type Tab = (typeof TABS)[number];

function DefinitionSummary({ pipeline }: { pipeline: PipelineDetail }) {
  const t = useTranslations('etl');
  const id = useId();
  const d = pipeline.definition;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {t('pipeline.definition')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        <div className="grid min-w-0 gap-1.5">
          <span id={`${id}-sql`} className="text-sm font-medium">
            {t('pipelineEditor.source')}
          </span>
          <CodeEditor
            value={d.source.sql}
            language="sql"
            readOnly
            lineNumbers={false}
            aria-labelledby={`${id}-sql`}
            maxHeight="16rem"
          />
        </div>
        {d.incremental && (
          <p className="text-sm text-muted-foreground">
            {t('pipeline.incrementalSummary', {
              column: d.incremental.column,
              watermark: pipeline.watermark ?? d.incremental.initial,
            })}
          </p>
        )}
        <div
          role="region"
          tabIndex={0}
          aria-label={t('pipelineEditor.mapping')}
          className="min-w-0 overflow-x-auto rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <table className="w-full text-sm">
            <caption className="sr-only">{t('pipelineEditor.mapping')}</caption>
            <thead className="bg-muted/60">
              <tr>
                {[t('mapping.source'), t('mapping.target'), t('mapping.transform')].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-left text-xs font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.mappings.map((m) => {
                const tr = parseTransform(m.transform);
                return (
                  <tr key={m.target} className="border-t">
                    <th scope="row" className="px-3 py-1.5 text-left font-mono text-xs font-normal">
                      {m.source}
                    </th>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {m.target}
                      {d.target.keys.includes(m.target) && (
                        <span className="ml-1 font-sans text-muted-foreground">{t('pipeline.key')}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      {t(`mapping.transforms.${tr.kind}`)}
                      {tr.arg !== null && tr.arg !== '' && <span className="font-mono"> {tr.arg}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** One pipeline: last run, runs, definition, links and files; "Run now" and "Schedule". */
export default function PipelinePage({ params }: WebPageProps) {
  const t = useTranslations('etl');
  const format = useFormatter();
  const router = useRouter();
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
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !p) return <ErrorState error={error} kind="page" />;

  const visible = TABS.filter((tab) => tab !== 'definition' || p.viewer.canManage);
  const tab: Tab = visible.includes(state.tab as Tab) ? (state.tab as Tab) : 'overview';
  const missing = p.source?.status === 'missing' || p.target?.status === 'missing';
  const lastFailed = p.lastRun?.status === 'failed';

  return (
    <div className="space-y-6">
      <DetailHeader
        className="pb-0"
        back={{ href: '/etl/pipelines', label: t('pipelines.title'), highlight: p.id }}
        icon={<WorkflowIcon />}
        reference={
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <ConnectionLabel connection={p.source} />
            <ArrowRightIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="sr-only">{t('pipelines.into')}</span>
            <ConnectionLabel connection={p.target} />
            <span className="font-mono text-xs">{p.targetTable}</span>
          </span>
        }
        title={p.name}
        status={
          <>
            {p.lastRun ? (
              <RunStatusBadge status={p.lastRun.status} />
            ) : (
              <span className="text-sm text-muted-foreground">{t('pipelines.never')}</span>
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
            <Button onClick={() => run.mutate(p.id)} loading={run.isPending} disabled={active || !p.enabled}>
              <PlayIcon /> {t('pipeline.runNow')}
            </Button>
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
            <Button asChild size="sm" variant="outline">
              <Link href={runHref(p.id, p.lastRun.id)}>{t('pipeline.seeLastRun')}</Link>
            </Button>
          }
        />
      )}
      {p.schedule && enabledModules.includes('scheduler') && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <CalendarClockIcon className="size-4 shrink-0" aria-hidden />
          <span>{t('pipeline.onSchedule')}</span>
          <Link
            href={`/scheduler/jobs/${p.schedule.jobId}`}
            className="font-medium text-primary hover:underline"
          >
            {t('pipeline.openJob')}
          </Link>
          <span>
            · {t('pipeline.lastScheduled')} <RelativeTime date={p.schedule.lastRunAt} />
          </span>
        </p>
      )}

      {missing && (
        <p
          role="status"
          className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', TONE.destructive)}
        >
          <UnplugIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('pipeline.connectionMissing')}
        </p>
      )}
      {active && p.lastRun && (
        <Link
          href={runHref(p.id, p.lastRun.id)}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50',
            TONE.info,
          )}
        >
          <LoaderCircleIcon className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
          {t('pipeline.runningNow', {
            read: format.number(p.lastRun.rowsRead),
            written: format.number(p.lastRun.rowsWritten),
          })}
        </Link>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) =>
          set({ tab: v === 'overview' ? undefined : v, page: undefined, status: undefined })
        }
      >
        <TabsList className="max-w-full overflow-x-auto">
          {visible.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`pipeline.tabs.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="grid min-w-0 gap-6">
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
              <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-2">
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
        </TabsContent>
        <TabsContent value="runs" className="min-w-0">
          {tab === 'runs' && (
            <RunsTable
              pipelineId={p.id}
              pageSize={25}
              status={typeof state.status === 'string' ? state.status : undefined}
            />
          )}
        </TabsContent>
        {p.viewer.canManage && (
          <TabsContent value="definition" className="min-w-0">
            {tab === 'definition' && (
              <PipelineEditor key={p.updatedAt} pipeline={p} onSaved={() => undefined} />
            )}
          </TabsContent>
        )}
        <TabsContent value="links" className="min-w-0">
          {tab === 'links' && <LinksAndFiles type="etl.pipeline" id={p.id} />}
        </TabsContent>
      </Tabs>

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
    </div>
  );
}
