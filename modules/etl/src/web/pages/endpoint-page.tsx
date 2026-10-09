'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  DatabaseZapIcon,
  FlaskConicalIcon,
  PencilIcon,
  RocketIcon,
  Trash2Icon,
  UnplugIcon,
} from 'lucide-react';
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
  if (error || !endpoint) return <ErrorState error={error} kind="page" />;

  const canManage = endpoint.viewer.canManage;
  const visible = TABS.filter((tab) => tab !== 'test' || canManage);
  const tab: Tab = visible.includes(state.tab as Tab) ? (state.tab as Tab) : 'overview';
  const period: StatsPeriod = state.period === '7d' ? '7d' : '24h';
  const publishable =
    canManage && endpoint.draftTested && (endpoint.latestVersion === null || endpoint.draftChanged);
  // A draft that differs from the published version (or was never published) needs a passing test first.
  const needsTest = !endpoint.draftTested && (endpoint.latestVersion === null || endpoint.draftChanged);

  return (
    <div className="space-y-6">
      <DetailHeader
        className="pb-0"
        back={{ href: '/etl', label: t('endpoints.title'), highlight: endpoint.id }}
        icon={<DatabaseZapIcon />}
        reference={
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <MethodBadge method={endpoint.method} />
            <code className="min-w-0 font-mono text-xs wrap-anywhere">{dataUrl(endpoint.slug)}</code>
          </span>
        }
        title={endpoint.name}
        status={
          <>
            <EndpointStatusBadge status={endpoint.status} />
            {endpoint.latestVersion !== null && (
              <span className="font-mono text-xs text-muted-foreground">
                {t('endpoint.latest', { version: endpoint.latestVersion })}
              </span>
            )}
            {endpoint.latestVersion !== null && endpoint.draftChanged && <DraftBadge />}
            <ConnectionLabel connection={endpoint.connection} className="text-sm" />
          </>
        }
        meta={
          <>
            {canManage && !publishable && needsTest && (
              <span className="block">{t('endpoint.publishNeedsTest')}</span>
            )}
            {endpoint.description && <span className="mt-1 block max-w-3xl">{endpoint.description}</span>}
          </>
        }
        primaryAction={
          canManage &&
          (publishable ? (
            <Button onClick={() => setPublishing(true)}>
              <RocketIcon /> {t('endpoint.publish')}
            </Button>
          ) : needsTest ? (
            <Button onClick={() => set({ tab: 'test' })}>
              <FlaskConicalIcon /> {t('endpoint.testDraft')}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => set({ tab: 'definition' })}>
              <PencilIcon /> {t('endpoint.editNewVersion')}
            </Button>
          ))
        }
        menu={
          canManage
            ? [
                {
                  label: t('endpoint.delete'),
                  icon: <Trash2Icon />,
                  destructive: true,
                  onSelect: () => setDeleting(true),
                },
              ]
            : []
        }
      />

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
