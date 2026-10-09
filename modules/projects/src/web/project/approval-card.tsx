'use client';

import type { WorkflowInstance } from '@isbp/contracts';
import { localize, walkSteps } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import type { FactOption } from '@isbp/ui/condition-builder';
import { FadeIn } from '@isbp/ui/motion';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatusBadge } from '@isbp/ui/status';
import { type StepRuntime, WorkflowDiagram } from '@isbp/ui/workflow-diagram';
import {
  BanIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ClockIcon,
  GavelIcon,
  type LucideIcon,
  WorkflowIcon,
  XCircleIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { PROJECT_PRIORITIES, type ProjectDetail } from '../../contracts';

const OUTCOME: Record<
  'pending' | 'approved' | 'rejected' | 'cancelled',
  { tone: 'info' | 'success' | 'destructive' | 'muted'; icon: LucideIcon }
> = {
  pending: { tone: 'info', icon: ClockIcon },
  approved: { tone: 'success', icon: CheckCircle2Icon },
  rejected: { tone: 'destructive', icon: XCircleIcon },
  cancelled: { tone: 'muted', icon: BanIcon },
};

function runtimeOf(instance: WorkflowInstance) {
  const runtime: Record<string, StepRuntime> = {};
  const chosen: Record<string, string> = {};
  for (const { step } of walkSteps(instance.graph.steps)) {
    const st = instance.state.steps[step.id];
    if (st?.branch) chosen[step.id] = st.branch;
    const status = st?.status ?? 'waiting';
    runtime[step.id] = {
      status: status === 'active' && instance.status !== 'running' ? 'skipped' : status,
      reason: st?.reason,
      people: instance.tasks
        .filter((x) => x.stepId === step.id && x.status !== 'delegated')
        .map((x) => ({ name: x.assignee.displayName, avatarUrl: x.assignee.avatarUrl, status: x.status })),
    };
  }
  return { runtime, chosen };
}

/** The approval path (the workflow diagram) in a sheet: wide enough to read, out of the narrow aside. */
function ApprovalPathSheet({
  instance,
  open,
  onOpenChange,
}: {
  instance: WorkflowInstance;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('projects.approval');
  const tp = useTranslations('projects.priority');
  const facts = useMemo<FactOption[]>(
    () => [
      { path: 'project.budgetHours', label: t('facts.budgetHours'), type: 'number' },
      {
        path: 'project.priority',
        label: t('facts.priority'),
        type: 'string',
        options: PROJECT_PRIORITIES.map((p) => ({ value: p, label: tp(p) })),
      },
      { path: 'project.memberCount', label: t('facts.memberCount'), type: 'number' },
    ],
    [t, tp],
  );
  const rt = useMemo(() => runtimeOf(instance), [instance]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{t('pathTitle')}</SheetTitle>
          <SheetDescription>{t('pathDescription')}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <div className="relative overflow-x-auto rounded-xl border bg-muted/20 py-4 [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:16px_16px]">
            <WorkflowDiagram
              graph={instance.graph}
              names={{ ...instance.names, facts }}
              runtime={rt.runtime}
              chosen={rt.chosen}
              outcome={instance.status}
            />
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** "Waiting for Mei Lin · Project manager's line manager · sent 2 minutes ago · due in 3 days". */
function InstanceDetail({ instanceId }: { instanceId: string }) {
  const t = useTranslations('projects.approval');
  const locale = useLocale();
  const [showPath, setShowPath] = useState(false);
  const { data, isLoading, error } = useApiQuery<WorkflowInstance>(`/workflow-instances/${instanceId}`);
  if (isLoading) return <Skeleton className="h-16 w-full rounded-lg" />;
  if (error || !data) return <p className="text-sm text-muted-foreground">{t('detailsHidden')}</p>;
  const pending = data.tasks.filter((x) => x.status === 'pending');
  const due = pending
    .map((x) => x.dueAt)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const steps = data.currentSteps.map((st) => localize(st.name, locale)).join(', ');
  return (
    <div className="grid gap-2">
      {data.status === 'running' && data.pendingWith.length > 0 && (
        <FadeIn className="grid gap-1.5 text-sm">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{t('waitingFor')}</span>
            {data.pendingWith.slice(0, 5).map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 font-medium">
                <UserAvatar name={p.displayName} src={p.avatarUrl} className="size-5 text-[9px]" />
                {p.displayName}
              </span>
            ))}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {steps && <span>{steps}</span>}
            <span>
              · {t('sent')} <RelativeTime date={data.startedAt} />
            </span>
            {due && (
              <span>
                · {t('due')} <RelativeTime date={due} />
              </span>
            )}
          </span>
        </FadeIn>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setShowPath(true)}>
          <WorkflowIcon /> {t('showPath')}
        </Button>
        {data.myTaskId && (
          <Link
            href={`/approvals?task=${data.myTaskId}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            {t('decide')}
          </Link>
        )}
      </div>
      <ApprovalPathSheet instance={data} open={showPath} onOpenChange={setShowPath} />
    </div>
  );
}

/** The proposal approval while the project is proposed (or the last decision on it). */
export function ApprovalCard({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.approval');
  const approval = project.approval;
  if (project.status !== 'proposed') return null;
  const status = approval?.status ?? null;
  const outcome = status ? OUTCOME[status] : null;
  const needsApproval =
    project.budgetHours !== null && project.budgetHours > project.settings.proposalThresholdHours;
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GavelIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>
          {needsApproval
            ? t('needsManager', { threshold: project.settings.proposalThresholdHours })
            : t('automatic', { threshold: project.settings.proposalThresholdHours })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {outcome && status ? (
            <StatusBadge
              tone={outcome.tone}
              icon={outcome.icon}
              label={t(`status.${status}`)}
              changeKey={status}
            />
          ) : (
            <StatusBadge tone="muted" icon={CircleDashedIcon} label={t('notStarted')} changeKey="none" />
          )}
          {approval?.decidedAt && (
            <RelativeTime date={approval.decidedAt} className="text-xs text-muted-foreground" />
          )}
        </div>
        {status === 'rejected' && (
          <p className="rounded-lg border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm">
            {approval?.comment ? t('rejectedWith', { comment: approval.comment }) : t('rejected')}
          </p>
        )}
        {!status && (
          <p className="text-sm text-muted-foreground">{needsApproval ? t('submitHint') : t('startHint')}</p>
        )}
        {approval?.instanceId && status === 'pending' && <InstanceDetail instanceId={approval.instanceId} />}
      </CardContent>
    </Card>
  );
}
