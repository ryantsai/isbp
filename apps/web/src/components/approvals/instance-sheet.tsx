'use client';

import type { RequestPath, WorkflowInstance } from '@isbp/contracts';
import { findStep, localize } from '@isbp/sdk';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { Disclosure } from '@isbp/ui/motion';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { CheckIcon, ForwardIcon, HourglassIcon, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { ApprovalPathList, pathSteps } from '../requests/approval-path';
import { InstanceProgress } from '../workflows/instance-progress';
import { InstanceTimeline } from '../workflows/instance-timeline';
import { StatusBadge } from '../workflows/status-badges';
import { SubjectDetails } from '../workflows/subject-details';
import { type Decision, DecisionDialog, DelegateDialog } from './decision-dialogs';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** Everything about one workflow instance, with the viewer's own decision buttons when it's their turn. */
export function InstanceSheet({
  instanceId,
  taskId,
  open,
  onOpenChange,
  triggerName,
}: {
  instanceId: string | null;
  /** The task the person came for (`/approvals?task=`): when it is no longer theirs to decide, say who decided. */
  taskId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerName?: string;
}) {
  const t = useTranslations('approvals.sheet');
  const locale = useLocale();
  const { user } = usePlatform();
  const isAdmin = useCan('core.workflows.manage');
  const canReadWorkflows = useCan('core.workflows.read');
  const { data } = useApiQuery<WorkflowInstance>(
    instanceId && open ? `/workflow-instances/${instanceId}` : null,
  );
  // The same linear path requesters see: done, waiting (who, since when), next (who would be asked).
  const path = useApiQuery<RequestPath>(instanceId && open ? `/workflow-instances/${instanceId}/path` : null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [delegating, setDelegating] = useState(false);
  const subject = data ? localize(data.subject.label, locale) : '';
  const myTask = data?.tasks.find((x) => x.id === data.myTaskId);
  const step = myTask && data ? findStep(data.graph, myTask.stepId) : undefined;
  const instructions = step?.type === 'approval' ? step.instructions : undefined;
  const canDelegate = step?.type === 'approval' ? step.allowDelegation !== false : false;
  const assignees = data?.tasks.filter((x) => x.status === 'pending').map((x) => x.assignee.id) ?? [];
  const asked = taskId ? data?.tasks.find((x) => x.id === taskId) : undefined;
  const decided =
    asked && asked.status !== 'pending'
      ? (data?.tasks
          .filter((x) => x.stepId === asked.stepId && x.decidedAt && x.decidedBy)
          .sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0] ?? null)
      : null;
  const waitingForMe = Boolean(myTask && myTask.status === 'pending');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl" closeLabel={t('close')}>
        <SheetHeader className="sticky top-0 z-10 border-b bg-background/95 px-5 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {triggerName && <span>{triggerName}</span>}
            {data &&
              (waitingForMe ? (
                <Badge
                  variant="warning"
                  label={t('waitingForYou')}
                  icon={<Icon icon={HourglassIcon} size="xsm" />}
                />
              ) : (
                <StatusBadge status={data.status} kind="instance" />
              ))}
          </div>
          <SheetTitle className="text-lg leading-snug [overflow-wrap:anywhere]">
            {subject || <Skeleton className="h-6 w-64" />}
          </SheetTitle>
          {data && (
            <SheetDescription>
              {t('requestedBy', { name: data.requester?.displayName ?? t('system') })}
            </SheetDescription>
          )}
        </SheetHeader>
        {!data ? (
          <div className="grid gap-4 p-5">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="grid gap-5 px-5 py-6">
            {asked && asked.status !== 'pending' && (
              <Banner
                status="info"
                title={
                  decided?.decidedBy
                    ? t('alreadyDecided', { name: decided.decidedBy.displayName })
                    : t('noLongerWaiting')
                }
                description={decided?.decidedAt ? <RelativeTime date={decided.decidedAt} /> : undefined}
                collapsible={false}
              />
            )}
            {instructions && (
              <Banner status="info" title={localize(instructions, locale)} collapsible={false} />
            )}
            <Section title={t('details')}>
              {/* Long answers (a justification pasted without spaces) wrap inside the sheet on a phone. */}
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <SubjectDetails instance={data} />
              </div>
              {data.subject.href && <Link href={data.subject.href}>{t('openSubject')}</Link>}
            </Section>
            <Section title={t('path')}>
              {path.data ? (
                <ApprovalPathList steps={pathSteps(path.data)} />
              ) : (
                <div className="grid gap-3">
                  <Skeleton className="h-14 w-full rounded-lg" />
                  <Skeleton className="h-14 w-full rounded-lg" />
                </div>
              )}
            </Section>
            <Disclosure
              summary={t('timeline')}
              className="rounded-lg border"
              triggerClassName="w-full justify-between px-4 py-3 text-sm font-medium"
              contentClassName="px-4 pb-4"
            >
              <InstanceTimeline instance={data} />
            </Disclosure>
            {canReadWorkflows && (
              <Disclosure
                summary={t('workflowDetails')}
                className="rounded-lg border"
                triggerClassName="w-full justify-between px-4 py-3 text-sm font-medium"
                contentClassName="px-4 pb-4"
              >
                <InstanceProgress instance={data} />
              </Disclosure>
            )}
          </div>
        )}
        {data && myTask && myTask.status === 'pending' && (
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background/95 px-5 py-3 backdrop-blur">
            <Button
              label={t('approve')}
              variant="primary"
              icon={<Icon icon={CheckIcon} />}

              onClick={() => setDecision('approve')}
            />
            <Button
              label={t('reject')}
              variant="secondary"
              icon={<Icon icon={XIcon} />}

              onClick={() => setDecision('reject')}
            />
            {(canDelegate || isAdmin) && (
              <span className="ml-auto">
                <Button
                  label={t('delegate')}
                  variant="ghost"
                  icon={<Icon icon={ForwardIcon} />}
                  onClick={() => setDelegating(true)}
                />
              </span>
            )}
          </div>
        )}
        {data && myTask && decision && (
          <DecisionDialog
            taskId={myTask.id}
            decision={decision}
            subject={subject}
            step={step?.type === 'approval' ? step : undefined}
            open={Boolean(decision)}
            onOpenChange={(o) => !o && setDecision(null)}
            onDone={() => onOpenChange(false)}
          />
        )}
        {data && myTask && (
          <DelegateDialog
            taskId={myTask.id}
            subject={subject}
            excludeIds={[user.id, ...assignees, data.requester?.id ?? '', data.subjectUser?.id ?? ''].filter(
              Boolean,
            )}
            open={delegating}
            onOpenChange={setDelegating}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
