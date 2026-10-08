'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ChevronDownIcon,
  DownloadIcon,
  FileUpIcon,
  LinkIcon,
  PlusIcon,
  SearchXIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useMemo, useState } from 'react';
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
  className,
  children,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allLabel: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={className ?? 'w-full sm:w-44'} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
}

/** The information asset register: every asset with its C/I/A and value, filters kept in the URL. */
export default function RegisterPage() {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
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
  const { data, isLoading, isFetching } = useApiQuery<Page<AssetListItem>>('/isms/assets', {
    ...query,
    page: state.page,
    pageSize: state.pageSize,
  });
  const filtered = FILTER_KEYS.some((k) => str(k));

  const columns = useMemo<DataTableColumn<AssetListItem>[]>(
    () => [
      {
        id: 'number',
        header: t('fields.number'),
        size: 120,
        meta: { sortKey: 'number', className: 'font-mono text-xs text-muted-foreground' },
        cell: ({ row }) => row.original.number,
      },
      {
        id: 'name',
        header: t('fields.name'),
        meta: { sortKey: 'name', className: 'max-w-64' },
        cell: ({ row }) => (
          <Link
            href={assetHref(row.original.number)}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-medium outline-none hover:underline focus-visible:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'class',
        header: t('fields.class'),
        meta: {
          sortKey: 'class',
          className: 'hidden max-w-48 sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => (
          <span className="block truncate">
            <span className="font-mono text-xs text-muted-foreground">{row.original.class.code}</span>{' '}
            {row.original.subclass
              ? localized(row.original.subclass.name)
              : localized(row.original.class.name)}
          </span>
        ),
      },
      {
        id: 'cia',
        header: t('fields.cia'),
        meta: {
          className: 'hidden font-mono text-xs lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => (
          <span
            aria-label={t('register.ciaLabel', {
              confidentiality: row.original.confidentiality,
              integrity: row.original.integrity,
              availability: row.original.availability,
            })}
          >
            {row.original.confidentiality}/{row.original.integrity}/{row.original.availability}
          </span>
        ),
      },
      {
        id: 'value',
        header: t('fields.value'),
        meta: { sortKey: 'value' },
        cell: ({ row }) => <ValueBadge value={row.original.value} />,
      },
      {
        id: 'classification',
        header: t('fields.classification'),
        meta: { className: 'hidden max-w-44 xl:table-cell', headerClassName: 'hidden xl:table-cell' },
        cell: ({ row }) =>
          row.original.classification ? (
            <span className="block truncate">{localized(row.original.classification.name)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'manager',
        header: t('fields.manager'),
        meta: { className: 'hidden max-w-44 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <span className="block truncate">
            {row.original.manager?.displayName ?? row.original.managerGroup?.name ?? (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        ),
      },
      {
        id: 'site',
        header: t('fields.site'),
        meta: {
          sortKey: 'site',
          className: 'hidden font-mono text-xs lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => row.original.site.code,
      },
      {
        id: 'status',
        header: t('fields.status'),
        meta: {
          sortKey: 'status',
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <AssetStatusBadge status={row.original.status} />,
      },
    ],
    [t, localized],
  );

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
      getRowId={(a) => a.id}
      onRowClick={(a) => router.push(assetHref(a.number))}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('register.search')}
            className="sm:w-64"
          />
          <FilterSelect
            value={str('class')}
            onChange={(v) => set({ class: v })}
            label={t('fields.class')}
            allLabel={t('register.allClasses')}
          >
            {(taxonomy?.classes ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.code} · {localized(c.name)}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect
            value={str('minValue')}
            onChange={(v) => set({ minValue: v })}
            label={t('register.minValue')}
            allLabel={t('register.anyValue')}
            className="w-full sm:w-36"
          >
            {[2, 3, 4].map((v) => (
              <SelectItem key={v} value={String(v)}>
                {t('register.valueAtLeast', { value: v })}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect
            value={str('classification')}
            onChange={(v) => set({ classification: v })}
            label={t('fields.classification')}
            allLabel={t('register.allClassifications')}
            className="w-full sm:w-52"
          >
            {(taxonomy?.labels ?? []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {localized(l.name)}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect
            value={str('site')}
            onChange={(v) => set({ site: v })}
            label={t('fields.site')}
            allLabel={t('register.allSites')}
            className="w-full sm:w-36"
          >
            {(taxonomy?.sites ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.code} · {s.name}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect
            value={str('managerGroup')}
            onChange={(v) => set({ managerGroup: v })}
            label={t('fields.managerGroup')}
            allLabel={t('register.anyGroup')}
          >
            {(groups?.items ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </FilterSelect>
          <div className="w-full sm:w-52">
            <PersonField
              value={str('manager') && str('manager') !== 'me' ? str('manager')! : null}
              onChange={(id) => set({ manager: id ?? undefined })}
              placeholder={t('register.anyManager')}
            />
          </div>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))}
            >
              {tc('clearFilters')}
            </Button>
          )}
        </>
      }
      empty={
        <EmptyState
          icon={filtered ? <SearchXIcon /> : <ShieldCheckIcon />}
          title={t('register.empty.title')}
          description={filtered ? t('register.empty.filtered') : t('register.empty.none')}
          action={
            !filtered &&
            canManage && (
              <Button onClick={() => setDialog('create')}>
                <PlusIcon /> {t('register.new')}
              </Button>
            )
          }
        />
      }
    />
  );

  return (
    <>
      <PageHeader
        title={t('register.title')}
        description={t('register.description')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={apiUrl('/isms/assets/export.csv', { ...query, locale })} download>
                <DownloadIcon /> {t('register.export')}
              </a>
            </Button>
            {canManage && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      {t('register.more')} <ChevronDownIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setDialog('import')}>
                      <FileUpIcon /> {t('register.import')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog('from')}>
                      <LinkIcon /> {t('register.createFrom')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button onClick={() => setDialog('create')}>
                  <PlusIcon /> {t('register.new')}
                </Button>
              </>
            )}
          </div>
        }
      />
      <Tabs
        value={view}
        onValueChange={(v) => set({ view: v === 'active' ? undefined : v })}
        className="gap-4"
      >
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {ASSET_VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`register.views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {ASSET_VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {view === v && table}
          </TabsContent>
        ))}
      </Tabs>
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
