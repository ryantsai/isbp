'use client';

import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ClipboardPenLineIcon, MessageSquareTextIcon, PencilIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';
import type { ProjectDetail, ProjectStatusUpdates } from '../../contracts';
import { StandingBadge } from '../components/badges';
import { projectApi, useSearchParam } from '../lib';
import { useDueLabel, usePeriodLabel } from '../status/period';
import { UpdateCard } from '../status/update-card';
import { StatusUpdateSheet } from '../status/update-sheet';

const PAGE_SIZE = 10;

function UpdatesSkeleton() {
  return (
    <div className="grid gap-4" aria-busy>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

/**
 * A project's status updates: this period's (who owes one, who sent it), the form to write yours (`&compose=1`
 * opens it, as My work and reminders do), and earlier updates.
 */
export function UpdatesTab({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.updates');
  const periodLabel = usePeriodLabel();
  const dueLabel = useDueLabel();
  const [pages, setPages] = useState(1);
  const [compose, setCompose] = useSearchParam('compose');
  const q = useApiQuery<ProjectStatusUpdates>(`${projectApi(project.key)}/status-updates`, {
    page: 1,
    pageSize: PAGE_SIZE * pages,
  });
  if (q.error && !q.data)
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} kind="section" />;
  if (!q.data) return <UpdatesSkeleton />;
  const d = q.data;
  const sent = d.current.filter((u) => u.state === 'submitted');
  const owed = d.current.filter((u) => u.expected);
  const mine = d.mine;
  const editing = mine?.state === 'submitted' && mine.canEdit;
  const canWrite = d.canPost || editing;
  const open = compose === '1' && Boolean(canWrite);
  const byManager = project.viewer.role === 'manager';
  const primary = canWrite ? (
    <Button
      label={editing ? t('editYours') : t('write')}
      variant={editing ? 'secondary' : 'primary'}
      icon={<Icon icon={editing ? PencilIcon : ClipboardPenLineIcon} />}
      onClick={() => setCompose('1')}
    />
  ) : null;

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="grid min-w-0 gap-4 lg:col-span-2">
        <Card className="min-w-0 gap-4">
          <CardHeader>
            <CardTitle>{t('thisPeriod', { period: periodLabel(d.period) })}</CardTitle>
            <CardDescription>
              {d.scheduleEnabled ? dueLabel(d.period.due) : t('notScheduled')}
            </CardDescription>
            {primary && <CardAction>{primary}</CardAction>}
          </CardHeader>
          <CardContent className="grid gap-4">
            {sent.length ? (
              sent.map((u, i) => (
                <Fragment key={u.id}>
                  {i > 0 && <Divider />}
                  <UpdateCard update={u} />
                </Fragment>
              ))
            ) : (
              <EmptyState
                variant="compact"
                icon={<MessageSquareTextIcon />}
                title={t('noneThisPeriod')}
                description={canWrite ? t('noneThisPeriodWriter') : t('noneThisPeriodReader')}
              />
            )}
          </CardContent>
        </Card>
        {d.history.items.length > 0 && (
          <Card className="min-w-0 gap-4">
            <CardHeader>
              <CardTitle>{t('earlier')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {d.history.items.map((u, i) => {
                const newPeriod = i === 0 || d.history.items[i - 1]!.period.key !== u.period.key;
                return (
                  <Fragment key={u.id}>
                    {i > 0 && <Divider />}
                    {newPeriod && (
                      <Text type="label">{periodLabel({ ...u.period, cadence: d.period.cadence })}</Text>
                    )}
                    <UpdateCard update={u} />
                  </Fragment>
                );
              })}
              {d.history.total > d.history.items.length && (
                <HStack hAlign="center">
                  <Button
                    label={t('showMore')}
                    variant="secondary"
                    isLoading={q.isFetching}
                    onClick={() => setPages((p) => p + 1)}
                  />
                </HStack>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <aside className="grid min-w-0 gap-4" aria-label={t('reporters')}>
        <Card className="min-w-0 gap-3">
          <CardHeader>
            <CardTitle>{t('reporters')}</CardTitle>
            <CardDescription>
              {d.scheduleEnabled ? t('reportersHint') : t('notScheduledHint')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {owed.length ? (
              <ul className="grid gap-2.5">
                {owed.map((u) => (
                  <li key={u.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                    <UserAvatar
                      name={u.author?.displayName ?? '—'}
                      src={u.author?.avatarUrl}
                      className="size-6 text-[10px]"
                    />
                    <span className="min-w-0 truncate">
                      <Text>{u.author?.displayName ?? '—'}</Text>
                    </span>
                    <StandingBadge standing={u.standing} />
                  </li>
                ))}
              </ul>
            ) : (
              <Text type="supporting">{t('noReporters')}</Text>
            )}
          </CardContent>
        </Card>
      </aside>
      {canWrite && (
        <StatusUpdateSheet
          project={project}
          period={d.period}
          update={mine}
          byManager={byManager}
          targetDate={project.targetDate}
          open={open}
          onOpenChange={(o) => setCompose(o ? '1' : null)}
        />
      )}
    </div>
  );
}
