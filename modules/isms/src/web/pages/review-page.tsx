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
import { useListState } from '@isbp/ui/data-table';
import {
  DecisionDone,
  DecisionList,
  type DecisionOption,
  DecisionProgress,
  DecisionViews,
} from '@isbp/ui/decision-list';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RecordValues } from '@isbp/ui/record-picker';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import {
  BadgeCheckIcon,
  BanIcon,
  CheckIcon,
  DownloadIcon,
  FileUpIcon,
  ListChecksIcon,
  PlusIcon,
  SendIcon,
  TicketIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  UserCheckIcon,
  XCircleIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { REVIEW_DECISIONS, type Review, type ReviewItem } from '../../contracts';
import { AccountStateText, DecisionBadge, PrivilegeBadge, ReviewStatusBadge } from '../badges';
import { apiUrl, download, INVALIDATE, useDay } from '../lib';
import { AddAccountDialog, DecideDialog, ImportAccountsDialog } from '../review-dialogs';
import { SignOffDialog } from '../stocktake-dialogs';

const VIEWS = ['todo', 'done', 'all'] as const;
type View = (typeof VIEWS)[number];
type Decision = (typeof REVIEW_DECISIONS)[number];
const FILTERS = [...REVIEW_DECISIONS, 'admin'] as const;
type Filter = (typeof FILTERS)[number];

/** The account and what the reviewer needs to decide about it, with a warning when the decision isn't done yet. */
function AccountSummary({ item }: { item: ReviewItem }) {
  const t = useTranslations('isms');
  const day = useDay();
  const who = item.userName ?? item.user?.displayName;
  // Recorded as done, yet the latest import still lists the account as enabled: what an auditor looks for.
  const stillEnabled =
    item.decision !== null && item.decision !== 'keep' && item.doneOn && item.accountStatus === 'enabled';
  return (
    <div className="grid min-w-0 gap-1">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono font-medium wrap-break-word">{item.accountName}</span>
        <PrivilegeBadge privilege={item.privilege} />
      </p>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {who && <span className="wrap-break-word">{who}</span>}
        {item.user && item.userName && item.user.displayName !== item.userName && (
          <span className="wrap-break-word">({item.user.displayName})</span>
        )}
        <AccountStateText state={item.accountStatus} />
        {item.detail && <span className="wrap-break-word">{item.detail}</span>}
      </p>
      {item.decision && item.decision !== 'keep' && (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {item.doneOn ? (
            <span className="text-muted-foreground">{t('review.doneOn', { date: day(item.doneOn) })}</span>
          ) : (
            <span className="font-medium text-warning-foreground">{t('review.notDoneYet')}</span>
          )}
          {item.ticket &&
            (item.ticket.href ? (
              <Link href={item.ticket.href} className="underline">
                {t('review.ticket', { reference: item.ticket.reference })}
              </Link>
            ) : (
              <span>{t('review.ticket', { reference: item.ticket.reference })}</span>
            ))}
        </p>
      )}
      {stillEnabled && (
        <p className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground">
          <TriangleAlertIcon className="size-3.5" aria-hidden />
          {t(`review.stillEnabled.${item.decision as 'disable' | 'delete'}`)}
        </p>
      )}
      {item.note && <p className="text-xs wrap-break-word text-muted-foreground">{item.note}</p>}
    </div>
  );
}

/** One account review: the accounts with Keep / Disable / Delete inline, then sending for sign-off. */
export default function ReviewPage({ params }: WebPageProps) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const api = useApi();
  const day = useDay();
  const locale = useLocale();
  const [state, set] = useListState({ pageSize: 25 });
  const review = useApiQuery<Review>(`/isms/reviews/${encodeURIComponent(params.ref ?? '')}`);
  const r = review.data;
  const view: View = VIEWS.includes(state.view as View)
    ? (state.view as View)
    : r?.viewer.canDecide && r.progress.decided < r.progress.total
      ? 'todo'
      : 'all';
  const filter = FILTERS.includes(state.filter as Filter) ? (state.filter as Filter) : undefined;
  const items = useApiQuery<Page<ReviewItem>>(r ? `/isms/reviews/${r.reference}/items` : null, {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    view: view === 'todo' ? 'undecided' : view === 'done' ? (filter ?? 'decided') : (filter ?? 'all'),
  });
  const [dating, setDating] = useState<{ items: ReviewItem[]; decision: 'disable' | 'delete' } | null>(null);
  const [dialog, setDialog] = useState<'import' | 'add' | 'signoff' | 'cancel' | 'tickets' | null>(null);
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
  const keep = useApiMutation(
    (_a, list: ReviewItem[]) =>
      api.post(`/isms/reviews/${r?.reference}/decisions`, {
        itemIds: list.map((i) => i.id),
        decision: 'keep',
      }),
    {
      invalidate: INVALIDATE,
      onSuccess: (_res, list) =>
        toast.success(
          list.length === 1
            ? t('decide.kept', { account: list[0]!.accountName })
            : t('decide.keptMany', { count: list.length }),
        ),
    },
  );
  const tickets = useApiMutation(
    () => api.post<{ raised: number; failed: number }>(`/isms/reviews/${r?.reference}/tickets`, {}),
    { ...done, success: (res) => t('review.ticketsRaised', res) },
  );
  const toTicket = useApiQuery<Page<ReviewItem>>(
    dialog === 'tickets' && r ? `/isms/reviews/${r.reference}/items` : null,
    { view: 'needs_ticket', pageSize: 50 },
  );
  const busy = useMemo(
    () => new Set<string>(keep.isPending ? (keep.variables ?? []).map((i) => i.id) : []),
    [keep.isPending, keep.variables],
  );

  if (review.isLoading) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (review.error) return <ErrorState kind="page" error={review.error} onRetry={() => review.refetch()} />;
  if (!r) return <EmptyState icon={<UserCheckIcon />} title={t('review.notFound')} />;
  const p = r.progress;
  const canDecide = r.viewer.canDecide;
  const allDecided = p.total > 0 && p.decided === p.total;
  const options: DecisionOption<Decision>[] = [
    { value: 'keep', label: t('reviewDecision.keep'), icon: <CheckIcon /> },
    { value: 'disable', label: t('reviewDecision.disable'), icon: <BanIcon /> },
    { value: 'delete', label: t('reviewDecision.delete'), icon: <Trash2Icon />, destructive: true },
  ];
  const filtered = Boolean(state.q || filter);
  const raise = r.viewer.canRaiseTickets && r.viewer.ticketsToRaise > 0;

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: '/isms/reviews', label: t('reviews.title'), highlight: r.id }}
        icon={<UserCheckIcon />}
        reference={r.reference}
        title={r.target}
        status={<ReviewStatusBadge status={r.status} overdue={r.overdue} />}
        meta={
          <span className="grid gap-1">
            <span>
              {[
                t('review.reviewer', { name: r.reviewer?.displayName ?? '—' }),
                t('stocktakes.dueOn', { date: day(r.dueOn) }),
                r.recurrence !== 'none' ? t(`recurrence.${r.recurrence}`) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {r.targetRef && <RecordValues refs={[r.targetRef]} />}
          </span>
        }
        primaryAction={
          canDecide ? (
            <Button
              disabled={!allDecided}
              loading={complete.isPending}
              onClick={() => complete.mutate(undefined)}
            >
              <SendIcon /> {t('review.complete')}
            </Button>
          ) : r.viewer.canSignOff ? (
            <Button onClick={() => setDialog('signoff')}>
              <BadgeCheckIcon /> {t('review.signOff')}
            </Button>
          ) : undefined
        }
        actions={
          raise
            ? [
                {
                  id: 'tickets',
                  label: t('review.raiseTickets', { count: r.viewer.ticketsToRaise }),
                  icon: <TicketIcon />,
                  onSelect: () => setDialog('tickets'),
                },
              ]
            : []
        }
        menu={[
          {
            id: 'export',
            label: t('review.export'),
            icon: <DownloadIcon />,
            onSelect: () => download(apiUrl(`/isms/reviews/${r.reference}/export.csv`, { locale })),
          },
          ...(canDecide
            ? [
                {
                  id: 'import',
                  label: t('review.import'),
                  icon: <FileUpIcon />,
                  onSelect: () => setDialog('import'),
                },
                { id: 'add', label: t('review.add'), icon: <PlusIcon />, onSelect: () => setDialog('add') },
              ]
            : []),
          ...(r.status === 'completed' && (r.viewer.canSignOff || r.viewer.canManage)
            ? [
                {
                  id: 'reopen',
                  label: t('review.reopen'),
                  icon: <Undo2Icon />,
                  onSelect: () => reopen.mutate(undefined),
                },
              ]
            : []),
          ...(r.viewer.canManage && r.status !== 'signed_off' && r.status !== 'cancelled'
            ? [
                {
                  id: 'cancel',
                  label: t('review.cancel'),
                  icon: <XCircleIcon />,
                  destructive: true,
                  onSelect: () => setDialog('cancel'),
                },
              ]
            : []),
        ]}
      />
      <DecisionProgress
        done={p.decided}
        total={p.total}
        label={t('reviews.progressLabel', { target: r.target })}
        valueText={t('review.progressValue', { done: p.decided, total: p.total })}
        summary={t('review.summary', { ...p.byDecision, undecided: p.total - p.decided })}
      >
        {canDecide && !allDecided && p.total > 0 && (
          <p className="text-sm text-muted-foreground">{t('review.completeWhenDone')}</p>
        )}
        {r.status === 'completed' && (
          <p className="text-sm">
            {t('review.waitingSignOff', {
              name: r.completedBy?.displayName ?? r.reviewer?.displayName ?? '',
            })}
          </p>
        )}
        {r.signedOffBy && (
          <p className="text-sm">
            {t('review.signedOffBy', { name: r.signedOffBy.displayName })}
            {r.signOffNote ? ` — ${r.signOffNote}` : ''}
          </p>
        )}
      </DecisionProgress>
      {r.status === 'scheduled' ? (
        <p className="text-sm text-muted-foreground">{t('review.scheduled', { date: day(r.startOn) })}</p>
      ) : (
        <>
          {canDecide && allDecided && view === 'todo' && (
            <DecisionDone title={t('review.allDecided')} description={t('review.allDecidedHint')} />
          )}
          <DecisionViews
            value={view}
            onValueChange={(v) => set({ view: v, filter: undefined })}
            label={t('review.items')}
            views={[
              { value: 'todo', label: t('review.views.todo'), count: p.total - p.decided },
              { value: 'done', label: t('review.views.done') },
              { value: 'all', label: t('review.views.all') },
            ]}
            actions={
              <>
                {view !== 'todo' && (
                  <Select
                    value={filter ?? 'any'}
                    onValueChange={(v) => set({ filter: v === 'any' ? undefined : v })}
                  >
                    <SelectTrigger className="w-full sm:w-44" aria-label={t('review.filter')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">{t('review.anyDecision')}</SelectItem>
                      {FILTERS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f === 'admin' ? t('review.views.admin') : t(`reviewDecision.${f}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <SearchInput
                  value={state.q ?? ''}
                  onChange={(q) => set({ q })}
                  placeholder={t('review.search')}
                  className="sm:w-56"
                />
              </>
            }
          >
            <DecisionList<ReviewItem, Decision>
              label={t('review.items')}
              items={items.data?.items ?? []}
              getId={(i) => i.id}
              renderItem={(i) => <AccountSummary item={i} />}
              options={options}
              decisionOf={(i) => i.decision}
              canDecide={() => canDecide}
              renderResult={(i) => <DecisionBadge decision={i.decision} />}
              optionLabel={(o, i) => t(`decide.for.${o.value}`, { account: i.accountName })}
              groupLabel={(i) => t('decide.groupFor', { account: i.accountName })}
              bulkLabel={(o, count) => t(`decide.selected.${o.value}`, { count })}
              onDecide={(list, decision) => {
                if (decision === 'keep') keep.mutate(list);
                else setDating({ items: list, decision });
              }}
              busy={busy}
              selectable={canDecide}
              loading={items.isLoading}
              error={items.error}
              onRetry={() => items.refetch()}
              total={items.data?.total}
              page={state.page}
              pageSize={state.pageSize}
              onPageChange={(page) => set({ page })}
              empty={
                filtered ? (
                  <EmptyState
                    variant="filtered"
                    onClearFilters={() => set({ q: undefined, filter: undefined })}
                  />
                ) : p.total === 0 ? (
                  <EmptyState
                    icon={<ListChecksIcon />}
                    title={t('review.noItems')}
                    description={canDecide ? t('review.noItemsHint') : undefined}
                    action={
                      canDecide ? (
                        <Button variant="outline" onClick={() => setDialog('import')}>
                          <FileUpIcon /> {t('review.import')}
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <EmptyState variant="compact" title={t(`review.empty.${view}`)} />
                )
              }
            />
          </DecisionViews>
        </>
      )}
      {dating && (
        <DecideDialog
          // A fresh form for every set of accounts (it starts from their current date and note).
          key={`${dating.decision}:${dating.items.map((i) => i.id).join(',')}`}
          review={r.reference}
          items={dating.items}
          decision={dating.decision}
          onOpenChange={(o) => !o && setDating(null)}
        />
      )}
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
      <AlertDialog open={dialog === 'tickets'} onOpenChange={(o) => setDialog(o ? 'tickets' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('review.ticketsTitle', { count: r.viewer.ticketsToRaise })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('review.ticketsDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm">
            {(toTicket.data?.items ?? []).map((i) => (
              <li key={i.id} className="wrap-break-word">
                {t(`review.ticketLine.${i.decision as 'disable' | 'delete'}`, { account: i.accountName })}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                tickets.mutate(undefined);
              }}
            >
              {t('review.raiseTickets', { count: r.viewer.ticketsToRaise })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
