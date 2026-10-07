'use client';

import type { Page } from '@isbp/sdk';
import type { WebPageProps } from '@isbp/sdk/web';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { Button } from '@isbp/ui/button';
import { DataTable, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedNumber } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import {
  ClipboardCheckIcon,
  DownloadIcon,
  FileQuestionIcon,
  LockIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { Review, ReviewItem } from '../../contracts';
import { DecisionBadge, ReviewStatusBadge, RiskBadge } from '../badges';
import { ReasonDialog } from '../dialogs';
import { INVALIDATE, useDate, useDay, useLocalized } from '../lib';
import { ReviewProgress } from '../review-progress';

const VIEWS = ['mine', 'undecided', 'decided', 'all'] as const;
type View = (typeof VIEWS)[number];

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-4 py-3 shadow-xs">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight">
        <AnimatedNumber value={value} />
      </span>
    </div>
  );
}

export default function ReviewPage({ params }: WebPageProps) {
  const t = useTranslations('dbaccess.review');
  const tp = useTranslations('dbaccess.policy');
  const trr = useTranslations('dbaccess.reviewerRule');
  const tc = useTranslations('common');
  const l = useLocalized();
  const day = useDay();
  const date = useDate();
  const id = params.id!;
  const [state, set] = useListState({ pageSize: 50 });
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [revoking, setRevoking] = useState<string[] | null>(null);
  const [closing, setClosing] = useState(false);
  const review = useApiQuery<Review>(`/dbaccess/reviews/${id}`);
  const r = review.data;
  const canManage = Boolean(r?.canManage);
  const defaultView: View = r && r.totals.mine > 0 ? 'mine' : 'all';
  const view: View = VIEWS.includes(state.view as View) ? (state.view as View) : defaultView;
  const items = useApiQuery<Page<ReviewItem>>(r ? `/dbaccess/reviews/${id}/items` : null, {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    view,
  });
  const decide = useApiMutation(
    (api, v: { itemIds: string[]; decision: 'keep' | 'revoke'; comment: string | null }) =>
      api.post<{ updated: number }>(`/dbaccess/reviews/${id}/decisions`, v),
    {
      invalidate: INVALIDATE,
      success: (res) => t('decided', { count: res.updated }),
      onSuccess: () => setSelection({}),
    },
  );
  const close = useApiMutation((api) => api.post<Review>(`/dbaccess/reviews/${id}/close`), {
    invalidate: INVALIDATE,
    success: t('closed'),
  });

  const decidable = useMemo(
    () => new Set((items.data?.items ?? []).filter((i) => i.canDecide).map((i) => i.id)),
    [items.data],
  );
  const selectedIds = Object.keys(selection).filter((k) => selection[k] && decidable.has(k));

  const columns = useMemo<ColumnDef<ReviewItem, unknown>[]>(
    () => [
      {
        id: 'grantee',
        header: t('person'),
        meta: { className: 'max-w-48' },
        cell: ({ row }) => (
          <span className="grid min-w-0">
            <span className="truncate font-medium">{row.original.grantee?.displayName ?? '—'}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {row.original.accountName ?? ''}
            </span>
          </span>
        ),
      },
      {
        id: 'role',
        header: t('access'),
        meta: { className: 'max-w-56' },
        cell: ({ row }) => (
          <span className="grid min-w-0">
            <span className="truncate">{l(row.original.role.name)}</span>
            <span className="truncate text-xs text-muted-foreground">{row.original.server.displayName}</span>
          </span>
        ),
      },
      {
        id: 'risk',
        header: t('risk'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <RiskBadge risk={row.original.role.risk} />,
      },
      {
        id: 'expires',
        header: t('expires'),
        meta: { className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => (row.original.expiresAt ? date(row.original.expiresAt) : t('permanent')),
      },
      {
        id: 'reviewer',
        header: t('reviewer'),
        meta: { className: 'hidden max-w-40 xl:table-cell', headerClassName: 'hidden xl:table-cell' },
        cell: ({ row }) => (
          <span className="block truncate text-sm">{row.original.reviewer?.name ?? t('unassigned')}</span>
        ),
      },
      {
        id: 'decision',
        header: t('decision'),
        meta: { className: 'max-w-56' },
        cell: ({ row }) => (
          <span className="grid min-w-0 gap-0.5">
            <span className="flex flex-wrap items-center gap-1">
              <DecisionBadge decision={row.original.decision} />
              {row.original.outcome && (
                <span className="text-xs text-muted-foreground">{t(`outcome.${row.original.outcome}`)}</span>
              )}
            </span>
            {row.original.comment && (
              <span className="truncate text-xs text-muted-foreground" title={row.original.comment}>
                {row.original.comment}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        cell: ({ row }) =>
          row.original.canDecide ? (
            <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                variant={row.original.decision === 'keep' ? 'secondary' : 'outline'}
                aria-label={t('keepFor', {
                  person: row.original.grantee?.displayName ?? row.original.accountName ?? '',
                })}
                onClick={() => decide.mutate({ itemIds: [row.original.id], decision: 'keep', comment: null })}
              >
                <ThumbsUpIcon />
                <span className="hidden sm:inline">{t('keep')}</span>
              </Button>
              <Button
                size="sm"
                variant={row.original.decision === 'revoke' ? 'secondary' : 'outline'}
                aria-label={t('revokeFor', {
                  person: row.original.grantee?.displayName ?? row.original.accountName ?? '',
                })}
                onClick={() => setRevoking([row.original.id])}
              >
                <ThumbsDownIcon />
                <span className="hidden sm:inline">{t('revoke')}</span>
              </Button>
            </span>
          ) : null,
      },
    ],
    [t, tc, l, date, decide],
  );

  if (review.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!r)
    return (
      <EmptyState
        icon={<FileQuestionIcon />}
        title={t('notFound')}
        action={
          <Button asChild variant="outline">
            <Link href="/dbaccess/reviews">{t('back')}</Link>
          </Button>
        }
      />
    );

  const table = (
    <DataTable
      label={t('items')}
      columns={columns}
      data={items.data?.items ?? []}
      total={items.data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      loading={items.isLoading}
      fetching={items.isFetching}
      getRowId={(i) => i.id}
      selectable={r.status === 'active' && decidable.size > 0}
      selection={selection}
      onSelectionChange={setSelection}
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
          {selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {tc('selectedCount', { count: selectedIds.length })}
              </span>
              <Button
                size="sm"
                variant="outline"
                loading={decide.isPending}
                onClick={() => decide.mutate({ itemIds: selectedIds, decision: 'keep', comment: null })}
              >
                <ThumbsUpIcon /> {t('keepSelected')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRevoking(selectedIds)}>
                <ThumbsDownIcon /> {t('revokeSelected')}
              </Button>
            </div>
          )}
        </>
      }
      empty={<EmptyState icon={<ClipboardCheckIcon />} title={t(`empty.${view}`)} />}
    />
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/dbaccess/reviews" className="hover:underline">
            <span className="font-mono">{r.reference}</span>
          </Link>
        }
        title={r.name}
        description={t('summary', {
          due: day(r.dueOn),
          policy: tp(r.policy),
          reviewers: trr(r.reviewerRule),
        })}
        actions={
          <>
            <ReviewStatusBadge status={r.status} />
            <Button variant="outline" asChild>
              <a href={`/api/v1/dbaccess/reviews/${r.id}/report.csv`} download>
                <DownloadIcon /> {t('export')}
              </a>
            </Button>
            {canManage && r.status === 'active' && (
              <Button variant="outline" onClick={() => setClosing(true)}>
                <LockIcon /> {t('close')}
              </Button>
            )}
          </>
        }
      />
      <div className="grid min-w-0 grid-cols-1 gap-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label={t('totals')}>
          <Tile label={t('tiles.items')} value={r.totals.items} />
          <Tile label={t('tiles.pending')} value={r.totals.pending} />
          <Tile label={t('tiles.kept')} value={r.totals.kept} />
          <Tile label={t('tiles.revoked')} value={r.totals.revoked} />
        </div>
        <ReviewProgress totals={r.totals} />
        {r.status === 'closed' && (
          <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <LockIcon className="size-4 text-muted-foreground" aria-hidden />
            {t('readOnly')}
          </p>
        )}
        <Tabs
          value={view}
          onValueChange={(v) => {
            setSelection({});
            set({ view: v });
          }}
          className="min-w-0"
        >
          <TabsList>
            {VIEWS.map((v) => (
              <TabsTrigger key={v} value={v}>
                {t(`views.${v}`)}
                {v === 'mine' && r.totals.mine > 0 ? ` (${r.totals.mine})` : ''}
              </TabsTrigger>
            ))}
          </TabsList>
          {VIEWS.map((v) => (
            <TabsContent key={v} value={v} className="min-w-0">
              {v === view && table}
            </TabsContent>
          ))}
        </Tabs>
      </div>
      <ReasonDialog
        open={Boolean(revoking)}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('revokeTitle', { count: revoking?.length ?? 0 })}
        description={t('revokeDescription')}
        confirmLabel={t('revoke')}
        pending={decide.isPending}
        onConfirm={(comment) => decide.mutateAsync({ itemIds: revoking ?? [], decision: 'revoke', comment })}
      />
      <AlertDialog open={closing} onOpenChange={setClosing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('closeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('closeDescription', { pending: r.totals.pending, policy: tp(r.policy) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => close.mutate(undefined)}>{t('close')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
