'use client';

import type { WorkflowInstance } from '@isbp/contracts';
import { evaluateCondition, localize, walkSteps } from '@isbp/sdk';
import { useCan, usePlatform, type WebPageProps } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  BanIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ClockIcon,
  DatabaseIcon,
  FileQuestionIcon,
  GavelIcon,
  SkipForwardIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { AccessRequest } from '../../contracts';
import { EngineLabel, GrantStatusBadge, RequestStatusBadge, RiskBadge } from '../badges';
import { INVALIDATE, useDate, useDay, useLocalized } from '../lib';

type StepView = {
  id: string;
  name: string;
  state: 'approved' | 'rejected' | 'waiting' | 'skipped' | 'later';
  people: string[];
  at: string | null;
};

/** The approval steps in plain words: who approved, who it waits for, what is next, what isn't needed. */
function stepsOf(instance: WorkflowInstance, locale: string): StepView[] {
  const out: StepView[] = [];
  for (const { step } of walkSteps(instance.graph.steps)) {
    if (step.type !== 'approval') continue;
    const st = instance.state.steps[step.id];
    const tasks = instance.tasks.filter((x) => x.stepId === step.id && x.status !== 'delegated');
    const decided = tasks.filter((x) => x.status === 'approved' || x.status === 'rejected');
    const base = { id: step.id, name: localize(step.name, locale), at: decided[0]?.decidedAt ?? null };
    if (st?.status === 'approved')
      out.push({
        ...base,
        state: 'approved',
        people: decided.map((x) => (x.decidedBy ?? x.assignee).displayName),
      });
    else if (st?.status === 'rejected')
      out.push({
        ...base,
        state: 'rejected',
        people: decided.map((x) => (x.decidedBy ?? x.assignee).displayName),
      });
    else if (st?.status === 'active' && instance.status === 'running')
      out.push({
        ...base,
        state: 'waiting',
        people: tasks.filter((x) => x.status === 'pending').map((x) => x.assignee.displayName),
      });
    // A step whose condition doesn't hold for this request won't run: say so instead of showing it as pending.
    else if (st?.status === 'skipped' || (!st && !evaluateCondition(step.when, instance.facts)))
      out.push({ ...base, state: 'skipped', people: [] });
    else if (instance.status === 'running') out.push({ ...base, state: 'later', people: [] });
  }
  return out;
}

const STEP_ICON = {
  approved: { icon: CircleCheckIcon, className: 'text-success' },
  rejected: { icon: CircleXIcon, className: 'text-destructive' },
  waiting: { icon: ClockIcon, className: 'text-info' },
  skipped: { icon: SkipForwardIcon, className: 'text-muted-foreground' },
  later: { icon: CircleDashedIcon, className: 'text-muted-foreground' },
} as const;

/** Who the request waits for and the approval path, without the rules behind it. */
function ApprovalPath({ instanceId }: { instanceId: string }) {
  const t = useTranslations('dbaccess.requestPage');
  const locale = useLocale();
  const date = useDate();
  const { data, isLoading, error } = useApiQuery<WorkflowInstance>(`/workflow-instances/${instanceId}`);
  const steps = useMemo(() => (data ? stepsOf(data, locale) : []), [data, locale]);
  if (isLoading) return <Skeleton className="h-32 w-full rounded-lg" />;
  if (error || !data) return <p className="text-sm text-muted-foreground">{t('pathHidden')}</p>;
  return (
    <div className="grid min-w-0 gap-3">
      <ol className="grid gap-3" aria-label={t('path')}>
        {steps.map((s) => {
          const { icon: Icon, className } = STEP_ICON[s.state];
          return (
            <li key={s.id} className={cn('flex min-w-0 gap-3', s.state === 'skipped' && 'opacity-70')}>
              <Icon className={cn('mt-0.5 size-5 shrink-0', className)} aria-hidden />
              <div className="min-w-0 text-sm">
                <p className="font-medium wrap-break-word">{s.name}</p>
                <p className="text-muted-foreground wrap-break-word">
                  {s.state === 'approved'
                    ? t('step.approved', { names: s.people.join(', '), date: date(s.at) })
                    : s.state === 'rejected'
                      ? t('step.rejected', { names: s.people.join(', '), date: date(s.at) })
                      : s.state === 'waiting'
                        ? t('step.waiting', { names: s.people.slice(0, 5).join(', ') })
                        : s.state === 'skipped'
                          ? t('step.skipped')
                          : t('step.later')}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {data.myTaskId && (
        <Button asChild size="sm" className="justify-self-start">
          <Link href={`/approvals?task=${data.myTaskId}`}>{t('decide')}</Link>
        </Button>
      )}
    </div>
  );
}

export default function RequestDetailPage({ params }: WebPageProps) {
  const t = useTranslations('dbaccess.requestPage');
  const tn = useTranslations('dbaccess.nav');
  const ta = useTranslations('requests.access');
  const l = useLocalized();
  const day = useDay();
  const { user } = usePlatform();
  const readsGrants = useCan('dbaccess.grants.read');
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
            <Link href="/requests">{ta('backToRequests')}</Link>
          </Button>
        }
      />
    );

  // The requester came from Requests (My requests); DBAs and auditors from Who has access.
  const back =
    data.requester?.id === user.id || !readsGrants
      ? { href: '/requests', label: ta('backToRequests') }
      : { href: '/dbaccess/grants', label: tn('grants') };

  return (
    <>
      <DetailHeader
        back={back}
        icon={<DatabaseIcon />}
        reference={data.reference}
        title={`${l(data.role.name)} · ${data.server.displayName}`}
        status={<RequestStatusBadge status={data.status} />}
        meta={t(`statusHint.${data.status}`)}
        primaryAction={
          data.grant ? (
            <Button asChild>
              <Link href="/dbaccess">{t('openMyAccess')}</Link>
            </Button>
          ) : undefined
        }
        menu={
          data.canCancel
            ? [
                {
                  id: 'cancel',
                  label: t('cancel'),
                  icon: <BanIcon />,
                  destructive: true,
                  disabled: cancel.isPending,
                  onSelect: () => cancel.mutate(undefined),
                },
              ]
            : []
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
