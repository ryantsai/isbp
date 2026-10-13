'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FilterBar } from '@isbp/ui/filter-bar';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Segmented } from '@isbp/ui/segmented';
import { ChevronLeftIcon, ChevronRightIcon, ClipboardCheckIcon, SettingsIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import {
  type Compliance,
  PERMISSIONS,
  type StatusUpdate,
  UPDATE_STANDINGS,
  type UpdateStanding,
} from '../../contracts';
import { HealthBadge, StandingBadge } from '../components/badges';
import { projectHref } from '../lib';
import { ProjectsTabs } from '../section-tabs';
import { usePeriodLabel } from '../status/period';

const ALL = 'all';
type Filter = UpdateStanding | typeof ALL;

/** Who sent their status update for a period (the PMO and portfolio readers), with the counts per standing. */
export default function StatusUpdatesPage() {
  const t = useTranslations('projects.compliance');
  const ts = useTranslations('projects.standing');
  const periodLabel = usePeriodLabel();
  const router = useRouter();
  const canManage = useCan(PERMISSIONS.reporting);
  const [state, set] = useListState();
  const standing = (UPDATE_STANDINGS as readonly string[]).includes(state.standing as string)
    ? (state.standing as UpdateStanding)
    : undefined;
  const q = useApiQuery<Compliance>('/projects/status-updates', {
    page: state.page,
    pageSize: state.pageSize,
    period: (state.period as string | undefined) || undefined,
    standing,
    q: (state.q as string | undefined) || undefined,
  });
  const d = q.data;

  const columns = useMemo<DataTableColumn<StatusUpdate>[]>(
    () => [
      {
        id: 'project',
        header: t('columns.project'),
        meta: { wrap: true, className: 'max-w-80' },
        cell: ({ row }) => (
          <VStack gap={0} className="min-w-0">
            <Link
              href={`${projectHref(row.original.project.key)}?view=updates`}
              onClick={(e) => e.stopPropagation()}
              weight="medium"
            >
              {row.original.project.name}
            </Link>
            <Text type="code" color="secondary">
              {row.original.project.key}
            </Text>
          </VStack>
        ),
      },
      {
        id: 'author',
        header: t('columns.reporter'),
        cell: ({ row }) => (
          <HStack gap={2} vAlign="center">
            <UserAvatar
              name={row.original.author?.displayName ?? '—'}
              src={row.original.author?.avatarUrl}
              className="size-6 text-[10px]"
            />
            <Text>{row.original.author?.displayName ?? '—'}</Text>
          </HStack>
        ),
      },
      {
        id: 'standing',
        header: t('columns.standing'),
        cell: ({ row }) => <StandingBadge standing={row.original.standing} />,
      },
      {
        id: 'status',
        header: t('columns.status'),
        meta: { priority: 2 },
        cell: ({ row }) => (row.original.status ? <HealthBadge health={row.original.status} plain /> : '—'),
      },
      {
        id: 'sent',
        header: t('columns.sent'),
        meta: { priority: 2 },
        cell: ({ row }) =>
          row.original.submittedAt ? <RelativeTime date={row.original.submittedAt} /> : '—',
      },
    ],
    [t],
  );

  const counts = d?.counts;
  const label = (s: Filter) =>
    s === ALL
      ? t('all', {
          count: counts ? counts.submitted + counts.late + counts.due + counts.overdue + counts.missed : 0,
        })
      : t('withCount', { label: ts(s), count: counts?.[s] ?? 0 });
  const filtered = Boolean(standing || state.q);

  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <Button
              label={t('schedule')}
              variant="secondary"
              icon={<Icon icon={SettingsIcon} />}
              href="/projects/reporting"
            />
          ) : undefined
        }
      />
      <ProjectsTabs />
      <HStack gap={1} vAlign="center" role="group" aria-label={t('periodNav')}>
        <IconButton
          label={t('previousPeriod')}
          icon={<Icon icon={ChevronLeftIcon} />}
          variant="ghost"
          isDisabled={!d}
          onClick={() => d && set({ period: d.previousKey, page: 1 })}
        />
        <Text weight="medium" aria-live="polite">
          {d ? periodLabel(d.period) : '…'}
        </Text>
        <IconButton
          label={t('nextPeriod')}
          icon={<Icon icon={ChevronRightIcon} />}
          variant="ghost"
          isDisabled={!d?.nextKey}
          onClick={() => d?.nextKey && set({ period: d.nextKey, page: 1 })}
        />
      </HStack>
      <Segmented<Filter>
        label={t('filter')}
        value={standing ?? ALL}
        onChange={(v) => set({ standing: v === ALL ? undefined : v, page: 1 })}
        options={[ALL, 'overdue', 'missed', 'due', 'late', 'submitted'].map((s) => ({
          value: s as Filter,
          label: label(s as Filter),
        }))}
      />
      <DataTable
        label={t('title')}
        columns={columns}
        data={d?.items ?? []}
        total={d?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        onRetry={() => void q.refetch()}
        getRowId={(u) => u.id}
        onRowClick={(u) => router.push(`${projectHref(u.project.key)}?view=updates`)}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        toolbar={
          <FilterBar
            search={
              <SearchInput
                value={(state.q as string | undefined) ?? ''}
                onChange={(v) => set({ q: v || undefined, page: 1 })}
                placeholder={t('search')}
                className="sm:w-72"
              />
            }
            onClearAll={filtered ? () => set({ q: undefined, standing: undefined, page: 1 }) : undefined}
          />
        }
        empty={
          filtered ? (
            <EmptyState
              variant="filtered"
              onClearFilters={() => set({ q: undefined, standing: undefined, page: 1 })}
            />
          ) : (
            <EmptyState
              icon={<ClipboardCheckIcon />}
              title={t('empty')}
              description={canManage ? t('emptyManager') : t('emptyReader')}
              action={
                canManage ? (
                  <Button label={t('schedule')} variant="primary" href="/projects/reporting" />
                ) : undefined
              }
            />
          )
        }
      />
    </div>
  );
}
