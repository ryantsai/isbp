'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import type { Delivery } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
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
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<Delivery>>(PATH, query);
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
            <Tooltip content={<span className="block max-w-sm break-words">{row.original.lastError}</span>}>
              <span
                tabIndex={0}
                className="block truncate rounded-sm font-mono text-xs text-destructive outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {row.original.lastError}
              </span>
            </Tooltip>
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
      <Text color="secondary" as="p" className="max-w-2xl">
        {t('intro')}
      </Text>
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
        getRowId={(d) => d.id}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        toolbar={
          <>
            <Selector
              label={t('filters.status')}
              isLabelHidden
              width={176}
              value={status ?? ALL}
              onChange={(v) => set({ status: v && v !== ALL ? v : undefined })}
              options={[
                { value: ALL, label: t('filters.allStatuses') },
                { type: 'divider' },
                ...DELIVERY_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
              ]}
            />
            <Selector
              label={t('filters.channel')}
              isLabelHidden
              width={176}
              value={channel ?? ALL}
              onChange={(v) => set({ channel: v && v !== ALL ? v : undefined })}
              options={[
                { value: ALL, label: t('filters.allChannels') },
                { type: 'divider' },
                ...CHANNEL_KINDS.map((c) => ({ value: c, label: channelLabel(c) })),
              ]}
            />
            {filtered && (
              <Button
                label={tc('clearFilters')}
                variant="ghost"
                size="sm"
                icon={<Icon icon={XIcon} />}
                onClick={() => set({ status: undefined, channel: undefined })}
              />
            )}
            <IconButton
              label={t('refresh')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={RefreshCwIcon} />}
              className="ml-auto"
              onClick={() => void refetch()}
            />
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
                  label={tc('clearFilters')}
                  variant="secondary"
                  size="sm"
                  onClick={() => set({ status: undefined, channel: undefined })}
                />
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
