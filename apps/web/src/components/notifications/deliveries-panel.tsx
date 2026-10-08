'use client';

import type { Delivery } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@isbp/ui/select';
import { Hint } from '@isbp/ui/tooltip';
import { RefreshCwIcon, ScrollTextIcon, SearchXIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { RelativeTime } from '@/components/relative-time';
import { useApiQuery } from '@/lib/api';
import {
  ChannelLabel,
  DELIVERY_STATUSES,
  DeliveryStatusBadge,
  useChannelLabel,
  useTypeLabel,
} from './notification-meta';

const PATH = '/notification-deliveries';
const ALL = '__all__';
const CHANNEL_KINDS = ['email', 'teams', 'slack', 'webhook'] as const;

/** Every email and channel message the worker tried to send, newest first, with failures explained. */
export function DeliveriesPanel() {
  const t = useTranslations('notifications.admin.log');
  const tc = useTranslations('common');
  const typeLabel = useTypeLabel();
  const channelLabel = useChannelLabel();
  const [state, set] = useListState({ pageSize: 25 });
  const str = (k: string) => (typeof state[k] === 'string' && state[k] ? (state[k] as string) : undefined);
  const status = str('status');
  const channel = str('channel');
  const query = { page: state.page, pageSize: state.pageSize, status, channel };
  const { data, isLoading, isFetching, refetch } = useApiQuery<Page<Delivery>>(PATH, query);
  const filtered = Boolean(status || channel);

  const columns = useMemo<DataTableColumn<Delivery>[]>(
    () => [
      {
        id: 'channel',
        header: t('columns.channel'),
        meta: { className: 'whitespace-nowrap' },
        cell: ({ row }) => <ChannelLabel kind={row.original.channel} />,
      },
      {
        id: 'notification',
        header: t('columns.notification'),
        meta: { className: 'max-w-72 min-w-48' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium" title={row.original.title}>
              {row.original.title}
            </p>
            <p className="truncate text-xs text-muted-foreground" title={row.original.type}>
              {typeLabel(row.original.type)}
            </p>
          </div>
        ),
      },
      {
        id: 'recipient',
        header: t('columns.recipient'),
        meta: { className: 'hidden max-w-48 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <span className="block truncate" title={row.original.recipient}>
            {row.original.recipient}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-0.5">
            <DeliveryStatusBadge status={row.original.status} />
            {row.original.attempts > 0 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {t('attempts', { count: row.original.attempts })}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'error',
        header: t('columns.error'),
        meta: { className: 'hidden max-w-52 lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) =>
          row.original.lastError ? (
            <Hint label={<span className="block max-w-sm break-words">{row.original.lastError}</span>}>
              <span
                tabIndex={0}
                className="block truncate rounded-sm font-mono text-xs text-destructive outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {row.original.lastError}
              </span>
            </Hint>
          ) : (
            <span className="text-muted-foreground" aria-label={t('noError')}>
              —
            </span>
          ),
      },
      {
        id: 'created',
        header: t('columns.created'),
        meta: { className: 'whitespace-nowrap text-muted-foreground' },
        cell: ({ row }) => <RelativeTime date={row.original.createdAt} />,
      },
      {
        id: 'sent',
        header: t('columns.sent'),
        meta: {
          className: 'hidden whitespace-nowrap text-muted-foreground xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) =>
          row.original.sentAt ? (
            <RelativeTime date={row.original.sentAt} />
          ) : (
            <span aria-label={t('notSent')}>—</span>
          ),
      },
    ],
    [t, typeLabel],
  );

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
      <DataTable
        label={t('title')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        loading={isLoading}
        fetching={isFetching}
        getRowId={(d) => d.id}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        toolbar={
          <>
            <Select value={status ?? ALL} onValueChange={(v) => set({ status: v === ALL ? undefined : v })}>
              <SelectTrigger className="w-full sm:w-44" aria-label={t('filters.status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
                <SelectSeparator />
                {DELIVERY_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={channel ?? ALL} onValueChange={(v) => set({ channel: v === ALL ? undefined : v })}>
              <SelectTrigger className="w-full sm:w-44" aria-label={t('filters.channel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('filters.allChannels')}</SelectItem>
                <SelectSeparator />
                {CHANNEL_KINDS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {channelLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => set({ status: undefined, channel: undefined })}
              >
                <XIcon /> {tc('clearFilters')}
              </Button>
            )}
            <Hint label={t('refresh')}>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                onClick={() => void refetch()}
                aria-label={t('refresh')}
              >
                <RefreshCwIcon
                  className={isFetching ? 'animate-spin motion-reduce:animate-none' : undefined}
                />
              </Button>
            </Hint>
          </>
        }
        empty={
          filtered ? (
            <EmptyState
              icon={<SearchXIcon />}
              title={t('emptyFilteredTitle')}
              description={t('emptyFilteredBody')}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => set({ status: undefined, channel: undefined })}
                >
                  {tc('clearFilters')}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<ScrollTextIcon />} title={t('emptyTitle')} description={t('emptyBody')} />
          )
        }
      />
    </div>
  );
}
