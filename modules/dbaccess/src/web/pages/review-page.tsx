'use client';

import type { Page } from '@isbp/sdk';
import { useCan, type WebPageProps } from '@isbp/sdk/web';
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
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import {
  ClipboardCheckIcon,
  DownloadIcon,
  LockIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { Review, ReviewDecision, ReviewItem } from '../../contracts';
import { DecisionBadge, ReviewStatusBadge, RiskBadge } from '../badges';
import { ReasonDialog } from '../dialogs';
import { INVALIDATE, useDate, useDay, useLocalized } from '../lib';

const VIEWS = ['todo', 'done', 'all'] as const;
type View = (typeof VIEWS)[number];
type Scope = 'mine' | 'everyone';
const API_VIEW: Record<View, 'undecided' | 'decided' | 'all'> = {
  todo: 'undecided',
  done: 'decided',
  all: 'all',
};

function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.click();
}

/** Who has it, what it is, why they have it and whether they use it: what a reviewer needs to decide. */
function GrantSummary({ item, showReviewer }: { item: ReviewItem; showReviewer: boolean }) {
  const t = useTranslations('dbaccess.review');
  const l = useLocalized();
  const date = useDate();
  const why = [
    item.grantedAt
      ? item.reason
        ? t('grantedFor', { date: date(item.grantedAt), reason: item.reason })
        : t('granted', { date: date(item.grantedAt) })
      : null,
    item.expiresAt ? t('endsOn', { date: date(item.expiresAt) }) : t('permanent'),
  ].filter(Boolean);
  return (
    <div className="grid min-w-0 gap-1">
      <p className="font-medium wrap-break-word">
        {item.grantee?.displayName ?? item.accountName ?? '—'}
        {item.grantee && item.accountName && (
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{item.accountName}</span>
        )}
      </p>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <span className="wrap-break-word text-foreground">{l(item.role.name)}</span>
        <span aria-hidden>·</span>
        <span className="wrap-break-word">{item.server.displayName}</span>
        <RiskBadge risk={item.role.risk} />
      </p>
      <p className="text-xs wrap-break-word text-muted-foreground">
        {why.join(' · ')}
        {item.signIn.known && (
          <>
            {' · '}
            {item.signIn.lastAt ? (
              <span>
                {t('lastSignIn')} <RelativeTime date={item.signIn.lastAt} />
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-warning-foreground">
                <TriangleAlertIcon className="size-3.5" aria-hidden />
                {t('neverSignedIn')}
              </span>
            )}
          </>
        )}
      </p>
      {showReviewer && (
        <p className="text-xs text-muted-foreground">
          {t('reviewerIs', { name: item.reviewer?.name ?? t('unassigned') })}
        </p>
      )}
    </div>
  );
}

/** One access review: progress, the reviewer's grants first with Keep / Revoke, export and closing. */
export default function ReviewPage({ params }: WebPageProps) {
  const t = useTranslations('dbaccess.review');
  const tp = useTranslations('dbaccess.policy');
  const trr = useTranslations('dbaccess.reviewerRule');
  const tc = useTranslations('common');
  const day = useDay();
  const ref = params.id!;
  const [state, set] = useListState({ pageSize: 25 });
  const [revoking, setRevoking] = useState<string[] | null>(null);
  const [closing, setClosing] = useState(false);
  const canRead = useCan('dbaccess.reviews.read');
  const canManageAll = useCan('dbaccess.reviews.manage');
  const canSeeAll = canRead || canManageAll;
  const review = useApiQuery<Review>(`/dbaccess/reviews/${encodeURIComponent(ref)}`);
  const r = review.data;
  const participant = Boolean(r && r.totals.mineTotal > 0);
  // Old links say `?view=mine`: the person's own grants to decide.
  const legacyMine = state.view === 'mine';
  const view: View = VIEWS.includes(state.view as View)
    ? (state.view as View)
    : legacyMine || (r && r.totals.mine > 0)
      ? 'todo'
      : 'all';
  const scope: Scope =
    legacyMine || state.scope === 'mine' || (state.scope !== 'everyone' && participant) ? 'mine' : 'everyone';
  const items = useApiQuery<Page<ReviewItem>>(r ? `/dbaccess/reviews/${r.reference}/items` : null, {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    view: API_VIEW[view],
    mine: scope === 'mine' ? 'true' : undefined,
  });
  const decide = useApiMutation(
    (api, v: { itemIds: string[]; decision: ReviewDecision; comment: string | null }) =>
      api.post<{ updated: number }>(`/dbaccess/reviews/${r!.reference}/decisions`, v),
    {
      invalidate: INVALIDATE,
      onSuccess: (res, v) =>
        toast.success(
          v.decision === 'keep' ? t('kept', { count: res.updated }) : t('revoked', { count: res.updated }),
        ),
    },
  );
  const close = useApiMutation((api) => api.post<Review>(`/dbaccess/reviews/${r!.reference}/close`), {
    invalidate: INVALIDATE,
    success: t('closed'),
    onSuccess: () => setClosing(false),
  });
  const busy = useMemo(
    () => new Set<string>(decide.isPending ? (decide.variables?.itemIds ?? []) : []),
    [decide.isPending, decide.variables],
  );

  const options: DecisionOption<ReviewDecision>[] = [
    { value: 'keep', label: t('keep'), icon: <ThumbsUpIcon /> },
    { value: 'revoke', label: t('revoke'), icon: <ThumbsDownIcon />, destructive: true },
  ];

  if (review.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (review.error) return <ErrorState kind="page" error={review.error} onRetry={() => review.refetch()} />;
  if (!r) return <EmptyState icon={<ClipboardCheckIcon />} title={t('notFound')} />;

  const done = r.totals.items - r.totals.pending;
  const active = r.status === 'active';
  const allMineDone = active && participant && r.totals.mine === 0;
  const person = (i: ReviewItem) => i.grantee?.displayName ?? i.accountName ?? '';
  const filtered = Boolean(state.q);

  return (
    <>
      <DetailHeader
        back={{ href: '/dbaccess/reviews', label: t('back'), highlight: r.id }}
        icon={<ClipboardCheckIcon />}
        reference={r.reference}
        title={r.name}
        status={<ReviewStatusBadge status={r.status} />}
        meta={t('summary', { due: day(r.dueOn), policy: tp(r.policy), reviewers: trr(r.reviewerRule) })}
        primaryAction={
          r.canManage && active ? (
            <Button variant={r.totals.pending ? 'outline' : 'default'} onClick={() => setClosing(true)}>
              <LockIcon /> {t('close')}
            </Button>
          ) : undefined
        }
        menu={[
          {
            id: 'export',
            label: t('export'),
            icon: <DownloadIcon />,
            onSelect: () => download(`/api/v1/dbaccess/reviews/${r.reference}/report.csv`),
          },
        ]}
      />
      <div className="grid min-w-0 grid-cols-1 gap-6">
        <DecisionProgress
          done={done}
          total={r.totals.items}
          label={t('progressLabel', { name: r.name })}
          valueText={t('progressValue', { done, items: r.totals.items })}
          summary={t('progressSummary', {
            kept: r.totals.kept,
            revoked: r.totals.revoked,
            pending: r.totals.pending,
          })}
        >
          {r.status === 'closed' && (
            <p className="flex items-center gap-2 text-sm">
              <LockIcon className="size-4 text-muted-foreground" aria-hidden />
              {t('readOnly')}
            </p>
          )}
        </DecisionProgress>
        {allMineDone && view === 'todo' && scope === 'mine' && (
          <DecisionDone title={t('allDone')} description={t('allDoneHint', { due: day(r.dueOn) })} />
        )}
        <DecisionViews
          value={view}
          onValueChange={(v) => set({ view: v })}
          label={t('items')}
          views={[
            {
              value: 'todo',
              label: t('views.todo'),
              count: scope === 'mine' ? r.totals.mine : r.totals.pending,
            },
            { value: 'done', label: t('views.done') },
            { value: 'all', label: t('views.all') },
          ]}
          actions={
            <>
              {participant && canSeeAll && (
                <Select value={scope} onValueChange={(v) => set({ scope: v, view: state.view })}>
                  <SelectTrigger className="w-full sm:w-44" aria-label={t('scope.label')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mine">{t('scope.mine')}</SelectItem>
                    <SelectItem value="everyone">{t('scope.everyone')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <SearchInput
                value={state.q ?? ''}
                onChange={(q) => set({ q })}
                placeholder={t('search')}
                className="sm:w-64"
              />
            </>
          }
        >
          <DecisionList<ReviewItem, ReviewDecision>
            label={t('items')}
            items={items.data?.items ?? []}
            getId={(i) => i.id}
            renderItem={(i) => <GrantSummary item={i} showReviewer={scope === 'everyone'} />}
            options={options}
            decisionOf={(i) => i.decision}
            canDecide={(i) => i.canDecide}
            renderResult={(i) => (
              <span className="grid justify-items-start gap-1 sm:justify-items-end">
                <DecisionBadge decision={i.decision} />
                {i.outcome && (
                  <span className="text-xs text-muted-foreground">{t(`outcome.${i.outcome}`)}</span>
                )}
                {i.comment && (
                  <span className="max-w-64 text-xs wrap-break-word text-muted-foreground">{i.comment}</span>
                )}
              </span>
            )}
            optionLabel={(o, i) =>
              o.value === 'keep' ? t('keepFor', { person: person(i) }) : t('revokeFor', { person: person(i) })
            }
            groupLabel={(i) => t('decisionFor', { person: person(i) })}
            bulkLabel={(o, count) =>
              o.value === 'keep' ? t('keepSelected', { count }) : t('revokeSelected', { count })
            }
            onDecide={(list, decision) => {
              const ids = list.map((i) => i.id);
              if (decision === 'revoke') setRevoking(ids);
              else decide.mutate({ itemIds: ids, decision, comment: null });
            }}
            busy={busy}
            selectable={active}
            loading={items.isLoading}
            error={items.error}
            onRetry={() => items.refetch()}
            total={items.data?.total}
            page={state.page}
            pageSize={state.pageSize}
            onPageChange={(page) => set({ page })}
            empty={
              filtered ? (
                <EmptyState variant="filtered" onClearFilters={() => set({ q: undefined })} />
              ) : (
                <EmptyState variant="compact" title={t(`empty.${view}`)} />
              )
            }
          />
        </DecisionViews>
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
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                close.mutate(undefined);
              }}
            >
              {t('close')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
