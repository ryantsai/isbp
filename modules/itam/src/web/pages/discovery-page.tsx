'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Link } from '@astryxdesign/core/Link';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Selector } from '@astryxdesign/core/Selector';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import {
  DataTable,
  type DataTableColumn,
  DataTableSummary,
  type ListState,
  useListState,
} from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { FormDialog } from '@isbp/ui/form-dialog';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import {
  BanIcon,
  CheckCircle2Icon,
  FileSpreadsheetIcon,
  LinkIcon,
  ListChecksIcon,
  OctagonXIcon,
  RadarIcon,
  SearchXIcon,
  ShieldCheckIcon,
  TicketIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
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
import { SoftwareSections } from '../sections';

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
  const tn = useTranslations('itam.nav');
  const [state, set] = useListState({ pageSize: 25 });
  const [importing, setImporting] = useState(false);
  const tab: Tab = TABS.includes(state.tab as Tab) ? (state.tab as Tab) : 'titles';
  const canDecide = useCan('itam.software.manage');
  const panelId = useId();

  return (
    <>
      <PageHeader
        title={tn('software')}
        description={t('description')}
        actions={
          <Button
            label={t('import')}
            variant="secondary"
            icon={<Icon icon={UploadIcon} />}
            onClick={() => setImporting(true)}
          />
        }
      />
      <SoftwareSections />
      <VStack gap={4}>
        <TabList
          role="tablist"
          value={tab}
          onChange={(v) =>
            set({
              tab: v === 'titles' ? undefined : v,
              q: undefined,
              source: undefined,
              kind: undefined,
              approval: undefined,
              department: undefined,
            })
          }
          hasDivider
        >
          {TABS.map((v) => (
            <Tab key={v} value={v} label={t(`tabs.${v}`)} panelId={panelId} />
          ))}
        </TabList>
        <div role="tabpanel" id={panelId} aria-label={t(`tabs.${tab}`)} className="min-w-0">
          {tab === 'titles' && <TitlesTab state={state} set={set} canDecide={canDecide} />}
          {tab === 'compliance' && <ComplianceTab state={state} set={set} canDecide={canDecide} />}
          {tab === 'reports' && <ReportsTab state={state} set={set} />}
          {tab === 'rules' && <RulesTab state={state} set={set} canDecide={canDecide} />}
        </div>
      </VStack>
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
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<DiscoveredTitle>>(
    '/itam/discovery/titles',
    {
      page: state.page,
      pageSize: state.pageSize,
      q: state.q,
    },
  );
  const ignore = useApiMutation(
    (api, title: string) => api.post('/itam/discovery/rules', { title, licenseId: null }),
    {
      invalidate: INVALIDATE,
      success: () => t('ignore.done', { title: ignoring ?? '' }),
      onSuccess: () => setIgnoring(null),
    },
  );

  const columns = useMemo<DataTableColumn<DiscoveredTitle>[]>(() => {
    // The fixes, as labelled buttons: beside the title on a wide table, under it on a phone.
    const titleActions = (r: DiscoveredTitle, under = false) => (
      <HStack
        gap={1.5}
        wrap="wrap"
        hAlign={under ? 'start' : 'end'}
        vAlign="center"
        className="md:flex-nowrap"
      >
        <Button
          label={t('titles.map')}
          aria-label={t('titles.mapFor', { title: r.title })}
          variant="secondary"
          size="sm"
          icon={<Icon icon={LinkIcon} />}
          onClick={() => setMapping(r.title)}
        />
        <Button
          label={t('titles.ignore')}
          aria-label={t('titles.ignoreFor', { title: r.title })}
          variant="secondary"
          size="sm"
          icon={<Icon icon={BanIcon} />}
          onClick={() => setIgnoring(r.title)}
        />
        <MoreMenu
          label={t('titles.actionsFor', { title: r.title })}
          size="sm"
          items={[
            {
              label: t('titles.allow'),
              icon: ShieldCheckIcon,
              onClick: () => setListing({ title: r.title, publisher: r.publisher }),
            },
            {
              label: t('titles.block'),
              icon: OctagonXIcon,
              onClick: () =>
                setListing({
                  title: r.title,
                  publisher: r.publisher,
                  status: 'blocked',
                }),
            },
          ]}
        />
      </HStack>
    );
    return [
      {
        id: 'title',
        header: t('titles.title'),
        meta: { className: 'max-w-72', wrap: true },
        cell: ({ row }) => (
          <VStack>
            <Text weight="medium">{row.original.title}</Text>
            {row.original.publisher && (
              <Text type="supporting" maxLines={1}>
                {row.original.publisher}
              </Text>
            )}
            <DataTableSummary>
              <span>{t('titles.onDevices', { count: row.original.devices })}</span>
            </DataTableSummary>
            {canDecide && (
              <DataTableSummary className="mt-2">{titleActions(row.original, true)}</DataTableSummary>
            )}
          </VStack>
        ),
      },
      {
        id: 'devices',
        header: t('titles.devices'),
        size: 100,
        meta: { className: 'tabular-nums', priority: 2 },
        cell: ({ row }) => row.original.devices,
      },
      {
        id: 'lastSeen',
        header: t('titles.lastSeen'),
        meta: { className: 'whitespace-nowrap text-muted-foreground', priority: 3 },
        cell: ({ row }) => <RelativeTime date={row.original.lastSeenAt} />,
      },
      ...(canDecide
        ? [
            {
              id: 'actions',
              header: () => <span className="sr-only">{tc('actions')}</span>,
              meta: { className: 'text-right', priority: 2 },
              cell: ({ row }) => titleActions(row.original),
            } satisfies DataTableColumn<DiscoveredTitle>,
          ]
        : []),
    ];
  }, [t, tc, canDecide]);

  return (
    <VStack gap={3}>
      <Text as="p" color="secondary">
        {t('titles.hint')}
      </Text>
      <DataTable
        label={t('tabs.titles')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        loading={isLoading}
        fetching={isFetching}
        error={error}
        onRetry={() => refetch()}
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
    </VStack>
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
  const [asking, setAsking] = useState<ComplianceItem | null>(null);
  const askRemoval = useApiMutation(
    (api, item: ComplianceItem) =>
      api.post<{ reference: string | null; href: string | null }>(
        `/itam/discovery/installations/${item.id}/ask-removal`,
        {},
      ),
    {
      invalidate: INVALIDATE,
      success: (r) => t('askRemovalDone', { reference: r.reference ?? '' }),
      onSuccess: () => setAsking(null),
    },
  );
  const { data: summary } = useApiQuery<ComplianceSummary>('/itam/discovery/compliance/summary');
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<ComplianceItem>>(
    '/itam/discovery/compliance',
    {
      page: state.page,
      pageSize: state.pageSize,
      q: state.q,
      approval,
      department,
    },
  );
  const filtered = Boolean(state.q || approval || department);

  const columns = useMemo<DataTableColumn<ComplianceItem>[]>(() => {
    const complianceActions = (item: ComplianceItem, under = false) => {
      const title = item.reportedAs ?? item.product;
      return (
        <HStack
          gap={1.5}
          wrap="wrap"
          hAlign={under ? 'start' : 'end'}
          vAlign="center"
          className="md:flex-nowrap"
        >
          {item.approval === 'unapproved' && (
            <Button
              label={t('allow')}
              aria-label={t('allowFor', { title })}
              variant="secondary"
              size="sm"
              icon={<Icon icon={ShieldCheckIcon} />}
              onClick={() =>
                setListing({ title, publisher: item.publisher, department: item.asset.department })
              }
            />
          )}
          <Button
            label={t('askRemoval')}
            aria-label={t('askRemovalFor', { title, device: item.asset.name })}
            variant="secondary"
            size="sm"
            icon={<Icon icon={TicketIcon} />}
            onClick={() => setAsking(item)}
          />
        </HStack>
      );
    };
    return [
      {
        id: 'title',
        header: t('title'),
        meta: { className: 'max-w-64', wrap: true },
        cell: ({ row }) => (
          <VStack>
            <Text weight="medium">{row.original.reportedAs ?? row.original.product}</Text>
            <Text type="supporting" maxLines={1}>
              {[row.original.version, row.original.publisher].filter(Boolean).join(' · ') || '—'}
            </Text>
            <DataTableSummary>
              <Text type="code" size="xsm">
                {row.original.asset.tag}
              </Text>
              <span>{row.original.asset.name}</span>
            </DataTableSummary>
            {canDecide && (
              <DataTableSummary className="mt-2">{complianceActions(row.original, true)}</DataTableSummary>
            )}
          </VStack>
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
        meta: { className: 'max-w-56', priority: 2 },
        cell: ({ row }) => (
          <VStack>
            <Link href={assetHref(row.original.asset)} color="primary" weight="medium" maxLines={1}>
              {row.original.asset.name}
            </Link>
            <Text type="supporting" maxLines={1}>
              {row.original.asset.tag}
              {row.original.asset.assignee ? ` · ${row.original.asset.assignee.displayName}` : ''}
            </Text>
          </VStack>
        ),
      },
      {
        id: 'department',
        header: t('department'),
        meta: { className: 'text-muted-foreground', priority: 3 },
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
              meta: { className: 'text-right', priority: 2 },
              cell: ({ row }) => complianceActions(row.original),
            } satisfies DataTableColumn<ComplianceItem>,
          ]
        : []),
    ];
  }, [t, tc, canDecide]);

  return (
    <VStack gap={3}>
      <Text as="p" color="secondary">
        {summary && !summary.allowListInUse ? t('notInUse') : t('hint')}{' '}
        <Link href="/itam/approved-software" type="inherit" weight="medium">
          {t('openList')}
        </Link>
      </Text>
      {summary && (
        <div role="status">
          <Text>
            {t('summary', {
              unapproved: summary.unapproved,
              blocked: summary.blocked,
              devices: summary.devices,
            })}
          </Text>
        </div>
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
              label={t('state')}
              isLabelHidden
              width={208}
              value={approval ?? ALL}
              onChange={(v) => set({ approval: v === ALL ? undefined : v })}
              options={[
                { value: ALL, label: t('allStates') },
                { value: 'unapproved', label: t('unapproved') },
                { value: 'blocked', label: t('blocked') },
              ]}
            />
            {departments.length > 0 && (
              <Selector
                label={t('department')}
                isLabelHidden
                width={192}
                hasSearch
                value={department ?? ALL}
                onChange={(v) => set({ department: v === ALL ? undefined : v })}
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
                onClick={() => set({ q: undefined, approval: undefined, department: undefined })}
              />
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
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(o) => !o && setAsking(null)}
        title={t('askRemovalTitle', {
          title: asking?.reportedAs ?? asking?.product ?? '',
          device: asking?.asset.name ?? '',
        })}
        description={t('askRemovalDescription', { user: asking?.asset.assignee?.displayName ?? '—' })}
        confirmLabel={t('askRemoval')}
        loading={askRemoval.isPending}
        onConfirm={() => asking && askRemoval.mutate(asking)}
      />
    </VStack>
  );
}

function MapDialog({ title, onOpenChange }: { title: string; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('itam.discovery.map');
  const tc = useTranslations('common');
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
    <FormDialog
      isOpen
      onOpenChange={(o) => !map.isPending && onOpenChange(o)}
      title={t('title', { title })}
      subtitle={t('description')}
      onSubmit={submit}
      submitLabel={t('submit')}
      cancelLabel={tc('cancel')}
      isSubmitting={map.isPending}
      isSubmitDisabled={!license}
    >
      <LicensePicker label={t('license')} value={license} onChange={setLicense} />
    </FormDialog>
  );
}

/* ───────────────────────────── recent reports ───────────────────────────── */

function ReportsTab({ state, set }: { state: ListState; set: SetState }) {
  const t = useTranslations('itam.discovery.reports');
  const tc = useTranslations('common');
  const source = str(state, 'source');
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<DiscoveryReport>>(
    '/itam/discovery/reports',
    {
      page: state.page,
      pageSize: state.pageSize,
      q: state.q,
      source,
    },
  );
  const filtered = Boolean(state.q || source);

  const columns = useMemo<DataTableColumn<DiscoveryReport>[]>(
    () => [
      {
        id: 'device',
        header: t('device'),
        meta: { className: 'max-w-64' },
        cell: ({ row }) => (
          <VStack>
            <Link href={assetHref(row.original.asset)} color="primary" weight="medium" maxLines={1}>
              {row.original.asset.name}
            </Link>
            <Text type="code" size="xsm" color="secondary">
              {row.original.asset.tag}
            </Text>
          </VStack>
        ),
      },
      {
        id: 'source',
        header: t('source'),
        cell: ({ row }) => (
          <VStack gap={1} hAlign="start">
            <Badge
              variant={row.original.source === 'import' ? 'info' : 'neutral'}
              icon={
                <Icon icon={row.original.source === 'import' ? FileSpreadsheetIcon : RadarIcon} size="xsm" />
              }
              label={t(`sources.${row.original.source}`)}
            />
            {row.original.fileName && (
              <Text type="supporting" maxLines={1}>
                {row.original.fileName}
              </Text>
            )}
          </VStack>
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
              label={t('source')}
              isLabelHidden
              width={176}
              value={source ?? ALL}
              onChange={(v) => set({ source: v === ALL ? undefined : v })}
              options={[
                { value: ALL, label: t('allSources') },
                { value: 'api', label: t('sources.api') },
                { value: 'import', label: t('sources.import') },
              ]}
            />
            {filtered && (
              <Button
                label={tc('clearFilters')}
                variant="ghost"
                size="sm"
                onClick={() => set({ q: undefined, source: undefined })}
              />
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
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<TitleRule>>(
    '/itam/discovery/rules',
    {
      page: state.page,
      pageSize: state.pageSize,
      q: state.q,
      kind,
    },
  );
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
        cell: ({ row }) => (
          <Text weight="medium" maxLines={1}>
            {row.original.title}
          </Text>
        ),
      },
      {
        id: 'outcome',
        header: t('outcome'),
        meta: { className: 'max-w-64' },
        cell: ({ row }) =>
          row.original.license ? (
            <HStack gap={1.5} vAlign="center">
              <Icon icon={LinkIcon} color="secondary" size="sm" />
              <Text type="code" size="xsm" color="secondary">
                {row.original.license.reference}
              </Text>
              <StackItem size="fill">
                <Link href={licenseHref(row.original.license)} color="primary" maxLines={1}>
                  {row.original.license.product}
                </Link>
              </StackItem>
            </HStack>
          ) : (
            <HStack gap={1.5} vAlign="center">
              <Icon icon={BanIcon} color="secondary" size="sm" />
              <Text color="secondary">{t('ignored')}</Text>
            </HStack>
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
                <IconButton
                  label={t('removeFor', { title: row.original.title })}
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={Trash2Icon} />}
                  onClick={() => setRemoving(row.original)}
                />
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
              label={t('outcome')}
              isLabelHidden
              width={176}
              value={kind ?? ALL}
              onChange={(v) => set({ kind: v === ALL ? undefined : v })}
              options={[
                { value: ALL, label: t('all') },
                { value: 'mapped', label: t('kinds.mapped') },
                { value: 'ignored', label: t('kinds.ignored') },
              ]}
            />
            {filtered && (
              <Button
                label={tc('clearFilters')}
                variant="ghost"
                size="sm"
                onClick={() => set({ q: undefined, kind: undefined })}
              />
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
