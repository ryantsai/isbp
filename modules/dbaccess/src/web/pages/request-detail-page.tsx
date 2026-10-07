'use client';

import type { WorkflowInstance } from '@isbp/contracts';
import { localize, walkSteps } from '@isbp/sdk';
import type { WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { type StepRuntime, WorkflowDiagram } from '@isbp/ui/workflow-diagram';
import { BanIcon, FileQuestionIcon, GavelIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { AccessRequest } from '../../contracts';
import { EngineLabel, GrantStatusBadge, RequestStatusBadge, RiskBadge } from '../badges';
import { INVALIDATE, useDay, useLocalized } from '../lib';

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

/** Who the request waits for and the approval path (requester, approvers, owners, DBAs). */
function ApprovalPath({ instanceId }: { instanceId: string }) {
  const t = useTranslations('dbaccess.requestPage');
  const locale = useLocale();
  const { data, isLoading, error } = useApiQuery<WorkflowInstance>(`/workflow-instances/${instanceId}`);
  const rt = useMemo(() => (data ? runtimeOf(data) : null), [data]);
  if (isLoading) return <Skeleton className="h-32 w-full rounded-lg" />;
  if (error || !data || !rt) return <p className="text-sm text-muted-foreground">{t('pathHidden')}</p>;
  return (
    <div className="grid min-w-0 gap-3">
      {data.status === 'running' && data.pendingWith.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {t('waitingFor', { step: data.currentSteps.map((s) => localize(s.name, locale)).join(', ') })}
          {data.pendingWith.slice(0, 5).map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 text-foreground">
              <UserAvatar name={p.displayName} src={p.avatarUrl} className="size-5 text-[9px]" />
              {p.displayName}
            </span>
          ))}
          {data.pendingWith.length > 5 && <span>{t('andMore', { count: data.pendingWith.length - 5 })}</span>}
        </p>
      )}
      <div
        className="relative overflow-x-auto rounded-xl border bg-muted/20 py-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        role="region"
        aria-label={t('path')}
        tabIndex={0}
      >
        <WorkflowDiagram
          graph={data.graph}
          names={data.names}
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

export default function RequestDetailPage({ params }: WebPageProps) {
  const t = useTranslations('dbaccess.requestPage');
  const l = useLocalized();
  const day = useDay();
  const { data, isLoading, error } = useApiQuery<AccessRequest>(
    `/dbaccess/requests/${params.ref}`,
    undefined,
    {
      refetchInterval: 10_000,
    },
  );
  const cancel = useApiMutation((api) => api.post<AccessRequest>(`/dbaccess/requests/${params.ref}/cancel`), {
    invalidate: INVALIDATE,
    success: t('cancelled'),
  });

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error || !data)
    return (
      <EmptyState
        icon={<FileQuestionIcon />}
        title={t('notFound')}
        action={
          <Button asChild variant="outline">
            <Link href="/dbaccess">{t('back')}</Link>
          </Button>
        }
      />
    );

  return (
    <>
      <PageHeader
        eyebrow={<span className="font-mono">{data.reference}</span>}
        title={`${l(data.role.name)} · ${data.server.displayName}`}
        description={t(`statusHint.${data.status}`)}
        actions={
          <>
            <RequestStatusBadge status={data.status} />
            {data.canCancel && (
              <Button variant="outline" loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>
                <BanIcon /> {t('cancel')}
              </Button>
            )}
          </>
        }
      />
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GavelIcon className="size-4 text-primary" aria-hidden />
              {t('approval')}
            </CardTitle>
            {data.decisionComment && (
              <CardDescription>{t('comment', { comment: data.decisionComment })}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {data.instanceId ? (
              <ApprovalPath instanceId={data.instanceId} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('noWorkflow')}</p>
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{t('details')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t('role')}</dt>
                <dd className="truncate font-mono">
                  {data.role.database ? `${data.role.database}.` : ''}
                  {data.role.roleName}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t('server')}</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate">{data.server.displayName}</span>
                  <EngineLabel engine={data.server.engine} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('risk')}</dt>
                <dd>
                  <RiskBadge risk={data.role.risk} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('until')}</dt>
                <dd>{data.expiresOn ? day(data.expiresOn) : t('permanent')}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t('requester')}</dt>
                <dd className="truncate">{data.requester?.displayName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('submitted')}</dt>
                <dd>
                  <DateTime date={data.createdAt} />
                </dd>
              </div>
              {data.justification && (
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{t('justification')}</dt>
                  <dd className="break-words whitespace-pre-line">{data.justification}</dd>
                </div>
              )}
              {data.grant && (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('access')}</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <GrantStatusBadge status={data.grant.viewStatus} />
                    <Link href="/dbaccess" className="text-primary hover:underline">
                      {t('openMyAccess')}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
