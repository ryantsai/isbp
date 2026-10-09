'use client';

import type { WorkflowInstance } from '@isbp/contracts';
import { childBranches, findStep, localize, walkSteps } from '@isbp/sdk';
import { RelativeTime } from '@isbp/ui/relative-time';
import { cn } from '@isbp/ui';
import {
  AlarmClockIcon,
  BanIcon,
  BellIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  FlagIcon,
  ForwardIcon,
  PlayIcon,
  SkipForwardIcon,
  SplitIcon,
  TrendingUpIcon,
  XCircleIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { DecisionValues } from './decision-values';

const ICONS: Record<string, { icon: ReactNode; tone: string }> = {
  started: { icon: <PlayIcon />, tone: 'bg-primary/10 text-primary' },
  step_started: { icon: <CircleDotIcon />, tone: 'bg-muted text-muted-foreground' },
  task_approved: { icon: <CheckCircle2Icon />, tone: 'bg-success/12 text-success' },
  task_already_approved: { icon: <CheckCircle2Icon />, tone: 'bg-success/12 text-success' },
  task_rejected: { icon: <XCircleIcon />, tone: 'bg-destructive/10 text-destructive' },
  task_delegated: { icon: <ForwardIcon />, tone: 'bg-info/12 text-info' },
  task_reminded: { icon: <AlarmClockIcon />, tone: 'bg-warning/15 text-warning-foreground' },
  task_overdue: { icon: <AlarmClockIcon />, tone: 'bg-destructive/10 text-destructive' },
  task_escalated: { icon: <TrendingUpIcon />, tone: 'bg-warning/15 text-warning-foreground' },
  task_auto_decided: { icon: <AlarmClockIcon />, tone: 'bg-warning/15 text-warning-foreground' },
  step_approved: { icon: <CheckCircle2Icon />, tone: 'bg-success/12 text-success' },
  step_rejected: { icon: <XCircleIcon />, tone: 'bg-destructive/10 text-destructive' },
  step_skipped: { icon: <SkipForwardIcon />, tone: 'bg-muted text-muted-foreground' },
  branch_chosen: { icon: <SplitIcon />, tone: 'bg-muted text-muted-foreground' },
  notified: { icon: <BellIcon />, tone: 'bg-info/12 text-info' },
  completed: { icon: <FlagIcon />, tone: 'bg-primary/10 text-primary' },
  cancelled: { icon: <BanIcon />, tone: 'bg-muted text-muted-foreground' },
};

/** What happened, in order: submitted, asked, approved/rejected/delegated, reminders, escalations. */
export function InstanceTimeline({ instance }: { instance: Pick<WorkflowInstance, 'events' | 'graph'> }) {
  const t = useTranslations('workflows.timeline');
  const locale = useLocale();
  const stepName = (id: string | null) => {
    if (!id) return '';
    const step = findStep(instance.graph, id);
    if (step) return localize(step.name, locale);
    for (const { step: s } of walkSteps(instance.graph.steps))
      for (const b of childBranches(s)) if (b.id === id) return localize(b.name, locale) || t('otherwise');
    return id;
  };
  // Hide noise: a step's start is implied by the decisions on it.
  const events = instance.events.filter((e) => e.type !== 'step_approved' && e.type !== 'step_started');
  return (
    <ol className="relative grid gap-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-border">
      {events.map((e, i) => {
        const look = ICONS[e.type] ?? ICONS.step_started!;
        const data = (e.data ?? {}) as Record<string, unknown>;
        const branchStep = e.type === 'branch_chosen' ? stepName(String(data.branchId ?? '')) : '';
        const values = {
          actor: e.actorName ?? t('system'),
          step: stepName(e.stepId),
          to: String(data.toName ?? ''),
          branch: branchStep,
          count: Number(data.added ?? data.recipients ?? data.assignees ?? 0),
          outcome: String(data.outcome ?? ''),
          reason: String(data.reason ?? ''),
          from: stepName(String(data.fromStepId ?? '')),
        };
        const key = t.has(`events.${e.type}`) ? `events.${e.type}` : 'events.other';
        const comment = typeof data.comment === 'string' && data.comment ? data.comment : null;
        const reason =
          e.type === 'cancelled' && typeof data.reason === 'string' && data.reason ? data.reason : null;
        // What the approver filled in with the decision (the step's fields).
        const decided = findStep(instance.graph, e.stepId ?? '');
        const filled =
          data.fields && typeof data.fields === 'object' && decided?.type === 'approval' && decided.fields
            ? { fields: decided.fields, data: data.fields as Record<string, unknown> }
            : null;
        return (
          <motion.li
            key={e.seq}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.3) }}
            className="relative flex gap-3"
          >
            <span
              className={cn(
                'relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-background [&_svg]:size-4',
                look.tone,
              )}
            >
              {look.icon}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm">
                {t(key, { ...values, type: e.type })}
                {e.type === 'step_skipped' && values.reason && (
                  <span className="text-muted-foreground">
                    {' '}
                    — {t.has(`reasons.${values.reason}`) ? t(`reasons.${values.reason}`) : values.reason}
                  </span>
                )}
              </p>
              {e.type === 'task_already_approved' && (
                <p className="text-sm text-muted-foreground">
                  {t('reasons.already-approved', { step: values.from })}
                </p>
              )}
              {(comment || reason) && (
                <blockquote className="mt-1.5 rounded-lg border-l-2 border-primary/40 bg-muted/50 px-3 py-2 text-sm whitespace-pre-line text-foreground/90">
                  {comment ?? reason}
                </blockquote>
              )}
              {filled && <DecisionValues fields={filled.fields} data={filled.data} className="mt-1.5" />}
              <RelativeTime date={e.createdAt} className="mt-0.5 block text-xs text-muted-foreground" />
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
