'use client';

import type { ApprovalItem } from '@isbp/contracts';
import { localize, type Page } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { cn } from '@isbp/ui';
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
import { AnimatePresence, motion } from 'motion/react';
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
  const triggerName = useTriggerName();
  const pending = item.task.status === 'pending';
  const subject = localize(item.instance.subject.label, locale);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
      className="group relative min-w-0 rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md"
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <TriggerIcon item={item} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{triggerName(item.trigger.name)}</span>
              <span aria-hidden>·</span>
              <span className="font-medium text-foreground/80">{localize(item.step.name, locale)}</span>
            </span>
            <span className="mt-0.5 block truncate font-medium group-hover:underline">{subject}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {item.instance.requester && (
                <span className="inline-flex items-center gap-1.5">
                  <UserAvatar
                    name={item.instance.requester.displayName}
                    src={item.instance.requester.avatarUrl}
                    className="size-5 text-[9px]"
                  />
                  {item.instance.requester.displayName}
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
          <div className="flex shrink-0 gap-2 sm:flex-col lg:flex-row">
            <Button
              size="sm"
              onClick={() => onDecide('approve')}
              aria-label={t('approveSubject', { subject })}
            >
              <CheckIcon />
              {t('approve')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDecide('reject')}
              aria-label={t('rejectSubject', { subject })}
            >
              <XIcon />
              {t('reject')}
            </Button>
          </div>
        )}
      </div>
    </motion.li>
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
  const { data, isLoading } = useApiQuery<Page<ApprovalItem>>('/me/approvals', {
    status,
    q: state.q,
    page: state.page,
    pageSize: state.pageSize,
  });
  const [open, setOpen] = useState<ApprovalItem | null>(null);
  const [deciding, setDeciding] = useState<{ item: ApprovalItem; decision: Decision } | null>(null);
  const items = data?.items ?? [];
  const pages = data ? Math.ceil(data.total / data.pageSize) : 1;

  const results = (
    <>
      {isLoading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : !items.length ? (
        <EmptyState
          icon={status === 'pending' ? <PartyPopperIcon /> : <CheckIcon />}
          title={state.q ? t('emptySearch') : status === 'pending' ? t('emptyPending') : t('emptyDone')}
          description={status === 'pending' && !state.q ? t('emptyPendingHint') : undefined}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <ul className="grid gap-3" aria-label={t(status === 'pending' ? 'tabs.pending' : 'tabs.done')}>
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((item) => (
              <ApprovalCard
                key={item.task.id}
                item={item}
                now={now}
                onOpen={() => setOpen(item)}
                onDecide={(decision) => setDeciding({ item, decision })}
              />
            ))}
          </AnimatePresence>
        </ul>
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
        open={Boolean(open)}
        onOpenChange={(o) => !o && setOpen(null)}
        triggerName={open ? triggerName(open.trigger.name) : undefined}
      />
      {deciding && (
        <DecisionDialog
          taskId={deciding.item.task.id}
          decision={deciding.decision}
          subject={localize(deciding.item.instance.subject.label, locale)}
          open
          onOpenChange={(o) => !o && setDeciding(null)}
        />
      )}
      <p className={cn('sr-only')} aria-live="polite">
        {data ? t('liveCount', { count: data.total }) : ''}
      </p>
    </div>
  );
}
