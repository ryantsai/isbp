'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useApi, type WebPageProps } from '@isbp/sdk/web';
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
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
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
    <VStack gap={1}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="code" weight="medium" wordBreak="break-word">
          {item.accountName}
        </Text>
        <PrivilegeBadge privilege={item.privilege} />
      </HStack>
      <HStack gap={2} vAlign="center" wrap="wrap">
        {who && <Text type="supporting">{who}</Text>}
        {item.user && item.userName && item.user.displayName !== item.userName && (
          <Text type="supporting">({item.user.displayName})</Text>
        )}
        <AccountStateText state={item.accountStatus} />
        {item.detail && <Text type="supporting">{item.detail}</Text>}
      </HStack>
      {item.decision && item.decision !== 'keep' && (
        <HStack gap={2} vAlign="center" wrap="wrap">
          {item.doneOn ? (
            <Text type="supporting">{t('review.doneOn', { date: day(item.doneOn) })}</Text>
          ) : (
            <Text type="supporting" weight="medium">
              {t('review.notDoneYet')}
            </Text>
          )}
          {item.ticket &&
            (item.ticket.href ? (
              <Link href={item.ticket.href}>{t('review.ticket', { reference: item.ticket.reference })}</Link>
            ) : (
              <Text type="supporting">{t('review.ticket', { reference: item.ticket.reference })}</Text>
            ))}
        </HStack>
      )}
      {stillEnabled && (
        <HStack gap={1} vAlign="center">
          <Icon icon={TriangleAlertIcon} color="warning" />
          <Text type="supporting" weight="medium">
            {t(`review.stillEnabled.${item.decision as 'disable' | 'delete'}`)}
          </Text>
        </HStack>
      )}
      {item.note && (
        <Text as="p" type="supporting" wordBreak="break-word">
          {item.note}
        </Text>
      )}
    </VStack>
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
    <div className="space-y-5">
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
              label={t('review.complete')}
              variant="primary"
              icon={<Icon icon={SendIcon} />}
              isLoading={complete.isPending}
              isDisabled={!allDecided}
              onClick={() => complete.mutate(undefined)}
            />
          ) : r.viewer.canSignOff ? (
            <Button
              label={t('review.signOff')}
              variant="primary"
              icon={<Icon icon={BadgeCheckIcon} />}
              onClick={() => setDialog('signoff')}
            />
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
          <Text as="p" color="secondary">
            {t('review.completeWhenDone')}
          </Text>
        )}
        {r.status === 'completed' && (
          <Text as="p">
            {t('review.waitingSignOff', {
              name: r.completedBy?.displayName ?? r.reviewer?.displayName ?? '',
            })}
          </Text>
        )}
        {r.signedOffBy && (
          <Text as="p">
            {t('review.signedOffBy', { name: r.signedOffBy.displayName })}
            {r.signOffNote ? ` — ${r.signOffNote}` : ''}
          </Text>
        )}
      </DecisionProgress>
      {r.status === 'scheduled' ? (
        <Text as="p" color="secondary">
          {t('review.scheduled', { date: day(r.startOn) })}
        </Text>
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
                  <Selector
                    label={t('review.filter')}
                    isLabelHidden
                    width={176}
                    value={filter ?? 'any'}
                    onChange={(v) => set({ filter: v === 'any' ? undefined : v })}
                    options={[
                      { value: 'any', label: t('review.anyDecision') },
                      ...FILTERS.map((f) => ({
                        value: f,
                        label: f === 'admin' ? t('review.views.admin') : t(`reviewDecision.${f}`),
                      })),
                    ]}
                  />
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
                        <Button
                          label={t('review.import')}
                          variant="secondary"
                          icon={<Icon icon={FileUpIcon} />}
                          onClick={() => setDialog('import')}
                        />
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
      {/* Lists the accounts the tickets are raised for, which an AlertDialog's plain description cannot hold. */}
      <Dialog isOpen={dialog === 'tickets'} onOpenChange={(o) => setDialog(o ? 'tickets' : null)} width={448}>
        <Layout
          header={
            <DialogHeader
              title={t('review.ticketsTitle', { count: r.viewer.ticketsToRaise })}
              subtitle={t('review.ticketsDescription')}
              onOpenChange={(o) => setDialog(o ? 'tickets' : null)}
            />
          }
          content={
            <LayoutContent padding={4}>
              <List listStyle="disc" density="compact">
                {(toTicket.data?.items ?? []).map((i) => (
                  <ListItem
                    key={i.id}
                    label={t(`review.ticketLine.${i.decision as 'disable' | 'delete'}`, {
                      account: i.accountName,
                    })}
                  />
                ))}
              </List>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider padding={3}>
              <HStack gap={2} hAlign="end">
                <Button label={tc('cancel')} variant="ghost" onClick={() => setDialog(null)} />
                <Button
                  label={t('review.raiseTickets', { count: r.viewer.ticketsToRaise })}
                  variant="primary"
                  isLoading={tickets.isPending}
                  onClick={() => tickets.mutate(undefined)}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
      <AlertDialog
        isOpen={dialog === 'cancel'}
        onOpenChange={(o) => setDialog(o ? 'cancel' : null)}
        title={t('review.cancelTitle', { reference: r.reference })}
        description={t('review.cancelDescription')}
        cancelLabel={tc('back')}
        actionLabel={t('review.cancel')}
        isActionLoading={cancel.isPending}
        onAction={() => cancel.mutate(undefined)}
      />
    </div>
  );
}
