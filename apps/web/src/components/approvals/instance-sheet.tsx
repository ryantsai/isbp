'use client';

import type { WorkflowInstance } from '@isbp/contracts';
import { findStep, localize } from '@isbp/sdk';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowUpRightIcon, CheckIcon, ForwardIcon, InfoIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { InstanceProgress } from '../workflows/instance-progress';
import { InstanceTimeline } from '../workflows/instance-timeline';
import { StatusBadge } from '../workflows/status-badges';
import { SubjectDetails } from '../workflows/subject-details';
import { type Decision, DecisionDialog, DelegateDialog } from './decision-dialogs';

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
  open,
  onOpenChange,
  triggerName,
}: {
  instanceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerName?: string;
}) {
  const t = useTranslations('approvals.sheet');
  const locale = useLocale();
  const { user } = usePlatform();
  const isAdmin = useCan('core.workflows.manage');
  const { data } = useApiQuery<WorkflowInstance>(
    instanceId && open ? `/workflow-instances/${instanceId}` : null,
  );
  const [decision, setDecision] = useState<Decision | null>(null);
  const [delegating, setDelegating] = useState(false);
  const subject = data ? localize(data.subject.label, locale) : '';
  const myTask = data?.tasks.find((x) => x.id === data.myTaskId);
  const step = myTask && data ? findStep(data.graph, myTask.stepId) : undefined;
  const instructions = step?.type === 'approval' ? step.instructions : undefined;
  const canDelegate = step?.type === 'approval' ? step.allowDelegation !== false : false;
  const assignees = data?.tasks.filter((x) => x.status === 'pending').map((x) => x.assignee.id) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl" closeLabel={t('close')}>
        <SheetHeader className="sticky top-0 z-10 border-b bg-background/95 px-6 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {triggerName && <span>{triggerName}</span>}
            {data && <StatusBadge status={data.status} kind="instance" />}
          </div>
          <SheetTitle className="text-lg leading-snug">
            {subject || <Skeleton className="h-6 w-64" />}
          </SheetTitle>
          {data && (
            <SheetDescription>
              {t('requestedBy', { name: data.requester?.displayName ?? t('system') })}
            </SheetDescription>
          )}
        </SheetHeader>
        {!data ? (
          <div className="grid gap-4 p-6">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="grid gap-8 px-6 py-6">
            {instructions && (
              <div className="flex gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2.5 text-sm">
                <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                <p>{localize(instructions, locale)}</p>
              </div>
            )}
            <Section title={t('details')}>
              <SubjectDetails instance={data} />
              {data.subject.href && (
                <Button asChild variant="link" className="h-auto justify-start p-0">
                  <Link href={data.subject.href}>
                    {t('openSubject')}
                    <ArrowUpRightIcon />
                  </Link>
                </Button>
              )}
            </Section>
            <Section title={t('progress')}>
              <InstanceProgress instance={data} />
            </Section>
            <Section title={t('timeline')}>
              <InstanceTimeline instance={data} />
            </Section>
          </div>
        )}
        {data && myTask && myTask.status === 'pending' && (
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background/95 px-6 py-3 backdrop-blur">
            <Button onClick={() => setDecision('approve')}>
              <CheckIcon />
              {t('approve')}
            </Button>
            <Button variant="outline" onClick={() => setDecision('reject')}>
              <XIcon />
              {t('reject')}
            </Button>
            {(canDelegate || isAdmin) && (
              <Button variant="ghost" className="ml-auto" onClick={() => setDelegating(true)}>
                <ForwardIcon />
                {t('delegate')}
              </Button>
            )}
          </div>
        )}
        {data && myTask && decision && (
          <DecisionDialog
            taskId={myTask.id}
            decision={decision}
            subject={subject}
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
