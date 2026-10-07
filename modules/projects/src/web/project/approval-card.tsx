'use client';

import type { WorkflowInstance } from '@isbp/contracts';
import { localize, walkSteps } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import type { FactOption } from '@isbp/ui/condition-builder';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { type StepRuntime, WorkflowDiagram } from '@isbp/ui/workflow-diagram';
import { BanIcon, CheckCircle2Icon, ClockIcon, GavelIcon, XCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useMemo } from 'react';
import { PROJECT_PRIORITIES, type ProjectDetail } from '../../contracts';

const OUTCOME: Record<
  'pending' | 'approved' | 'rejected' | 'cancelled',
  { variant: 'info' | 'success' | 'destructive' | 'muted'; icon: ReactNode }
> = {
  pending: { variant: 'info', icon: <ClockIcon aria-hidden /> },
  approved: { variant: 'success', icon: <CheckCircle2Icon aria-hidden /> },
  rejected: { variant: 'destructive', icon: <XCircleIcon aria-hidden /> },
  cancelled: { variant: 'muted', icon: <BanIcon aria-hidden /> },
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

/** Who the proposal waits for and the approval path (visible to the requester, owner and approvers). */
function InstanceDetail({ instanceId }: { instanceId: string }) {
  const t = useTranslations('projects.approval');
  const tp = useTranslations('projects.priority');
  const locale = useLocale();
  const { data, isLoading, error } = useApiQuery<WorkflowInstance>(`/workflow-instances/${instanceId}`);
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
  const rt = useMemo(() => (data ? runtimeOf(data) : null), [data]);
  if (isLoading) return <Skeleton className="h-32 w-full rounded-lg" />;
  if (error || !data || !rt) return <p className="text-sm text-muted-foreground">{t('detailsHidden')}</p>;
  return (
    <div className="grid gap-3">
      {data.status === 'running' && data.currentSteps.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {data.currentSteps.map((s) => localize(s.name, locale)).join(', ')}
        </p>
      )}
      {data.status === 'running' && data.pendingWith.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {t('waitingFor')}
          {data.pendingWith.slice(0, 5).map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 text-foreground">
              <UserAvatar name={p.displayName} src={p.avatarUrl} className="size-5 text-[9px]" />
              {p.displayName}
            </span>
          ))}
        </p>
      )}
      <div className="relative overflow-x-auto rounded-xl border bg-muted/20 py-4 [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:16px_16px]">
        <WorkflowDiagram
          graph={data.graph}
          names={{ ...data.names, facts }}
          runtime={rt.runtime}
          chosen={rt.chosen}
          outcome={data.status}
        />
      </div>
      {data.myTaskId && (
        <Link href="/approvals" className="text-sm font-medium text-primary hover:underline">
          {t('decide')}
        </Link>
      )}
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
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GavelIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>
          {project.budgetHours !== null && project.budgetHours > project.settings.proposalThresholdHours
            ? t('needsManager', { threshold: project.settings.proposalThresholdHours })
            : t('automatic', { threshold: project.settings.proposalThresholdHours })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {outcome && status ? (
            <Badge variant={outcome.variant}>
              {outcome.icon}
              {t(`status.${status}`)}
            </Badge>
          ) : (
            <Badge variant="muted">{t('notStarted')}</Badge>
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
        {!status && <p className="text-sm text-muted-foreground">{t('startHint')}</p>}
        {approval?.instanceId && status === 'pending' && <InstanceDetail instanceId={approval.instanceId} />}
      </CardContent>
    </Card>
  );
}
