'use client';

import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import type { ColumnDef } from '@tanstack/react-table';
import {
  EllipsisIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  LinkIcon,
  RefreshCwIcon,
  SearchXIcon,
  UnlinkIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { LINK_STATES, type Link as LinkDto, type LinkState } from '../contracts';
import { LinkStateBadge } from './badges';
import { ConfirmDialog } from './confirm-dialog';
import { INVALIDATE, runHref } from './lib';

const VIEWS = ['all', ...LINK_STATES] as const;
type View = (typeof VIEWS)[number];

/** The local side: a link to the record, or a note that the viewer can't see it (or it isn't created yet). */
export function LocalCell({ local }: { local: LinkDto['local'] }) {
  const t = useTranslations('integrations.links');
  if (!local) return <span className="text-sm text-muted-foreground">{t('notCreated')}</span>;
  if (local.hidden)
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <EyeOffIcon className="size-3.5" aria-hidden />
        {t('hidden')}
      </span>
    );
  const text = (
    <>
      {local.reference && (
        <span className="mr-1.5 font-mono text-xs text-muted-foreground">{local.reference}</span>
      )}
      {local.title}
    </>
  );
  return local.href ? (
    <Link
      href={local.href}
      onClick={(e) => e.stopPropagation()}
      className="block truncate text-sm font-medium outline-none hover:underline focus-visible:underline"
    >
      {text}
    </Link>
  ) : (
    <span className="block truncate text-sm font-medium">{text}</span>
  );
}

/** The remote side, opening the outside system in a new tab. */
export function RemoteCell({
  remoteRef,
  remoteUrl,
  title,
}: {
  remoteRef: string | null;
  remoteUrl: string | null;
  title?: string | null;
}) {
  const t = useTranslations('integrations.links');
  const label = remoteRef ?? '—';
  return (
    <span className="flex min-w-0 flex-col">
      {remoteUrl ? (
        <a
          href={remoteUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex w-fit items-center gap-1 font-mono text-sm text-primary outline-none hover:underline focus-visible:underline"
        >
          {label}
          <ExternalLinkIcon className="size-3" aria-hidden />
          <span className="sr-only">{t('opensNewTab')}</span>
        </a>
      ) : (
        <span className="font-mono text-sm">{label}</span>
      )}
      {title && <span className="truncate text-xs text-muted-foreground">{title}</span>}
    </span>
  );
}

function RelinkDialog({
  link,
  onOpenChange,
}: {
  link: LinkDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('integrations.links');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const id = useId();
  const [remoteId, setRemoteId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const relink = useApiMutation(
    (api, v: { id: string; remoteId: string }) =>
      api.post(`/integrations/links/${v.id}/relink`, { remoteId: v.remoteId }),
    { invalidate: INVALIDATE, success: t('relinked'), silent: true, onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog
      open={link !== null}
      onOpenChange={(open) => {
        if (!open) {
          setRemoteId('');
          setError(null);
        }
        onOpenChange(open);
      }}
    >
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('relinkTitle')}</DialogTitle>
          <DialogDescription>
            {t('relinkDescription', { ref: link?.remoteRef ?? link?.remoteId ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!link || !remoteId.trim()) return;
            relink.mutate(
              { id: link.id, remoteId: remoteId.trim() },
              { onError: (err) => setError(errorText(err)) },
            );
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-remote`}>{t('remoteId')}</Label>
            <Input
              id={`${id}-remote`}
              value={remoteId}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              aria-describedby={`${id}-hint`}
              onChange={(e) => setRemoteId(e.target.value)}
            />
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              {t('remoteIdHint')}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={relink.isPending} disabled={!remoteId.trim()}>
              {t('relink')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Linked records of a connection: filter by state, open either side, sync, relink or unlink. */
export function LinksTable({
  connectionId,
  state,
  set,
}: {
  connectionId: string;
  state: ListState;
  set: (patch: Partial<ListState>) => void;
}) {
  const t = useTranslations('integrations.links');
  const tl = useTranslations('integrations.linkState');
  const tc = useTranslations('common');
  const router = useRouter();
  const canManage = useCan('integrations.connections.manage');
  const view: View = VIEWS.includes(state.state as View) ? (state.state as View) : 'all';
  const [relinking, setRelinking] = useState<LinkDto | null>(null);
  const [unlinking, setUnlinking] = useState<LinkDto | null>(null);
  const { data, isLoading, isFetching } = useApiQuery<Page<LinkDto>>('/integrations/links', {
    connectionId,
    state: view === 'all' ? undefined : (view as LinkState),
    q: state.q,
    sort: state.sort,
    page: state.page,
    pageSize: state.pageSize,
  });
  const resync = useApiMutation(
    (api, id: string) => api.post<{ runId: string }>(`/integrations/links/${id}/resync`),
    {
      invalidate: INVALIDATE,
      success: t('syncRequested'),
      onSuccess: (r) => router.push(runHref(r.runId)),
    },
  );
  const unlink = useApiMutation((api, id: string) => api.delete(`/integrations/links/${id}`), {
    invalidate: INVALIDATE,
    success: t('unlinked'),
    onSuccess: () => setUnlinking(null),
  });

  const columns = useMemo<ColumnDef<LinkDto, unknown>[]>(
    () => [
      {
        id: 'local',
        header: t('local'),
        meta: { className: 'max-w-72' },
        cell: ({ row }) => <LocalCell local={row.original.local} />,
      },
      {
        id: 'remote',
        header: t('remote'),
        meta: { sortKey: 'remoteRef', className: 'max-w-56' },
        cell: ({ row }) => (
          <RemoteCell
            remoteRef={row.original.remoteRef}
            remoteUrl={row.original.remoteUrl}
            title={row.original.remoteTitle}
          />
        ),
      },
      {
        id: 'state',
        header: tc('status'),
        // Errors wrap instead of widening the table.
        meta: { className: 'min-w-32 max-w-64 whitespace-normal' },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col gap-0.5">
            <LinkStateBadge state={row.original.state} />
            {row.original.lastError && (
              <span className="line-clamp-2 text-xs break-words text-destructive">
                {row.original.lastError.message}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'profile',
        header: t('profile'),
        meta: { className: 'hidden xl:table-cell max-w-48', headerClassName: 'hidden xl:table-cell' },
        cell: ({ row }) => <span className="truncate text-sm">{row.original.profileName}</span>,
      },
      {
        id: 'synced',
        header: t('lastSynced'),
        meta: {
          sortKey: 'lastSyncedAt',
          className: 'hidden sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.lastSyncedAt} />,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        meta: { className: 'w-10' },
        cell: ({ row }) =>
          canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('actionsFor', { ref: row.original.remoteRef ?? row.original.remoteId })}
                  onClick={(e) => e.stopPropagation()}
                >
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem
                  onSelect={() => resync.mutate(row.original.id)}
                  disabled={row.original.state === 'orphaned'}
                >
                  <RefreshCwIcon /> {t('syncNow')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRelinking(row.original)} disabled={!row.original.local}>
                  <LinkIcon /> {t('relink')}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setUnlinking(row.original)}>
                  <UnlinkIcon /> {t('unlink')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
      },
    ],
    [t, tc, canManage, resync],
  );

  const table = (
    <DataTable
      label={t('title')}
      columns={columns}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      sort={state.sort}
      loading={isLoading}
      fetching={isFetching}
      getRowId={(l) => l.id}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      onSortChange={(sort) => set({ sort })}
      toolbar={
        <SearchInput
          value={state.q ?? ''}
          onChange={(q) => set({ q })}
          placeholder={t('search')}
          className="sm:w-72"
        />
      }
      empty={
        <EmptyState
          icon={state.q ? <SearchXIcon /> : <LinkIcon />}
          title={state.q || view !== 'all' ? t('emptyFiltered') : t('empty')}
          description={t('emptyHint')}
        />
      }
    />
  );

  return (
    <>
      <Tabs value={view} onValueChange={(v) => set({ state: v === 'all' ? undefined : v })}>
        <TabsList aria-label={t('filter')}>
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {v === 'all' ? tc('all') : tl(v)}
            </TabsTrigger>
          ))}
        </TabsList>
        {VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="min-w-0">
            {v === view && table}
          </TabsContent>
        ))}
      </Tabs>
      <RelinkDialog link={relinking} onOpenChange={(open) => !open && setRelinking(null)} />
      <ConfirmDialog
        open={unlinking !== null}
        onOpenChange={(open) => !open && setUnlinking(null)}
        title={t('unlinkTitle', { ref: unlinking?.remoteRef ?? unlinking?.remoteId ?? '' })}
        description={t('unlinkDescription')}
        confirmLabel={t('unlink')}
        destructive
        loading={unlink.isPending}
        onConfirm={() => unlinking && unlink.mutate(unlinking.id)}
      />
    </>
  );
}
