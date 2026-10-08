'use client';

import type { AccessRequest, FormSubmission, WorkflowInstance } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@isbp/ui/alert-dialog';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { FormAnswers } from '@isbp/ui/form-renderer';
import { PageHeader } from '@isbp/ui/page-header';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleCheckIcon,
  CircleXIcon,
  FileQuestionIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  PrinterIcon,
  UndoIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { NavIcon } from '../nav-icon';
import { useRoleText } from '../roles/role-utils';
import { RequestActions, RequestReminders } from './request-actions';
import { RequestDecisions, RequestEvidence } from './request-evidence';
import { InstanceProgress } from '../workflows/instance-progress';
import { InstanceTimeline } from '../workflows/instance-timeline';
import { StatusBadge } from '../workflows/status-badges';
import { Field, Person, RiskBadge } from '../workflows/subject-details';

type Lookup = { kind: 'access'; request: AccessRequest } | { kind: 'form'; submission: FormSubmission };

function WithdrawButton({ path }: { path: string }) {
  const t = useTranslations('requests.detail');
  const withdraw = useApiMutation((api) => api.post(path, {}), {
    invalidate: ['/requests', '/me/requests', '/workflow-instances', '/me/badges', '/requestable-roles'],
    success: t('withdrawn'),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <UndoIcon />
          {t('withdraw')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('withdrawTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('withdrawBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => withdraw.mutate(undefined)}>{t('withdraw')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'success' | 'destructive';
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={
        tone === 'success'
          ? 'flex items-start gap-2 rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm'
          : 'flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm'
      }
    >
      <span className={tone === 'success' ? 'text-success' : 'text-destructive'}>{icon}</span>
      <div>{children}</div>
    </div>
  );
}

function AccessDetails({ r }: { r: AccessRequest }) {
  const t = useTranslations('requests.detail');
  const format = useFormatter();
  const roleText = useRoleText();
  const role = roleText(r.role);
  return (
    <div className="grid grid-cols-1 gap-4">
      {r.status === 'approved' && (
        <Banner tone="success" icon={<CheckCircle2Icon className="size-4" />}>
          {r.expiresAt
            ? t('grantedUntil', {
                date: format.dateTime(new Date(r.expiresAt), { dateStyle: 'long', timeStyle: 'short' }),
              })
            : t('grantedPermanent')}
        </Banner>
      )}
      {r.status === 'failed' && (
        <Banner tone="destructive" icon={<AlertTriangleIcon className="size-4" />}>
          {t(
            `failure.${
              r.failureReason === 'role_deleted' ||
              r.failureReason === 'beneficiary_suspended' ||
              r.failureReason === 'beneficiary_offboarded'
                ? r.failureReason
                : 'beneficiary_inactive'
            }`,
          )}
        </Banner>
      )}
      {r.status === 'rejected' && r.workflow?.outcomeComment && (
        <Banner tone="destructive" icon={<AlertTriangleIcon className="size-4" />}>
          <span className="font-medium">{t('rejectedBecause')}</span> {r.workflow.outcomeComment}
        </Banner>
      )}
      <Card>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label={t('role')}>
              <span className="font-medium">{role.name}</span>
              {r.role.application.key !== 'isbp' && (
                <span className="ml-1.5 text-muted-foreground">· {r.role.application.name}</span>
              )}
              {role.description && <p className="mt-0.5 text-xs text-muted-foreground">{role.description}</p>}
            </Field>
            <Field label={t('risk')}>
              <RiskBadge level={r.role.riskLevel} />
            </Field>
            <Field label={t('for')}>
              <Person person={r.beneficiary} />
            </Field>
            <Field label={t('requestedBy')}>
              <Person person={r.requester} />
            </Field>
            <Field label={t('duration')}>
              {r.durationDays ? t('days', { count: r.durationDays }) : t('permanent')}
            </Field>
            {r.scopeDepartment && <Field label={t('scope')}>{r.scopeDepartment.name}</Field>}
            <Field label={t('justification')} wide>
              <p className="rounded-lg bg-muted/50 px-3 py-2 whitespace-pre-line">{r.justification}</p>
            </Field>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function WorkflowSection({ instanceId }: { instanceId: string }) {
  const t = useTranslations('requests.detail');
  const { data } = useApiQuery<WorkflowInstance>(`/workflow-instances/${instanceId}`);
  if (!data) return <Skeleton className="h-72 w-full rounded-xl" />;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <section className="grid min-w-0 content-start gap-3">
        <h2 className="text-base font-semibold">{t('path')}</h2>
        {data.status === 'running' && data.pendingWith.length > 0 && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {t('waitingFor')}
            {data.pendingWith.slice(0, 5).map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 text-foreground">
                <UserAvatar name={p.displayName} src={p.avatarUrl} className="size-5 text-[9px]" />
                {p.displayName}
              </span>
            ))}
            {data.pendingWith.length > 5 && <span>+{data.pendingWith.length - 5}</span>}
          </p>
        )}
        <InstanceProgress instance={data} />
      </section>
      <section className="grid min-w-0 content-start gap-3">
        <h2 className="text-base font-semibold">{t('history')}</h2>
        <InstanceTimeline instance={data} />
      </section>
    </div>
  );
}

/** One request (access or form) by its number, with its approval path and history. */
const FULFILMENT_TONE = {
  neutral: 'muted',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
} as const;

/** Where the request is being fulfilled (e.g. the service-desk ticket), reported by the module. */
function FulfilmentCard({ f }: { f: NonNullable<FormSubmission['fulfilment']> }) {
  const t = useTranslations('requests.detail');
  const root = useTranslations();
  const Icon =
    f.state === 'done' ? CircleCheckIcon : f.state === 'cancelled' ? CircleXIcon : LoaderCircleIcon;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 pt-6">
        <span
          className={
            'grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4 ' +
            (f.state === 'done'
              ? 'bg-success/12 text-success'
              : f.state === 'cancelled'
                ? 'bg-muted text-muted-foreground'
                : 'bg-info/12 text-info')
          }
        >
          <Icon aria-hidden />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-medium">{t(`fulfilment.${f.state}`)}</span>
          <span className="text-sm text-muted-foreground">
            {t('fulfilment.updated')} <RelativeTime date={f.updatedAt} />
          </span>
        </span>
        <Badge variant={FULFILMENT_TONE[f.tone ?? 'neutral']}>
          {root.has(f.statusKey) ? root(f.statusKey) : f.statusKey.split('.').pop()}
        </Badge>
        <Button asChild variant="outline" size="sm">
          <Link href={f.href}>
            {t('fulfilment.openRef', { reference: f.reference })}
            <ArrowRightIcon aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function RequestDetailView({ reference }: { reference: string }) {
  const t = useTranslations('requests.detail');
  const locale = useLocale();
  const roleText = useRoleText();
  const { data, isLoading, error } = useApiQuery<Lookup>(`/requests/${encodeURIComponent(reference)}`);
  const back = (
    <Link href="/requests" className="inline-flex items-center gap-1 hover:text-foreground">
      <ArrowLeftIcon className="size-3.5" aria-hidden />
      {t('back')}
    </Link>
  );
  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error || !data)
    return (
      <EmptyState
        icon={<FileQuestionIcon />}
        title={t('notFound')}
        action={
          <Button asChild variant="outline">
            <Link href="/requests">{t('back')}</Link>
          </Button>
        }
      />
    );
  const isAccess = data.kind === 'access';
  const item = isAccess ? data.request : data.submission;
  const title = isAccess ? roleText(data.request.role).name : localize(data.submission.form.name, locale);
  const instanceId = item.workflow?.id ?? null;
  const cancelPath = isAccess ? `/access-requests/${item.id}/cancel` : `/form-submissions/${item.id}/cancel`;

  return (
    <div className="grid grid-cols-1 gap-8">
      <PageHeader
        eyebrow={back}
        title={
          <span className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">
              {isAccess ? <KeyRoundIcon /> : <NavIcon name={data.submission.form.icon} />}
            </span>
            <span className="truncate">{title}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{item.reference}</span>
            <StatusBadge status={item.status} />
            <span>
              {t('submittedAt')} <DateTime date={item.createdAt} /> (<RelativeTime date={item.createdAt} />)
            </span>
          </span>
        }
        actions={
          isAccess ? (
            item.canCancel ? (
              <WithdrawButton path={cancelPath} />
            ) : undefined
          ) : (
            <div className="flex flex-wrap gap-2">
              {/* A print-friendly page of the request (audit evidence): answers, decisions, actions, attachments. */}
              <Button asChild variant="outline">
                <Link href={`/requests/${encodeURIComponent(item.reference)}/print`}>
                  <PrinterIcon aria-hidden />
                  {t('print')}
                </Link>
              </Button>
              {item.canCancel && <WithdrawButton path={cancelPath} />}
            </div>
          )
        }
      />
      {!isAccess && data.submission.fulfilment && <FulfilmentCard f={data.submission.fulfilment} />}
      {isAccess ? (
        <AccessDetails r={data.request} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('answers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FormAnswers
              elements={data.submission.schema.elements}
              data={data.submission.data}
              people={data.submission.people}
            />
          </CardContent>
        </Card>
      )}
      {!isAccess && <RequestDecisions submission={data.submission} />}
      {!isAccess && <RequestActions submission={data.submission} />}
      {!isAccess && <RequestReminders submission={data.submission} />}
      {!isAccess && <RequestEvidence submissionId={data.submission.id} />}
      {instanceId ? (
        <WorkflowSection instanceId={instanceId} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('noApproval')}</p>
      )}
    </div>
  );
}
