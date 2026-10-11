'use client';

import { Button } from '@astryxdesign/core/Button';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import type { AuditLog, ModuleInfo } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { type FilterDef, FilterBar } from '@isbp/ui/filter-bar';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import { toast } from '@isbp/ui/toast';
import { DownloadIcon, ScrollTextIcon } from 'lucide-react';
import { useNow, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { AuditIcon, useActionLabel } from '@/components/audit-action';
import { RelativeTime } from '@/components/relative-time';
import { fromDateInput, toDateInput } from '@/components/roles/role-utils';
import { useApiQuery } from '@/lib/api';
import { AuditDetailSheet } from './audit-detail-sheet';
import { ActorCell, CategoryBadge, OutcomeBadge, TargetCell } from './audit-parts';
import { CHANGED, CHANGED_KEYS, type ChangedKey, useAuditText } from './audit-text';
import { downloadCsv, toCsv } from './csv';

const ALL = '__all__';
const CATEGORIES = ['data', 'security', 'system'] as const;
const OUTCOMES = ['success', 'failure', 'denied'] as const;
const PERIODS = ['today', '7d', '30d', 'custom'] as const;
type Period = (typeof PERIODS)[number];
/** Filters other pages can deep-link with (e.g. `/admin/audit?userId=…`, a person's or a role's history). */
const LINK_FILTERS = ['actorId', 'entityType', 'entityId', 'action', 'userId', 'roleId'] as const;

/** Start of the day `days` days before `now`, in the viewer's time zone. */
function daysAgo(now: Date, days: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

export function AuditView() {
  const t = useTranslations('audit');
  const tr = useTranslations();
  const actionLabel = useActionLabel();
  const text = useAuditText();
  const canModules = useCan('core.modules.read');
  const [state, set] = useListState({ pageSize: 25 });
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const now = useNow({ updateInterval: 3_600_000 });
  const today = toDateInput(now);

  const str = (k: string) => (typeof state[k] === 'string' && state[k] ? (state[k] as string) : undefined);
  const changed = CHANGED_KEYS.includes(str('changed') as ChangedKey)
    ? (str('changed') as ChangedKey)
    : undefined;
  const from = str('from');
  const to = str('to');
  const period: Period | undefined = PERIODS.includes(str('period') as Period)
    ? (str('period') as Period)
    : from || to
      ? 'custom'
      : undefined;
  const range =
    period === 'today'
      ? { from: daysAgo(now, 0).toISOString() }
      : period === '7d'
        ? { from: daysAgo(now, 6).toISOString() }
        : period === '30d'
          ? { from: daysAgo(now, 29).toISOString() }
          : {
              // Date inputs are local calendar days → start / end of that day in the viewer's time zone.
              from: from ? fromDateInput(from)?.toISOString() : undefined,
              to: to ? fromDateInput(to, true)?.toISOString() : undefined,
            };
  const ascending = state.sort === 'occurredAt';
  const query = {
    page: state.page,
    pageSize: state.pageSize,
    sort: ascending ? 'occurredAt' : undefined,
    q: state.q,
    category: str('category'),
    outcome: str('outcome'),
    moduleId: str('moduleId'),
    actions: changed ? [...CHANGED[changed]] : undefined,
    ...range,
    ...Object.fromEntries(LINK_FILTERS.map((k) => [k, str(k)])),
  };
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<AuditLog>>('/audit-logs', query);
  const modules = useApiQuery<{ items: ModuleInfo[] }>(canModules ? '/modules' : null);
  const linkFilters = LINK_FILTERS.filter((k) => str(k));
  const filtered = Boolean(
    state.q || query.category || query.outcome || query.moduleId || changed || period || linkFilters.length,
  );
  const clearAll = () =>
    set({
      q: undefined,
      category: undefined,
      outcome: undefined,
      moduleId: undefined,
      changed: undefined,
      period: undefined,
      from: undefined,
      to: undefined,
      ...Object.fromEntries(LINK_FILTERS.map((k) => [k, undefined])),
    });

  const columns = useMemo<DataTableColumn<AuditLog>[]>(
    () => [
      {
        id: 'when',
        header: t('columns.when'),
        meta: { sortKey: 'occurredAt', className: 'whitespace-nowrap text-muted-foreground' },
        cell: ({ row }) => <RelativeTime date={row.original.occurredAt} />,
      },
      {
        id: 'actor',
        header: t('columns.actor'),
        meta: { className: 'max-w-52' },
        cell: ({ row }) => <ActorCell log={row.original} />,
      },
      {
        id: 'action',
        header: t('columns.action'),
        cell: ({ row }) => {
          const line = text.summary(row.original);
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <AuditIcon log={row.original} className="size-7 [&_svg]:size-3.5" />
              <div className="min-w-0">
                {/* A real button (a `Link` without href) so keyboard users can open the record (rows are mouse-clickable). */}
                <Link
                  color="primary"
                  weight="medium"
                  display="block"
                  maxLines={1}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(row.original);
                  }}
                >
                  {actionLabel(row.original.action)}
                </Link>
                {line && (
                  <Text as="div" display="block" type="supporting" color="secondary" maxLines={1}>
                    {line}
                  </Text>
                )}
              </div>
            </div>
          );
        },
      },
      {
        id: 'target',
        header: t('columns.target'),
        meta: { className: 'hidden max-w-56 md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <TargetCell log={row.original} />,
      },
      {
        id: 'category',
        header: t('columns.category'),
        meta: { className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => <CategoryBadge category={row.original.category} />,
      },
      {
        id: 'outcome',
        header: t('columns.outcome'),
        cell: ({ row }) => <OutcomeBadge outcome={row.original.outcome} />,
      },
    ],
    [t, actionLabel, text],
  );

  const exportCsv = () => {
    const items = data?.items ?? [];
    if (!items.length) return;
    const header = (
      [
        'seq',
        'occurredAt',
        'actorType',
        'actorId',
        'actorName',
        'action',
        'actionLabel',
        'category',
        'outcome',
        'moduleId',
        'entityType',
        'entityId',
        'entityLabel',
        'changes',
        'metadata',
        'ip',
        'userAgent',
        'requestId',
        'eventId',
      ] as const
    ).map((k) => t(`export.columns.${k}`));
    const rows = items.map((l) => [
      l.seq,
      l.occurredAt,
      l.actorType,
      l.actorId,
      l.actorName,
      l.action,
      actionLabel(l.action),
      l.category,
      l.outcome,
      l.moduleId,
      l.entityType,
      l.entityId,
      text.targetName(l),
      l.changes,
      l.metadata,
      l.ip,
      l.userAgent,
      l.requestId,
      l.eventId,
    ]);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    downloadCsv(`audit-log-${stamp}-p${state.page}.csv`, toCsv([header, ...rows]));
    toast.success(t('export.done', { count: items.length }));
  };

  const moduleName = (m: ModuleInfo) => (tr.has(m.name) ? tr(m.name) : m.name);
  // A deep-linked person or role reads as its name (the API names the ids the entries mention).
  const linkValue = (k: (typeof LINK_FILTERS)[number]) => {
    const v = str(k)!;
    if (k === 'action') return actionLabel(v);
    if (k === 'entityType') return text.typeName(v) ?? v;
    const named = data?.items.map((l) => text.refName(l, v)).find(Boolean);
    return named ?? `${v.slice(0, 8)}…`;
  };

  const moduleOptions = [
    { value: ALL, label: t('filters.allModules') },
    { type: 'divider' as const },
    ...(modules.data?.items ?? []).map((m) => ({ value: m.id, label: moduleName(m) })),
    ...(query.moduleId && !modules.data?.items.some((m) => m.id === query.moduleId)
      ? [{ value: query.moduleId, label: query.moduleId }]
      : []),
  ];

  const filters: FilterDef[] = [
    {
      id: 'changed',
      label: t('filters.changed'),
      primary: true,
      value: changed ? t(`changed.${changed}`) : undefined,
      onClear: () => set({ changed: undefined }),
      control: (
        <Selector
          label={t('filters.changed')}
          isLabelHidden
          value={changed ?? ALL}
          onChange={(v) => set({ changed: v === ALL ? undefined : v })}
          options={[
            { value: ALL, label: t('filters.anything') },
            { type: 'divider' },
            ...CHANGED_KEYS.map((k) => ({ value: k, label: t(`changed.${k}`) })),
          ]}
          width={176}
        />
      ),
    },
    {
      id: 'period',
      label: t('filters.period'),
      primary: true,
      value: period ? t(`period.${period}`) : undefined,
      onClear: () => set({ period: undefined, from: undefined, to: undefined }),
      control: (
        <Selector
          label={t('filters.period')}
          isLabelHidden
          value={period ?? ALL}
          onChange={(v) =>
            set(
              v === 'custom'
                ? { period: 'custom' }
                : { period: v === ALL ? undefined : v, from: undefined, to: undefined },
            )
          }
          options={[
            { value: ALL, label: t('period.any') },
            { type: 'divider' },
            ...PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) })),
          ]}
          width={160}
        />
      ),
    },
    ...(period === 'custom'
      ? [
          {
            id: 'from',
            label: t('filters.from'),
            value: from,
            onClear: () => set({ from: undefined }),
            control: (
              <DateInput
                label={t('filters.from')}
                isLabelHidden
                value={from as ISODateString | undefined}
                max={(to ?? today) as ISODateString}
                hasClear
                onChange={(v) => set({ from: v || undefined, period: 'custom' })}
                width={170}
              />
            ),
          },
          {
            id: 'to',
            label: t('filters.to'),
            value: to,
            onClear: () => set({ to: undefined }),
            control: (
              <DateInput
                label={t('filters.to')}
                isLabelHidden
                value={to as ISODateString | undefined}
                min={from as ISODateString | undefined}
                hasClear
                onChange={(v) => set({ to: v || undefined, period: 'custom' })}
                width={170}
              />
            ),
          },
        ]
      : []),
    {
      id: 'category',
      label: t('filters.category'),
      value: query.category ? t(`category.${query.category}`) : undefined,
      onClear: () => set({ category: undefined }),
      control: (
        <Selector
          label={t('filters.category')}
          isLabelHidden
          value={query.category ?? ALL}
          onChange={(v) => set({ category: v === ALL ? undefined : v })}
          options={[
            { value: ALL, label: t('filters.allCategories') },
            { type: 'divider' },
            ...CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) })),
          ]}
          width="100%"
        />
      ),
    },
    {
      id: 'outcome',
      label: t('filters.outcome'),
      value: query.outcome ? t(`outcome.${query.outcome}`) : undefined,
      onClear: () => set({ outcome: undefined }),
      control: (
        <Selector
          label={t('filters.outcome')}
          isLabelHidden
          value={query.outcome ?? ALL}
          onChange={(v) => set({ outcome: v === ALL ? undefined : v })}
          options={[
            { value: ALL, label: t('filters.allOutcomes') },
            { type: 'divider' },
            ...OUTCOMES.map((o) => ({ value: o, label: t(`outcome.${o}`) })),
          ]}
          width="100%"
        />
      ),
    },
    ...(canModules
      ? [
          {
            id: 'moduleId',
            label: t('filters.module'),
            value: query.moduleId
              ? (modules.data?.items.find((m) => m.id === query.moduleId) &&
                  moduleName(modules.data.items.find((m) => m.id === query.moduleId)!)) ||
                query.moduleId
              : undefined,
            onClear: () => set({ moduleId: undefined }),
            control: (
              <Selector
                label={t('filters.module')}
                isLabelHidden
                value={query.moduleId ?? ALL}
                onChange={(v) => set({ moduleId: v === ALL ? undefined : v })}
                options={moduleOptions}
                hasSearch
                width="100%"
              />
            ),
          },
        ]
      : []),
    // Deep links (a person's or a role's history, one actor): shown as removable chips only.
    ...linkFilters.map((k) => ({
      id: k,
      label: t(`filters.${k}`),
      value: linkValue(k),
      onClear: () => set({ [k]: undefined }),
      control: <Text>{linkValue(k)}</Text>,
    })),
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Tooltip content={t('export.hint')}>
            <Button
              label={t('export.button')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={DownloadIcon} />}
              isDisabled={!data?.items.length}
              onClick={exportCsv}
            />
          </Tooltip>
        }
      />
      <DataTable
        label={t('title')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        // The API sorts by time only: newest first unless `sort=occurredAt`. Two-state toggle.
        sort={ascending ? 'occurredAt' : '-occurredAt'}
        loading={isLoading}
        fetching={isFetching}
        error={error}
        onRetry={() => refetch()}
        getRowId={(l) => String(l.seq)}
        onRowClick={setSelected}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(s) => set({ sort: s === '-occurredAt' ? undefined : 'occurredAt' })}
        toolbar={
          <FilterBar
            search={
              <SearchInput
                value={state.q ?? ''}
                onChange={(q) => set({ q })}
                placeholder={t('filters.search')}
                className="w-full sm:w-72"
              />
            }
            filters={filters}
            onClearAll={filtered ? clearAll : undefined}
          />
        }
        empty={
          filtered ? (
            <EmptyState variant="filtered" description={t('emptyHint')} onClearFilters={clearAll} />
          ) : (
            <EmptyState icon={<ScrollTextIcon />} title={t('emptyAll')} />
          )
        }
      />
      <AuditDetailSheet log={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </>
  );
}
