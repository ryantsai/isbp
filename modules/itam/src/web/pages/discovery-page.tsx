'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, type ListState, useListState } from '@isbp/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { Label } from '@isbp/ui/label';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  BanIcon,
  CheckCircle2Icon,
  EllipsisIcon,
  FileSpreadsheetIcon,
  LinkIcon,
  ListChecksIcon,
  OctagonXIcon,
  RadarIcon,
  SearchXIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useMemo, useState } from 'react';
import type {
  ComplianceItem,
  ComplianceSummary,
  DiscoveredTitle,
  DiscoveryReport,
  TitleRule,
} from '../../contracts';
import { type ApprovedSoftwarePrefill, ApprovedSoftwareSheet } from '../approved-software-sheet';
import { ApprovalBadge } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { DiscoveryImportDialog } from '../discovery-import-dialog';
import { assetHref, INVALIDATE, licenseHref, useDepartments } from '../lib';
import { LicensePicker, type PickedLicense } from '../pickers';

const TABS = ['titles', 'compliance', 'reports', 'rules'] as const;
type Tab = (typeof TABS)[number];
const ALL = '__all__';

type SetState = (patch: Partial<ListState>) => void;
const str = (state: ListState, k: string) => (state[k] as string | undefined) || undefined;

/**
 * Software discovery (asset managers): discovered titles that match no licence (map them or ignore them), recent
 * reports from inventory tools and CSV imports, and the rules made so far. Same permission as the discovery API.
 */
export default function DiscoveryPage() {
  const t = useTranslations('itam.discovery');
  const [state, set] = useListState({ pageSize: 25 });
  const [importing, setImporting] = useState(false);
  const tab: Tab = TABS.includes(state.tab as Tab) ? (state.tab as Tab) : 'titles';
  const canDecide = useCan('itam.software.manage');

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={() => setImporting(true)}>
            <UploadIcon /> {t('import')}
          </Button>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          set({
            tab: v === 'titles' ? undefined : v,
            q: undefined,
            source: undefined,
            kind: undefined,
            approval: undefined,
            department: undefined,
          })
        }
        className="gap-4"
      >
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {TABS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`tabs.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {tab === v && v === 'titles' && <TitlesTab state={state} set={set} canDecide={canDecide} />}
            {tab === v && v === 'compliance' && (
              <ComplianceTab state={state} set={set} canDecide={canDecide} />
            )}
            {tab === v && v === 'reports' && <ReportsTab state={state} set={set} />}
            {tab === v && v === 'rules' && <RulesTab state={state} set={set} canDecide={canDecide} />}
          </TabsContent>
        ))}
      </Tabs>
      {importing && <DiscoveryImportDialog onOpenChange={setImporting} />}
    </>
  );
}

function LiveCount({ total }: { total: number | undefined }) {
  const t = useTranslations('itam.discovery');
  return (
    <p className="sr-only" aria-live="polite">
      {total === undefined ? '' : t('liveCount', { count: total })}
    </p>
  );
}

/* ───────────────────────────── to review ───────────────────────────── */

function TitlesTab({ state, set, canDecide }: { state: ListState; set: SetState; canDecide: boolean }) {
  const t = useTranslations('itam.discovery');
  const tc = useTranslations('common');
  const [mapping, setMapping] = useState<string | null>(null);
  const [ignoring, setIgnoring] = useState<string | null>(null);
  const [listing, setListing] = useState<ApprovedSoftwarePrefill | null>(null);
  const { data, isLoading, isFetching } = useApiQuery<Page<DiscoveredTitle>>('/itam/discovery/titles', {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
  });
  const ignore = useApiMutation(
    (api, title: string) => api.post('/itam/discovery/rules', { title, licenseId: null }),
    {
      invalidate: INVALIDATE,
      success: () => t('ignore.done', { title: ignoring ?? '' }),
      onSuccess: () => setIgnoring(null),
    },
  );

  const columns = useMemo<DataTableColumn<DiscoveredTitle>[]>(
    () => [
      {
        id: 'title',
        header: t('titles.title'),
        meta: { className: 'max-w-72' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="block truncate font-medium">{row.original.title}</span>
            {row.original.publisher && (
              <span className="block truncate text-xs text-muted-foreground">{row.original.publisher}</span>
            )}
          </div>
        ),
      },
      {
        id: 'devices',
        header: t('titles.devices'),
        size: 100,
        meta: { className: 'tabular-nums' },
        cell: ({ row }) => row.original.devices,
      },
      {
        id: 'lastSeen',
        header: t('titles.lastSeen'),
        meta: {
          className: 'hidden whitespace-nowrap text-muted-foreground sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.lastSeenAt} />,
      },
      ...(canDecide
        ? [
            {
              id: 'actions',
              header: () => <span className="sr-only">{tc('actions')}</span>,
              size: 56,
              meta: { className: 'text-right' },
              cell: ({ row }) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('titles.actionsFor', { title: row.original.title })}
                    >
                      <EllipsisIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setMapping(row.original.title)}>
                      <LinkIcon /> {t('titles.map')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setIgnoring(row.original.title)}>
                      <BanIcon /> {t('titles.ignore')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setListing({ title: row.original.title, publisher: row.original.publisher })
                      }
                    >
                      <ShieldCheckIcon /> {t('titles.allow')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setListing({
                          title: row.original.title,
                          publisher: row.original.publisher,
                          status: 'blocked',
                        })
                      }
                    >
                      <OctagonXIcon /> {t('titles.block')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            } satisfies DataTableColumn<DiscoveredTitle>,
          ]
        : []),
    ],
    [t, tc, canDecide],
  );

  return (
    <div className="grid min-w-0 gap-3">
      <p className="text-sm text-muted-foreground">{t('titles.hint')}</p>
      <DataTable
        label={t('tabs.titles')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        loading={isLoading}
        fetching={isFetching}
        getRowId={(r) => r.title}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        toolbar={
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('titles.search')}
            className="sm:w-64"
          />
        }
        empty={
          <EmptyState
            icon={state.q ? <SearchXIcon /> : <CheckCircle2Icon />}
            title={t('titles.emptyTitle')}
            description={state.q ? t('titles.emptyFiltered') : t('titles.empty')}
          />
        }
      />
      <LiveCount total={data?.total} />
      {mapping !== null && <MapDialog title={mapping} onOpenChange={(o) => !o && setMapping(null)} />}
      {listing && <ApprovedSoftwareSheet prefill={listing} onClose={() => setListing(null)} />}
      <ConfirmDialog
        open={ignoring !== null}
        onOpenChange={(o) => !o && setIgnoring(null)}
        title={t('ignore.title', { title: ignoring ?? '' })}
        description={t('ignore.description')}
        confirmLabel={t('ignore.submit')}
        loading={ignore.isPending}
        onConfirm={() => ignoring && ignore.mutate(ignoring)}
      />
    </div>
  );
}

/* ───────────────────────────── approved-software compliance ───────────────────────────── */

function ComplianceTab({ state, set, canDecide }: { state: ListState; set: SetState; canDecide: boolean }) {
  const t = useTranslations('itam.discovery.compliance');
  const tc = useTranslations('common');
  const approval = str(state, 'approval');
  const department = str(state, 'department');
  const departments = useDepartments();
  const [listing, setListing] = useState<ApprovedSoftwarePrefill | null>(null);
  const { data: summary } = useApiQuery<ComplianceSummary>('/itam/discovery/compliance/summary');
  const { data, isLoading, isFetching } = useApiQuery<Page<ComplianceItem>>('/itam/discovery/compliance', {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    approval,
    department,
  });
  const filtered = Boolean(state.q || approval || department);

  const columns = useMemo<DataTableColumn<ComplianceItem>[]>(
    () => [
      {
        id: 'title',
        header: t('title'),
        meta: { className: 'max-w-64' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="block truncate font-medium">
              {row.original.reportedAs ?? row.original.product}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {[row.original.version, row.original.publisher].filter(Boolean).join(' · ') || '—'}
            </span>
          </div>
        ),
      },
      {
        id: 'approval',
        header: t('state'),
        cell: ({ row }) => <ApprovalBadge approval={row.original.approval} />,
      },
      {
        id: 'device',
        header: t('device'),
        meta: { className: 'max-w-56' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={assetHref(row.original.asset)}
              className="block truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {row.original.asset.name}
            </Link>
            <span className="block truncate text-xs text-muted-foreground">
              <span className="font-mono">{row.original.asset.tag}</span>
              {row.original.asset.assignee ? ` · ${row.original.asset.assignee.displayName}` : ''}
            </span>
          </div>
        ),
      },
      {
        id: 'department',
        header: t('department'),
        meta: {
          className: 'hidden text-muted-foreground md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => row.original.asset.department?.name ?? '—',
      },
      {
        id: 'lastSeen',
        header: t('lastSeen'),
        meta: {
          className: 'hidden whitespace-nowrap text-muted-foreground sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.lastSeenAt} />,
      },
      ...(canDecide
        ? [
            {
              id: 'actions',
              header: () => <span className="sr-only">{tc('actions')}</span>,
              size: 56,
              meta: { className: 'text-right' },
              cell: ({ row }) =>
                row.original.approval === 'unapproved' ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('allowFor', { title: row.original.reportedAs ?? row.original.product })}
                    onClick={() =>
                      setListing({
                        title: row.original.reportedAs ?? row.original.product,
                        publisher: row.original.publisher,
                      })
                    }
                  >
                    <ShieldCheckIcon />
                  </Button>
                ) : null,
            } satisfies DataTableColumn<ComplianceItem>,
          ]
        : []),
    ],
    [t, tc, canDecide],
  );

  return (
    <div className="grid min-w-0 gap-3">
      <p className="text-sm text-muted-foreground">
        {summary && !summary.allowListInUse ? t('notInUse') : t('hint')}{' '}
        <Link href="/itam/approved-software" className="font-medium text-primary hover:underline">
          {t('openList')}
        </Link>
      </p>
      {summary && (
        <p className="text-sm" role="status">
          {t('summary', {
            unapproved: summary.unapproved,
            blocked: summary.blocked,
            devices: summary.devices,
          })}
        </p>
      )}
      <DataTable
        label={t('label')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
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
              value={approval ?? ALL}
              onValueChange={(v) => set({ approval: v === ALL ? undefined : v })}
            >
              <SelectTrigger className="w-full sm:w-52" aria-label={t('state')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('allStates')}</SelectItem>
                <SelectItem value="unapproved">{t('unapproved')}</SelectItem>
                <SelectItem value="blocked">{t('blocked')}</SelectItem>
              </SelectContent>
            </Select>
            {departments.length > 0 && (
              <Select
                value={department ?? ALL}
                onValueChange={(v) => set({ department: v === ALL ? undefined : v })}
              >
                <SelectTrigger className="w-full sm:w-48" aria-label={t('department')}>
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
                onClick={() => set({ q: undefined, approval: undefined, department: undefined })}
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
          />
        }
      />
      <LiveCount total={data?.total} />
      {listing && <ApprovedSoftwareSheet prefill={listing} onClose={() => setListing(null)} />}
    </div>
  );
}

function MapDialog({ title, onOpenChange }: { title: string; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('itam.discovery.map');
  const tc = useTranslations('common');
  const id = useId();
  const [license, setLicense] = useState<PickedLicense | null>(null);
  const map = useApiMutation(
    (api, body: { title: string; licenseId: string }) => api.post<TitleRule>('/itam/discovery/rules', body),
    {
      invalidate: INVALIDATE,
      success: (r) => t('done', { title: r.title, product: r.license?.product ?? '' }),
      onSuccess: () => onOpenChange(false),
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (license) map.mutate({ title, licenseId: license.id });
  };
  return (
    <Dialog open onOpenChange={(o) => !map.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle className="break-words">{t('title', { title })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor={id}>{t('license')}</Label>
            <LicensePicker id={id} value={license} onChange={setLicense} />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={map.isPending}
            >
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={map.isPending} disabled={!license}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── recent reports ───────────────────────────── */

function ReportsTab({ state, set }: { state: ListState; set: SetState }) {
  const t = useTranslations('itam.discovery.reports');
  const tc = useTranslations('common');
  const source = str(state, 'source');
  const { data, isLoading, isFetching } = useApiQuery<Page<DiscoveryReport>>('/itam/discovery/reports', {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    source,
  });
  const filtered = Boolean(state.q || source);

  const columns = useMemo<DataTableColumn<DiscoveryReport>[]>(
    () => [
      {
        id: 'device',
        header: t('device'),
        meta: { className: 'max-w-64' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={assetHref(row.original.asset)}
              className="block truncate font-medium outline-none hover:underline focus-visible:underline"
            >
              {row.original.asset.name}
            </Link>
            <span className="block font-mono text-xs text-muted-foreground">{row.original.asset.tag}</span>
          </div>
        ),
      },
      {
        id: 'source',
        header: t('source'),
        cell: ({ row }) => (
          <div className="grid min-w-0 gap-1">
            <Badge variant={row.original.source === 'import' ? 'info' : 'secondary'}>
              {row.original.source === 'import' ? (
                <FileSpreadsheetIcon aria-hidden />
              ) : (
                <RadarIcon aria-hidden />
              )}
              {t(`sources.${row.original.source}`)}
            </Badge>
            {row.original.fileName && (
              <span className="block max-w-48 truncate text-xs text-muted-foreground">
                {row.original.fileName}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'changes',
        header: t('changes'),
        meta: { className: 'min-w-48 whitespace-normal text-sm' },
        cell: ({ row }) =>
          t('changesValue', {
            reported: row.original.reported,
            added: row.original.added,
            updated: row.original.updated,
            removed: row.original.removed,
          }),
      },
      {
        id: 'by',
        header: t('by'),
        meta: {
          className: 'hidden text-muted-foreground md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => row.original.by?.displayName ?? '—',
      },
      {
        id: 'when',
        header: t('when'),
        meta: { className: 'whitespace-nowrap text-muted-foreground' },
        cell: ({ row }) => <RelativeTime date={row.original.createdAt} />,
      },
    ],
    [t],
  );

  return (
    <>
      <DataTable
        label={t('changes')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
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
            <Select value={source ?? ALL} onValueChange={(v) => set({ source: v === ALL ? undefined : v })}>
              <SelectTrigger className="w-full sm:w-44" aria-label={t('source')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('allSources')}</SelectItem>
                <SelectItem value="api">{t('sources.api')}</SelectItem>
                <SelectItem value="import">{t('sources.import')}</SelectItem>
              </SelectContent>
            </Select>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => set({ q: undefined, source: undefined })}>
                {tc('clearFilters')}
              </Button>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={filtered ? <SearchXIcon /> : <RadarIcon />}
            title={t('emptyTitle')}
            description={filtered ? t('emptyFiltered') : t('empty')}
          />
        }
      />
      <LiveCount total={data?.total} />
    </>
  );
}

/* ───────────────────────────── rules ───────────────────────────── */

function RulesTab({ state, set, canDecide }: { state: ListState; set: SetState; canDecide: boolean }) {
  const t = useTranslations('itam.discovery.rules');
  const tc = useTranslations('common');
  const kind = str(state, 'kind');
  const [removing, setRemoving] = useState<TitleRule | null>(null);
  const { data, isLoading, isFetching } = useApiQuery<Page<TitleRule>>('/itam/discovery/rules', {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    kind,
  });
  const remove = useApiMutation((api, rule: TitleRule) => api.delete(`/itam/discovery/rules/${rule.id}`), {
    invalidate: INVALIDATE,
    success: () => t('removed', { title: removing?.title ?? '' }),
    onSuccess: () => setRemoving(null),
  });
  const filtered = Boolean(state.q || kind);

  const columns = useMemo<DataTableColumn<TitleRule>[]>(
    () => [
      {
        id: 'title',
        header: t('title'),
        meta: { className: 'max-w-64' },
        cell: ({ row }) => <span className="block truncate font-medium">{row.original.title}</span>,
      },
      {
        id: 'outcome',
        header: t('outcome'),
        meta: { className: 'max-w-64' },
        cell: ({ row }) =>
          row.original.license ? (
            <Link
              href={licenseHref(row.original.license)}
              className="flex min-w-0 items-center gap-1.5 outline-none hover:underline focus-visible:underline"
            >
              <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="font-mono text-xs text-muted-foreground">
                {row.original.license.reference}
              </span>
              <span className="truncate">{row.original.license.product}</span>
            </Link>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <BanIcon className="size-3.5 shrink-0" aria-hidden />
              {t('ignored')}
            </span>
          ),
      },
      {
        id: 'by',
        header: t('by'),
        meta: {
          className: 'hidden text-muted-foreground md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => row.original.createdBy?.displayName ?? '—',
      },
      {
        id: 'when',
        header: t('when'),
        meta: {
          className: 'hidden whitespace-nowrap text-muted-foreground sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.createdAt} />,
      },
      ...(canDecide
        ? [
            {
              id: 'actions',
              header: () => <span className="sr-only">{tc('actions')}</span>,
              size: 56,
              meta: { className: 'text-right' },
              cell: ({ row }) => (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('removeFor', { title: row.original.title })}
                  onClick={() => setRemoving(row.original)}
                >
                  <Trash2Icon />
                </Button>
              ),
            } satisfies DataTableColumn<TitleRule>,
          ]
        : []),
    ],
    [t, tc, canDecide],
  );

  return (
    <>
      <DataTable
        label={t('title')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
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
            <Select value={kind ?? ALL} onValueChange={(v) => set({ kind: v === ALL ? undefined : v })}>
              <SelectTrigger className="w-full sm:w-44" aria-label={t('outcome')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('all')}</SelectItem>
                <SelectItem value="mapped">{t('kinds.mapped')}</SelectItem>
                <SelectItem value="ignored">{t('kinds.ignored')}</SelectItem>
              </SelectContent>
            </Select>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => set({ q: undefined, kind: undefined })}>
                {tc('clearFilters')}
              </Button>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={filtered ? <SearchXIcon /> : <LinkIcon />}
            title={t('emptyTitle')}
            description={filtered ? t('emptyFiltered') : t('empty')}
          />
        }
      />
      <LiveCount total={data?.total} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('removeTitle', { title: removing?.title ?? '' })}
        description={t('removeHint')}
        confirmLabel={t('remove')}
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </>
  );
}
