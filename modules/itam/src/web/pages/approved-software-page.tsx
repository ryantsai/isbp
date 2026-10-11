'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { DownloadButton } from '@isbp/ui/download-button';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { ClockAlertIcon, DownloadIcon, ListChecksIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { type ApprovedSoftware, LICENSE_MODELS } from '../../contracts';
import { ApprovalStatusBadge } from '../badges';
import { ApprovedSoftwareSheet } from '../approved-software-sheet';
import { licenseHref, useDay, useDepartments } from '../lib';
import { SoftwareSections } from '../sections';
import { QuickViews } from './quick-views';

const ALL = '__all__';
/** Quick views → status / state filters. */
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
  const tn = useTranslations('itam.nav');
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
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<ApprovedSoftware>>(
    '/itam/approved-software',
    {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      ...filters,
    },
  );
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
          <VStack>
            {canManage ? (
              <Link color="primary" weight="medium" maxLines={1} onClick={() => setEditing(row.original)}>
                {row.original.title}
              </Link>
            ) : (
              <Text weight="medium" maxLines={1}>
                {row.original.title}
              </Text>
            )}
            {row.original.publisher && (
              <Text type="supporting" maxLines={1}>
                {row.original.publisher}
              </Text>
            )}
          </VStack>
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
          <VStack gap={0.5}>
            <Text>{tm(row.original.licenseModel)}</Text>
            {row.original.license && (
              <Link href={licenseHref(row.original.license)} type="code" size="xsm">
                {row.original.license.reference}
              </Link>
            )}
            {row.original.contract && (
              <Text type="code" size="xsm">
                {row.original.contract.reference}
              </Text>
            )}
          </VStack>
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
            <Text maxLines={2}>{row.original.departments.map((d) => d.name).join(', ')}</Text>
          ),
      },
      {
        id: 'validUntil',
        header: t('fields.validUntil'),
        meta: { sortKey: 'validUntil', className: 'whitespace-nowrap' },
        cell: ({ row }) => {
          const e = row.original;
          if (!e.validUntil) return <Text color="secondary">{t('permanent')}</Text>;
          return e.state === 'active' ? (
            day(e.validUntil)
          ) : (
            <Badge
              variant={e.state === 'expired' ? 'error' : 'warning'}
              icon={<Icon icon={ClockAlertIcon} size="xsm" />}
              label={t(`state.${e.state}`, { date: day(e.validUntil) })}
            />
          );
        },
      },
      {
        id: 'request',
        header: t('fields.request'),
        meta: {
          className: 'hidden xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) =>
          row.original.requestReference ? (
            /^REQ-\d+$/.test(row.original.requestReference) ? (
              <Link href={`/requests/${row.original.requestReference}`} type="code" size="xsm">
                {row.original.requestReference}
              </Link>
            ) : (
              <Text type="code" size="xsm">
                {row.original.requestReference}
              </Text>
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
        title={tn('software')}
        description={t('description')}
        actions={
          <HStack gap={2} wrap="wrap">
            <DownloadButton
              label={t('exportCsv')}
              variant="secondary"
              icon={<Icon icon={DownloadIcon} />}
              href={exportHref}
              download
            />
            {canManage && (
              <Button
                label={t('add')}
                variant="primary"
                icon={<Icon icon={PlusIcon} />}
                onClick={() => setEditing('new')}
              />
            )}
          </HStack>
        }
      />
      <SoftwareSections />
      <VStack gap={4}>
        <QuickViews
          label={tc('filters')}
          value={view}
          onChange={(v) => set({ view: v === 'allowed' ? undefined : v })}
          options={VIEW_KEYS.map((v) => ({ value: v, label: t(`views.${v}`) }))}
        />
        <DataTable
          key={view}
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
          error={error}
          onRetry={() => refetch()}
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
              <Selector
                label={t('fields.licenseModel')}
                isLabelHidden
                width={176}
                value={str('model') ?? ALL}
                onChange={(m) => set({ model: m === ALL ? undefined : m })}
                options={[
                  { value: ALL, label: t('allModels') },
                  ...LICENSE_MODELS.map((m) => ({ value: m, label: tm(m) })),
                ]}
              />
              {departments.length > 0 && (
                <Selector
                  label={t('fields.department')}
                  isLabelHidden
                  width={192}
                  hasSearch
                  value={str('department') ?? ALL}
                  onChange={(d) => set({ department: d === ALL ? undefined : d })}
                  options={[
                    { value: ALL, label: t('allDepartments') },
                    ...departments.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              )}
              {filtered && (
                <Button
                  label={tc('clearFilters')}
                  variant="ghost"
                  size="sm"
                  onClick={() => set({ q: undefined, model: undefined, department: undefined })}
                />
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
                  <Button
                    label={t('add')}
                    variant="primary"
                    icon={<Icon icon={PlusIcon} />}
                    onClick={() => setEditing('new')}
                  />
                ) : undefined
              }
            />
          }
        />
      </VStack>
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
