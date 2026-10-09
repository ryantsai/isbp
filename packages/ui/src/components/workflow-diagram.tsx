'use client';

import {
  type ApproverRule,
  type Branch,
  childBranches,
  localize,
  type WorkflowGraph,
  type WorkflowStep,
} from '@isbp/sdk';
import {
  BellIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleMinusIcon,
  ClockIcon,
  FlagIcon,
  ForwardIcon,
  PlayIcon,
  SkipForwardIcon,
  SplitIcon,
  UserCheckIcon,
  WorkflowIcon,
  XCircleIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, type ReactNode, useCallback } from 'react';
import { cn } from '../lib/utils';
import { UserAvatar } from './avatar';
import { type FactOption, useConditionText } from './condition-builder';
import { useReducedMotion } from './motion';

/** Where a step sits: the top-level sequence, or a branch of a parallel/condition step. */
export type SequenceRef = { kind: 'root' } | { kind: 'branch'; stepId: string; branchId: string };

export type StepRunStatus = 'active' | 'approved' | 'rejected' | 'skipped' | 'waiting';

/** Per-step state for showing a running or finished instance on the diagram. */
export interface StepRuntime {
  status: StepRunStatus;
  reason?: string;
  people?: { name: string; avatarUrl?: string | null; status: string }[];
}

export interface DiagramNames {
  groups?: Record<string, string>;
  roles?: Record<string, string>;
  users?: Record<string, string>;
  facts?: readonly FactOption[];
}

/** "Group: Security Team, otherwise Role: Platform administrator". */
export function useApproverText(names: DiagramNames = {}) {
  const t = useTranslations('ui.workflow.approver');
  const describe = useCallback(
    (root: ApproverRule): string => {
      function walk(rule: ApproverRule): string {
        let own: string;
        switch (rule.type) {
          case 'user':
            own = t('user', { name: names.users?.[rule.userId] ?? '…' });
            break;
          case 'group':
            own = t('group', { name: names.groups?.[rule.groupKey] ?? rule.groupKey });
            break;
          case 'role':
            own = t('role', { name: names.roles?.[rule.roleKey] ?? rule.roleKey });
            break;
          case 'manager':
            own = t('manager', { level: String(rule.level ?? 1) });
            break;
          case 'department-head':
            own = t('department-head');
            break;
          case 'fact': {
            const fact = names.facts?.find((f) => f.path === rule.fact)?.label ?? rule.fact;
            own = rule.kind === 'group' ? t('factGroup', { fact }) : t('fact', { fact });
            break;
          }
          case 'requester':
            own = t('requester');
            break;
        }
        return 'fallback' in rule && rule.fallback
          ? t('fallback', { rule: own, fallback: walk(rule.fallback) })
          : own;
      }
      return walk(root);
    },
    [names, t],
  );
  return describe;
}

const STATUS_ICON: Record<StepRunStatus, ReactNode> = {
  active: <ClockIcon className="size-3.5" />,
  approved: <CheckCircle2Icon className="size-3.5" />,
  rejected: <XCircleIcon className="size-3.5" />,
  skipped: <SkipForwardIcon className="size-3.5" />,
  waiting: <CircleDashedIcon className="size-3.5" />,
};
const STATUS_TONE: Record<StepRunStatus, string> = {
  active: 'text-primary',
  approved: 'text-success',
  rejected: 'text-destructive',
  skipped: 'text-muted-foreground',
  waiting: 'text-muted-foreground',
};

function TypeIcon({ type, className }: { type: WorkflowStep['type']; className?: string }) {
  if (type === 'approval') return <UserCheckIcon className={className} />;
  if (type === 'notify') return <BellIcon className={className} />;
  if (type === 'condition') return <SplitIcon className={className} />;
  return <WorkflowIcon className={className} />;
}

interface Ctx {
  names: DiagramNames;
  runtime?: Record<string, StepRuntime>;
  chosen?: Record<string, string>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  renderInsert?: (at: { parent: SequenceRef; index: number }) => ReactNode;
  renderActions?: (step: WorkflowStep, at: { parent: SequenceRef; index: number }) => ReactNode;
  issues?: Record<string, string[]>;
  dimmed?: boolean;
}

function Connector({ insert, dimmed }: { insert?: ReactNode; dimmed?: boolean }) {
  return (
    <div className={cn('relative flex h-9 w-px shrink-0 justify-center bg-border', dimmed && 'opacity-40')}>
      {insert && (
        <div className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">{insert}</div>
      )}
    </div>
  );
}

function StepCard({
  step,
  ctx,
  at,
}: {
  step: WorkflowStep;
  ctx: Ctx;
  at: { parent: SequenceRef; index: number };
}) {
  const t = useTranslations('ui.workflow');
  const locale = useLocale();
  const reduce = useReducedMotion();
  const describe = useApproverText(ctx.names);
  const conditionText = useConditionText(ctx.names.facts ?? []);
  const run = ctx.runtime?.[step.id];
  const status: StepRunStatus | undefined = ctx.runtime ? (run?.status ?? 'waiting') : undefined;
  const selected = ctx.selectedId === step.id;
  const issues = ctx.issues?.[step.id];
  const lines: string[] = [];
  if (step.type === 'approval') lines.push(...step.approvers.map(describe));
  if (step.type === 'notify') lines.push(...step.recipients.map(describe));
  const meta: string[] = [];
  if (step.type === 'approval') {
    meta.push(
      step.mode === 'quorum'
        ? t('mode.quorum', { n: step.quorum ?? 1, total: step.approvers.length })
        : t(`mode.${step.mode}`),
    );
    if (step.sla) meta.push(t('sla', { hours: step.sla.dueHours }));
  }
  if (step.type === 'parallel') meta.push(t('branches', { count: step.branches.length }));
  if (step.type === 'condition') meta.push(t('branches', { count: step.branches.length + 1 }));

  const Wrapper = ctx.onSelect ? 'button' : 'div';
  return (
    <motion.div layout="position" className="relative w-72 max-w-[80vw]">
      <Wrapper
        {...(ctx.onSelect
          ? { type: 'button' as const, onClick: () => ctx.onSelect!(step.id), 'aria-pressed': selected }
          : {})}
        className={cn(
          'group/step relative flex w-full flex-col gap-2 rounded-xl border bg-card p-3 text-left shadow-xs transition-[box-shadow,border-color,opacity]',
          ctx.onSelect &&
            'cursor-pointer hover:border-ring/40 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          selected && 'border-primary ring-2 ring-primary/30',
          issues?.length && 'border-destructive/60',
          status === 'approved' && 'border-success/40',
          status === 'rejected' && 'border-destructive/50',
          status === 'active' && 'border-primary/60 shadow-md',
          (status === 'skipped' || status === 'waiting' || ctx.dimmed) && 'border-dashed opacity-70',
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg',
              step.type === 'approval' && 'bg-primary/10 text-primary',
              step.type === 'notify' && 'bg-info/10 text-info',
              (step.type === 'condition' || step.type === 'parallel') &&
                'bg-warning/15 text-warning-foreground',
            )}
          >
            <TypeIcon type={step.type} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t(`types.${step.type}`)}
            </div>
            <div className="truncate text-sm font-semibold">{localize(step.name, locale) || '—'}</div>
          </div>
          {status && (
            <span className={cn('flex shrink-0 items-center gap-1 text-xs font-medium', STATUS_TONE[status])}>
              {status === 'active' ? (
                <span className="relative flex size-2">
                  {!reduce && (
                    <motion.span
                      className="absolute inline-flex size-full rounded-full bg-primary/60"
                      animate={{ scale: [1, 2.2], opacity: [0.7, 0] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                    />
                  )}
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
              ) : (
                STATUS_ICON[status]
              )}
              {t(`status.${status}`)}
            </span>
          )}
        </div>
        {lines.length > 0 && (
          <ul className="grid gap-0.5 text-xs text-muted-foreground">
            {lines.slice(0, 3).map((l, i) => (
              <li key={i} className="line-clamp-2">
                {l}
              </li>
            ))}
          </ul>
        )}
        {step.when && (
          <div className="rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
            {t('when', { condition: conditionText(step.when) })}
          </div>
        )}
        {meta.length > 0 && <div className="text-[11px] text-muted-foreground">{meta.join(' · ')}</div>}
        {run?.reason && <div className="text-xs text-muted-foreground">{t(`skipped.${run.reason}`)}</div>}
        {run?.people && run.people.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {run.people.slice(0, 6).map((p, i) => (
              <li
                key={i}
                className={cn(
                  'flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-0.5 text-[11px]',
                  p.status === 'approved' && 'border-success/40',
                  p.status === 'rejected' && 'border-destructive/40',
                  // Dimmed by colour, not opacity (which would take the initials below AA), and named by an icon.
                  (p.status === 'cancelled' || p.status === 'delegated') &&
                    'border-dashed text-muted-foreground',
                )}
              >
                <UserAvatar name={p.name} src={p.avatarUrl} className="size-4 text-[8px]" />
                <span className="max-w-28 truncate">{p.name}</span>
                {p.status === 'approved' && (
                  <CheckCircle2Icon className="size-3 text-success" aria-label={t('status.approved')} />
                )}
                {p.status === 'rejected' && (
                  <XCircleIcon className="size-3 text-destructive" aria-label={t('status.rejected')} />
                )}
                {p.status === 'delegated' && (
                  <ForwardIcon className="size-3" aria-label={t('status.delegated')} />
                )}
                {p.status === 'cancelled' && (
                  <CircleMinusIcon className="size-3" aria-label={t('status.cancelled')} />
                )}
              </li>
            ))}
          </ul>
        )}
        {issues?.length ? (
          <ul className="grid gap-0.5 text-xs text-destructive">
            {issues.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        ) : null}
      </Wrapper>
      {ctx.renderActions && (
        <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover/step:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {ctx.renderActions(step, at)}
        </div>
      )}
    </motion.div>
  );
}

function Branches({ step, ctx }: { step: WorkflowStep; ctx: Ctx }) {
  const t = useTranslations('ui.workflow');
  const locale = useLocale();
  const conditionText = useConditionText(ctx.names.facts ?? []);
  const branches = childBranches(step);
  const chosen = ctx.chosen?.[step.id];
  return (
    <div className="flex items-stretch">
      {branches.map((b: Branch, i) => {
        const first = i === 0;
        const last = i === branches.length - 1;
        const isOtherwise = step.type === 'condition' && b.id === step.otherwise.id;
        const when =
          step.type === 'condition' && !isOtherwise ? (b as Branch & { when?: never }).when : undefined;
        const dimmed = ctx.dimmed || (chosen !== undefined && chosen !== b.id);
        const ref: SequenceRef = { kind: 'branch', stepId: step.id, branchId: b.id };
        return (
          <div key={b.id} className="relative flex flex-col items-center px-3">
            <span
              aria-hidden
              className={cn(
                'absolute top-0 h-px bg-border',
                first && last
                  ? 'hidden'
                  : first
                    ? 'right-0 left-1/2'
                    : last
                      ? 'right-1/2 left-0'
                      : 'inset-x-0',
              )}
            />
            <span
              aria-hidden
              className={cn(
                'absolute bottom-0 h-px bg-border',
                first && last
                  ? 'hidden'
                  : first
                    ? 'right-0 left-1/2'
                    : last
                      ? 'right-1/2 left-0'
                      : 'inset-x-0',
              )}
            />
            <div className="h-4 w-px bg-border" />
            <div
              className={cn(
                'max-w-60 rounded-full border bg-background px-3 py-1 text-center text-xs font-medium',
                chosen === b.id && 'border-primary/50 text-primary',
                dimmed && 'opacity-50',
              )}
              title={when ? conditionText(when) : undefined}
            >
              <span className="line-clamp-2">
                {isOtherwise
                  ? localize(b.name, locale) || t('otherwise')
                  : localize(b.name, locale) || conditionText(when)}
              </span>
            </div>
            <Sequence steps={b.steps} parent={ref} ctx={{ ...ctx, dimmed }} />
            <div className="w-px flex-1 bg-border" />
          </div>
        );
      })}
    </div>
  );
}

function Sequence({ steps, parent, ctx }: { steps: readonly WorkflowStep[]; parent: SequenceRef; ctx: Ctx }) {
  const t = useTranslations('ui.workflow');
  return (
    <>
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          <Connector insert={ctx.renderInsert?.({ parent, index })} dimmed={ctx.dimmed} />
          <StepCard step={step} ctx={ctx} at={{ parent, index }} />
          {(step.type === 'parallel' || step.type === 'condition') && (
            <>
              <div className={cn('h-4 w-px bg-border', ctx.dimmed && 'opacity-40')} />
              <Branches step={step} ctx={ctx} />
            </>
          )}
        </Fragment>
      ))}
      <Connector insert={ctx.renderInsert?.({ parent, index: steps.length })} dimmed={ctx.dimmed} />
      {parent.kind === 'branch' && !steps.length && !ctx.renderInsert && (
        <div className="rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
          {t('noSteps')}
        </div>
      )}
    </>
  );
}

/**
 * Renders a workflow as a vertical flow: steps as cards, parallel/condition steps as side-by-side
 * branches. Pass `runtime` to show an instance's progress, or `renderInsert`/`onSelect` to edit.
 */
export function WorkflowDiagram({
  graph,
  names = {},
  runtime,
  chosen,
  outcome,
  selectedId,
  onSelect,
  renderInsert,
  renderActions,
  issues,
  className,
}: {
  graph: WorkflowGraph;
  names?: DiagramNames;
  runtime?: Record<string, StepRuntime>;
  /** Chosen branch per condition step (instance view). */
  chosen?: Record<string, string>;
  outcome?: 'running' | 'approved' | 'rejected' | 'cancelled';
  selectedId?: string | null;
  onSelect?: (stepId: string) => void;
  renderInsert?: Ctx['renderInsert'];
  renderActions?: Ctx['renderActions'];
  issues?: Record<string, string[]>;
  className?: string;
}) {
  const t = useTranslations('ui.workflow');
  const ctx: Ctx = { names, runtime, chosen, selectedId, onSelect, renderInsert, renderActions, issues };
  const endLabel =
    outcome === 'rejected' ? t('rejected') : outcome === 'cancelled' ? t('cancelled') : t('end');
  return (
    <div className={cn('flex min-w-max flex-col items-center px-4 py-2', className)}>
      <div className="flex items-center gap-2 rounded-full border bg-background px-4 py-1.5 text-sm font-medium shadow-xs">
        <PlayIcon className="size-3.5 text-primary" aria-hidden />
        {t('start')}
      </div>
      <Sequence steps={graph.steps} parent={{ kind: 'root' }} ctx={ctx} />
      <div
        className={cn(
          'flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium shadow-xs',
          outcome === 'approved' && 'border-success/40 bg-success/10 text-success',
          outcome === 'rejected' && 'border-destructive/40 bg-destructive/10 text-destructive',
          (!outcome || outcome === 'running' || outcome === 'cancelled') && 'bg-background',
        )}
      >
        {outcome === 'rejected' ? (
          <XCircleIcon className="size-3.5" aria-hidden />
        ) : (
          <FlagIcon
            className={cn('size-3.5', outcome === 'approved' ? '' : 'text-muted-foreground')}
            aria-hidden
          />
        )}
        {endLabel}
      </div>
    </div>
  );
}
