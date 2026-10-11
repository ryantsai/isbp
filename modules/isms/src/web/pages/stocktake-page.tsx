'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { useApi, useCan, type WebPageProps } from '@isbp/sdk/web';
import { useListState } from '@isbp/ui/data-table';
import { DecisionDone, DecisionProgress, DecisionViews } from '@isbp/ui/decision-list';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { BadgeCheckIcon, ClipboardCheckIcon, DownloadIcon, XCircleIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { STOCKTAKE_RESULTS, type Stocktake, type StocktakeItem } from '../../contracts';
import { StocktakeStatusBadge } from '../badges';
import { apiUrl, download, INVALIDATE, useDay } from '../lib';
import { SignOffDialog } from '../stocktake-dialogs';
import { StocktakeItemList } from '../stocktake-items';

const VIEWS = ['todo', 'done', 'all'] as const;
type View = (typeof VIEWS)[number];
type Result = (typeof STOCKTAKE_RESULTS)[number];

/** One stocktake: progress, the viewer's assets first ("Is this still right?"), export and sign-off. */
export default function StocktakePage({ params }: WebPageProps) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const api = useApi();
  const day = useDay();
  const locale = useLocale();
  const ref = params.ref ?? '';
  const readsAssets = useCan('isms.assets.read');
  const managesStocktakes = useCan('isms.stocktakes.manage');
  const signsOff = useCan('isms.stocktakes.signoff');
  const readsAll = readsAssets || managesStocktakes || signsOff;
  const [state, set] = useListState({ pageSize: 25 });
  const st = useApiQuery<Stocktake>(`/isms/stocktakes/${encodeURIComponent(ref)}`);
  const s = st.data;
  const participant = Boolean(s && s.viewer.mineTotal > 0);
  const view: View = VIEWS.includes(state.view as View)
    ? (state.view as View)
    : state.mine === 'true' || (s && s.viewer.pendingForMe > 0)
      ? 'todo'
      : 'all';
  // `?mine=true` (notifications, My work) or a participant's default: their own assets.
  const mine = state.mine === 'true' || (state.mine !== 'false' && participant);
  const result = STOCKTAKE_RESULTS.includes(state.result as Result) ? (state.result as Result) : undefined;
  const items = useApiQuery<Page<StocktakeItem>>(s ? `/isms/stocktakes/${s.reference}/items` : null, {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    view: view === 'todo' ? 'pending' : view === 'done' ? (result ?? 'done') : 'all',
    mine: mine ? 'true' : undefined,
  });
  const [signing, setSigning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const signOff = useApiMutation(
    (_a, note: string | null) => api.post<Stocktake>(`/isms/stocktakes/${s!.reference}/sign-off`, { note }),
    { invalidate: INVALIDATE, success: t('stocktake.signedOff'), onSuccess: () => setSigning(false) },
  );
  const cancel = useApiMutation(() => api.post<Stocktake>(`/isms/stocktakes/${s!.reference}/cancel`, {}), {
    invalidate: INVALIDATE,
    success: t('stocktake.cancelled'),
    onSuccess: () => setCancelling(false),
  });

  if (st.isLoading) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (st.error) return <ErrorState kind="page" error={st.error} onRetry={() => st.refetch()} />;
  if (!s) return <EmptyState icon={<ClipboardCheckIcon />} title={t('stocktake.notFound')} />;
  const p = s.progress;
  const open = s.status === 'open';
  const canSignOff = s.viewer.canSignOff && open;
  const filtered = Boolean(state.q || result);

  return (
    <div className="space-y-5">
      <DetailHeader
        back={{ href: '/isms/stocktakes', label: t('stocktakes.title'), highlight: s.id }}
        icon={<ClipboardCheckIcon />}
        reference={s.reference}
        title={s.name}
        status={<StocktakeStatusBadge status={s.status} overdue={s.overdue} />}
        meta={[
          t('stocktakes.dueOn', { date: day(s.dueOn) }),
          s.recurrence !== 'none' ? t(`recurrence.${s.recurrence}`) : null,
          s.createdBy ? t('stocktake.runBy', { name: s.createdBy.displayName }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        primaryAction={
          canSignOff ? (
            <Button
              label={t('stocktake.signOff')}
              variant="primary"
              icon={<Icon icon={BadgeCheckIcon} />}
              isDisabled={p.done < p.total}
              onClick={() => setSigning(true)}
            />
          ) : undefined
        }
        menu={[
          {
            id: 'export',
            label: t('stocktake.export'),
            icon: <DownloadIcon />,
            onSelect: () => download(apiUrl(`/isms/stocktakes/${s.reference}/export.csv`, { locale })),
          },
          ...(s.viewer.canManage && (open || s.status === 'scheduled')
            ? [
                {
                  id: 'cancel',
                  label: t('stocktake.cancel'),
                  icon: <XCircleIcon />,
                  destructive: true,
                  onSelect: () => setCancelling(true),
                },
              ]
            : []),
        ]}
      />
      <DecisionProgress
        done={p.done}
        total={p.total}
        label={t('stocktakes.progressLabel', { name: s.name })}
        valueText={t('stocktake.progressValue', { done: p.done, total: p.total })}
        summary={t('stocktake.summary', { ...p.byResult, pending: p.total - p.done })}
      >
        {canSignOff && p.done < p.total && (
          <Text as="p" color="secondary">
            {t('stocktake.signOffWhenDone')}
          </Text>
        )}
        {s.viewer.canSignOff && open && p.total > 0 && p.done === p.total && (
          <Text as="p" weight="medium">
            {t('stocktake.readyToSignOff')}
          </Text>
        )}
        {s.signedOffBy && (
          <Text as="p">
            {t('stocktake.signedOffBy', { name: s.signedOffBy.displayName })}
            {s.signOffNote ? ` — ${s.signOffNote}` : ''}
          </Text>
        )}
      </DecisionProgress>
      {s.status === 'scheduled' ? (
        <Text as="p" color="secondary">
          {t('stocktake.scheduled', { date: day(s.startOn) })}
        </Text>
      ) : (
        <>
          {open && participant && mine && s.viewer.pendingForMe === 0 && view === 'todo' && (
            <DecisionDone title={t('stocktake.allDone')} description={t('stocktake.allDoneHint')} />
          )}
          <DecisionViews
            value={view}
            onValueChange={(v) => set({ view: v, result: undefined })}
            label={t('stocktake.items')}
            views={[
              {
                value: 'todo',
                label: t('stocktake.views.todo'),
                count: mine ? s.viewer.pendingForMe : p.total - p.done,
              },
              { value: 'done', label: t('stocktake.views.done') },
              { value: 'all', label: t('stocktake.views.all') },
            ]}
            actions={
              <>
                {participant && readsAll && (
                  <Selector
                    label={t('stocktake.scope.label')}
                    isLabelHidden
                    width={176}
                    value={mine ? 'mine' : 'everyone'}
                    onChange={(v) => set({ mine: v === 'mine' ? 'true' : 'false' })}
                    options={[
                      { value: 'mine', label: t('stocktake.scope.mine') },
                      { value: 'everyone', label: t('stocktake.scope.everyone') },
                    ]}
                  />
                )}
                {view === 'done' && (
                  <Selector
                    label={t('fields.result')}
                    isLabelHidden
                    width={160}
                    value={result ?? 'any'}
                    onChange={(v) => set({ result: v === 'any' ? undefined : v })}
                    options={[
                      { value: 'any', label: t('stocktake.anyResult') },
                      ...STOCKTAKE_RESULTS.map((r) => ({ value: r, label: t(`stocktakeResult.${r}`) })),
                    ]}
                  />
                )}
                <SearchInput
                  value={state.q ?? ''}
                  onChange={(q) => set({ q })}
                  placeholder={t('stocktake.search')}
                  className="sm:w-56"
                />
              </>
            }
          >
            <StocktakeItemList
              label={t('stocktake.items')}
              items={items.data?.items ?? []}
              stocktakeOf={() => s.reference}
              showAssignee={!mine}
              selectable={open}
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
                    onClearFilters={() => set({ q: undefined, result: undefined })}
                  />
                ) : (
                  <EmptyState variant="compact" title={t(`stocktake.empty.${view}`)} />
                )
              }
            />
          </DecisionViews>
        </>
      )}
      <SignOffDialog
        open={signing}
        onOpenChange={setSigning}
        title={t('stocktake.signOffTitle', { reference: s.reference })}
        description={t('stocktake.signOffDescription')}
        onConfirm={(note) => signOff.mutate(note)}
        pending={signOff.isPending}
      />
      <AlertDialog
        isOpen={cancelling}
        onOpenChange={setCancelling}
        title={t('stocktake.cancelTitle', { reference: s.reference })}
        description={t('stocktake.cancelDescription')}
        cancelLabel={tc('back')}
        actionLabel={t('stocktake.cancel')}
        isActionLoading={cancel.isPending}
        onAction={() => cancel.mutate(undefined)}
      />
    </div>
  );
}
