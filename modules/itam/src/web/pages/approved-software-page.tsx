'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { ClockAlertIcon, DownloadIcon, ListChecksIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { type ApprovedSoftware, LICENSE_MODELS } from '../../contracts';
import { ApprovalStatusBadge } from '../badges';
import { ApprovedSoftwareSheet } from '../approved-software-sheet';
import { licenseHref, useDay, useDepartments } from '../lib';

const ALL = '__all__';
/** Quick tabs → status / state filters. */
const VIEWS = {
  allowed: { status: 'allowed' },
  blocked: { status: 'blocked' },
  expiring: { state: 'expiring' },
  all: {},
} as const;
type View = keyof typeof VIEWS;
const VIEW_KEYS = Object.keys(VIEWS) as View[];

/**
 * The approved-software list (allow / block list, "software whitelist"): which titles may be installed, for the
 * whole company or some departments, until when; and which are blocked. Software readers see it; software managers
 * add, change and remove entries. Exports the list as CSV in the whitelist layout.
 */
export default function ApprovedSoftwarePage() {
  const t = useTranslations('itam.approvedSoftware');
  const tm = useTranslations('itam.licenseModel');
  const tc = useTranslations('common');
  const locale = useLocale();
  const day = useDay();
  const canManage = useCan('itam.software.manage');
  const departments = useDepartments(canManage);
  const [state, set] = useListState({ pageSize: 25 });
  const [editing, setEditing] = useState<ApprovedSoftware | 'new' | null>(null);
  const view: View = VIEW_KEYS.includes(state.view as View) ? (state.view as View) : 'allowed';
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const filters = {
    q: state.q,
    licenseModel: str('model'),
    department: str('department'),
    ...VIEWS[view],
  };
  const { data, isLoading, isFetching } = useApiQuery<Page<ApprovedSoftware>>('/itam/approved-software', {
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...filters,
  });
  const filtered = Boolean(state.q || str('model') || str('department'));
  const exportHref = `/api/v1/itam/approved-software/export?${new URLSearchParams(
    Object.entries({ ...filters, sort: state.sort, locale }).filter(
      (e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '',
    ),
  ).toString()}`;

  const columns = useMemo<DataTableColumn<ApprovedSoftware>[]>(
    () => [
      {
        id: 'title',
        header: t('fields.title'),
        meta: { sortKey: 'title', className: 'max-w-72' },
        cell: ({ row }) => (
          <div className="min-w-0">
            {canManage ? (
              <button
                type="button"
                onClick={() => setEditing(row.original)}
                className="block max-w-full truncate text-left font-medium outline-none hover:underline focus-visible:underline"
              >
                {row.original.title}
              </button>
            ) : (
              <span className="block truncate font-medium">{row.original.title}</span>
            )}
            {row.original.publisher && (
              <span className="block truncate text-xs text-muted-foreground">{row.original.publisher}</span>
            )}
          </div>
        ),
      },
      {
        id: 'version',
        header: t('fields.version'),
        meta: { className: 'whitespace-nowrap tabular-nums text-muted-foreground' },
        cell: ({ row }) => row.original.version ?? t('anyVersion'),
      },
      {
        id: 'status',
        header: t('fields.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <ApprovalStatusBadge status={row.original.status} />,
      },
      {
        id: 'model',
        header: t('fields.licenseModel'),
        meta: {
          className: 'hidden text-muted-foreground md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => (
          <div className="grid min-w-0 gap-0.5">
            <span>{tm(row.original.licenseModel)}</span>
            {row.original.license && (
              <Link
                href={licenseHref(row.original.license)}
                className="font-mono text-xs hover:underline focus-visible:underline"
              >
                {row.original.license.reference}
              </Link>
            )}
            {row.original.contract && (
              <span className="font-mono text-xs">{row.original.contract.reference}</span>
            )}
          </div>
        ),
      },
      {
        id: 'scope',
        header: t('fields.scope'),
        meta: {
          className: 'hidden max-w-56 whitespace-normal lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) =>
          row.original.scope === 'company' ? (
            t('scope.company')
          ) : (
            <span className="line-clamp-2">{row.original.departments.map((d) => d.name).join(', ')}</span>
          ),
      },
      {
        id: 'validUntil',
        header: t('fields.validUntil'),
        meta: { sortKey: 'validUntil', className: 'whitespace-nowrap' },
        cell: ({ row }) => {
          const e = row.original;
          if (!e.validUntil) return <span className="text-muted-foreground">{t('permanent')}</span>;
          return e.state === 'active' ? (
            day(e.validUntil)
          ) : (
            <Badge variant={e.state === 'expired' ? 'destructive' : 'warning'}>
              <ClockAlertIcon aria-hidden />
              {t(`state.${e.state}`, { date: day(e.validUntil) })}
            </Badge>
          );
        },
      },
      {
        id: 'request',
        header: t('fields.request'),
        meta: {
          className: 'hidden font-mono text-xs xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) =>
          row.original.requestReference ? (
            /^REQ-\d+$/.test(row.original.requestReference) ? (
              <Link
                href={`/requests/${row.original.requestReference}`}
                className="hover:underline focus-visible:underline"
              >
                {row.original.requestReference}
              </Link>
            ) : (
              row.original.requestReference
            )
          ) : (
            '—'
          ),
      },
    ],
    [t, tm, day, canManage],
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={exportHref} download>
                <DownloadIcon aria-hidden /> {t('exportCsv')}
              </a>
            </Button>
            {canManage && (
              <Button onClick={() => setEditing('new')}>
                <PlusIcon aria-hidden /> {t('add')}
              </Button>
            )}
          </div>
        }
      />
      <Tabs
        value={view}
        onValueChange={(v) => set({ view: v === 'allowed' ? undefined : v })}
        className="gap-4"
      >
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {VIEW_KEYS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {VIEW_KEYS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {v === view && (
              <DataTable
                label={t('title')}
                columns={columns}
                data={data?.items ?? []}
                total={data?.total ?? 0}
                page={state.page}
                pageSize={state.pageSize}
                sort={state.sort}
                onSortChange={(sort) => set({ sort })}
                loading={isLoading}
                fetching={isFetching}
                getRowId={(r) => r.id}
                onPageChange={(page) => set({ page })}
                onPageSizeChange={(pageSize) => set({ pageSize })}
                toolbar={
                  <>
                    <SearchInput
                      value={state.q ?? ''}
                      onChange={(q) => set({ q })}
                      placeholder={t('search')}
                      className="sm:w-64"
                    />
                    <Select
                      value={str('model') ?? ALL}
                      onValueChange={(m) => set({ model: m === ALL ? undefined : m })}
                    >
                      <SelectTrigger className="w-full sm:w-44" aria-label={t('fields.licenseModel')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>{t('allModels')}</SelectItem>
                        {LICENSE_MODELS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {tm(m)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {departments.length > 0 && (
                      <Select
                        value={str('department') ?? ALL}
                        onValueChange={(d) => set({ department: d === ALL ? undefined : d })}
                      >
                        <SelectTrigger className="w-full sm:w-48" aria-label={t('fields.department')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL}>{t('allDepartments')}</SelectItem>
                          {departments.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {filtered && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => set({ q: undefined, model: undefined, department: undefined })}
                      >
                        {tc('clearFilters')}
                      </Button>
                    )}
                  </>
                }
                empty={
                  <EmptyState
                    icon={filtered ? <SearchXIcon /> : <ListChecksIcon />}
                    title={t('emptyTitle')}
                    description={filtered ? t('emptyFiltered') : t('empty')}
                    action={
                      canManage && !filtered ? (
                        <Button onClick={() => setEditing('new')}>
                          <PlusIcon aria-hidden /> {t('add')}
                        </Button>
                      ) : undefined
                    }
                  />
                }
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
      <p className="sr-only" aria-live="polite">
        {data ? t('liveCount', { count: data.total }) : ''}
      </p>
      {editing && (
        <ApprovedSoftwareSheet
          entry={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
