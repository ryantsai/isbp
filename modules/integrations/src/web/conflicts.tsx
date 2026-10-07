'use client';

import type { Page } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { DataTable, type ListState } from '@isbp/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { EmptyState } from '@isbp/ui/empty-state';
import { usePeople } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import type { ColumnDef } from '@tanstack/react-table';
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
  if (!text) return <span className="text-muted-foreground italic">{t('empty')}</span>;
  return <span className="line-clamp-6 whitespace-pre-wrap wrap-anywhere">{text}</span>;
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
  const id = useId();
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
    <Dialog open={conflictId !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={tc('close')} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrowsIcon className="size-4 text-warning-foreground" aria-hidden />
            {t('title')}
          </DialogTitle>
          <DialogDescription>
            {data
              ? t('description', {
                  local: data.local?.hidden
                    ? t('hiddenRecord')
                    : (data.local?.reference ?? data.local?.title ?? ''),
                  remote: data.remoteRef ?? '',
                  system,
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="grid min-w-0 gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ConflictStatusBadge status={data.status} />
              <RemoteCell remoteRef={data.remoteRef} remoteUrl={data.remoteUrl} />
            </div>
            {fields.map((f) => {
              const chosen = choices[f.field] ?? data.choices?.[f.field];
              return (
                <fieldset
                  key={f.field}
                  className="grid min-w-0 gap-2 rounded-lg border p-3"
                  disabled={!editable}
                >
                  <legend className="px-1 text-sm font-semibold">{label(f.label, f.field)}</legend>
                  <div className="grid min-w-0 grid-cols-1 gap-2 text-sm md:grid-cols-3">
                    <div className="min-w-0 rounded-md bg-muted/40 p-2">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">{t('base')}</p>
                      <Value field={f} value={f.base} people={people} />
                    </div>
                    {(['local', 'remote'] as const).map((side) => (
                      <label
                        key={side}
                        htmlFor={`${id}-${f.field}-${side}`}
                        className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border p-2 has-checked:border-primary has-checked:bg-primary/5 has-disabled:cursor-default"
                      >
                        <input
                          id={`${id}-${f.field}-${side}`}
                          type="radio"
                          name={`${id}-${f.field}`}
                          value={side}
                          checked={chosen === side}
                          onChange={() => setChoices((c) => ({ ...c, [f.field]: side }))}
                          className="mt-1 size-4 shrink-0 accent-primary"
                        />
                        <span className="grid min-w-0 gap-1">
                          <span className="text-xs font-medium text-muted-foreground">
                            {side === 'local' ? t('inIsbp') : t('inRemote', { system })}
                          </span>
                          <Value field={f} value={side === 'local' ? f.local : f.remote} people={people} />
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            {data.local?.hidden && <p className="text-sm text-muted-foreground">{t('hiddenHint')}</p>}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={close}>
            {editable ? tc('cancel') : tc('close')}
          </Button>
          {editable && (
            <>
              <Button
                variant="outline"
                loading={dismiss.isPending}
                onClick={() => dismiss.mutate(undefined, { onError: (e) => setError(errorText(e)) })}
              >
                {t('keepBoth')}
              </Button>
              <Button
                loading={resolve.isPending}
                disabled={!complete}
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
              >
                {t('apply')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
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
  const status: ConflictStatus = CONFLICT_STATUSES.includes(state.status as ConflictStatus)
    ? (state.status as ConflictStatus)
    : 'open';
  const { data, isLoading, isFetching } = useApiQuery<Page<ConflictSummary>>('/integrations/conflicts', {
    connectionId,
    status,
    page: state.page,
    pageSize: state.pageSize,
  });
  const open = typeof state.conflict === 'string' ? state.conflict : null;

  const columns = useMemo<ColumnDef<ConflictSummary, unknown>[]>(
    () => [
      {
        id: 'local',
        header: t('record'),
        meta: { className: 'max-w-72' },
        cell: ({ row }) => <LocalCell local={row.original.local} />,
      },
      {
        id: 'remote',
        header: t('remote'),
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <RemoteCell remoteRef={row.original.remoteRef} remoteUrl={row.original.remoteUrl} />
            {!connectionId && (
              <span className="truncate text-xs text-muted-foreground">{row.original.connection.name}</span>
            )}
          </span>
        ),
      },
      {
        id: 'fields',
        header: t('fields'),
        meta: { className: 'hidden md:table-cell max-w-56', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <span className="truncate font-mono text-xs">{row.original.fields.join(', ')}</span>
        ),
      },
      {
        id: 'status',
        header: tc('status'),
        cell: ({ row }) => <ConflictStatusBadge status={row.original.status} />,
      },
      {
        id: 'when',
        header: t('when'),
        meta: { className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
        cell: ({ row }) => (
          <span className="flex flex-col text-xs">
            <RelativeTime date={row.original.resolvedAt ?? row.original.createdAt} />
            {row.original.resolvedBy && (
              <span className="text-muted-foreground">{row.original.resolvedBy.displayName}</span>
            )}
          </span>
        ),
      },
      {
        id: 'open',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant={row.original.status === 'open' ? 'default' : 'outline'}
            onClick={(e) => {
              e.stopPropagation();
              set({ conflict: row.original.id, page: state.page });
            }}
            // The accessible name starts with the visible label (WCAG 2.5.3).
            aria-label={t(row.original.status === 'open' ? 'resolveFor' : 'viewFor', {
              ref: row.original.remoteRef ?? '',
            })}
          >
            {row.original.status === 'open' ? t('resolve') : t('view')}
          </Button>
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
      <Tabs value={status} onValueChange={(v) => set({ status: v === 'open' ? undefined : v })}>
        <TabsList aria-label={t('filter')}>
          {CONFLICT_STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {ts(s)}
            </TabsTrigger>
          ))}
        </TabsList>
        {CONFLICT_STATUSES.map((s) => (
          <TabsContent key={s} value={s} className="min-w-0">
            {s === status && table}
          </TabsContent>
        ))}
      </Tabs>
      <ResolveDialog
        conflictId={open}
        onOpenChange={(o) => !o && set({ conflict: undefined, page: state.page })}
      />
    </>
  );
}
