'use client';

import type { FormsHeaderSlotProps, FormSummary } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { Slot, useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import { Switch } from '@isbp/ui/switch';
import {
  ClipboardListIcon,
  LockIcon,
  PlusIcon,
  SearchXIcon,
  UsersRoundIcon,
  WorkflowIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { RelativeTime } from '@/components/relative-time';
import { useApiQuery } from '@/lib/api';
import { CreateFormDialog } from './create-form-dialog';
import { useCategoryLabel } from './form-inputs';
import { FormIconTile, FormStatusBadges } from './form-meta';

const PAGE_SIZE = 25;

/** Workflow names of system definitions are i18n keys. */
export function useWorkflowName() {
  const tr = useTranslations();
  return useCallback((name: string) => (tr.has(name) ? tr(name) : name), [tr]);
}

export function FormsView() {
  const t = useTranslations('forms');
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const canManage = useCan('core.forms.manage');
  const workflowName = useWorkflowName();
  const { label: categoryLabel } = useCategoryLabel();
  const [state, set] = useListState({ pageSize: PAGE_SIZE });
  const includeArchived = state.archived === 'true';
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<{ items: FormSummary[] }>(
    canManage ? '/forms' : null,
    {
      q: state.q,
      includeArchived,
    },
  );
  const all = useMemo(() => data?.items ?? [], [data]);
  const page = Math.max(1, state.page);
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const categories = useMemo(
    () => [...new Set(all.map((f) => f.category).filter((c): c is string => Boolean(c)))].sort(),
    [all],
  );

  const columns = useMemo<DataTableColumn<FormSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('columns.form'),
        cell: ({ row }) => {
          const f = row.original;
          return (
            <Link
              href={`/admin/forms/${f.id}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-3 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <FormIconTile name={f.icon} className={f.archived ? 'opacity-60 grayscale' : undefined} />
              <span className="min-w-0">
                <span className="block truncate font-medium hover:underline">
                  {localize(f.name, locale) || f.key}
                </span>
                <code className="block truncate font-mono text-xs text-muted-foreground">{f.key}</code>
              </span>
            </Link>
          );
        },
      },
      {
        id: 'category',
        header: t('columns.category'),
        meta: {
          className: 'hidden text-muted-foreground lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) =>
          row.original.category ? (
            <Badge variant="outline" className="font-normal">
              {categoryLabel(row.original.category)}
            </Badge>
          ) : (
            '—'
          ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => <FormStatusBadges form={row.original} />,
      },
      {
        id: 'workflow',
        header: t('columns.workflow'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => {
          const f = row.original;
          return (
            <div className="space-y-1 text-sm">
              {f.workflow ? (
                <span className="flex items-center gap-1.5">
                  <WorkflowIcon className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="truncate">{workflowName(f.workflow.name)}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">{t('noApproval')}</span>
              )}
              {f.audience.type === 'groups' && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UsersRoundIcon className="size-3" aria-hidden />
                  {t('audienceGroups', { count: f.audience.groupKeys.length })}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: 'submissions',
        header: t('columns.submissions'),
        meta: {
          className: 'hidden text-right sm:table-cell',
          headerClassName: 'hidden text-right sm:table-cell',
        },
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            <div>{row.original.submissionCount.toLocaleString(locale)}</div>
            {row.original.pendingCount > 0 && (
              <div className="text-xs text-muted-foreground">
                {t('pendingCount', { count: row.original.pendingCount })}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'updated',
        header: t('columns.updated'),
        meta: {
          className: 'hidden text-muted-foreground xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.updatedAt} />,
      },
    ],
    [t, locale, workflowName, categoryLabel],
  );

  const createOpen = sp.get('create') === '1';
  const setCreateOpen = (open: boolean) => {
    const next = new URLSearchParams(sp.toString());
    if (open) next.set('create', '1');
    else next.delete('create');
    router.replace(`/admin/forms${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  if (!canManage) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState icon={<LockIcon />} title={t('noAccess')} />
      </>
    );
  }

  const filtered = Boolean(state.q);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            {/* Modules add their own ways to start a process here (the assistant: "Install a process pack"). */}
            <Slot<FormsHeaderSlotProps>
              name="core.forms.header"
              props={{ empty: !isLoading && !all.length }}
            />
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon /> {t('add')}
            </Button>
          </>
        }
      />
      <DataTable
        label={t('title')}
        columns={columns}
        data={rows}
        total={all.length}
        page={page}
        pageSize={PAGE_SIZE}
        loading={isLoading}
        fetching={isFetching}
        error={error}
        onRetry={() => refetch()}
        getRowId={(f) => f.id}
        onRowClick={(f) => router.push(`/admin/forms/${f.id}`)}
        onPageChange={(p) => set({ page: p })}
        toolbar={
          <>
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('searchPlaceholder')}
              className="sm:w-80"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground sm:ml-auto">
              <Switch
                checked={includeArchived}
                onCheckedChange={(v) => set({ archived: v ? 'true' : undefined })}
              />
              {t('showArchived')}
            </label>
          </>
        }
        empty={
          filtered ? (
            <EmptyState
              icon={<SearchXIcon />}
              title={t('empty.title')}
              description={t('empty.description')}
            />
          ) : (
            <EmptyState
              icon={<ClipboardListIcon />}
              title={t('empty.firstTitle')}
              description={t('empty.firstDescription')}
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <PlusIcon /> {t('add')}
                </Button>
              }
            />
          )
        }
      />
      <CreateFormDialog open={createOpen} onOpenChange={setCreateOpen} categories={categories} />
    </>
  );
}
