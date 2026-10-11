'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Divider } from '@astryxdesign/core/Divider';
import { Text } from '@astryxdesign/core/Text';
import type { WebPageProps } from '@isbp/sdk/web';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import {
  problemOfError,
  RunCounts,
  RunLayout,
  RunLog,
  type RunLogLine,
  RunProblemBanner,
} from '@isbp/ui/run-detail';
import { Skeleton } from '@isbp/ui/skeleton';
import { CircleXIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { COUNT_KEYS, isActiveRun, LIMITS, type RunDetail } from '../../contracts';
import { KindLabel, RunStatusBadge, TriggerLabel } from '../badges';
import { connectionHref, profileHref, useLabel } from '../lib';

/** A sync run: status, counts and its log (followed live while it runs). */
export default function RunPage({ params }: WebPageProps) {
  const t = useTranslations('integrations.run');
  const tn = useTranslations('integrations.counts');
  const label = useLabel();
  const format = useFormatter();
  const id = params.id ?? '';
  const [active, setActive] = useState(true);
  const {
    data: run,
    isLoading,
    error,
  } = useApiQuery<RunDetail>(`/integrations/runs/${id}`, undefined, {
    refetchInterval: active ? 1_500 : undefined,
  });
  const live = run ? isActiveRun(run.status) : true;
  useEffect(() => setActive(live), [live]);

  if (isLoading)
    return (
      <VStack gap={5}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </VStack>
    );
  if (error || !run) return <ErrorState error={error} kind="page" />;
  const when = format.dateTime(new Date(run.startedAt ?? run.createdAt), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const problems = run.log.filter((l) => l.level === 'error');
  // Field labels in the reader's language ("Updated INC-00042 from #1234: Title, Due date").
  const text = (l: (typeof run.log)[number]) =>
    l.ref?.fields?.length ? `${l.message}: ${l.ref.fields.map((f) => label(f)).join(', ')}` : l.message;
  const lines: RunLogLine[] = [
    ...run.log.slice(0, run.logDropped ? LIMITS.logHead : run.log.length).map((l, i) => ({
      key: i,
      at: l.at,
      level: l.level,
      message: text(l),
    })),
    ...(run.logDropped
      ? [
          {
            key: 'dropped',
            at: run.log[LIMITS.logHead]?.at ?? run.createdAt,
            level: 'info' as const,
            message: t('dropped', { count: run.logDropped }),
          },
          ...run.log.slice(LIMITS.logHead).map((l, i) => ({
            key: i + LIMITS.logHead,
            at: l.at,
            level: l.level,
            message: text(l),
          })),
        ]
      : []),
  ];

  return (
    <VStack gap={5}>
      <DetailHeader
        className="pb-0"
        back={{ href: `${connectionHref(run.connection.id)}?tab=runs`, label: run.connection.name }}
        reference={
          <HStack gap={2} wrap="wrap" vAlign="center">
            <KindLabel kind={run.kind} />
            <span aria-hidden>·</span>
            <TriggerLabel trigger={run.trigger} />
          </HStack>
        }
        title={t('title', { profile: run.profile.name, when })}
        status={
          <HStack gap={2} wrap="wrap" vAlign="center" role="status" aria-live="polite">
            <RunStatusBadge status={run.status} />
            {run.status === 'waiting' && run.resumeAt && (
              <Text color="secondary">
                {t('resumes')} <DateTime date={run.resumeAt} />
              </Text>
            )}
          </HStack>
        }
      />

      <RunLayout
        aside={
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{t('details')}</CardTitle>
            </CardHeader>
            <CardContent>
              <MetadataList label={{ position: 'start', width: 136 }}>
                <MetadataListItem label={t('profile')}>
                  <Link href={profileHref(run.connection.id, run.profile.id)}>{run.profile.name}</Link>
                </MetadataListItem>
                <MetadataListItem label={t('started')}>
                  {run.startedAt ? <DateTime date={run.startedAt} /> : '—'}
                </MetadataListItem>
                <MetadataListItem label={t('finished')}>
                  {run.finishedAt ? <DateTime date={run.finishedAt} /> : '—'}
                </MetadataListItem>
                <MetadataListItem label={t('duration')}>
                  {run.durationMs !== null
                    ? t('seconds', { s: format.number(Math.round(run.durationMs / 100) / 10) })
                    : '—'}
                </MetadataListItem>
                <MetadataListItem label={t('by')}>{run.triggeredBy?.displayName ?? '—'}</MetadataListItem>
              </MetadataList>
            </CardContent>
          </Card>
        }
      >
        {run.error && (
          <RunProblemBanner
            problem={problemOfError(
              { status: 422, code: run.errorCode ?? 'INVALID_STATE', message: run.error },
              {
                id: run.connection.id,
                name: run.connection.name,
                href: connectionHref(run.connection.id),
              },
            )}
            error={run.error}
          />
        )}
        <RunCounts
          label={t('counts')}
          // The main counters always; the rest only when something happened.
          items={COUNT_KEYS.filter(
            (k) => ['read', 'created', 'updated', 'pushed', 'errors'].includes(k) || run.counts[k] > 0,
          ).map((k) => ({
            key: k,
            label: tn(k),
            value: format.number(run.counts[k]),
            tone:
              k === 'errors' && run.counts.errors > 0
                ? 'destructive'
                : k === 'conflicts' && run.counts.conflicts > 0
                  ? 'warning'
                  : 'default',
          }))}
        />
        {problems.length > 0 && (
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>
                <HStack gap={2} vAlign="center">
                  <Icon icon={CircleXIcon} color="error" />
                  {t('problems', { count: problems.length })}
                </HStack>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <VStack as="ul" gap={0}>
                {problems.slice(0, 20).map((p, i) => (
                  <li key={`${p.at}-${i}`}>
                    {i > 0 && <Divider />}
                    <VStack gap={0.5} paddingBlock={2} className="min-w-0">
                      {(p.ref?.local || p.ref?.remote) && (
                        <HStack gap={2} wrap="wrap" vAlign="center">
                          {p.ref?.local && <Text weight="medium">{p.ref.local}</Text>}
                          {p.ref?.remote && (
                            <Text type="code" color="secondary">
                              {p.ref.remote}
                            </Text>
                          )}
                          <Link
                            href={`${connectionHref(run.connection.id)}?tab=links&q=${encodeURIComponent(p.ref.remote ?? p.ref.local ?? '')}`}
                          >
                            {t('openLink')}
                          </Link>
                        </HStack>
                      )}
                      <Text color="secondary" className="wrap-anywhere">
                        {text(p)}
                      </Text>
                    </VStack>
                  </li>
                ))}
              </VStack>
            </CardContent>
          </Card>
        )}
        <RunLog lines={lines} live={live} fileName={`sync-run-${run.id}.log`} />
      </RunLayout>
    </VStack>
  );
}
