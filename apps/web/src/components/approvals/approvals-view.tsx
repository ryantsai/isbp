'use client';

import type { ApprovalItem } from '@isbp/contracts';
import { localize, type Page } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { RelativeTime } from '@isbp/ui/relative-time';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { IconTile } from '@isbp/ui/icon-tile';
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
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Pagination } from '@astryxdesign/core/Pagination';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';

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
    <ClickableCard label={subject} onClick={onOpen} padding={4}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <HStack gap={3} vAlign="start" className="min-w-0 flex-1">
          <IconTile aria-hidden>
            <TriggerIcon item={item} />
          </IconTile>
          <StackItem size="fill">
            <VStack gap={1}>
              <Text type="supporting" weight="medium">
                {localize(item.step.name, locale)}
              </Text>
              <Text size="base" weight="medium" maxLines={2} wordBreak="break-word">
                {subject}
              </Text>
              <HStack gap={3} wrap="wrap" vAlign="center">
                {requester && (
                  <HStack gap={1.5} vAlign="center">
                    <UserAvatar
                      name={requester.displayName}
                      src={requester.avatarUrl}
                      className="size-5 text-[9px]"
                    />
                    <Text type="supporting" maxLines={1}>
                      {t('requestedBy', { name: requester.displayName })}
                    </Text>
                  </HStack>
                )}
                <Text type="supporting">
                  <RelativeTime date={item.task.createdAt} />
                </Text>
                {pending && <DueBadge dueAt={item.task.dueAt} now={now} />}
                {item.task.isEscalation && (
                  <Badge
                    variant="warning"
                    label={t('escalated')}
                    icon={<Icon icon={TrendingUpIcon} size="xsm" />}
                  />
                )}
                {item.task.delegatedFrom && (
                  <Badge
                    variant="info"
                    label={t('delegatedBy', { name: item.task.delegatedFrom.displayName })}
                    icon={<Icon icon={ForwardIcon} size="xsm" />}
                  />
                )}
                {!pending && <StatusBadge status={item.task.status} kind="task" />}
              </HStack>
            </VStack>
          </StackItem>
          <span className="hidden sm:block">
            <Icon icon={ChevronRightIcon} color="secondary" />
          </span>
        </HStack>
        {pending && (
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-col lg:flex-row">
            <Button
              label={t('approve')}
              aria-label={t('approveSubject', { subject })}
              variant="primary"
              icon={<Icon icon={CheckIcon} />}
              onClick={() => onDecide('approve')}
            />
            <Button
              label={t('reject')}
              aria-label={t('rejectSubject', { subject })}
              variant="secondary"
              icon={<Icon icon={XIcon} />}
              onClick={() => onDecide('reject')}
            />
          </div>
        )}
      </div>
    </ClickableCard>
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
          action={<Button label={t('retry')} variant="secondary" size="sm" onClick={() => refetch()} />}
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
              <ApprovalCard
                item={item}
                now={now}
                onOpen={() => setOpen(item)}
                onDecide={(decision) => setDeciding({ item, decision })}
              />
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}

      {pages > 1 && (
        <div className="mt-4 flex justify-center">
          <Pagination
            variant="compact"
            label={t('title')}
            page={state.page}
            totalPages={pages}
            onChange={(page) => set({ page })}
          />
        </div>
      )}
    </>
  );

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          label={t('title')}
          value={status}
          onChange={(v) => set({ status: v === 'done' ? 'done' : undefined })}
        >
          <SegmentedControlItem
            value="pending"
            label={status === 'pending' && data ? `${t('tabs.pending')} · ${data.total}` : t('tabs.pending')}
          />
          <SegmentedControlItem value="done" label={t('tabs.done')} />
        </SegmentedControl>
        <SearchInput
          value={state.q ?? ''}
          onChange={(q) => set({ q: q || undefined })}
          placeholder={t('search')}
          className="sm:w-72"
        />
      </div>
      {results}

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
