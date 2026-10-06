'use client';

import type { SubmissionStatus, SubmissionSummary } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import type { ColumnDef } from '@tanstack/react-table';
import { InboxIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { DateTime, RelativeTime } from '@/components/relative-time';
import { useApiQuery } from '@/lib/api';
import { SUBMISSION_STATUSES, SubmissionStatusBadge } from './form-meta';

const ALL = '__all__';

/** Requests made with this form (all versions), newest first. */
export function FormSubmissions({ formId }: { formId: string }) {
  const t = useTranslations('forms.submissions');
  const tc = useTranslations('common');
  const router = useRouter();
  const [state, set] = useListState({ pageSize: 25 });
  const status = SUBMISSION_STATUSES.includes(state.status as SubmissionStatus)
    ? (state.status as SubmissionStatus)
    : undefined;
  const { data, isLoading, isFetching } = useApiQuery<Page<SubmissionSummary>>(
    `/forms/${formId}/submissions`,
    {
      page: state.page,
      pageSize: state.pageSize,
      status,
    },
  );

  const columns = useMemo<ColumnDef<SubmissionSummary, unknown>[]>(
    () => [
      {
        id: 'reference',
        header: t('columns.reference'),
        cell: ({ row }) => (
          <Link
            href={`/requests/${row.original.reference}`}
            onClick={(e) => e.stopPropagation()}
            className="rounded-sm font-mono text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
            <span className="flex items-center gap-2">
              <UserAvatar
                name={row.original.submittedBy.displayName}
                src={row.original.submittedBy.avatarUrl}
                className="size-6 text-[10px]"
              />
              <span className="truncate">{row.original.submittedBy.displayName}</span>
            </span>
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
      getRowId={(s) => s.id}
      onRowClick={(s) => router.push(`/requests/${s.reference}`)}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      toolbar={
        <>
          <Select value={status ?? ALL} onValueChange={(v) => set({ status: v === ALL ? undefined : v })}>
            <SelectTrigger className="w-full sm:w-48" aria-label={t('statusFilter')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
              {SUBMISSION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  <SubmissionStatusBadge status={s} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {status && (
            <Button variant="ghost" size="sm" onClick={() => set({ status: undefined })}>
              {tc('clearFilters')}
            </Button>
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
