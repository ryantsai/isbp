'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArrowLeftIcon,
  DatabaseZapIcon,
  FileQuestionIcon,
  RocketIcon,
  Trash2Icon,
  UnplugIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { EndpointDetail, StatsPeriod } from '../../contracts';
import { ConnectionLabel, DraftBadge, EndpointStatusBadge, MethodBadge, TONE } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { DocsTab } from '../endpoint/docs';
import { EndpointEditor } from '../endpoint/editor';
import { EndpointDetailsCard, EndpointStatsCard } from '../endpoint/overview';
import { PublishDialog, TestConsole } from '../endpoint/test-console';
import { VersionsTab } from '../endpoint/versions';
import { dataUrl, INVALIDATE } from '../lib';
import { LinksAndFiles } from '../record-panels';

const TABS = ['overview', 'definition', 'test', 'versions', 'docs', 'links'] as const;
type Tab = (typeof TABS)[number];

/** One Data API: traffic, the draft editor, the test console, versions, docs, links and files. */
export default function EndpointPage({ params }: WebPageProps) {
  const t = useTranslations('etl');
  const router = useRouter();
  const ref = params.slug ?? '';
  const {
    data: endpoint,
    isLoading,
    error,
  } = useApiQuery<EndpointDetail>(`/etl/endpoints/${encodeURIComponent(ref)}`);
  const [state, set] = useListState();
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useApiMutation((api, id: string) => api.delete(`/etl/endpoints/${id}`), {
    invalidate: INVALIDATE,
    success: t('endpoint.deleted'),
    onSuccess: () => router.push('/etl'),
  });

  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  if (error || !endpoint) return <EmptyState icon={<FileQuestionIcon />} title={t('endpoint.notFound')} />;

  const canManage = endpoint.viewer.canManage;
  const visible = TABS.filter((tab) => tab !== 'test' || canManage);
  const tab: Tab = visible.includes(state.tab as Tab) ? (state.tab as Tab) : 'overview';
  const period: StatsPeriod = state.period === '7d' ? '7d' : '24h';
  const publishable =
    canManage && endpoint.draftTested && (endpoint.latestVersion === null || endpoint.draftChanged);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/etl">
          <ArrowLeftIcon /> {t('endpoints.title')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <DatabaseZapIcon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <MethodBadge method={endpoint.method} />
              <code className="min-w-0 font-mono text-xs wrap-anywhere">{dataUrl(endpoint.slug)}</code>
            </p>
            <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{endpoint.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <EndpointStatusBadge status={endpoint.status} />
              {endpoint.latestVersion !== null && (
                <span className="font-mono text-xs text-muted-foreground">
                  {t('endpoint.latest', { version: endpoint.latestVersion })}
                </span>
              )}
              {endpoint.latestVersion !== null && endpoint.draftChanged && <DraftBadge />}
              <ConnectionLabel connection={endpoint.connection} className="text-sm" />
            </div>
            {endpoint.description && (
              <p className="max-w-3xl text-sm text-muted-foreground">{endpoint.description}</p>
            )}
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDeleting(true)}>
              <Trash2Icon /> {t('endpoint.delete')}
            </Button>
            <Button onClick={() => (publishable ? setPublishing(true) : set({ tab: 'test' }))}>
              <RocketIcon /> {publishable ? t('endpoint.publish') : t('endpoint.testToPublish')}
            </Button>
          </div>
        )}
      </FadeIn>

      {endpoint.connection?.status === 'missing' && (
        <p
          role="status"
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${TONE.destructive}`}
        >
          <UnplugIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('endpoint.connectionMissing')}
        </p>
      )}

      <Tabs value={tab} onValueChange={(v) => set({ tab: v === 'overview' ? undefined : v })}>
        <TabsList className="max-w-full overflow-x-auto">
          {visible.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`endpoint.tabs.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-3">
          {tab === 'overview' && (
            <>
              <div className="min-w-0 xl:col-span-2">
                <EndpointStatsCard
                  endpoint={endpoint}
                  period={period}
                  onPeriod={(p) => set({ period: p === '24h' ? undefined : p })}
                />
              </div>
              <EndpointDetailsCard endpoint={endpoint} />
            </>
          )}
        </TabsContent>

        <TabsContent value="definition" className="min-w-0">
          {tab === 'definition' &&
            (canManage ? (
              // Remount after every save so the form shows what was stored.
              <EndpointEditor key={`${endpoint.updatedAt}`} endpoint={endpoint} />
            ) : (
              <ReadOnlyDefinition endpoint={endpoint} />
            ))}
        </TabsContent>

        {canManage && (
          <TabsContent value="test" className="min-w-0">
            {tab === 'test' && <TestConsole endpoint={endpoint} onPublish={() => setPublishing(true)} />}
          </TabsContent>
        )}

        <TabsContent value="versions" className="min-w-0">
          {tab === 'versions' && <VersionsTab endpoint={endpoint} />}
        </TabsContent>

        <TabsContent value="docs" className="min-w-0">
          {tab === 'docs' && <DocsTab endpoint={endpoint} />}
        </TabsContent>

        <TabsContent value="links" className="min-w-0">
          {tab === 'links' && <LinksAndFiles type="etl.endpoint" id={endpoint.id} />}
        </TabsContent>
      </Tabs>

      {canManage && <PublishDialog endpoint={endpoint} open={publishing} onOpenChange={setPublishing} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('endpoint.deleteTitle', { name: endpoint.name })}
        description={t('endpoint.deleteBody')}
        confirmLabel={t('endpoint.delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(endpoint.id)}
      />
    </div>
  );
}

/** What readers see of the draft: the statement and the parameters. */
function ReadOnlyDefinition({ endpoint }: { endpoint: EndpointDetail }) {
  const t = useTranslations('etl');
  const def = endpoint.draft;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {t('editor.statement')}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3">
        <pre
          tabIndex={0}
          className="max-h-96 min-w-0 overflow-auto rounded-lg border bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {def.kind === 'query' ? def.sql : `${def.procedure?.schema}.${def.procedure?.name}`}
        </pre>
        <p className="text-sm text-muted-foreground">
          {t('editor.paramsList', { list: def.params.map((p) => p.name).join(', ') || '—' })}
        </p>
      </CardContent>
    </Card>
  );
}
