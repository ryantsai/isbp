'use client';

import { HStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import type { Page } from '@isbp/sdk';
import { Card, CardContent } from '@isbp/ui/card';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { Button } from '@astryxdesign/core/Button';
import { ListChecksIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ActionItem } from '../../contracts';
import { ItemList } from '../items';
import { MeetingsTabs } from '../section-tabs';

const todayLocal = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** My action items from meeting minutes (or those of meetings I organised), open first by due date. */
export default function ActionItemsPage() {
  const t = useTranslations('meetings.actionItems');
  const [state, set] = useListState({ pageSize: 50 });
  const view = state.view === 'assigned' ? 'assigned' : 'mine';
  const status = state.status === 'done' || state.status === 'all' ? (state.status as string) : 'open';
  const q = useApiQuery<Page<ActionItem>>('/meetings/action-items', {
    view,
    status,
    page: state.page,
    pageSize: state.pageSize,
  });
  const items = q.data?.items ?? [];
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader title={t('title')} description={t('description')} />
      <MeetingsTabs />
      <HStack gap={3} wrap="wrap">
        <SegmentedControl
          label={t('whose')}
          value={view}
          onChange={(v) => set({ view: v === 'assigned' ? 'assigned' : undefined, page: 1 })}
        >
          <SegmentedControlItem value="mine" label={t('mine')} />
          <SegmentedControlItem value="assigned" label={t('assigned')} />
        </SegmentedControl>
        <SegmentedControl
          label={t('which')}
          value={status}
          onChange={(v) => set({ status: v === 'open' ? undefined : v, page: 1 })}
        >
          <SegmentedControlItem value="open" label={t('open')} />
          <SegmentedControlItem value="done" label={t('done')} />
          <SegmentedControlItem value="all" label={t('all')} />
        </SegmentedControl>
      </HStack>
      {q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} kind="list" />
      ) : !q.data ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !items.length ? (
        <EmptyState
          icon={<ListChecksIcon />}
          title={status === 'open' ? t('emptyOpen') : t('empty')}
          description={view === 'mine' ? t('emptyMineHint') : t('emptyAssignedHint')}
        />
      ) : (
        <Card className="min-w-0">
          <CardContent className="grid gap-4 pt-4">
            <ItemList items={items} showMeeting today={todayLocal()} />
            {q.data.total > items.length && (
              <HStack hAlign="center">
                <Button
                  label={t('showMore')}
                  variant="secondary"
                  onClick={() => set({ pageSize: state.pageSize + 50 })}
                />
              </HStack>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
