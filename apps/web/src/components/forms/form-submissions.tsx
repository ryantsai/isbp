'use client';

import type { SubmissionStatus, SubmissionSummary } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { InboxIcon, SearchXIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { DateTime, RelativeTime } from '@/components/relative-time';
import { useApiQuery } from '@/lib/api';
import { SUBMISSION_STATUSES, SubmissionStatusBadge } from './form-meta';
import { Button } from '@astryxdesign/core/Button';
import { HStack, StackItem } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';

const ALL = '__all__';

/** Requests made with this form (all versions), newest first. */
export function FormSubmissions({ formId }: { formId: string }) {
  const t = useTranslations('forms.submissions');
  const ts = useTranslations('forms.submissionStatus');
  const tc = useTranslations('common');
  const router = useRouter();
  const [state, set] = useListState({ pageSize: 25 });
  const status = SUBMISSION_STATUSES.includes(state.status as SubmissionStatus)
    ? (state.status as SubmissionStatus)
    : undefined;
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<SubmissionSummary>>(
    `/forms/${formId}/submissions`,
    {
      page: state.page,
      pageSize: state.pageSize,
      status,
    },
  );

  const columns = useMemo<DataTableColumn<SubmissionSummary>[]>(
    () => [
      {
        id: 'reference',
        header: t('columns.reference'),
        cell: ({ row }) => (
          <Link
            href={`/requests/${row.original.reference}`}
            color="primary"
            weight="medium"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.reference}
          </Link>
        ),
      },
      {
        id: 'submitter',
        header: t('columns.submitter'),
        cell: ({ row }) =>
          row.original.submittedBy ? (
            <HStack gap={2} vAlign="center">
              <UserAvatar
                name={row.original.submittedBy.displayName}
                src={row.original.submittedBy.avatarUrl}
                className="size-6 text-[10px]"
              />
              <StackItem size="fill">
                <Text maxLines={1}>{row.original.submittedBy.displayName}</Text>
              </StackItem>
            </HStack>
          ) : (
            '—'
          ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => <SubmissionStatusBadge status={row.original.status} />,
      },
      {
        id: 'submitted',
        header: t('columns.submitted'),
        meta: {
          className: 'hidden text-muted-foreground sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.createdAt} />,
      },
      {
        id: 'completed',
        header: t('columns.completed'),
        meta: {
          className: 'hidden text-muted-foreground md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) =>
          row.original.completedAt ? <DateTime date={row.original.completedAt} /> : <span>—</span>,
      },
    ],
    [t],
  );

  return (
    <DataTable
      label={t('title')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      loading={isLoading}
      fetching={isFetching}
      error={error}
      onRetry={() => refetch()}
      getRowId={(s) => s.id}
      onRowClick={(s) => router.push(`/requests/${s.reference}`)}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      toolbar={
        <>
          <Selector
            label={t('statusFilter')}
            isLabelHidden
            width={192}
            value={status ?? ALL}
            onChange={(v) => set({ status: v === ALL ? undefined : v })}
            options={[
              { value: ALL, label: t('allStatuses') },
              ...SUBMISSION_STATUSES.map((s) => ({ value: s, label: ts(s) })),
            ]}
          />
          {status && (
            <Button
              label={tc('clearFilters')}
              variant="ghost"
              size="sm"
              onClick={() => set({ status: undefined })}
            />
          )}
        </>
      }
      empty={
        status ? (
          <EmptyState icon={<SearchXIcon />} title={t('emptyFiltered')} />
        ) : (
          <EmptyState icon={<InboxIcon />} title={t('emptyTitle')} description={t('emptyDescription')} />
        )
      }
    />
  );
}
