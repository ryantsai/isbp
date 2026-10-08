'use client';

import type { Page } from '@isbp/sdk';
import { useApi, type WebPageProps } from '@isbp/sdk/web';
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
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { DataTable, type DataTableColumn, type DataTableSelection, useListState } from '@isbp/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RecordValues } from '@isbp/ui/record-picker';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  ArrowLeftIcon,
  BadgeCheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  FileQuestionIcon,
  FileUpIcon,
  ListChecksIcon,
  PlusIcon,
  SendIcon,
  TicketIcon,
  Undo2Icon,
  XCircleIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { REVIEW_ITEM_VIEWS, type Review, type ReviewItem } from '../../contracts';
import { AccountStateText, DecisionBadge, PrivilegeBadge, ProgressBar, ReviewStatusBadge } from '../badges';
import { apiUrl, INVALIDATE, useDay } from '../lib';
import { AddAccountDialog, DecideDialog, ImportAccountsDialog } from '../review-dialogs';
import { SignOffDialog } from '../stocktake-dialogs';

type View = (typeof REVIEW_ITEM_VIEWS)[number];
const NO_SELECTION: DataTableSelection = {};

/** One account review: the accounts and decisions, import, completion, sign-off, tickets and export. */
export default function ReviewPage({ params }: WebPageProps) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const api = useApi();
  const day = useDay();
  const locale = useLocale();
  const [state, set] = useListState({ pageSize: 50 });
  const view: View = REVIEW_ITEM_VIEWS.includes(state.view as View) ? (state.view as View) : 'all';
  const {
    data: r,
    isLoading,
    error,
  } = useApiQuery<Review>(`/isms/reviews/${encodeURIComponent(params.ref ?? '')}`);
  const items = useApiQuery<Page<ReviewItem>>(r ? `/isms/reviews/${r.reference}/items` : null, {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    view,
  });
  const [selection, setSelection] = useState<DataTableSelection>(NO_SELECTION);
  const [deciding, setDeciding] = useState<ReviewItem[]>([]);
  const [dialog, setDialog] = useState<'import' | 'add' | 'signoff' | 'cancel' | null>(null);
  const post = (path: string, body?: Record<string, unknown>) =>
    api.post<Review>(`/isms/reviews/${r?.reference}/${path}`, body ?? {});
  const done = { invalidate: INVALIDATE, onSuccess: () => setDialog(null) };
  const complete = useApiMutation(() => post('complete'), { ...done, success: t('review.completed') });
  const reopen = useApiMutation(() => post('reopen'), { ...done, success: t('review.reopened') });
  const signOff = useApiMutation((_a, body: { note: string | null }) => post('sign-off', body), {
    ...done,
    success: t('review.signedOff'),
  });
  const cancel = useApiMutation(() => post('cancel'), { ...done, success: t('review.cancelled') });
  const tickets = useApiMutation(
    () => api.post<{ raised: number; failed: number }>(`/isms/reviews/${r?.reference}/tickets`, {}),
    { invalidate: INVALIDATE, success: (res) => t('review.ticketsRaised', res) },
  );

  const canDecide = Boolean(r?.viewer.canDecide);
  const columns = useMemo<DataTableColumn<ReviewItem>[]>(
    () => [
      {
        id: 'account',
        header: t('fields.account'),
        meta: { className: 'max-w-48 font-mono text-sm' },
        cell: ({ row }) => <span className="block truncate">{row.original.accountName}</span>,
      },
      {
        id: 'user',
        header: t('fields.userName'),
        meta: { className: 'hidden max-w-52 sm:table-cell', headerClassName: 'hidden sm:table-cell' },
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="block truncate">
              {row.original.userName ?? row.original.user?.displayName ?? '—'}
            </span>
            {row.original.user &&
              row.original.userName &&
              row.original.user.displayName !== row.original.userName && (
                <span className="block truncate text-xs text-muted-foreground">
                  {row.original.user.displayName}
                </span>
              )}
            {row.original.detail && (
              <span className="block truncate text-xs text-muted-foreground">{row.original.detail}</span>
            )}
          </span>
        ),
      },
      {
        id: 'privilege',
        header: t('fields.privilege'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <PrivilegeBadge privilege={row.original.privilege} />,
      },
      {
        id: 'state',
        header: t('fields.accountState'),
        meta: { className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) => <AccountStateText state={row.original.accountStatus} />,
      },
      {
        id: 'decision',
        header: t('fields.decision'),
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col gap-0.5">
            <DecisionBadge decision={row.original.decision} />
            {row.original.doneOn && (
              <span className="text-xs text-muted-foreground">
                {t('review.doneOn', { date: day(row.original.doneOn) })}
              </span>
            )}
            {row.original.decision && row.original.decision !== 'keep' && !row.original.doneOn && (
              <span className="text-xs text-warning-foreground">{t('review.notDoneYet')}</span>
            )}
            {row.original.ticket &&
              (row.original.ticket.href ? (
                <Link href={row.original.ticket.href} className="text-xs underline">
                  {row.original.ticket.reference}
                </Link>
              ) : (
                <span className="text-xs">{row.original.ticket.reference}</span>
              ))}
          </span>
        ),
      },
      {
        id: 'note',
        header: t('fields.note'),
        meta: { className: 'hidden max-w-56 xl:table-cell', headerClassName: 'hidden xl:table-cell' },
        cell: ({ row }) => (
          <span className="block truncate text-sm text-muted-foreground">{row.original.note ?? ''}</span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        cell: ({ row }) =>
          canDecide && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setDeciding([row.original]);
              }}
              aria-label={t('decide.openFor', { account: row.original.accountName })}
            >
              {t('decide.open')}
            </Button>
          ),
      },
    ],
    [t, tc, day, canDecide],
  );

  if (isLoading) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (error || !r) return <EmptyState icon={<FileQuestionIcon />} title={t('review.notFound')} />;
  const p = r.progress;
  const selected = (items.data?.items ?? []).filter((i) => selection[i.id]);
  const table = (
    <DataTable
      label={t('review.items')}
      columns={columns}
      data={items.data?.items ?? []}
      total={items.data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      loading={items.isLoading}
      fetching={items.isFetching}
      getRowId={(i) => i.id}
      selectable={canDecide}
      selection={selection}
      onSelectionChange={setSelection}
      onPageChange={(page) => set({ page })}
      onPageSizeChange={(pageSize) => set({ pageSize })}
      toolbar={
        <>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder={t('review.search')}
            className="sm:w-64"
          />
          {canDecide && selected.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setDeciding(selected)}>
              {t('decide.selected', { count: selected.length })}
            </Button>
          )}
        </>
      }
      empty={
        <EmptyState
          icon={<ListChecksIcon />}
          title={t('review.noItems')}
          description={canDecide ? t('review.noItemsHint') : undefined}
        />
      }
    />
  );

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/isms/reviews">
          <ArrowLeftIcon /> {t('reviews.title')}
        </Link>
      </Button>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-mono text-sm text-muted-foreground">{r.reference}</p>
          <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{r.target}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <ReviewStatusBadge status={r.status} overdue={r.overdue} />
            <span>{t('review.reviewer', { name: r.reviewer?.displayName ?? '—' })}</span>
            <span>· {t('stocktakes.dueOn', { date: day(r.dueOn) })}</span>
            {r.recurrence !== 'none' && <span>· {t(`recurrence.${r.recurrence}`)}</span>}
          </div>
          {r.targetRef && <RecordValues refs={[r.targetRef]} />}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href={apiUrl(`/isms/reviews/${r.reference}/export.csv`, { locale })} download>
              <DownloadIcon /> {t('review.export')}
            </a>
          </Button>
          {canDecide && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  {t('review.accounts')} <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDialog('import')}>
                  <FileUpIcon /> {t('review.import')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog('add')}>
                  <PlusIcon /> {t('review.add')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {r.viewer.canRaiseTickets && p.byDecision.disable + p.byDecision.delete > 0 && (
            <Button variant="outline" loading={tickets.isPending} onClick={() => tickets.mutate(undefined)}>
              <TicketIcon /> {t('review.raiseTickets')}
            </Button>
          )}
          {canDecide && (
            <Button
              disabled={p.decided < p.total || !p.total}
              loading={complete.isPending}
              onClick={() => complete.mutate(undefined)}
            >
              <SendIcon /> {t('review.complete')}
            </Button>
          )}
          {r.status === 'completed' && (r.viewer.canSignOff || r.viewer.canManage) && (
            <Button variant="outline" loading={reopen.isPending} onClick={() => reopen.mutate(undefined)}>
              <Undo2Icon /> {t('review.reopen')}
            </Button>
          )}
          {r.viewer.canSignOff && (
            <Button onClick={() => setDialog('signoff')}>
              <BadgeCheckIcon /> {t('review.signOff')}
            </Button>
          )}
          {r.viewer.canManage && r.status !== 'signed_off' && r.status !== 'cancelled' && (
            <Button variant="ghost" onClick={() => setDialog('cancel')}>
              <XCircleIcon /> {t('review.cancel')}
            </Button>
          )}
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('fields.progress')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProgressBar
            done={p.decided}
            total={p.total}
            label={t('reviews.progressLabel', { target: r.target })}
          />
          <p className="text-sm text-muted-foreground">
            {t('review.summary', { ...p.byDecision, undecided: p.total - p.decided })}
          </p>
          {canDecide && p.decided < p.total && (
            <p className="text-sm text-muted-foreground">{t('review.completeWhenDone')}</p>
          )}
          {r.status === 'completed' && <p className="text-sm">{t('review.waitingSignOff')}</p>}
          {r.signedOffBy && (
            <p className="text-sm">
              {t('review.signedOffBy', { name: r.signedOffBy.displayName })}
              {r.signOffNote ? ` — ${r.signOffNote}` : ''}
            </p>
          )}
        </CardContent>
      </Card>
      {r.status === 'scheduled' ? (
        <p className="text-sm text-muted-foreground">{t('review.scheduled', { date: day(r.startOn) })}</p>
      ) : (
        <Tabs
          value={view}
          onValueChange={(v) => set({ view: v === 'all' ? undefined : v })}
          className="gap-4"
        >
          <TabsList className="max-w-full justify-start overflow-x-auto">
            {REVIEW_ITEM_VIEWS.map((v) => (
              <TabsTrigger key={v} value={v}>
                {t(`review.views.${v}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {REVIEW_ITEM_VIEWS.map((v) => (
            <TabsContent key={v} value={v} className="min-w-0">
              {view === v && table}
            </TabsContent>
          ))}
        </Tabs>
      )}
      <DecideDialog
        // A fresh form for every set of accounts (it starts from their current decision).
        key={deciding.map((i) => i.id).join(',')}
        review={r.reference}
        items={deciding}
        onOpenChange={(o) => {
          if (!o) {
            setDeciding([]);
            setSelection(NO_SELECTION);
          }
        }}
      />
      {canDecide && (
        <>
          <ImportAccountsDialog
            review={r.reference}
            open={dialog === 'import'}
            onOpenChange={(o) => setDialog(o ? 'import' : null)}
          />
          <AddAccountDialog
            review={r.reference}
            open={dialog === 'add'}
            onOpenChange={(o) => setDialog(o ? 'add' : null)}
          />
        </>
      )}
      <SignOffDialog
        open={dialog === 'signoff'}
        onOpenChange={(o) => setDialog(o ? 'signoff' : null)}
        title={t('review.signOffTitle', { reference: r.reference })}
        description={t('review.signOffDescription')}
        onConfirm={(note) => signOff.mutate({ note })}
        pending={signOff.isPending}
      />
      <AlertDialog open={dialog === 'cancel'} onOpenChange={(o) => setDialog(o ? 'cancel' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('review.cancelTitle', { reference: r.reference })}</AlertDialogTitle>
            <AlertDialogDescription>{t('review.cancelDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('back')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                cancel.mutate(undefined);
              }}
            >
              {t('review.cancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
