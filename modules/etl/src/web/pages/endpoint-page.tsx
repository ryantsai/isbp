'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { WebPageProps } from '@isbp/sdk/web';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { DatabaseZapIcon, FlaskConicalIcon, PencilIcon, RocketIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { EndpointDetail, StatsPeriod } from '../../contracts';
import { ConnectionLabel, DraftBadge, EndpointStatusBadge, MethodBadge } from '../badges';
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
  const panelId = useId();
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
      <VStack gap={5}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </VStack>
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
    <VStack gap={5}>
      <DetailHeader
        className="pb-0"
        back={{ href: '/etl', label: t('endpoints.title'), highlight: endpoint.id }}
        icon={<DatabaseZapIcon />}
        reference={
          <HStack gap={2} wrap="wrap" vAlign="center" className="min-w-0">
            <MethodBadge method={endpoint.method} />
            <Text type="code" className="min-w-0 wrap-anywhere">
              {dataUrl(endpoint.slug)}
            </Text>
          </HStack>
        }
        title={endpoint.name}
        status={
          <>
            <EndpointStatusBadge status={endpoint.status} />
            {endpoint.latestVersion !== null && (
              <Text type="code" color="secondary">
                {t('endpoint.latest', { version: endpoint.latestVersion })}
              </Text>
            )}
            {endpoint.latestVersion !== null && endpoint.draftChanged && <DraftBadge />}
            <ConnectionLabel connection={endpoint.connection} />
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
            <Button
              label={t('endpoint.publish')}
              variant="primary"
              icon={<Icon icon={RocketIcon} />}
              onClick={() => setPublishing(true)}
            />
          ) : needsTest ? (
            <Button
              label={t('endpoint.testDraft')}
              variant="primary"
              icon={<Icon icon={FlaskConicalIcon} />}
              onClick={() => set({ tab: 'test' })}
            />
          ) : (
            <Button
              label={t('endpoint.editNewVersion')}
              variant="secondary"
              icon={<Icon icon={PencilIcon} />}
              onClick={() => set({ tab: 'definition' })}
            />
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
        <Banner status="error" title={t('endpoint.connectionMissing')} collapsible={false} />
      )}

      <VStack gap={3}>
        <TabList
          role="tablist"
          value={tab}
          onChange={(v) => set({ tab: v === 'overview' ? undefined : v })}
          hasDivider
        >
          {visible.map((v) => (
            <Tab key={v} value={v} label={t(`endpoint.tabs.${v}`)} panelId={panelId} />
          ))}
        </TabList>

        <div
          role="tabpanel"
          id={panelId}
          aria-label={t(`endpoint.tabs.${tab}`)}
          className={
            tab === 'overview' ? 'grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-3' : 'min-w-0'
          }
        >
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
          {tab === 'definition' &&
            (canManage ? (
              // Remount after every save so the form shows what was stored.
              <EndpointEditor key={`${endpoint.updatedAt}`} endpoint={endpoint} />
            ) : (
              <ReadOnlyDefinition endpoint={endpoint} />
            ))}
          {tab === 'test' && canManage && (
            <TestConsole endpoint={endpoint} onPublish={() => setPublishing(true)} />
          )}
          {tab === 'versions' && <VersionsTab endpoint={endpoint} />}
          {tab === 'docs' && <DocsTab endpoint={endpoint} />}
          {tab === 'links' && <LinksAndFiles type="etl.endpoint" id={endpoint.id} />}
        </div>
      </VStack>

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
    </VStack>
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
      <CardContent>
        <VStack gap={3} className="min-w-0">
          <CodeBlock
            code={def.kind === 'query' ? (def.sql ?? '') : `${def.procedure?.schema}.${def.procedure?.name}`}
            language={def.kind === 'query' ? 'sql' : 'plaintext'}
            width="100%"
            maxHeight="24rem"
            isWrapped
          />
          <Text color="secondary">
            {t('editor.paramsList', { list: def.params.map((p) => p.name).join(', ') || '—' })}
          </Text>
        </VStack>
      </CardContent>
    </Card>
  );
}
