'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn, DataTableSummary, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatusBadge } from '@isbp/ui/status';
import { BotIcon, ScrollTextIcon, SearchXIcon, UserIcon, ZapIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  CALL_PERIODS,
  type CallDetail,
  type CallDto,
  type CallerDto,
  type EndpointSummary,
} from '../../contracts';
import { HttpStatus } from '../badges';
import { endpointHref, useDuration } from '../lib';
import { DataApiTabs } from '../section-tabs';

const ALL = '__all__';
const FILTERS = ['endpoint', 'status', 'caller', 'period', 'q'] as const;

/** A filter select with an "all" entry (a sentinel option: `Selector` has no empty value). */
function FilterSelect({
  value,
  onChange,
  label,
  allLabel,
  options,
  width = 176,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  label: string;
  allLabel?: string;
  options: { value: string; label: string }[];
  width?: number;
}) {
  return (
    <Selector
      label={label}
      isLabelHidden
      width={width}
      options={allLabel ? [{ value: ALL, label: allLabel }, ...options] : options}
      value={value ?? ALL}
      onChange={(v) => onChange(v === ALL ? undefined : v)}
    />
  );
}

function CallerName({ caller }: { caller: CallerDto }) {
  return (
    <HStack gap={1.5} vAlign="center" className="min-w-0">
      <Icon icon={caller.type === 'client' ? BotIcon : UserIcon} color="secondary" />
      <Text maxLines={1}>{caller.name}</Text>
    </HStack>
  );
}

/** One call: masked parameters, the full error and the request id. */
function CallSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslations('etl.logs');
  const tc = useTranslations('common');
  const duration = useDuration();
  const { data } = useApiQuery<CallDetail>(id ? `/etl/calls/${id}` : null);
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent closeLabel={tc('close')} className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t('call')}</SheetTitle>
          <SheetDescription>
            {data ? `${data.endpoint.name} · v${data.version ?? '—'}` : ' '}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="overflow-y-auto">
          {!data ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <VStack gap={4}>
              <MetadataList label={{ position: 'start', width: 136 }}>
                <MetadataListItem label={t('when')}>
                  <DateTime date={data.createdAt} />
                </MetadataListItem>
                <MetadataListItem label={t('endpoint')}>
                  <Link href={endpointHref(data.endpoint.slug)}>{data.endpoint.name}</Link>
                </MetadataListItem>
                <MetadataListItem label={t('caller')}>
                  <CallerName caller={data.caller} />
                </MetadataListItem>
                <MetadataListItem label={t('status')}>
                  <HttpStatus status={data.status} code={data.errorCode} />
                </MetadataListItem>
                <MetadataListItem label={t('duration')}>{duration(data.durationMs)}</MetadataListItem>
                <MetadataListItem label={t('rows')}>{data.rows ?? '—'}</MetadataListItem>
                <MetadataListItem label={t('cache')}>{data.cached ? t('hit') : t('miss')}</MetadataListItem>
                <MetadataListItem label={t('requestId')}>
                  <Text type="code">{data.requestId ?? '—'}</Text>
                </MetadataListItem>
              </MetadataList>
              {data.errorMessage && <Banner status="error" title={data.errorMessage} collapsible={false} />}
              <VStack gap={1.5}>
                <Text type="label">{t('params')}</Text>
                <CodeBlock
                  code={JSON.stringify(data.params, null, 2)}
                  language="json"
                  width="100%"
                  maxHeight="16rem"
                  isWrapped
                />
                <Text type="supporting">{t('maskedHint')}</Text>
              </VStack>
            </VStack>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** The execution log of Data API calls, filtered by endpoint, outcome, caller and period. */
export default function LogsPage() {
  const t = useTranslations('etl');
  const tc = useTranslations('common');
  const format = useFormatter();
  const duration = useDuration();
  const [state, set] = useListState({ pageSize: 50 });
  const [open, setOpen] = useState<string | null>(null);
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const period = (CALL_PERIODS as readonly string[]).includes(str('period') ?? '') ? str('period')! : '7d';
  const endpoints =
    useApiQuery<Page<EndpointSummary>>('/etl/endpoints', { pageSize: 200, sort: 'name' }).data?.items ?? [];
  const callers = useApiQuery<{ items: CallerDto[] }>('/etl/calls/callers').data?.items ?? [];
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<CallDto>>('/etl/calls', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    q: state.q,
    endpoint: str('endpoint'),
    status: str('status'),
    caller: str('caller'),
    period,
  });
  const filtered = FILTERS.some((k) => k !== 'period' && str(k));

  const columns = useMemo<DataTableColumn<CallDto>[]>(
    () => [
      {
        id: 'createdAt',
        header: t('logs.when'),
        meta: { sortKey: 'createdAt', priority: 2, className: 'whitespace-nowrap' },
        cell: ({ row }) => <RelativeTime date={row.original.createdAt} />,
      },
      {
        id: 'endpoint',
        header: t('logs.endpoint'),
        meta: { wrap: true, className: 'max-w-72' },
        cell: ({ row }) => (
          <VStack gap={0} className="min-w-0">
            <Text weight="medium" className="wrap-anywhere">
              {row.original.endpoint.name}
            </Text>
            <Text type="code" color="secondary" className="wrap-anywhere">
              {row.original.endpoint.slug}
              {row.original.version !== null && ` · v${row.original.version}`}
            </Text>
            <DataTableSummary>
              <RelativeTime date={row.original.createdAt} />
              <span className="tabular-nums">{duration(row.original.durationMs)}</span>
            </DataTableSummary>
          </VStack>
        ),
      },
      {
        id: 'caller',
        header: t('logs.caller'),
        meta: { priority: 2, className: 'max-w-48' },
        cell: ({ row }) => <CallerName caller={row.original.caller} />,
      },
      {
        id: 'status',
        header: t('logs.status'),
        meta: { sortKey: 'status', className: 'whitespace-normal' },
        cell: ({ row }) => <HttpStatus status={row.original.status} code={row.original.errorCode} />,
      },
      {
        id: 'durationMs',
        header: t('logs.duration'),
        meta: { sortKey: 'durationMs', priority: 2, className: 'tabular-nums' },
        cell: ({ row }) => (
          <HStack gap={1} vAlign="center">
            {duration(row.original.durationMs)}
            {row.original.cached && <StatusBadge tone="info" icon={ZapIcon} label={t('logs.cached')} />}
          </HStack>
        ),
      },
      {
        id: 'rows',
        header: t('logs.rows'),
        meta: { priority: 3, className: 'tabular-nums' },
        cell: ({ row }) => (row.original.rows === null ? '—' : format.number(row.original.rows)),
      },
    ],
    [t, format, duration],
  );

  return (
    <>
      <PageHeader title={t('endpoints.title')} description={t('logs.description')} />
      <DataApiTabs />
      <DataTable
        label={t('logs.title')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        sort={state.sort}
        loading={isLoading}
        fetching={isFetching}
        error={error}
        onRetry={() => refetch()}
        getRowId={(c) => c.id}
        onRowClick={(c) => setOpen(c.id)}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        toolbar={
          <>
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('logs.search')}
              className="sm:w-60"
            />
            <FilterSelect
              value={str('endpoint')}
              onChange={(v) => set({ endpoint: v })}
              label={t('logs.endpoint')}
              allLabel={t('logs.allEndpoints')}
              options={endpoints.map((e) => ({ value: e.id, label: e.name }))}
              width={224}
            />
            <FilterSelect
              value={str('status')}
              onChange={(v) => set({ status: v })}
              label={t('logs.status')}
              allLabel={t('logs.allStatuses')}
              options={[
                { value: 'ok', label: t('logs.ok') },
                { value: 'error', label: t('logs.error') },
              ]}
            />
            <FilterSelect
              value={str('caller')}
              onChange={(v) => set({ caller: v })}
              label={t('logs.caller')}
              allLabel={t('logs.allCallers')}
              options={callers.map((c) => ({ value: `${c.type}:${c.id}`, label: c.name }))}
            />
            <FilterSelect
              value={period}
              onChange={(v) => set({ period: v === '7d' ? undefined : v })}
              label={t('logs.period')}
              options={CALL_PERIODS.map((p) => ({ value: p, label: t(`logs.periods.${p}`) }))}
            />
            {filtered && (
              <Button
                label={tc('clearFilters')}
                variant="ghost"
                size="sm"
                onClick={() =>
                  set(Object.fromEntries(FILTERS.filter((k) => k !== 'period').map((k) => [k, undefined])))
                }
              />
            )}
          </>
        }
        empty={
          <EmptyState
            icon={filtered ? <SearchXIcon /> : <ScrollTextIcon />}
            title={filtered ? t('logs.emptyFiltered') : t('logs.empty')}
            description={t('logs.emptyHint')}
          />
        }
      />
      <p className="sr-only" aria-live="polite">
        {data ? t('logs.liveCount', { count: data.total }) : ''}
      </p>
      <CallSheet id={open} onClose={() => setOpen(null)} />
    </>
  );
}
