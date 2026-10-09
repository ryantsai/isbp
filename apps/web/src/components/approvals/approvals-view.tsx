'use client';

import type { ApprovalItem } from '@isbp/contracts';
import { localize, type Page } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  CheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  ForwardIcon,
  KeyRoundIcon,
  PartyPopperIcon,
  TrendingUpIcon,
  XIcon,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { webModules } from '@/generated/modules';
import { useApiQuery } from '@/lib/api';
import { NavIcon } from '../nav-icon';
import { DueBadge, StatusBadge } from '../workflows/status-badges';
import { type Decision, DecisionDialog } from './decision-dialogs';
import { InstanceSheet } from './instance-sheet';

function TriggerIcon({ item }: { item: ApprovalItem }) {
  const cls = 'size-5';
  if (item.trigger.key === 'core.access-request') return <KeyRoundIcon className={cls} />;
  if (item.trigger.key === 'core.form-submission') return <FileTextIcon className={cls} />;
  return <NavIcon name={webModules[item.trigger.moduleId]?.manifest.icon} className={cls} />;
}

function useTriggerName() {
  const t = useTranslations();
  return (key: string) => (t.has(key) ? t(key) : key);
}

/**
 * One item waiting for a decision: the step it is at, what it is (the subject, in full), who asked and by when. Approve
 * and Reject sit on the card, so an approver on a phone can decide from the list; the sheet has the details.
 */
function ApprovalCard({
  item,
  now,
  onOpen,
  onDecide,
}: {
  item: ApprovalItem;
  now: Date;
  onOpen: () => void;
  onDecide: (d: Decision) => void;
}) {
  const t = useTranslations('approvals');
  const locale = useLocale();
  const pending = item.task.status === 'pending';
  const subject = localize(item.instance.subject.label, locale);
  const requester = item.instance.requester;
  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <TriggerIcon item={item} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-muted-foreground">
            {localize(item.step.name, locale)}
          </span>
          <span className="mt-0.5 line-clamp-2 block font-medium [overflow-wrap:anywhere] group-hover:underline">
            {subject}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            {requester && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <UserAvatar
                  name={requester.displayName}
                  src={requester.avatarUrl}
                  className="size-5 text-[9px]"
                />
                <span className="truncate">{t('requestedBy', { name: requester.displayName })}</span>
              </span>
            )}
            <RelativeTime date={item.task.createdAt} />
            {pending && <DueBadge dueAt={item.task.dueAt} now={now} />}
            {item.task.isEscalation && (
              <Badge variant="warning">
                <TrendingUpIcon aria-hidden />
                {t('escalated')}
              </Badge>
            )}
            {item.task.delegatedFrom && (
              <Badge variant="info">
                <ForwardIcon aria-hidden />
                {t('delegatedBy', { name: item.task.delegatedFrom.displayName })}
              </Badge>
            )}
            {!pending && <StatusBadge status={item.task.status} kind="task" />}
          </span>
        </span>
        <ChevronRightIcon
          className="mt-3 hidden size-4 shrink-0 text-muted-foreground sm:block"
          aria-hidden
        />
      </button>
      {pending && (
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-col lg:flex-row">
          <Button
            className="h-11 sm:h-9"
            onClick={() => onDecide('approve')}
            aria-label={t('approveSubject', { subject })}
          >
            <CheckIcon />
            {t('approve')}
          </Button>
          <Button
            variant="outline"
            className="h-11 sm:h-9"
            onClick={() => onDecide('reject')}
            aria-label={t('rejectSubject', { subject })}
          >
            <XIcon />
            {t('reject')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The approvals inbox: what is waiting for me (SLA first), and what I decided. */
export function ApprovalsView() {
  const t = useTranslations('approvals');
  const locale = useLocale();
  const now = useNow({ updateInterval: 60_000 });
  const triggerName = useTriggerName();
  const [state, set] = useListState({ pageSize: 20 });
  const status = state.status === 'done' ? 'done' : 'pending';
  const { data, isLoading, error, refetch } = useApiQuery<Page<ApprovalItem>>('/me/approvals', {
    status,
    q: state.q,
    page: state.page,
    pageSize: state.pageSize,
  });
  // The open decision is in the URL (`?task=<id>`): notifications and My work link straight to it, and Back closes it.
  const taskId = typeof state.task === 'string' && state.task ? state.task : null;
  const listed = data?.items.find((i) => i.task.id === taskId);
  const single = useApiQuery<Page<ApprovalItem>>(taskId && !listed ? '/me/approvals' : null, {
    task: taskId,
  });
  const open = listed ?? single.data?.items[0] ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const setOpen = (item: ApprovalItem | null) => {
    if (!item) return set({ task: undefined, page: state.page });
    // Opening adds a history entry, so the browser's Back closes the decision instead of leaving the page.
    const next = new URLSearchParams(search.toString());
    next.set('task', item.task.id);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const [deciding, setDeciding] = useState<{ item: ApprovalItem; decision: Decision } | null>(null);
  const items = data?.items ?? [];
  const pages = data ? Math.ceil(data.total / data.pageSize) : 1;

  const results = (
    <>
      {isLoading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={<PartyPopperIcon />}
          title={t('loadFailed')}
          className="rounded-xl border border-dashed"
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : !items.length ? (
        <EmptyState
          icon={status === 'pending' ? <PartyPopperIcon /> : <CheckIcon />}
          title={state.q ? t('emptySearch') : status === 'pending' ? t('emptyPending') : t('emptyDone')}
          description={status === 'pending' && !state.q ? t('emptyPendingHint') : undefined}
          className="rounded-xl border border-dashed"
        />
      ) : (
        // Spacing is padding, not gap, so a decided item can collapse out of the list smoothly.
        <AnimatedList aria-label={t(status === 'pending' ? 'tabs.pending' : 'tabs.done')} className="grid">
          {items.map((item) => (
            <AnimatedItem key={item.task.id} as="li" className="pb-3 last:pb-0">
              <div className="rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md">
                <ApprovalCard
                  item={item}
                  now={now}
                  onOpen={() => setOpen(item)}
                  onDecide={(decision) => setDeciding({ item, decision })}
                />
              </div>
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={state.page <= 1}
            onClick={() => set({ page: state.page - 1 })}
          >
            {t('previous')}
          </Button>
          <span className="text-sm text-muted-foreground">{t('pageOf', { page: state.page, pages })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={state.page >= pages}
            onClick={() => set({ page: state.page + 1 })}
          >
            {t('next')}
          </Button>
        </div>
      )}
    </>
  );

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs
        value={status}
        onValueChange={(v) => set({ status: v === 'done' ? 'done' : undefined })}
        className="gap-0"
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="pending">
              {t('tabs.pending')}
              {status === 'pending' && data ? (
                <span className="ml-1.5 tabular-nums text-muted-foreground">{data.total}</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="done">{t('tabs.done')}</TabsTrigger>
          </TabsList>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q: q || undefined })}
            placeholder={t('search')}
            className="sm:w-72"
          />
        </div>
        {/* Radix renders the panel's children only for the active tab. */}
        {(['pending', 'done'] as const).map((tab) => (
          <TabsContent key={tab} value={tab}>
            {results}
          </TabsContent>
        ))}
      </Tabs>

      <InstanceSheet
        instanceId={open?.instance.id ?? null}
        taskId={taskId}
        open={Boolean(taskId)}
        onOpenChange={(o) => !o && setOpen(null)}
        triggerName={open ? triggerName(open.trigger.name) : undefined}
      />
      {deciding && (
        <DecisionDialog
          taskId={deciding.item.task.id}
          decision={deciding.decision}
          subject={localize(deciding.item.instance.subject.label, locale)}
          step={deciding.item.step}
          open
          onOpenChange={(o) => !o && setDeciding(null)}
        />
      )}
      <p className="sr-only" aria-live="polite">
        {data ? t('liveCount', { count: data.total }) : ''}
      </p>
    </div>
  );
}
