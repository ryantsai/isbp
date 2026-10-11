'use client';

import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, DataTableSummary, useListState } from '@isbp/ui/data-table';
import { DownloadButton } from '@isbp/ui/download-button';
import { EmptyState } from '@isbp/ui/empty-state';
import { FilterBar } from '@isbp/ui/filter-bar';
import { PageHeader } from '@isbp/ui/page-header';
import { usePeople } from '@isbp/ui/person-picker';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Segmented } from '@isbp/ui/segmented';
import { DownloadIcon, FileUpIcon, LinkIcon, PlusIcon, ShieldCheckIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ASSET_VIEWS, type AssetListItem } from '../../contracts';
import { AssetFormSheet } from '../asset-form';
import { AssetStatusBadge, ValueBadge } from '../badges';
import { CreateFromSheet } from '../create-from-sheet';
import { ImportAssetsDialog } from '../import-dialog';
import { apiUrl, assetHref, useGroups, useLocalized, useTaxonomy } from '../lib';
import { PersonField } from '../people';

const ALL = '__all__';
const FILTER_KEYS = ['q', 'class', 'minValue', 'classification', 'site', 'manager', 'managerGroup'] as const;
type View = (typeof ASSET_VIEWS)[number];

function FilterSelect({
  value,
  onChange,
  allLabel,
  label,
  width = 176,
  hasSearch,
  options,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allLabel: string;
  label: string;
  width?: number;
  hasSearch?: boolean;
  options: { value: string; label: string }[];
}) {
  return (
    <Selector
      label={label}
      isLabelHidden
      width={width}
      hasSearch={hasSearch}
      value={value ?? ALL}
      onChange={(v) => onChange(v === ALL ? undefined : v)}
      options={[{ value: ALL, label: allLabel }, ...options]}
    />
  );
}

/** The information asset register: every asset with its C/I/A and value, filters kept in the URL. */
export default function RegisterPage() {
  const t = useTranslations('isms');
  const router = useRouter();
  const locale = useLocale();
  const localized = useLocalized();
  const canManage = useCan('isms.assets.manage');
  const [state, set] = useListState({ pageSize: 25 });
  const [dialog, setDialog] = useState<'create' | 'import' | 'from' | null>(null);
  const view: View = ASSET_VIEWS.includes(state.view as View) ? (state.view as View) : 'active';
  const str = (k: string) => (state[k] as string | undefined) || undefined;
  const { data: taxonomy } = useTaxonomy();
  const { data: groups } = useGroups();

  const query = {
    sort: state.sort,
    q: state.q,
    view,
    class: str('class'),
    minValue: str('minValue'),
    classification: str('classification'),
    site: str('site'),
    manager: str('manager'),
    managerGroup: str('managerGroup'),
  };
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<AssetListItem>>('/isms/assets', {
    ...query,
    page: state.page,
    pageSize: state.pageSize,
  });
  const filtered = FILTER_KEYS.some((k) => str(k));
  const owner = str('manager') && str('manager') !== 'me' ? str('manager')! : null;
  const people = usePeople(owner ? [owner] : []);
  const ownerName = owner ? (people.get(owner)?.displayName ?? '…') : undefined;

  const columns = useMemo<DataTableColumn<AssetListItem>[]>(
    () => [
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', wrap: true },
        cell: ({ row }) => (
          <VStack gap={0}>
            <Link href={assetHref(row.original.number)} onClick={(e) => e.stopPropagation()}>
              {row.original.name}
            </Link>
            <Text type="code" color="secondary">
              {row.original.number}
            </Text>
            <DataTableSummary>
              <ValueBadge value={row.original.value} />
              <span>
                {row.original.subclass
                  ? localized(row.original.subclass.name)
                  : localized(row.original.class.name)}
              </span>
              {(row.original.manager || row.original.managerGroup) && (
                <span>· {row.original.manager?.displayName ?? row.original.managerGroup?.name}</span>
              )}
            </DataTableSummary>
          </VStack>
        ),
      },
      {
        id: 'class',
        header: t('fields.class'),
        meta: { sortKey: 'class', priority: 2, className: 'max-w-48' },
        cell: ({ row }) => (
          <Text maxLines={1}>
            {row.original.subclass
              ? localized(row.original.subclass.name)
              : localized(row.original.class.name)}
          </Text>
        ),
      },
      {
        id: 'value',
        header: t('fields.value'),
        meta: { sortKey: 'value', priority: 2 },
        cell: ({ row }) => (
          <span
            title={t('register.ciaLabel', {
              confidentiality: row.original.confidentiality,
              integrity: row.original.integrity,
              availability: row.original.availability,
            })}
          >
            <ValueBadge value={row.original.value} />
          </span>
        ),
      },
      {
        id: 'manager',
        header: t('fields.manager'),
        meta: { priority: 2, className: 'max-w-44' },
        cell: ({ row }) => (
          <Text
            maxLines={1}
            color={row.original.manager || row.original.managerGroup ? 'primary' : 'secondary'}
          >
            {row.original.manager?.displayName ?? row.original.managerGroup?.name ?? '—'}
          </Text>
        ),
      },
      {
        id: 'classification',
        header: t('fields.classification'),
        meta: { priority: 3, className: 'max-w-44' },
        cell: ({ row }) =>
          row.original.classification ? (
            <Text maxLines={1}>{localized(row.original.classification.name)}</Text>
          ) : (
            <Text color="secondary">—</Text>
          ),
      },
      {
        id: 'status',
        header: t('fields.status'),
        meta: { sortKey: 'status' },
        cell: ({ row }) => <AssetStatusBadge status={row.original.status} inList />,
      },
    ],
    [t, localized],
  );

  const clearAll = () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])));
  const nameOf = <T extends { id: string }>(
    list: T[] | undefined,
    id: string | undefined,
    label: (x: T) => string,
  ) => {
    const hit = id ? list?.find((x) => x.id === id) : undefined;
    return hit ? label(hit) : undefined;
  };
  const table = (
    <DataTable
      label={t('register.title')}
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
      getRowId={(a) => a.id}
      onRowClick={(a) => router.push(assetHref(a.number))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <FilterBar
          search={
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('register.search')}
              className="sm:w-64"
            />
          }
          onClearAll={clearAll}
          filters={[
            {
              id: 'class',
              label: t('fields.class'),
              primary: true,
              value: nameOf(taxonomy?.classes, str('class'), (c) => localized(c.name)),
              onClear: () => set({ class: undefined }),
              control: (
                <FilterSelect
                  value={str('class')}
                  onChange={(v) => set({ class: v })}
                  label={t('fields.class')}
                  allLabel={t('register.allClasses')}
                  options={(taxonomy?.classes ?? []).map((c) => ({
                    value: c.id,
                    label: `${c.code} · ${localized(c.name)}`,
                  }))}
                />
              ),
            },
            {
              id: 'minValue',
              label: t('register.minValue'),
              primary: true,
              value: str('minValue') ? t('register.valueAtLeast', { value: str('minValue')! }) : undefined,
              onClear: () => set({ minValue: undefined }),
              control: (
                <FilterSelect
                  value={str('minValue')}
                  onChange={(v) => set({ minValue: v })}
                  label={t('register.minValue')}
                  allLabel={t('register.anyValue')}
                  width={160}
                  options={[2, 3, 4].map((v) => ({
                    value: String(v),
                    label: t('register.valueAtLeast', { value: v }),
                  }))}
                />
              ),
            },
            {
              id: 'classification',
              label: t('fields.classification'),
              value: nameOf(taxonomy?.labels, str('classification'), (l) => localized(l.name)),
              onClear: () => set({ classification: undefined }),
              control: (
                <FilterSelect
                  value={str('classification')}
                  onChange={(v) => set({ classification: v })}
                  label={t('fields.classification')}
                  allLabel={t('register.allClassifications')}
                  options={(taxonomy?.labels ?? []).map((l) => ({ value: l.id, label: localized(l.name) }))}
                />
              ),
            },
            {
              id: 'site',
              label: t('fields.site'),
              value: nameOf(taxonomy?.sites, str('site'), (x) => `${x.code} · ${x.name}`),
              onClear: () => set({ site: undefined }),
              control: (
                <FilterSelect
                  value={str('site')}
                  onChange={(v) => set({ site: v })}
                  label={t('fields.site')}
                  allLabel={t('register.allSites')}
                  options={(taxonomy?.sites ?? []).map((x) => ({
                    value: x.id,
                    label: `${x.code} · ${x.name}`,
                  }))}
                />
              ),
            },
            {
              id: 'managerGroup',
              label: t('fields.managerGroup'),
              value: nameOf(groups?.items, str('managerGroup'), (g) => g.name),
              onClear: () => set({ managerGroup: undefined }),
              control: (
                <FilterSelect
                  value={str('managerGroup')}
                  onChange={(v) => set({ managerGroup: v })}
                  label={t('fields.managerGroup')}
                  allLabel={t('register.anyGroup')}
                  hasSearch
                  options={(groups?.items ?? []).map((g) => ({ value: g.id, label: g.name }))}
                />
              ),
            },
            {
              id: 'manager',
              label: t('fields.manager'),
              value: ownerName,
              onClear: () => set({ manager: undefined }),
              control: (
                <PersonField
                  value={str('manager') && str('manager') !== 'me' ? str('manager')! : null}
                  onChange={(id) => set({ manager: id ?? undefined })}
                  placeholder={t('register.anyManager')}
                />
              ),
            },
          ]}
        />
      }
      empty={
        filtered ? (
          <EmptyState variant="filtered" onClearFilters={clearAll} />
        ) : (
          <EmptyState
            icon={<ShieldCheckIcon />}
            title={t('register.empty.title')}
            description={t('register.empty.none')}
            action={
              canManage && (
                <Button
                  label={t('register.new')}
                  variant="primary"
                  icon={<Icon icon={PlusIcon} />}
                  onClick={() => setDialog('create')}
                />
              )
            }
          />
        )
      }
    />
  );

  return (
    <>
      <PageHeader
        title={t('register.title')}
        description={t('register.description')}
        actions={
          <HStack gap={2} wrap="wrap">
            <DownloadButton
              label={t('register.export')}
              variant="secondary"
              icon={<Icon icon={DownloadIcon} />}
              href={apiUrl('/isms/assets/export.csv', { ...query, locale })}
              download
            />
            {canManage && (
              <>
                <DropdownMenu
                  button={{ label: t('register.more'), variant: 'secondary' }}
                  alignment="end"
                  items={[
                    { label: t('register.import'), icon: FileUpIcon, onClick: () => setDialog('import') },
                    { label: t('register.createFrom'), icon: LinkIcon, onClick: () => setDialog('from') },
                  ]}
                />
                <Button
                  label={t('register.new')}
                  variant="primary"
                  icon={<Icon icon={PlusIcon} />}
                  onClick={() => setDialog('create')}
                />
              </>
            )}
          </HStack>
        }
      />
      <VStack gap={4}>
        <Segmented
          label={t('fields.status')}
          value={view}
          onChange={(v) => set({ view: v === 'active' ? undefined : v })}
          options={ASSET_VIEWS.map((v) => ({ value: v, label: t(`register.views.${v}`) }))}
        />
        {table}
      </VStack>
      <p className="sr-only" aria-live="polite">
        {data ? t('register.liveCount', { count: data.total }) : ''}
      </p>
      {canManage && (
        <>
          <AssetFormSheet
            open={dialog === 'create'}
            onOpenChange={(o) => setDialog(o ? 'create' : null)}
            onSaved={(a) => router.push(assetHref(a.number))}
          />
          <ImportAssetsDialog
            open={dialog === 'import'}
            onOpenChange={(o) => setDialog(o ? 'import' : null)}
          />
          <CreateFromSheet open={dialog === 'from'} onOpenChange={(o) => setDialog(o ? 'from' : null)} />
        </>
      )}
    </>
  );
}
