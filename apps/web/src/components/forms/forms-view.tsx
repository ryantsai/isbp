'use client';

import type { FormsHeaderSlotProps, FormSummary } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { Slot, useCan } from '@isbp/sdk/web';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import {
  ClipboardListIcon,
  LockIcon,
  PlusIcon,
  SearchXIcon,
  UsersRoundIcon,
  WorkflowIcon,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { RelativeTime } from '@/components/relative-time';
import { useApiQuery } from '@/lib/api';
import { CreateFormDialog } from './create-form-dialog';
import { useCategoryLabel } from './form-inputs';
import { FormIconTile, FormStatusBadges } from './form-meta';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';

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
            <HStack gap={3} vAlign="center">
              <FormIconTile name={f.icon} muted={f.archived} />
              <StackItem size="fill">
                <VStack hAlign="start">
                  <Link
                    href={`/admin/forms/${f.id}`}
                    color="primary"
                    weight="medium"
                    maxLines={1}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {localize(f.name, locale) || f.key}
                  </Link>
                  <Code color="secondary">{f.key}</Code>
                </VStack>
              </StackItem>
            </HStack>
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
            <Badge variant="neutral" label={categoryLabel(row.original.category)} />
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
            <VStack gap={1} hAlign="start">
              {f.workflow ? (
                <HStack gap={1.5} vAlign="center">
                  <Icon icon={WorkflowIcon} size="sm" color="secondary" />
                  <Text maxLines={1}>{workflowName(f.workflow.name)}</Text>
                </HStack>
              ) : (
                <Text color="secondary">{t('noApproval')}</Text>
              )}
              {f.audience.type === 'groups' && (
                <HStack gap={1.5} vAlign="center">
                  <Icon icon={UsersRoundIcon} size="xsm" color="secondary" />
                  <Text type="supporting">{t('audienceGroups', { count: f.audience.groupKeys.length })}</Text>
                </HStack>
              )}
            </VStack>
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
          <VStack hAlign="end">
            <Text hasTabularNumbers>{row.original.submissionCount.toLocaleString(locale)}</Text>
            {row.original.pendingCount > 0 && (
              <Text type="supporting" hasTabularNumbers>
                {t('pendingCount', { count: row.original.pendingCount })}
              </Text>
            )}
          </VStack>
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
            <Button
              label={t('add')}
              variant="primary"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => setCreateOpen(true)}
            />
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
            <div className="sm:ml-auto">
              <Switch
                label={t('showArchived')}
                value={includeArchived}
                onChange={(v) => set({ archived: v ? 'true' : undefined })}
              />
            </div>
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
                <Button
                  label={t('add')}
                  variant="primary"
                  size="sm"
                  icon={<Icon icon={PlusIcon} />}
                  onClick={() => setCreateOpen(true)}
                />
              }
            />
          )
        }
      />
      {createOpen && <CreateFormDialog open onOpenChange={setCreateOpen} categories={categories} />}
    </>
  );
}
