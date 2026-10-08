'use client';

import type { Page } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { BotIcon, ScrollTextIcon, SearchXIcon, UserIcon, ZapIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState } from 'react';
import {
  CALL_PERIODS,
  type CallDetail,
  type CallDto,
  type CallerDto,
  type EndpointSummary,
} from '../../contracts';
import { HttpStatus, TONE } from '../badges';
import { endpointHref, useDuration } from '../lib';

const ALL = '__all__';
const FILTERS = ['endpoint', 'status', 'caller', 'period', 'q'] as const;

function FilterSelect({
  value,
  onChange,
  label,
  allLabel,
  children,
  className,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  label: string;
  allLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={cn('w-full sm:w-44', className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        {children}
      </SelectContent>
    </Select>
  );
}

function CallerName({ caller }: { caller: CallerDto }) {
  const Icon = caller.type === 'client' ? BotIcon : UserIcon;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{caller.name}</span>
    </span>
  );
}

/** One call: masked parameters, the full error and the request id. */
function CallSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslations('etl.logs');
  const tc = useTranslations('common');
  const duration = useDuration();
  const { data } = useApiQuery<CallDetail>(id ? `/etl/calls/${id}` : null);
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">{value}</dd>
    </div>
  );
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
            <div className="grid gap-4">
              <dl className="divide-y">
                {row(t('when'), <DateTime date={data.createdAt} />)}
                {row(
                  t('endpoint'),
                  <Link className="text-primary hover:underline" href={endpointHref(data.endpoint.slug)}>
                    {data.endpoint.name}
                  </Link>,
                )}
                {row(t('caller'), <CallerName caller={data.caller} />)}
                {row(t('status'), <HttpStatus status={data.status} code={data.errorCode} />)}
                {row(t('duration'), duration(data.durationMs))}
                {row(t('rows'), data.rows ?? '—')}
                {row(t('cache'), data.cached ? t('hit') : t('miss'))}
                {row(t('requestId'), <code className="font-mono text-xs">{data.requestId ?? '—'}</code>)}
              </dl>
              {data.errorMessage && (
                <p className={cn('rounded-lg px-3 py-2 text-sm wrap-anywhere', TONE.destructive)}>
                  {data.errorMessage}
                </p>
              )}
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">{t('params')}</span>
                <pre
                  tabIndex={0}
                  className="max-h-64 overflow-auto rounded-lg border bg-muted/20 p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {JSON.stringify(data.params, null, 2)}
                </pre>
                <p className="text-xs text-muted-foreground">{t('maskedHint')}</p>
              </div>
            </div>
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
  const { data, isLoading, isFetching } = useApiQuery<Page<CallDto>>('/etl/calls', {
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
        meta: { sortKey: 'createdAt', className: 'whitespace-nowrap' },
        cell: ({ row }) => <RelativeTime date={row.original.createdAt} />,
      },
      {
        id: 'endpoint',
        header: t('logs.endpoint'),
        meta: { className: 'max-w-56' },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.endpoint.name}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {row.original.endpoint.slug}
              {row.original.version !== null && ` · v${row.original.version}`}
            </span>
          </span>
        ),
      },
      {
        id: 'caller',
        header: t('logs.caller'),
        meta: { className: 'hidden max-w-48 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <CallerName caller={row.original.caller} />,
      },
      {
        id: 'status',
        header: t('logs.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <HttpStatus status={row.original.status} code={row.original.errorCode} />,
      },
      {
        id: 'durationMs',
        header: t('logs.duration'),
        meta: {
          sortKey: 'durationMs',
          className: 'hidden tabular-nums sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => (
          <span className="flex items-center gap-1">
            {duration(row.original.durationMs)}
            {row.original.cached && (
              <span className={cn('inline-flex items-center gap-0.5 rounded px-1 text-[11px]', TONE.info)}>
                <ZapIcon className="size-3" aria-hidden />
                {t('logs.cached')}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'rows',
        header: t('logs.rows'),
        meta: { className: 'hidden tabular-nums lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => (row.original.rows === null ? '—' : format.number(row.original.rows)),
      },
    ],
    [t, format, duration],
  );

  return (
    <>
      <PageHeader title={t('logs.title')} description={t('logs.description')} />
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
              className="sm:w-56"
            >
              {endpoints.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect
              value={str('status')}
              onChange={(v) => set({ status: v })}
              label={t('logs.status')}
              allLabel={t('logs.allStatuses')}
            >
              <SelectItem value="ok">{t('logs.ok')}</SelectItem>
              <SelectItem value="error">{t('logs.error')}</SelectItem>
            </FilterSelect>
            <FilterSelect
              value={str('caller')}
              onChange={(v) => set({ caller: v })}
              label={t('logs.caller')}
              allLabel={t('logs.allCallers')}
            >
              {callers.map((c) => (
                <SelectItem key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>
                  {c.name}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect
              value={period}
              onChange={(v) => set({ period: v === '7d' ? undefined : v })}
              label={t('logs.period')}
            >
              {CALL_PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`logs.periods.${p}`)}
                </SelectItem>
              ))}
            </FilterSelect>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  set(Object.fromEntries(FILTERS.filter((k) => k !== 'period').map((k) => [k, undefined])))
                }
              >
                {tc('clearFilters')}
              </Button>
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
