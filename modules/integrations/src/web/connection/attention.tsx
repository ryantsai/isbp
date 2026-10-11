'use client';

import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import type { Page } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { CircleCheckIcon, GitCompareArrowsIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { ConflictSummary, Connection, Link as LinkDto, Profile } from '../../contracts';
import { RunStatusText } from '../badges';
import { ResolveDialog } from '../conflicts';
import { connectionHref, profileHref, runHref } from '../lib';
import { LocalCell, RemoteCell } from '../links-table';

const SHOWN = 5;

/**
 * What needs a person on this connection, first: open conflicts (resolve them here), records that failed to sync
 * (with why and both sides), and sync rules whose last run failed. "Nothing needs attention" when all is well.
 */
export function NeedsAttention({ c }: { c: Connection }) {
  const t = useTranslations('integrations.attention');
  const errorText = useErrorText();
  const id = useId();
  const [conflict, setConflict] = useState<string | null>(null);
  const conflicts = useApiQuery<Page<ConflictSummary>>('/integrations/conflicts', {
    connectionId: c.id,
    status: 'open',
    pageSize: SHOWN,
  });
  const failed = useApiQuery<Page<LinkDto>>('/integrations/links', {
    connectionId: c.id,
    state: 'error',
    pageSize: SHOWN,
  });
  const rules = useApiQuery<{ items: Profile[] }>('/integrations/profiles', { connectionId: c.id });
  const failedRules = (rules.data?.items ?? []).filter(
    (p) => p.lastRun && (p.lastRun.status === 'failed' || p.lastRun.status === 'partial'),
  );
  const loading = conflicts.isLoading || failed.isLoading || rules.isLoading;
  const error = conflicts.error ?? failed.error ?? rules.error;
  const nConflicts = conflicts.data?.total ?? 0;
  const nFailed = failed.data?.total ?? 0;
  const nothing = !loading && !error && nConflicts === 0 && nFailed === 0 && failedRules.length === 0;

  return (
    <Card className="min-w-0" role="region" aria-labelledby={id}>
      <CardHeader>
        <CardTitle id={id}>
          <HStack gap={2} vAlign="center">
            <Icon
              icon={nothing ? CircleCheckIcon : TriangleAlertIcon}
              color={nothing ? 'success' : 'warning'}
            />
            {t('title')}
          </HStack>
        </CardTitle>
        <CardDescription>{nothing ? t('nothing') : t('description')}</CardDescription>
      </CardHeader>
      {!nothing && (
        <CardContent className="min-w-0">
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : error ? (
            <ErrorState
              compact
              error={error}
              onRetry={() => {
                void conflicts.refetch();
                void failed.refetch();
                void rules.refetch();
              }}
            />
          ) : (
            <VStack gap={5} className="min-w-0">
              {nConflicts > 0 && (
                <VStack as="section" gap={2} className="min-w-0" aria-labelledby={`${id}-conflicts`}>
                  <Text type="label" as="div" role="heading" aria-level={3} id={`${id}-conflicts`}>
                    {t('conflicts', { count: nConflicts })}
                  </Text>
                  <AnimatedList>
                    {(conflicts.data?.items ?? []).map((x, i) => (
                      <AnimatedItem key={x.id}>
                        {i > 0 && <Divider />}
                        <HStack gap={2} wrap="wrap" hAlign="between" vAlign="center" paddingBlock={2}>
                          <VStack gap={0.5} className="min-w-0">
                            <LocalCell local={x.local} />
                            <Text type="supporting">
                              {t('fieldsChanged', { fields: x.fields.join(', ') })} ·{' '}
                              <RelativeTime date={x.createdAt} />
                            </Text>
                          </VStack>
                          <Button
                            label={t('resolve')}
                            aria-label={t('resolveFor', { ref: x.remoteRef ?? x.local?.title ?? '' })}
                            variant="primary"
                            size="sm"
                            icon={<Icon icon={GitCompareArrowsIcon} />}
                            onClick={() => setConflict(x.id)}
                          />
                        </HStack>
                      </AnimatedItem>
                    ))}
                  </AnimatedList>
                  {nConflicts > SHOWN && (
                    <Link href={`${connectionHref(c.id)}?tab=conflicts`}>
                      {t('allConflicts', { count: nConflicts })}
                    </Link>
                  )}
                </VStack>
              )}
              {nFailed > 0 && (
                <VStack as="section" gap={2} className="min-w-0" aria-labelledby={`${id}-failed`}>
                  <Text type="label" as="div" role="heading" aria-level={3} id={`${id}-failed`}>
                    {t('failed', { count: nFailed })}
                  </Text>
                  <VStack as="ul" gap={0}>
                    {(failed.data?.items ?? []).map((l, i) => (
                      <li key={l.id}>
                        {i > 0 && <Divider />}
                        <VStack gap={1} paddingBlock={2} className="min-w-0">
                          <HStack gap={3} wrap="wrap" vAlign="center">
                            <LocalCell local={l.local} />
                            <RemoteCell remoteRef={l.remoteRef} remoteUrl={l.remoteUrl} />
                          </HStack>
                          {l.lastError && (
                            <Text type="supporting" className="wrap-anywhere">
                              {errorText(new ApiError(422, l.lastError.code, l.lastError.message))}
                              {l.lastError.message && (
                                <>
                                  <br />
                                  {l.lastError.message}
                                </>
                              )}
                            </Text>
                          )}
                        </VStack>
                      </li>
                    ))}
                  </VStack>
                  {nFailed > SHOWN && (
                    <Link href={`${connectionHref(c.id)}?tab=links&state=error`}>
                      {t('allFailed', { count: nFailed })}
                    </Link>
                  )}
                </VStack>
              )}
              {failedRules.length > 0 && (
                <VStack as="section" gap={2} className="min-w-0" aria-labelledby={`${id}-rules`}>
                  <Text type="label" as="div" role="heading" aria-level={3} id={`${id}-rules`}>
                    {t('rules')}
                  </Text>
                  <VStack as="ul" gap={0}>
                    {failedRules.map((p, i) => (
                      <li key={p.id}>
                        {i > 0 && <Divider />}
                        <HStack gap={2} wrap="wrap" hAlign="between" vAlign="center" paddingBlock={2}>
                          <Link href={profileHref(c.id, p.id)} weight="medium">
                            {p.name}
                          </Link>
                          <HStack gap={2} vAlign="center" wrap="wrap">
                            <RunStatusText status={p.lastRun!.status} />
                            {(p.lastRun!.finishedAt ?? p.lastRun!.startedAt) && (
                              <Text type="supporting">
                                <RelativeTime date={(p.lastRun!.finishedAt ?? p.lastRun!.startedAt)!} />
                              </Text>
                            )}
                            <Link href={runHref(p.lastRun!.id)}>{t('viewRun')}</Link>
                          </HStack>
                        </HStack>
                      </li>
                    ))}
                  </VStack>
                </VStack>
              )}
            </VStack>
          )}
        </CardContent>
      )}
      <ResolveDialog conflictId={conflict} onOpenChange={(o) => !o && setConflict(null)} />
    </Card>
  );
}
