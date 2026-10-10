'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  BotIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  GitPullRequestArrowIcon,
  PackageIcon,
  SearchXIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo } from 'react';
import { CHANGE_SET_STATUSES, type ChangeSetStatus, changeSetHref } from '../../contracts';
import { StatusBadge, ToneText } from '../badges';
import {
  type AssistantStatusDto,
  CHANGE_SETS_PATH,
  type ChangeSetSummaryDto,
  isOpenStatus,
  PACKS_HREF,
  STATUS_PATH,
  useKindLabel,
} from '../lib';

const ALL = '__all__';
const SCOPES = ['mine', 'all'] as const;
type Scope = (typeof SCOPES)[number];

/** Whether an open change set can be applied as it is; applied, rolled back and discarded sets show nothing. */
function Readiness({ cs }: { cs: ChangeSetSummaryDto }) {
  const t = useTranslations('assistant.list.readiness');
  if (!isOpenStatus(cs.status)) return null;
  if (cs.itemCount === 0)
    return <ToneText meta={{ icon: CircleDashedIcon, tone: 'muted' }} label={t('empty')} />;
  return cs.ready ? (
    <ToneText meta={{ icon: CircleCheckIcon, tone: 'success' }} label={t('ready')} />
  ) : (
    <ToneText meta={{ icon: CircleDashedIcon, tone: 'warning' }} label={t('notReady')} />
  );
}

/** Change sets: mine, or everyone's with `assistant.change-sets.read`; status filter and search in the URL. */
export default function ChangeSetsPage() {
  const t = useTranslations('assistant.list');
  const ts = useTranslations('assistant.status');
  const tc = useTranslations('common');
  const router = useRouter();
  const id = useId();
  const canReadAll = useCan('assistant.change-sets.read');
  const [state, set] = useListState({ pageSize: 25 });
  // `?packages=1` (older links, the navigation's "Process packs") opens the process packs page.
  const wantsPacks = state.packages === '1';
  useEffect(() => {
    if (wantsPacks) router.replace(PACKS_HREF);
  }, [wantsPacks, router]);
  const scope: Scope = canReadAll && state.scope === 'all' ? 'all' : 'mine';
  const status = CHANGE_SET_STATUSES.includes(state.status as ChangeSetStatus)
    ? (state.status as ChangeSetStatus)
    : undefined;
  const q = (state.q as string | undefined) || undefined;
  const filtered = Boolean(status || q);
  const kinds = useApiQuery<AssistantStatusDto>(STATUS_PATH);
  const kindLabel = useKindLabel(kinds.data?.kinds);
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<ChangeSetSummaryDto>>(
    CHANGE_SETS_PATH,
    {
      scope,
      status,
      q,
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
    },
  );

  const columns = useMemo<DataTableColumn<ChangeSetSummaryDto>[]>(
    () => [
      {
        id: 'changeSet',
        header: t('columns.changeSet'),
        meta: { sortKey: 'number', className: 'max-w-80' },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col gap-0.5">
            <Link
              href={changeSetHref(row.original.id)}
              onClick={(e) => e.stopPropagation()}
              className="truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              <span className="mr-1.5 font-mono text-xs text-muted-foreground">{row.original.reference}</span>
              {row.original.title || t('untitled')}
            </Link>
          </span>
        ),
      },
      {
        id: 'status',
        header: tc('status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'kinds',
        header: t('columns.kinds'),
        meta: { className: 'hidden max-w-56 lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) =>
          row.original.kinds.length ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {row.original.kinds.map((k) => kindLabel(k)).join(', ')}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'items',
        header: t('columns.items'),
        meta: { className: 'hidden tabular-nums md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => row.original.itemCount,
      },
      // Readiness only means something for drafts and sets in review.
      ...(status && !isOpenStatus(status)
        ? []
        : [
            {
              id: 'readiness',
              header: t('columns.readiness'),
              meta: { className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
              cell: ({ row }: { row: { original: ChangeSetSummaryDto } }) => <Readiness cs={row.original} />,
            },
          ]),
      {
        id: 'author',
        header: t('columns.author'),
        meta: { className: 'hidden max-w-44 xl:table-cell', headerClassName: 'hidden xl:table-cell' },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-1.5 text-sm">
            {row.original.createdBy.type === 'service' && (
              <>
                <BotIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="sr-only">{t('apiClient')}:</span>
              </>
            )}
            <span className="truncate">{row.original.createdBy.name}</span>
          </span>
        ),
      },
      {
        id: 'updatedAt',
        header: tc('updated_at'),
        meta: {
          sortKey: 'updatedAt',
          className: 'hidden md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.updatedAt} className="text-sm" />,
      },
    ],
    [t, tc, kindLabel, status],
  );

  const table = (
    <DataTable
      label={t('title')}
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
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(changeSetHref(r.id))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput value={q ?? ''} onChange={(v) => set({ q: v })} placeholder={t('search')} />
          <label htmlFor={`${id}-status`} className="sr-only">
            {tc('status')}
          </label>
          <Select value={status ?? ALL} onValueChange={(v) => set({ status: v === ALL ? undefined : v })}>
            <SelectTrigger id={`${id}-status`} className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
              {CHANGE_SET_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ts(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => set({ status: undefined, q: undefined })}>
              {tc('clearFilters')}
            </Button>
          )}
        </>
      }
      empty={
        <EmptyState
          icon={filtered ? <SearchXIcon /> : <GitPullRequestArrowIcon />}
          title={filtered ? t('emptyFiltered') : t('empty')}
          description={filtered ? t('emptyFilteredHint') : t('emptyHint')}
        />
      }
    />
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button variant="outline" asChild>
            <Link href={PACKS_HREF}>
              <PackageIcon /> {t('installPack')}
            </Link>
          </Button>
        }
      />
      <div className="grid min-w-0 grid-cols-1 gap-4">
        {canReadAll ? (
          <Tabs value={scope} onValueChange={(v) => set({ scope: v === 'mine' ? undefined : v })}>
            <TabsList aria-label={t('tabs.label')}>
              {SCOPES.map((s) => (
                <TabsTrigger key={s} value={s}>
                  {t(`tabs.${s}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            {/* Each tab only filters the same list; every tab still has its panel. */}
            {SCOPES.map((s) => (
              <TabsContent key={s} value={s} className="min-w-0">
                {s === scope && table}
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          table
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {data ? t('liveCount', { count: data.total }) : ''}
      </p>
    </>
  );
}
