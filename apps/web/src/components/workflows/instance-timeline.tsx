'use client';

import type { WorkflowInstance } from '@isbp/contracts';
import { childBranches, findStep, localize, walkSteps } from '@isbp/sdk';
import { IconTile } from '@isbp/ui/icon-tile';
import { RelativeTime } from '@isbp/ui/relative-time';
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '@isbp/ui/timeline';
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
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { DecisionValues } from './decision-values';

const ICONS: Record<string, { icon: ReactNode; tone: string }> = {
  started: { icon: <PlayIcon />, tone: 'text-primary' },
  step_started: { icon: <CircleDotIcon />, tone: 'text-muted-foreground' },
  task_approved: { icon: <CheckCircle2Icon />, tone: 'text-success' },
  task_already_approved: { icon: <CheckCircle2Icon />, tone: 'text-success' },
  task_rejected: { icon: <XCircleIcon />, tone: 'text-destructive' },
  task_delegated: { icon: <ForwardIcon />, tone: 'text-info' },
  task_reminded: { icon: <AlarmClockIcon />, tone: 'text-warning-foreground' },
  task_overdue: { icon: <AlarmClockIcon />, tone: 'text-destructive' },
  task_escalated: { icon: <TrendingUpIcon />, tone: 'text-warning-foreground' },
  task_auto_decided: { icon: <AlarmClockIcon />, tone: 'text-warning-foreground' },
  step_approved: { icon: <CheckCircle2Icon />, tone: 'text-success' },
  step_rejected: { icon: <XCircleIcon />, tone: 'text-destructive' },
  step_skipped: { icon: <SkipForwardIcon />, tone: 'text-muted-foreground' },
  branch_chosen: { icon: <SplitIcon />, tone: 'text-muted-foreground' },
  notified: { icon: <BellIcon />, tone: 'text-info' },
  completed: { icon: <FlagIcon />, tone: 'text-primary' },
  cancelled: { icon: <BanIcon />, tone: 'text-muted-foreground' },
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
    <Timeline>
      {events.map((e) => {
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
          <TimelineItem key={e.seq}>
            <TimelineHeader>
              <TimelineSeparator />
              <TimelineIndicator asChild>
                <IconTile size="xs" className={look.tone}>
                  {look.icon}
                </IconTile>
              </TimelineIndicator>
              <TimelineTitle className="font-normal">
                {t(key, { ...values, type: e.type })}
                {e.type === 'step_skipped' && values.reason && (
                  <span className="text-muted-foreground">
                    {' '}
                    — {t.has(`reasons.${values.reason}`) ? t(`reasons.${values.reason}`) : values.reason}
                  </span>
                )}
              </TimelineTitle>
            </TimelineHeader>
            <TimelineContent>
              {e.type === 'task_already_approved' && (
                <p>{t('reasons.already-approved', { step: values.from })}</p>
              )}
              {(comment || reason) && (
                <blockquote className="mt-1 rounded-md border-l-2 border-primary/40 bg-muted/50 px-2.5 py-1.5 whitespace-pre-line text-foreground/90">
                  {comment ?? reason}
                </blockquote>
              )}
              {filled && <DecisionValues fields={filled.fields} data={filled.data} className="mt-1" />}
              <RelativeTime date={e.createdAt} className="mt-0.5 block text-xs" />
            </TimelineContent>
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}
