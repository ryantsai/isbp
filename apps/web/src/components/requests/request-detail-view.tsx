'use client';

import type {
  AccessRequest,
  FormAssignment,
  FormSubmission,
  RequestPath,
  WorkflowInstance,
} from '@isbp/contracts';
import { type LocalizedText, localize } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
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
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { FormAnswers } from '@isbp/ui/form-renderer';
import { Disclosure, SuccessMark } from '@isbp/ui/motion';
import { DetailHeader } from '@isbp/ui/page-header';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { MappedStatus } from '@isbp/ui/status';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CircleCheckIcon,
  FileQuestionIcon,
  KeyRoundIcon,
  PrinterIcon,
  UndoIcon,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { NavIcon } from '../nav-icon';
import { useRoleText } from '../roles/role-utils';
import { InstanceProgress } from '../workflows/instance-progress';
import { InstanceTimeline } from '../workflows/instance-timeline';
import { Field, Person, RiskBadge } from '../workflows/subject-details';
import { ApprovalPathList, pathSteps } from './approval-path';
import { RequestActions, RequestReminders } from './request-actions';
import { RequestDecisions, RequestEvidence } from './request-evidence';
import { REQUESTER_STATUS, type RequesterStatus, requesterStatusOf } from './request-status';

type Lookup = { kind: 'access'; request: AccessRequest } | { kind: 'form'; submission: FormSubmission };

/** An answer worth showing: no empty fields, no unticked boxes. */
function answered(value: unknown) {
  if (value === undefined || value === null || value === '' || value === false) return false;
  return !(Array.isArray(value) && value.length === 0);
}

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

const HERO_TONE: Partial<Record<RequesterStatus, string>> = {
  waiting: 'border-warning/40 bg-warning/10',
  rejected: 'border-destructive/30 bg-destructive/5',
  failed: 'border-destructive/30 bg-destructive/5',
  approved: 'border-success/30 bg-success/5',
  done: 'border-success/30 bg-success/5',
};

/** Under the title: what is happening, who it waits for, by when, and what comes next. */
function StatusHero({
  status,
  path,
  fulfilmentState,
  outcomeComment,
}: {
  status: RequesterStatus;
  path: RequestPath | undefined;
  fulfilmentState: string | null;
  outcomeComment: string | null;
}) {
  const t = useTranslations('requests.detail.hero');
  const format = useFormatter();
  const locale = useLocale();
  const current = path?.steps.find((s) => s.state === 'current') ?? null;
  const next = path?.steps.find((s) => s.state === 'upcoming') ?? null;
  const names = current?.people.map((p) => p.displayName) ?? [];
  const when = (v: string) => format.dateTime(new Date(v), { dateStyle: 'medium', timeStyle: 'short' });
  const stepName = (s: { name: LocalizedText }) => localize(s.name, locale);

  const headline =
    status === 'waiting'
      ? current
        ? t('waitingFor', { names: names.length > 1 ? `${names[0]} +${names.length - 1}` : (names[0] ?? '') })
        : t('waiting')
      : status === 'inProgress'
        ? t('fulfilling', { status: fulfilmentState ?? '' })
        : status === 'approved'
          ? t('approved')
          : status === 'done'
            ? t('done')
            : status === 'rejected'
              ? t('rejected')
              : status === 'withdrawn'
                ? t('withdrawn')
                : status === 'failed'
                  ? t('failed')
                  : t('received');

  return (
    <section
      aria-labelledby="request-status"
      className={`grid grid-cols-1 gap-2 rounded-xl border px-5 py-4 ${HERO_TONE[status] ?? 'border-info/25 bg-info/5'}`}
    >
      <h2 id="request-status" className="sr-only">
        {t('label')}
      </h2>
      <p className="text-base font-semibold [overflow-wrap:anywhere]">{headline}</p>
      {status === 'waiting' && current && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="text-foreground">{stepName(current)}</span>
          {current.since && <span>· {t('since', { date: when(current.since) })}</span>}
          {current.dueAt && <span>· {t('due', { date: when(current.dueAt) })}</span>}
        </p>
      )}
      {status === 'waiting' && next && (
        <p className="text-sm text-muted-foreground">{t('next', { step: stepName(next) })}</p>
      )}
      {status === 'rejected' && outcomeComment && (
        <p className="text-sm whitespace-pre-line">{outcomeComment}</p>
      )}
    </section>
  );
}

function AccessDetails({ r }: { r: AccessRequest }) {
  const t = useTranslations('requests.detail');
  const format = useFormatter();
  const roleText = useRoleText();
  const role = roleText(r.role);
  // "For" only when someone else gets the access.
  const forSomeoneElse = r.beneficiary.id !== r.requester?.id;
  return (
    <div className="grid grid-cols-1 gap-4">
      {r.status === 'approved' && (
        <Banner tone="success" icon={<CircleCheckIcon className="size-4" />}>
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
            {forSomeoneElse && (
              <Field label={t('for')}>
                <Person person={r.beneficiary} />
              </Field>
            )}
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
  const Icon = f.state === 'done' ? CircleCheckIcon : f.state === 'cancelled' ? UndoIcon : KeyRoundIcon;
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

/** A to-do's finish: done, and where it is recorded (the request was sent from `?todo=`). */
function TodoDone({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations('requests.detail.todo');
  const format = useFormatter();
  const todo = useApiQuery<FormAssignment>(`/me/form-assignments/${assignmentId}`);
  const a = todo.data;
  if (!a || a.status !== 'done') return null;
  const period =
    a.periodKey && /^\d{4}-\d{2}$/.test(a.periodKey)
      ? format.dateTime(new Date(`${a.periodKey}-01T00:00:00Z`), {
          year: 'numeric',
          month: 'long',
          timeZone: 'UTC',
        })
      : a.periodKey;
  return (
    <section
      role="status"
      aria-labelledby="todo-done"
      className="flex flex-col gap-4 rounded-xl border border-success/30 bg-success/5 px-5 py-4 sm:flex-row sm:items-center"
    >
      <SuccessMark label={t('label')} />
      <div className="grid min-w-0 flex-1 gap-1">
        <p id="todo-done" className="font-semibold [overflow-wrap:anywhere]">
          {t('done', { title: a.title })}
        </p>
        {period && <p className="text-sm text-muted-foreground">{t('recorded', { period })}</p>}
      </div>
      <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
        <Link href="/my-work">
          {t('back')}
          <ArrowRightIcon aria-hidden />
        </Link>
      </Button>
    </section>
  );
}

/** The approval path for the requester; the workflow diagram only for people who read workflows (behind "Details"). */
function ApprovalSection({
  path,
  instanceId,
  toDo,
}: {
  path: RequestPath | undefined;
  instanceId: string | null;
  toDo: boolean;
}) {
  const t = useTranslations('requests.detail');
  const isAdmin = useCan('core.workflows.read');
  const instance = useApiQuery<WorkflowInstance>(instanceId ? `/workflow-instances/${instanceId}` : null);
  if (!instanceId && !path?.steps.length) {
    return toDo ? null : <p className="text-sm text-muted-foreground">{t('noApproval')}</p>;
  }
  return (
    <section
      aria-labelledby="request-path"
      className="grid min-w-0 grid-cols-1 gap-4 rounded-xl border bg-card p-5 sm:p-6"
    >
      <div className="grid min-w-0 gap-0.5">
        <h2 id="request-path" className="text-base font-semibold">
          {t('path')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('pathDescription')}</p>
      </div>
      {path ? (
        <ApprovalPathList steps={pathSteps(path)} />
      ) : (
        <div className="grid gap-3">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      )}
      <Disclosure
        summary={t('history')}
        className="rounded-lg border"
        triggerClassName="w-full justify-between px-4 py-3 text-sm font-medium"
        contentClassName="px-4 pb-4"
      >
        {instance.data ? (
          <InstanceTimeline instance={instance.data} />
        ) : (
          <Skeleton className="h-24 w-full rounded-lg" />
        )}
      </Disclosure>
      {isAdmin && instance.data && (
        <Disclosure
          summary={t('details')}
          className="rounded-lg border"
          triggerClassName="w-full justify-between px-4 py-3 text-sm font-medium"
          contentClassName="px-4 pb-4"
        >
          <p className="mb-3 text-xs text-muted-foreground">{t('workflowHint')}</p>
          <InstanceProgress instance={instance.data} />
        </Disclosure>
      )}
    </section>
  );
}

function RequestBody({
  lookup,
  reference,
  todoId,
}: {
  lookup: Lookup;
  reference: string;
  todoId: string | null;
}) {
  const t = useTranslations('requests.detail');
  const tRoot = useTranslations();
  const locale = useLocale();
  const roleText = useRoleText();
  const isAccess = lookup.kind === 'access';
  const item = isAccess ? lookup.request : lookup.submission;
  const title = isAccess ? roleText(lookup.request.role).name : localize(lookup.submission.form.name, locale);
  const instanceId = item.workflow?.id ?? null;
  const cancelPath = isAccess ? `/access-requests/${item.id}/cancel` : `/form-submissions/${item.id}/cancel`;
  const path = useApiQuery<RequestPath>(`/requests/${encodeURIComponent(reference)}/path`);
  const status = requesterStatusOf(item);
  // Empty answers are left out, and so are unticked boxes: the answers a person gave.
  const answers = isAccess
    ? []
    : lookup.submission.schema.elements.filter(
        (e) =>
          'key' in e &&
          answered((lookup.submission.data as Record<string, unknown>)[(e as { key: string }).key]),
      );
  const toDo = todoId !== null && !isAccess;

  return (
    <div className="grid grid-cols-1 gap-8">
      <DetailHeader
        back={{ href: '/requests', label: t('back') }}
        icon={isAccess ? <KeyRoundIcon /> : <NavIcon name={lookup.submission.form.icon} />}
        reference={item.reference}
        title={title}
        status={<MappedStatus map={REQUESTER_STATUS} value={status} t={tRoot} animate />}
        meta={
          <span>
            {t('submittedAt')} <DateTime date={item.createdAt} />
          </span>
        }
        actions={
          isAccess
            ? []
            : [
                {
                  label: t('print'),
                  icon: <PrinterIcon />,
                  href: `/requests/${encodeURIComponent(item.reference)}/print`,
                },
              ]
        }
      >
        {item.canCancel && <WithdrawButton path={cancelPath} />}
      </DetailHeader>

      {toDo && todoId && <TodoDone assignmentId={todoId} />}

      <StatusHero
        status={status}
        path={path.data}
        fulfilmentState={
          !isAccess && lookup.submission.fulfilment
            ? t(`fulfilment.${lookup.submission.fulfilment.state}`)
            : null
        }
        outcomeComment={isAccess ? (lookup.request.workflow?.outcomeComment ?? null) : null}
      />

      <ApprovalSection path={path.data} instanceId={instanceId} toDo={toDo} />

      {!isAccess && lookup.submission.fulfilment && <FulfilmentCard f={lookup.submission.fulfilment} />}

      {isAccess ? (
        <AccessDetails r={lookup.request} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('answers')}</CardTitle>
          </CardHeader>
          <CardContent>
            {answers.length ? (
              <FormAnswers
                elements={answers}
                data={lookup.submission.data}
                people={lookup.submission.people}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t('noAnswers')}</p>
            )}
          </CardContent>
        </Card>
      )}
      {!isAccess && <RequestDecisions submission={lookup.submission} />}
      {!isAccess && <RequestActions submission={lookup.submission} />}
      {!isAccess && <RequestReminders submission={lookup.submission} />}
      {!isAccess && <RequestEvidence submissionId={lookup.submission.id} />}
    </div>
  );
}

/** One request (access or form) by its number: where it is, who it waits for, and what happens next. */
export function RequestDetailView({ reference }: { reference: string }) {
  const t = useTranslations('requests.detail');
  const todoId = useSearchParams().get('todo');
  const { data, isLoading, error } = useApiQuery<Lookup>(`/requests/${encodeURIComponent(reference)}`);
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
  return <RequestBody lookup={data} reference={reference} todoId={todoId} />;
}
