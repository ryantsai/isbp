'use client';

import type { WorkflowInstance } from '@isbp/contracts';
import { localize, walkSteps } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
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
import { Markdown } from '@isbp/ui/markdown';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { type StepRuntime, WorkflowDiagram } from '@isbp/ui/workflow-diagram';
import {
  BanIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ClockIcon,
  GavelIcon,
  GitCompareArrowsIcon,
  PencilIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
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
import type { ChangeDetail } from '../types';

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
  open,
  onOpenChange,
}: {
  ticket: TicketDetail;
  change: ChangeDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('itsm.changePlan');
  const tc = useTranslations('common');
  const [values, setValues] = useState<ChangePlanValues>(() => toValues(change));
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setValues(toValues(change));
    setTouched(false);
  }, [open, change]);
  const save = useApiMutation(
    (api, body: ChangePatch) => api.patch<TicketDetail>(`${ticketApi(ticket.reference)}/change`, body),
    { invalidate: INVALIDATE, success: tc('saved'), onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>
            {ticket.reference} · {ticket.title}
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
            <Button type="submit" loading={save.isPending}>
              {tc('saveChanges')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlanSection({ title, text, empty }: { title: string; text: string; empty: string }) {
  return (
    <section className="grid gap-1.5">
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

/** The CAB approval: outcome, who it waits for and the path (Phase 1 workflow instance). */
function ApprovalSection({ instanceId }: { instanceId: string }) {
  const t = useTranslations('itsm.changePlan.approval');
  const tf = useTranslations('itsm.changePlan.facts');
  const tv = useTranslations('itsm');
  const locale = useLocale();
  const { data, isLoading, error } = useApiQuery<WorkflowInstance>(`/workflow-instances/${instanceId}`);
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
  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (error || !data || !rt) return <p className="text-sm text-muted-foreground">{t('unavailable')}</p>;
  const outcome = OUTCOME[data.status];
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={outcome.variant}>
          {outcome.icon}
          {t(`status.${data.status}`)}
        </Badge>
        {data.currentSteps.length > 0 && (
          <span className="text-muted-foreground">
            {data.currentSteps.map((s) => localize(s.name, locale)).join(', ')}
          </span>
        )}
      </div>
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
      {data.outcomeComment && (
        <p className="rounded-lg border-l-2 bg-muted/40 px-3 py-1.5 text-sm">{data.outcomeComment}</p>
      )}
      <div className="overflow-x-auto rounded-xl border bg-muted/20 py-4 [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:16px_16px]">
        <WorkflowDiagram
          graph={data.graph}
          names={{ ...data.names, facts }}
          runtime={rt.runtime}
          chosen={rt.chosen}
          outcome={data.status}
        />
      </div>
      <Link href="/approvals" className="text-sm font-medium text-primary hover:underline">
        {t('openInbox')}
      </Link>
    </div>
  );
}

/** The change plan: type, risk, window, reason and plans (change managers edit), conflicts and CAB. */
export function ChangeCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.changePlan');
  const tc = useTranslations('common');
  const format = useFormatter();
  const canManage = useCan('itsm.changes.manage') && ticket.viewer.canEdit;
  const [editing, setEditing] = useState(false);
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
        </CardDescription>
        {canManage && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon />
              {tc('edit')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-5">
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
        <EditPlanDialog ticket={ticket} change={change} open={editing} onOpenChange={setEditing} />
      )}
    </Card>
  );
}
