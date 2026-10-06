'use client';

import type { AuditLog, ModuleInfo } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@isbp/ui/select';
import { toast } from '@isbp/ui/sonner';
import { Hint } from '@isbp/ui/tooltip';
import type { ColumnDef } from '@tanstack/react-table';
import { DownloadIcon, ScrollTextIcon, SearchXIcon, XIcon } from 'lucide-react';
import { useNow, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { AuditIcon, useActionLabel } from '@/components/audit-action';
import { RelativeTime } from '@/components/relative-time';
import { fromDateInput, toDateInput } from '@/components/roles/role-utils';
import { useApiQuery } from '@/lib/api';
import { AuditDetailSheet } from './audit-detail-sheet';
import { ActorCell, CategoryBadge, OutcomeBadge, TargetCell } from './audit-parts';
import { downloadCsv, toCsv } from './csv';

const ALL = '__all__';
const CATEGORIES = ['data', 'security', 'system'] as const;
const OUTCOMES = ['success', 'failure', 'denied'] as const;
/** Filters other pages can deep-link with (e.g. `/admin/audit?entityType=user&entityId=…`). */
const LINK_FILTERS = ['actorId', 'entityType', 'entityId', 'action'] as const;

export function AuditView() {
  const t = useTranslations('audit');
  const tc = useTranslations('common');
  const tr = useTranslations();
  const actionLabel = useActionLabel();
  const canModules = useCan('core.modules.read');
  const [state, set] = useListState({ pageSize: 25 });
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const str = (k: string) => (typeof state[k] === 'string' && state[k] ? (state[k] as string) : undefined);
  const from = str('from');
  const to = str('to');
  const ascending = state.sort === 'occurredAt';
  const query = {
    page: state.page,
    pageSize: state.pageSize,
    sort: ascending ? 'occurredAt' : undefined,
    q: state.q,
    category: str('category'),
    outcome: str('outcome'),
    moduleId: str('moduleId'),
    // Date inputs are local calendar days → start / end of that day in the viewer's time zone.
    from: from ? fromDateInput(from)?.toISOString() : undefined,
    to: to ? fromDateInput(to, true)?.toISOString() : undefined,
    ...Object.fromEntries(LINK_FILTERS.map((k) => [k, str(k)])),
  };
  const { data, isLoading, isFetching } = useApiQuery<Page<AuditLog>>('/audit-logs', query);
  const modules = useApiQuery<{ items: ModuleInfo[] }>(canModules ? '/modules' : null);
  const linkFilters = LINK_FILTERS.filter((k) => str(k));
  const filtered = Boolean(
    state.q || query.category || query.outcome || query.moduleId || from || to || linkFilters.length,
  );

  const columns = useMemo<ColumnDef<AuditLog, unknown>[]>(
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
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <AuditIcon log={row.original} className="size-7 [&_svg]:size-3.5" />
            <div className="min-w-0">
              {/* A real button so keyboard users can open the record (rows are mouse-clickable). */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(row.original);
                }}
                className="block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {actionLabel(row.original.action)}
              </button>
              <code className="block truncate font-mono text-[11px] text-muted-foreground">
                {row.original.action}
              </code>
            </div>
          </div>
        ),
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
    [t, actionLabel],
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
      l.entityLabel,
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
  const now = useNow({ updateInterval: 3_600_000 });
  const today = toDateInput(now);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Hint label={t('export.hint')}>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data?.items.length}>
              <DownloadIcon /> {t('export.button')}
            </Button>
          </Hint>
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
        getRowId={(l) => String(l.seq)}
        onRowClick={setSelected}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(s) => set({ sort: s === '-occurredAt' ? undefined : 'occurredAt' })}
        toolbar={
          <>
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('filters.search')}
              className="sm:w-72"
            />
            <Select
              value={query.category ?? ALL}
              onValueChange={(v) => set({ category: v === ALL ? undefined : v })}
            >
              <SelectTrigger className="w-40" aria-label={t('filters.category')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('filters.allCategories')}</SelectItem>
                <SelectSeparator />
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`category.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={query.outcome ?? ALL}
              onValueChange={(v) => set({ outcome: v === ALL ? undefined : v })}
            >
              <SelectTrigger className="w-36" aria-label={t('filters.outcome')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('filters.allOutcomes')}</SelectItem>
                <SelectSeparator />
                {OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {t(`outcome.${o}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canModules && (
              <Select
                value={query.moduleId ?? ALL}
                onValueChange={(v) => set({ moduleId: v === ALL ? undefined : v })}
              >
                <SelectTrigger className="w-40" aria-label={t('filters.module')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('filters.allModules')}</SelectItem>
                  <SelectSeparator />
                  {(modules.data?.items ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {moduleName(m)}
                    </SelectItem>
                  ))}
                  {query.moduleId && !modules.data?.items.some((m) => m.id === query.moduleId) && (
                    <SelectItem value={query.moduleId}>{query.moduleId}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
            <div role="group" aria-label={t('filters.dateRange')} className="flex items-center gap-1.5">
              <Input
                type="date"
                aria-label={t('filters.from')}
                value={from ?? ''}
                max={to ?? today}
                onChange={(e) => set({ from: e.target.value || undefined })}
                className="w-[9.5rem]"
              />
              <span aria-hidden className="text-muted-foreground">
                –
              </span>
              <Input
                type="date"
                aria-label={t('filters.to')}
                value={to ?? ''}
                min={from}
                onChange={(e) => set({ to: e.target.value || undefined })}
                className="w-[9.5rem]"
              />
            </div>
            {linkFilters.map((k) => (
              <Badge key={k} variant="secondary" className="h-8 gap-1.5 pr-1 font-normal">
                <span className="text-muted-foreground">{t(`filters.${k}`)}:</span>
                <code className="max-w-40 truncate font-mono text-xs" title={str(k)}>
                  {str(k)}
                </code>
                <button
                  type="button"
                  onClick={() => set({ [k]: undefined })}
                  aria-label={t('filters.removeFilter', { filter: t(`filters.${k}`) })}
                  className="rounded-sm p-0.5 hover:bg-background/60"
                >
                  <XIcon className="size-3.5" />
                </button>
              </Badge>
            ))}
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  set({
                    q: undefined,
                    category: undefined,
                    outcome: undefined,
                    moduleId: undefined,
                    from: undefined,
                    to: undefined,
                    ...Object.fromEntries(LINK_FILTERS.map((k) => [k, undefined])),
                  })
                }
              >
                {tc('clearFilters')}
              </Button>
            )}
          </>
        }
        empty={
          filtered ? (
            <EmptyState icon={<SearchXIcon />} title={t('empty')} description={t('emptyHint')} />
          ) : (
            <EmptyState icon={<ScrollTextIcon />} title={t('emptyAll')} />
          )
        }
      />
      <AuditDetailSheet log={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </>
  );
}
