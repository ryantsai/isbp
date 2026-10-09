'use client';

import type { WorkflowInstance } from '@isbp/contracts';
import { localize, walkSteps } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import type { FactOption } from '@isbp/ui/condition-builder';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Label } from '@isbp/ui/label';
import { Markdown } from '@isbp/ui/markdown';
import { Disclosure, FadeIn } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatusBadge } from '@isbp/ui/status';
import { Textarea } from '@isbp/ui/textarea';
import { type StepRuntime, WorkflowDiagram } from '@isbp/ui/workflow-diagram';
import {
  BanIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ClockIcon,
  GavelIcon,
  GitCompareArrowsIcon,
  HourglassIcon,
  type LucideIcon,
  MinusCircleIcon,
  PencilIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useLocale, useNow, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import type { z } from 'zod';
import type { TicketDetail, updateChangeSchema } from '../../contracts';
import { ChangeTypeBadge, RiskBadge, TicketStatusBadge } from '../components/badges';
import {
  ChangePlanFields,
  type ChangePlanValues,
  ConflictCheck,
  windowInvalid,
} from '../components/change-plan';
import { fromLocalInput, INVALIDATE, ticketApi, ticketHref, toLocalInput } from '../lib';
import { windowProblem } from '../logic';
import type { ChangeDetail } from '../types';
import { useTransition, useTransitionError } from './actions';

type ChangePatch = z.input<typeof updateChangeSchema>;

const toValues = (c: ChangeDetail): ChangePlanValues => ({
  changeType: c.changeType,
  risk: c.risk,
  reason: c.reason,
  plannedStart: toLocalInput(c.plannedStart),
  plannedEnd: toLocalInput(c.plannedEnd),
  implementationPlan: c.implementationPlan,
  backoutPlan: c.backoutPlan,
  testPlan: c.testPlan,
});

function EditPlanDialog({
  ticket,
  change,
  mode,
  onOpenChange,
}: {
  ticket: TicketDetail;
  change: ChangeDetail;
  /** `submit`: opened by "Submit for approval" (the window is missing or has passed): save, then submit. */
  mode: PlanMode;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('itsm.changePlan');
  const tc = useTranslations('common');
  const open = mode !== null;
  const [values, setValues] = useState<ChangePlanValues>(() => toValues(change));
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setValues(toValues(change));
    setTouched(false);
  }, [open, change]);
  const onTransitionError = useTransitionError();
  const submit = useTransition(ticket, () => onOpenChange(false));
  const save = useApiMutation(
    (api, body: ChangePatch) => api.patch<TicketDetail>(`${ticketApi(ticket.reference)}/change`, body),
    {
      invalidate: INVALIDATE,
      success: mode === 'submit' ? undefined : tc('saved'),
      onSuccess: () => {
        if (mode !== 'submit') return onOpenChange(false);
        submit.mutate({ status: 'authorization' }, { onError: (err) => onTransitionError(err) });
      },
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t(mode === 'submit' ? 'submitTitle' : 'editTitle')}</DialogTitle>
          <DialogDescription>
            {mode === 'submit' ? t('submitHint') : `${ticket.reference} · ${ticket.title}`}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (windowInvalid(values)) return;
            save.mutate({
              ...values,
              reason: values.reason.trim(),
              plannedStart: fromLocalInput(values.plannedStart),
              plannedEnd: fromLocalInput(values.plannedEnd),
            });
          }}
        >
          <ChangePlanFields value={values} onChange={setValues} showErrors={touched} />
          <ConflictCheck
            plannedStart={values.plannedStart}
            plannedEnd={values.plannedEnd}
            ciIds={ticket.cis.map((c) => c.id)}
            exclude={ticket.id}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={save.isPending || submit.isPending}>
              {mode === 'submit' ? t('saveAndSubmit') : tc('saveChanges')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** How the plan editor was opened: to edit, or to fix the window before submitting. */
export type PlanMode = 'edit' | 'submit' | null;

function PlanSection({ title, text, empty }: { title: string; text: string; empty: string }) {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-1.5">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {text ? <Markdown>{text}</Markdown> : <p className="text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}

/** Step states of the CAB instance for the diagram (decisions, who is asked, skipped reasons). */
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

const OUTCOME: Record<
  WorkflowInstance['status'],
  { variant: 'info' | 'success' | 'destructive' | 'muted'; icon: ReactNode }
> = {
  running: { variant: 'info', icon: <ClockIcon aria-hidden /> },
  approved: { variant: 'success', icon: <CheckCircle2Icon aria-hidden /> },
  rejected: { variant: 'destructive', icon: <XCircleIcon aria-hidden /> },
  cancelled: { variant: 'muted', icon: <BanIcon aria-hidden /> },
};

/** The CAB instance of a change (shared by the attention banner and the plan card through the query cache). */
function useCabInstance(instanceId: string | null | undefined) {
  return useApiQuery<WorkflowInstance>(instanceId ? `/workflow-instances/${instanceId}` : null);
}

/** Single-person rules: when they resolve to nobody, a `fallback` (often a whole group) is asked instead. */
const SINGLE: readonly string[] = ['user', 'manager', 'department-head', 'fact'];

interface PathStep {
  id: string;
  name: string;
  status: 'active' | 'approved' | 'rejected' | 'skipped';
  reason?: string;
  pending: { id: string; displayName: string; avatarUrl: string | null }[];
  decidedBy: string | null;
  decidedAt: string | null;
  dueAt: string | null;
  /** Everyone of a fallback group is asked; the first answer decides. */
  fellBack: boolean;
  anyDecides: boolean;
}

/** The taken path only: approval steps that ran, are running or were skipped (untaken branches are left out). */
function pathOf(instance: WorkflowInstance, locale: string): PathStep[] {
  const out: PathStep[] = [];
  for (const { step } of walkSteps(instance.graph.steps)) {
    if (step.type !== 'approval') continue;
    const st = instance.state.steps[step.id];
    if (!st) continue;
    const tasks = instance.tasks.filter((x) => x.stepId === step.id && x.status !== 'delegated');
    const pending = tasks.filter((x) => x.status === 'pending').map((x) => x.assignee);
    const decided = tasks.find((x) => x.status === 'approved' || x.status === 'rejected');
    const status = st.status === 'active' && instance.status !== 'running' ? 'skipped' : st.status;
    out.push({
      id: step.id,
      name: localize(step.name, locale),
      status,
      reason: st.reason,
      pending,
      decidedBy: decided?.decidedBy?.displayName ?? decided?.assignee.displayName ?? null,
      decidedAt: decided?.decidedAt ?? null,
      dueAt:
        tasks
          .filter((x) => x.status === 'pending' && x.dueAt)
          .map((x) => x.dueAt!)
          .sort()[0] ?? null,
      fellBack:
        tasks.length > step.approvers.length &&
        step.approvers.every((r) => SINGLE.includes(r.type) && 'fallback' in r && Boolean(r.fallback)),
      anyDecides: step.mode === 'any',
    });
  }
  return out;
}

const STEP_ICON: Record<PathStep['status'], LucideIcon> = {
  active: HourglassIcon,
  approved: CheckCircle2Icon,
  rejected: XCircleIcon,
  skipped: MinusCircleIcon,
};

/** "① Change manager — waiting for Platform Admin · due in 24 h": who decides, by when; skipped steps say why. */
function ApprovalStepper({ instance }: { instance: WorkflowInstance }) {
  const t = useTranslations('itsm.changePlan.approval');
  const locale = useLocale();
  const steps = pathOf(instance, locale);
  if (!steps.length) return null;
  return (
    <ol className="grid">
      {steps.map((s, i) => {
        const Icon = STEP_ICON[s.status];
        const last = i === steps.length - 1;
        return (
          <li key={s.id} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
            {!last && (
              <span
                aria-hidden
                className={cn(
                  'absolute top-7 bottom-0 left-3.5 w-px origin-top -translate-x-1/2 transition-colors duration-(--motion-base) motion-reduce:transition-none',
                  s.status === 'approved' ? 'bg-success/60' : 'bg-border',
                )}
              />
            )}
            <span
              className={cn(
                'grid size-7 place-items-center rounded-full border bg-background',
                s.status === 'approved' && 'border-success/40 bg-success/10 text-success',
                s.status === 'rejected' && 'border-destructive/40 bg-destructive/10 text-destructive',
                s.status === 'active' && 'border-info/40 bg-info/10 text-info',
                s.status === 'skipped' && 'text-muted-foreground',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className={cn('min-w-0 pt-0.5 text-sm', s.status === 'skipped' && 'text-muted-foreground')}>
              <p className="font-medium">
                {s.name}
                <span className="sr-only"> · {t(`stepStatus.${s.status}`)}</span>
              </p>
              {s.status === 'active' && (
                <>
                  <p className="text-muted-foreground">
                    {t('waitingForPeople', {
                      names: s.pending
                        .slice(0, 3)
                        .map((p) => p.displayName)
                        .join(', '),
                      more: Math.max(0, s.pending.length - 3),
                    })}
                    {s.dueAt && (
                      <>
                        {' · '}
                        {t('due')} <RelativeTime date={s.dueAt} />
                      </>
                    )}
                  </p>
                  {s.fellBack ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('fellBack', { count: s.pending.length })}
                    </p>
                  ) : (
                    s.anyDecides &&
                    s.pending.length > 1 && (
                      <p className="mt-1 text-xs text-muted-foreground">{t('firstAnswer')}</p>
                    )
                  )}
                </>
              )}
              {(s.status === 'approved' || s.status === 'rejected') && (
                <p className="text-muted-foreground">
                  {t(s.status === 'approved' ? 'approvedBy' : 'rejectedBy', { name: s.decidedBy ?? '—' })}
                  {s.decidedAt && (
                    <>
                      {' · '}
                      <RelativeTime date={s.decidedAt} />
                    </>
                  )}
                </p>
              )}
              {s.status === 'skipped' && (
                <p className="text-xs">
                  {t(s.reason === 'no-approver' ? 'skippedNobody' : 'skippedCondition')}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Approve (comment optional) or reject (comment required) a CAB task from the change itself. */
function DecideDialog({
  taskId,
  decision,
  subject,
  onOpenChange,
}: {
  taskId: string;
  decision: 'approve' | 'reject' | null;
  subject: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('itsm.changePlan.decide');
  const tc = useTranslations('common');
  const id = useId();
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [shown, setShown] = useState(decision);
  if (decision !== shown) {
    setShown(decision);
    setComment('');
    setTouched(false);
  }
  const decide = useApiMutation(
    (api, body: { decision: 'approve' | 'reject'; comment?: string }) =>
      api.post(`/approvals/${taskId}/${body.decision}`, { comment: body.comment }),
    {
      invalidate: [...INVALIDATE, '/workflow-instances', '/me/approvals', '/me/badges'],
      success: (_r) => (decision === 'approve' ? t('approved') : t('rejected')),
      onSuccess: () => onOpenChange(false),
    },
  );
  const missing = decision === 'reject' && !comment.trim();
  return (
    <Dialog open={decision !== null} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t(decision === 'reject' ? 'rejectTitle' : 'approveTitle')}</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!decision || missing) return;
            decide.mutate({ decision, comment: comment.trim() || undefined });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-comment`}>{t(decision === 'reject' ? 'reason' : 'comment')}</Label>
            <Textarea
              id={`${id}-comment`}
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              aria-invalid={touched && missing ? true : undefined}
              aria-describedby={`${id}-hint`}
            />
            <p
              id={`${id}-hint`}
              className={cn('text-xs', touched && missing ? 'text-destructive' : 'text-muted-foreground')}
            >
              {touched && missing ? t('reasonRequired') : t('commentHint')}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button
              type="submit"
              variant={decision === 'reject' ? 'destructive' : 'default'}
              loading={decide.isPending}
            >
              {t(decision === 'reject' ? 'reject' : 'approve')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Your approval is needed": under the change's header when the viewer has a pending CAB task, with Approve / Reject
 * right here (steps that ask the approver to fill in fields open the approvals inbox instead).
 */
export function CabAttention({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.changePlan.decide');
  const instanceId = ticket.change?.approvalInstanceId;
  const { data } = useCabInstance(ticket.status === 'authorization' ? instanceId : null);
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  if (!data?.myTaskId || data.status !== 'running') return null;
  const task = data.tasks.find((x) => x.id === data.myTaskId);
  const step = task ? walkSteps(data.graph.steps).find((s) => s.step.id === task.stepId)?.step : undefined;
  const hasFields = step?.type === 'approval' && (step.fields?.length ?? 0) > 0;
  return (
    <FadeIn
      role="region"
      aria-label={t('title')}
      className="flex flex-col gap-3 rounded-xl border border-info/40 bg-info/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <GavelIcon className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
        <div className="grid gap-0.5 text-sm">
          <p className="font-semibold">{t('title')}</p>
          <p className="text-muted-foreground">
            {task?.dueAt ? (
              <>
                {t('dueHint')} <RelativeTime date={task.dueAt} />
              </>
            ) : (
              t('hint')
            )}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {hasFields ? (
          <Button asChild>
            <Link href={`/approvals?task=${data.myTaskId}`}>{t('openTask')}</Link>
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => setDecision('reject')}>
              <XCircleIcon aria-hidden />
              {t('reject')}
            </Button>
            <Button onClick={() => setDecision('approve')}>
              <CheckCircle2Icon aria-hidden />
              {t('approve')}
            </Button>
          </>
        )}
      </div>
      <DecideDialog
        taskId={data.myTaskId}
        decision={decision}
        subject={`${ticket.reference} · ${ticket.title}`}
        onOpenChange={(o) => !o && setDecision(null)}
      />
    </FadeIn>
  );
}

/** The CAB approval: outcome, the taken path with who and by when, and the whole flow on demand. */
function ApprovalSection({ instanceId }: { instanceId: string }) {
  const t = useTranslations('itsm.changePlan.approval');
  const tf = useTranslations('itsm.changePlan.facts');
  const tv = useTranslations('itsm');
  const { data, isLoading, error } = useCabInstance(instanceId);
  const facts = useMemo<FactOption[]>(
    () => [
      {
        path: 'change.type',
        label: tf('type'),
        type: 'string',
        options: (['standard', 'normal', 'emergency'] as const).map((v) => ({
          value: v,
          label: tv(`changeType.${v}`),
        })),
      },
      {
        path: 'change.risk',
        label: tf('risk'),
        type: 'string',
        options: (['low', 'medium', 'high'] as const).map((v) => ({ value: v, label: tv(`risk.${v}`) })),
      },
      { path: 'change.impact', label: tf('impact'), type: 'number' },
      { path: 'change.ciCount', label: tf('ciCount'), type: 'number' },
      { path: 'change.durationHours', label: tf('durationHours'), type: 'number' },
      { path: 'change.criticalCis', label: tf('criticalCis'), type: 'boolean' },
    ],
    [tf, tv],
  );
  const rt = useMemo(() => (data ? runtimeOf(data) : null), [data]);
  if (isLoading) return <Skeleton className="h-24 w-full rounded-lg" />;
  if (error || !data || !rt) return <p className="text-sm text-muted-foreground">{t('unavailable')}</p>;
  const outcome = OUTCOME[data.status];
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={outcome.variant}>
          {outcome.icon}
          {t(`status.${data.status}`)}
        </Badge>
      </div>
      <ApprovalStepper instance={data} />
      {data.outcomeComment && (
        <p className="rounded-lg border-l-2 bg-muted/40 px-3 py-1.5 text-sm">{data.outcomeComment}</p>
      )}
      <Disclosure
        summary={<span className="text-sm text-muted-foreground">{t('wholeFlow')}</span>}
        className="min-w-0"
        contentClassName="min-w-0 pt-2"
      >
        <div className="overflow-x-auto rounded-xl border bg-muted/20 py-4 [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:16px_16px]">
          <WorkflowDiagram
            graph={data.graph}
            names={{ ...data.names, facts }}
            runtime={rt.runtime}
            chosen={rt.chosen}
            outcome={data.status}
          />
        </div>
      </Disclosure>
    </div>
  );
}

/** The change plan: type, risk, window, reason and plans (change managers edit), conflicts and CAB. */
export function ChangeCard({
  ticket,
  plan,
  onPlanChange,
}: {
  ticket: TicketDetail;
  /** The plan editor, opened from here or from the header ("Edit plan", submitting without a window). */
  plan: PlanMode;
  onPlanChange: (mode: PlanMode) => void;
}) {
  const t = useTranslations('itsm.changePlan');
  const tc = useTranslations('common');
  const format = useFormatter();
  const canManage = useCan('itsm.changes.manage') && ticket.viewer.canEdit;
  const now = useNow({ updateInterval: 60_000 });
  const change = ticket.change;
  if (!change) return null;
  const plannedWindow =
    change.plannedStart && change.plannedEnd
      ? format.dateTimeRange(new Date(change.plannedStart), new Date(change.plannedEnd), {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCompareArrowsIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <ChangeTypeBadge type={change.changeType} />
          <RiskBadge risk={change.risk} />
          <span className="inline-flex items-center gap-1.5">
            <CalendarClockIcon className="size-4" aria-hidden />
            {plannedWindow ?? t('noWindow')}
          </span>
          {['draft', 'assessment'].includes(ticket.status) && windowProblem(change, now) === 'past' && (
            <StatusBadge tone="warning" icon={TriangleAlertIcon} label={t('windowPassed')} />
          )}
        </CardDescription>
        {canManage && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => onPlanChange('edit')}>
              <PencilIcon />
              {tc('edit')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid min-w-0 grid-cols-1 gap-5">
        {change.conflicts.length > 0 && (
          <div
            role="status"
            className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm"
          >
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlertIcon className="size-4 shrink-0 text-warning-foreground" aria-hidden />
              {t('conflicts.found', { count: change.conflicts.length })}
            </p>
            <ul className="grid gap-1">
              {change.conflicts.map((c) => (
                <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link
                    href={ticketHref(c.reference)}
                    className="font-mono text-xs font-medium hover:underline"
                  >
                    {c.reference}
                  </Link>
                  <span className="min-w-0 truncate">{c.title}</span>
                  <TicketStatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <PlanSection title={t('reason')} text={change.reason} empty={t('empty')} />
        <PlanSection title={t('implementationPlan')} text={change.implementationPlan} empty={t('empty')} />
        <PlanSection title={t('backoutPlan')} text={change.backoutPlan} empty={t('empty')} />
        <PlanSection title={t('testPlan')} text={change.testPlan} empty={t('empty')} />
        {change.approvalInstanceId ? (
          <section className="grid gap-2 border-t pt-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <GavelIcon className="size-4 text-muted-foreground" aria-hidden />
              {t('approval.title')}
            </h3>
            <ApprovalSection instanceId={change.approvalInstanceId} />
          </section>
        ) : (
          ['draft', 'assessment'].includes(ticket.status) && (
            <p className="border-t pt-4 text-sm text-muted-foreground">{t('approval.notStarted')}</p>
          )
        )}
      </CardContent>
      {canManage && (
        <EditPlanDialog
          ticket={ticket}
          change={change}
          mode={plan}
          onOpenChange={(o) => !o && onPlanChange(null)}
        />
      )}
    </Card>
  );
}
