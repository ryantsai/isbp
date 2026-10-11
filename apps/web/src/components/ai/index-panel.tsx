'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { proportional, Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import type { AiIndexInfo } from '@isbp/contracts';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  CircleCheckIcon,
  DatabaseIcon,
  DatabaseZapIcon,
  HistoryIcon,
  RefreshCwIcon,
  SparklesIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId } from 'react';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { INDEX_PATH } from './ai-meta';

export function IndexPanel() {
  const t = useTranslations('ai.index');
  const format = useFormatter();
  const staleId = useId();
  const { data } = useApiQuery<AiIndexInfo>(INDEX_PATH);
  // While documents wait for re-embedding, follow the background job's progress.
  const stale = data?.stale ?? 0;
  useApiQuery<AiIndexInfo>(INDEX_PATH, undefined, { refetchInterval: 10_000, enabled: stale > 0 });

  const reindex = useApiMutation((api) => api.post(`${INDEX_PATH}/reindex`), {
    invalidate: [INDEX_PATH],
    success: t('content.reembedStarted'),
  });

  if (!data)
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl lg:col-span-2" />
      </div>
    );

  const pg = data.vectorStore === 'pgvector';
  const typeLabel = (type: string) => {
    const key = `types.${type.replace(/[.-]/g, '_')}`;
    return t.has(key) ? t(key) : type;
  };

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('store.title')}</CardTitle>
          <CardAction>
            <Badge
              variant={pg ? 'success' : 'info'}
              label={pg ? t('store.pgvector') : t('store.portable')}
              icon={<Icon icon={pg ? DatabaseZapIcon : DatabaseIcon} size="xsm" />}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">{pg ? t('store.pgvectorBody') : t('store.portableBody')}</p>
          <dl className="space-y-1 rounded-lg border bg-muted/30 px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SparklesIcon className="size-3.5" aria-hidden /> {t('model')}
            </dt>
            <dd className="font-mono text-sm break-all">{data.embeddingModel}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card className="min-w-0 lg:col-span-2">
        <CardHeader>
          <CardTitle>{t('content.title')}</CardTitle>
          <CardDescription>{t('content.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          {data.types.length ? (
            <Table
              aria-label={t('content.title')}
              idKey={(r) => `${r.type}/${r.model}`}
              data={data.types}
              columns={[
                {
                  key: 'type',
                  header: t('content.type'),
                  width: proportional(2, { minWidth: 140 }),
                  renderCell: (r) => (
                    <>
                      <Text as="div" display="block" weight="medium">
                        {typeLabel(r.type)}
                      </Text>
                      <Text as="div" display="block" type="code" color="secondary">
                        {r.type}
                      </Text>
                    </>
                  ),
                },
                {
                  key: 'documents',
                  header: t('content.documents'),
                  align: 'end',
                  renderCell: (r) => format.number(r.documents),
                },
                {
                  key: 'chunks',
                  header: t('content.chunks'),
                  align: 'end',
                  renderCell: (r) => format.number(r.chunks),
                },
                {
                  key: 'model',
                  header: t('content.model'),
                  width: proportional(2, { minWidth: 160 }),
                  renderCell: (r) => (
                    <HStack gap={2} wrap="wrap" vAlign="center">
                      <Text type="code">{r.model}</Text>
                      {r.model === data.embeddingModel ? (
                        <Badge
                          variant="success"
                          label={t('content.current')}
                          icon={<Icon icon={CircleCheckIcon} size="xsm" />}
                        />
                      ) : (
                        <Badge
                          variant="warning"
                          label={t('content.older')}
                          icon={<Icon icon={HistoryIcon} size="xsm" />}
                        />
                      )}
                    </HStack>
                  ),
                },
              ]}
            />
          ) : (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">{t('content.empty')}</p>
          )}
          <div className="flex flex-col gap-3 border-t px-5 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <HStack id={staleId} gap={1.5} vAlign="center">
              <Icon
                icon={stale > 0 ? HistoryIcon : CircleCheckIcon}
                color={stale > 0 ? 'warning' : 'success'}
              />
              <Text color={stale > 0 ? 'primary' : 'secondary'}>{t('content.stale', { count: stale })}</Text>
            </HStack>
            <div>
              <Button
                label={t('content.reembed')}
                variant="secondary"
                icon={<Icon icon={RefreshCwIcon} />}
                isDisabled={stale === 0}
                isLoading={reindex.isPending}
                aria-describedby={staleId}
                onClick={() => reindex.mutate(undefined)}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
