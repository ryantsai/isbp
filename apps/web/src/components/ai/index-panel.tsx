'use client';

import type { AiIndexInfo } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Skeleton } from '@isbp/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
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
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('store.title')}</CardTitle>
          <CardAction>
            <Badge variant={pg ? 'success' : 'info'}>
              {pg ? <DatabaseZapIcon aria-hidden /> : <DatabaseIcon aria-hidden />}{' '}
              {pg ? t('store.pgvector') : t('store.portable')}
            </Badge>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">{t('content.type')}</TableHead>
                  <TableHead className="text-right">{t('content.documents')}</TableHead>
                  <TableHead className="text-right">{t('content.chunks')}</TableHead>
                  <TableHead className="pr-5">{t('content.model')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.types.map((r) => {
                  const current = r.model === data.embeddingModel;
                  return (
                    <TableRow key={`${r.type}/${r.model}`}>
                      <TableCell className="pl-5">
                        <span className="block font-medium">{typeLabel(r.type)}</span>
                        <code className="font-mono text-xs text-muted-foreground">{r.type}</code>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{format.number(r.documents)}</TableCell>
                      <TableCell className="text-right tabular-nums">{format.number(r.chunks)}</TableCell>
                      <TableCell className="pr-5">
                        <span className="flex flex-wrap items-center gap-2">
                          <code className="font-mono text-xs">{r.model}</code>
                          {current ? (
                            <Badge variant="success">
                              <CircleCheckIcon aria-hidden /> {t('content.current')}
                            </Badge>
                          ) : (
                            <Badge variant="warning">
                              <HistoryIcon aria-hidden /> {t('content.older')}
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">{t('content.empty')}</p>
          )}
          <div className="flex flex-col gap-3 border-t px-5 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p
              id={staleId}
              className={cn(
                'flex items-center gap-1.5 text-sm',
                stale > 0 ? 'text-warning-foreground' : 'text-muted-foreground',
              )}
            >
              {stale > 0 ? (
                <HistoryIcon className="size-4 shrink-0" aria-hidden />
              ) : (
                <CircleCheckIcon className="size-4 shrink-0 text-success" aria-hidden />
              )}
              {t('content.stale', { count: stale })}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={stale === 0}
              loading={reindex.isPending}
              aria-describedby={staleId}
              onClick={() => reindex.mutate(undefined)}
              className="self-start sm:self-auto"
            >
              {!reindex.isPending && <RefreshCwIcon />} {t('content.reembed')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
