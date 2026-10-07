'use client';

import { usePlatform, type WebPageProps } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { CodeEditor } from '@isbp/ui/code-editor';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  CirclePauseIcon,
  FileQuestionIcon,
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
import { INVALIDATE, runHref, scheduleHref } from '../lib';
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
  if (error || !p) return <EmptyState icon={<FileQuestionIcon />} title={t('pipeline.notFound')} />;

  const visible = TABS.filter((tab) => tab !== 'definition' || p.viewer.canManage);
  const tab: Tab = visible.includes(state.tab as Tab) ? (state.tab as Tab) : 'overview';
  const missing = p.source?.status === 'missing' || p.target?.status === 'missing';
  const tiles = [
    { key: 'runs', value: format.number(p.stats.runs) },
    { key: 'succeeded', value: format.number(p.stats.succeeded) },
    { key: 'failed', value: format.number(p.stats.failed) },
    { key: 'rowsWritten', value: format.number(p.stats.rowsWritten) },
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/etl/pipelines">
          <ArrowLeftIcon /> {t('pipelines.title')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <WorkflowIcon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <ConnectionLabel connection={p.source} />
              <ArrowRightIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="sr-only">{t('pipelines.into')}</span>
              <ConnectionLabel connection={p.target} />
              <span className="font-mono text-xs">{p.targetTable}</span>
            </p>
            <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{p.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              {p.lastRun ? (
                <RunStatusBadge status={p.lastRun.status} />
              ) : (
                <span className="text-sm text-muted-foreground">{t('pipelines.never')}</span>
              )}
              {!p.enabled && (
                <ToneBadge tone="muted" icon={CirclePauseIcon} label={t('pipelines.disabled')} />
              )}
              <span className="text-sm text-muted-foreground">
                {t(`writeMode.${p.mode}`)}
                {p.incremental ? ` · ${t('pipelines.incremental')}` : ''}
                {p.owner ? ` · ${t('pipeline.ownedBy', { name: p.owner.displayName })}` : ''}
              </span>
            </div>
            {p.description && <p className="max-w-3xl text-sm text-muted-foreground">{p.description}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {p.viewer.canManage && (
            <Button variant="outline" onClick={() => setDeleting(true)}>
              <Trash2Icon /> {t('pipeline.delete')}
            </Button>
          )}
          {enabledModules.includes('scheduler') && p.viewer.canRun && (
            <Button variant="outline" asChild>
              <Link href={scheduleHref(p)}>
                <CalendarClockIcon /> {t('pipeline.schedule')}
              </Link>
            </Button>
          )}
          {p.viewer.canRun && (
            <Button onClick={() => run.mutate(p.id)} loading={run.isPending} disabled={active || !p.enabled}>
              <PlayIcon /> {t('pipeline.runNow')}
            </Button>
          )}
        </div>
      </FadeIn>

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
        onValueChange={(v) => set({ tab: v === 'overview' ? undefined : v, page: undefined })}
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
              <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label={t('pipeline.last30')}>
                {tiles.map((tile) => (
                  <div key={tile.key} className="min-w-0 rounded-xl border bg-card p-4 shadow-xs">
                    <dt className="truncate text-xs text-muted-foreground">
                      {t(`pipeline.tiles.${tile.key}`)}
                    </dt>
                    <dd className="mt-1 truncate text-2xl font-semibold tracking-tight">{tile.value}</dd>
                  </div>
                ))}
              </dl>
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
          {tab === 'runs' && <RunsTable pipelineId={p.id} pageSize={25} />}
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
