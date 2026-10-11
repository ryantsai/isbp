'use client';

import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { Banner } from '@astryxdesign/core/Banner';
import type { Page } from '@isbp/sdk';
import { DataTable, type DataTableColumn, DataTableSummary, type ListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { usePeople } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { GitCompareArrowsIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import {
  CONFLICT_STATUSES,
  type ConflictDetail,
  type ConflictField,
  type ConflictStatus,
  type ConflictSummary,
} from '../contracts';
import { ConflictStatusBadge } from './badges';
import { LocalCell, RemoteCell } from './links-table';
import { INVALIDATE, showValue, useLabel } from './lib';

function Value({
  field,
  value,
  people,
}: {
  field: ConflictField;
  value: unknown;
  people: ReturnType<typeof usePeople>;
}) {
  const t = useTranslations('integrations.resolve');
  const text =
    field.type === 'user' && typeof value === 'string'
      ? (people.get(value)?.displayName ?? value)
      : showValue(value);
  if (!text) return <Text color="secondary">{t('empty')}</Text>;
  return (
    <Text maxLines={6} className="whitespace-pre-wrap wrap-anywhere">
      {text}
    </Text>
  );
}

/** "Changed by Mei Lin · 34 minutes ago" / "Changed in ServiceDesk Plus · 40 minutes ago". */
function ChangeNote({
  side,
  system,
  change,
}: {
  side: 'local' | 'remote';
  system: string;
  change: { at: string; by?: string | null } | null | undefined;
}) {
  const t = useTranslations('integrations.resolve');
  if (!change) return null;
  return (
    <Text type="supporting">
      {side === 'remote'
        ? t('changedIn', { system })
        : change.by
          ? t('changedBy', { name: change.by })
          : t('changedHere')}{' '}
      · <RelativeTime date={change.at} />
    </Text>
  );
}

/**
 * Side by side per field: the last agreed value, ISBP's and the remote system's; pick a side per field and
 * apply, or keep both as they are. Read-only once resolved (or for people who can't resolve).
 */
export function ResolveDialog({
  conflictId,
  onOpenChange,
}: {
  conflictId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('integrations.resolve');
  const tc = useTranslations('common');
  const label = useLabel();
  const errorText = useErrorText();
  const { data, isLoading } = useApiQuery<ConflictDetail>(
    conflictId ? `/integrations/conflicts/${conflictId}` : null,
  );
  const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({});
  const [error, setError] = useState<string | null>(null);
  const userIds = (data?.details ?? [])
    .filter((f) => f.type === 'user')
    .flatMap((f) => [f.base, f.local, f.remote])
    .filter((v): v is string => typeof v === 'string');
  const people = usePeople(userIds);
  const close = () => {
    setChoices({});
    setError(null);
    onOpenChange(false);
  };
  const resolve = useApiMutation(
    (api, body: { choices: Record<string, 'local' | 'remote'> }) =>
      api.post<ConflictDetail>(`/integrations/conflicts/${conflictId}/resolve`, body),
    { invalidate: INVALIDATE, success: t('resolved'), silent: true, onSuccess: close },
  );
  const dismiss = useApiMutation(
    (api) => api.post<ConflictDetail>(`/integrations/conflicts/${conflictId}/dismiss`),
    {
      invalidate: INVALIDATE,
      success: t('dismissed'),
      silent: true,
      onSuccess: close,
    },
  );
  const editable = Boolean(data?.canResolve);
  const fields = data?.details ?? [];
  const complete = fields.length > 0 && fields.every((f) => choices[f.field] ?? data?.choices?.[f.field]);
  const system = data?.connection.name ?? '';

  return (
    <Dialog
      isOpen={conflictId !== null}
      onOpenChange={(open) => (open ? undefined : close())}
      width={768}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            startContent={<Icon icon={GitCompareArrowsIcon} color="warning" />}
            title={t('title')}
            subtitle={
              data
                ? t('description', {
                    local: data.local?.hidden
                      ? t('hiddenRecord')
                      : (data.local?.reference ?? data.local?.title ?? ''),
                    remote: data.remoteRef ?? '',
                    system,
                  })
                : undefined
            }
            onOpenChange={(open) => (open ? undefined : close())}
          />
        }
        content={
          <LayoutContent padding={4}>
            {isLoading || !data ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <VStack gap={4} className="min-w-0">
                <HStack gap={2} wrap="wrap" vAlign="center">
                  <ConflictStatusBadge status={data.status} />
                  <RemoteCell remoteRef={data.remoteRef} remoteUrl={data.remoteUrl} />
                </HStack>
                {fields.map((f, index) => {
                  const chosen = choices[f.field] ?? data.choices?.[f.field];
                  const name = label(f.label, f.field);
                  return (
                    <VStack key={f.field} gap={2} className="min-w-0">
                      {index > 0 && <Divider />}
                      <Text type="label" aria-hidden>
                        {name}
                      </Text>
                      <VStack gap={0.5} className="min-w-0">
                        <Text type="supporting">{t('base')}</Text>
                        <Value field={f} value={f.base} people={people} />
                      </VStack>
                      <RadioList
                        label={name}
                        isLabelHidden
                        value={chosen ?? ''}
                        onChange={(side) =>
                          setChoices((c) => ({ ...c, [f.field]: side as 'local' | 'remote' }))
                        }
                        isDisabled={!editable}
                      >
                        {(['local', 'remote'] as const).map((side) => (
                          <RadioListItem
                            key={side}
                            value={side}
                            label={side === 'local' ? t('inIsbp') : t('inRemote', { system })}
                            description={
                              <VStack gap={0.5} className="min-w-0">
                                <Value
                                  field={f}
                                  value={side === 'local' ? f.local : f.remote}
                                  people={people}
                                />
                                <ChangeNote
                                  side={side}
                                  system={system}
                                  change={side === 'local' ? data.localChange : data.remoteChange}
                                />
                              </VStack>
                            }
                          />
                        ))}
                      </RadioList>
                    </VStack>
                  );
                })}
                {data.local?.hidden && <Text color="secondary">{t('hiddenHint')}</Text>}
                {editable && <Text type="supporting">{t('keepBothHint')}</Text>}
                {error && <Banner status="error" title={error} collapsible={false} />}
              </VStack>
            )}
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end" wrap="wrap">
              <Button label={editable ? tc('cancel') : tc('close')} variant="ghost" onClick={close} />
              {editable && (
                <>
                  <Button
                    label={t('keepBoth')}
                    variant="secondary"
                    isLoading={dismiss.isPending}
                    onClick={() => dismiss.mutate(undefined, { onError: (e) => setError(errorText(e)) })}
                  />
                  <Button
                    label={t('apply')}
                    variant="primary"
                    isLoading={resolve.isPending}
                    isDisabled={!complete}
                    onClick={() =>
                      resolve.mutate(
                        {
                          choices: Object.fromEntries(
                            fields.map((f) => [f.field, (choices[f.field] ?? data?.choices?.[f.field])!]),
                          ),
                        },
                        { onError: (e) => setError(errorText(e)) },
                      )
                    }
                  />
                </>
              )}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/** Conflicts (of a connection, or all), by status, each opening the resolution dialog. */
export function ConflictsTable({
  connectionId,
  state,
  set,
}: {
  connectionId?: string;
  state: ListState;
  set: (patch: Partial<ListState>) => void;
}) {
  const t = useTranslations('integrations.conflicts');
  const ts = useTranslations('integrations.conflictStatus');
  const tc = useTranslations('common');
  const panelId = useId();
  const status: ConflictStatus = CONFLICT_STATUSES.includes(state.status as ConflictStatus)
    ? (state.status as ConflictStatus)
    : 'open';
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<ConflictSummary>>(
    '/integrations/conflicts',
    {
      connectionId,
      status,
      page: state.page,
      pageSize: state.pageSize,
    },
  );
  const open = typeof state.conflict === 'string' ? state.conflict : null;

  const columns = useMemo<DataTableColumn<ConflictSummary>[]>(
    () => [
      {
        id: 'local',
        header: t('record'),
        meta: { className: 'max-w-72', wrap: true },
        cell: ({ row }) => (
          <div className="min-w-0">
            <LocalCell local={row.original.local} wrap />
            <DataTableSummary>
              <ConflictStatusBadge status={row.original.status} />
              <RelativeTime date={row.original.resolvedAt ?? row.original.createdAt} />
            </DataTableSummary>
          </div>
        ),
      },
      {
        id: 'remote',
        header: t('remote'),
        meta: { priority: 2 },
        cell: ({ row }) => (
          <VStack gap={0} className="min-w-0">
            <RemoteCell remoteRef={row.original.remoteRef} remoteUrl={row.original.remoteUrl} />
            {!connectionId && (
              <Text type="supporting" maxLines={1}>
                {row.original.connection.name}
              </Text>
            )}
          </VStack>
        ),
      },
      {
        id: 'fields',
        header: t('fields'),
        meta: { className: 'max-w-56', priority: 3 },
        cell: ({ row }) => (
          <Text type="code" maxLines={1}>
            {row.original.fields.join(', ')}
          </Text>
        ),
      },
      {
        id: 'status',
        header: tc('status'),
        meta: { priority: 2 },
        cell: ({ row }) => <ConflictStatusBadge status={row.original.status} />,
      },
      {
        id: 'when',
        header: t('when'),
        meta: { priority: 2 },
        cell: ({ row }) => (
          <VStack gap={0}>
            <Text type="supporting" color="primary">
              <RelativeTime date={row.original.resolvedAt ?? row.original.createdAt} />
            </Text>
            {row.original.resolvedBy && <Text type="supporting">{row.original.resolvedBy.displayName}</Text>}
          </VStack>
        ),
      },
      {
        id: 'open',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant={row.original.status === 'open' ? 'primary' : 'secondary'}
            label={row.original.status === 'open' ? t('resolve') : t('view')}
            // The accessible name starts with the visible label (WCAG 2.5.3).
            aria-label={t(row.original.status === 'open' ? 'resolveFor' : 'viewFor', {
              ref: row.original.remoteRef ?? '',
            })}
            onClick={(e) => {
              e.stopPropagation();
              set({ conflict: row.original.id, page: state.page });
            }}
          />
        ),
      },
    ],
    [t, tc, connectionId, set, state.page],
  );

  const table = (
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
      getRowId={(c) => c.id}
      onRowClick={(c) => set({ conflict: c.id, page: state.page })}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      empty={
        <EmptyState
          icon={<GitCompareArrowsIcon />}
          title={status === 'open' ? t('emptyOpen') : t('empty')}
          description={t('emptyHint')}
        />
      }
    />
  );

  return (
    <>
      <VStack gap={3}>
        <TabList
          role="tablist"
          aria-label={t('filter')}
          value={status}
          onChange={(v) => set({ status: v === 'open' ? undefined : v })}
          hasDivider
        >
          {CONFLICT_STATUSES.map((s) => (
            <Tab key={s} value={s} label={ts(s)} panelId={panelId} />
          ))}
        </TabList>
        {/* The tabs only filter the same list; the one panel holds it. */}
        <div role="tabpanel" id={panelId} aria-label={ts(status)} className="min-w-0">
          {table}
        </div>
      </VStack>
      <ResolveDialog
        conflictId={open}
        onOpenChange={(o) => !o && set({ conflict: undefined, page: state.page })}
      />
    </>
  );
}
