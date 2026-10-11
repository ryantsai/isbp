'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { SelectableCard } from '@astryxdesign/core/SelectableCard';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
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
import { IconTile } from './icon-tile';

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
  active: <StatusDot variant="accent" isPulsing label="" aria-hidden />,
  approved: <Icon icon={CheckCircle2Icon} />,
  rejected: <Icon icon={XCircleIcon} />,
  skipped: <Icon icon={SkipForwardIcon} />,
  waiting: <Icon icon={CircleDashedIcon} />,
};
const STATUS_VARIANT = {
  active: 'info',
  approved: 'success',
  rejected: 'error',
  skipped: 'neutral',
  waiting: 'neutral',
} as const satisfies Record<StepRunStatus, string>;

/** The card's tint says where the step is; the badge and the text say it in words. */
const STATUS_CARD = {
  active: 'blue',
  approved: 'green',
  rejected: 'red',
  skipped: 'muted',
  waiting: 'muted',
} as const satisfies Record<StepRunStatus, string>;

function TypeIcon({ type }: { type: WorkflowStep['type'] }) {
  const Glyph =
    type === 'approval'
      ? UserCheckIcon
      : type === 'notify'
        ? BellIcon
        : type === 'condition'
          ? SplitIcon
          : WorkflowIcon;
  return (
    <IconTile
      aria-hidden
      size="sm"
      className={
        type === 'notify'
          ? 'text-(--color-text-blue)'
          : type === 'condition' || type === 'parallel'
            ? 'text-(--color-text-yellow)'
            : undefined
      }
    >
      <Glyph />
    </IconTile>
  );
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
    <div
      className={cn(
        'relative flex h-9 w-px shrink-0 justify-center bg-(--color-border)',
        dimmed && 'opacity-40',
      )}
    >
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

  const name = localize(step.name, locale) || '—';
  const variant = issues?.length ? 'red' : status ? STATUS_CARD[status] : 'default';
  const body = (
    <VStack gap={2}>
      <div className="flex items-start gap-2.5">
        <TypeIcon type={step.type} />
        <div className="min-w-0 flex-1">
          <Text type="supporting" size="xsm" weight="semibold" display="block">
            {t(`types.${step.type}`)}
          </Text>
          <Text weight="semibold" maxLines={1}>
            {name}
          </Text>
        </div>
      </div>
      {status && (
        <div>
          <Badge variant={STATUS_VARIANT[status]} icon={STATUS_ICON[status]} label={t(`status.${status}`)} />
        </div>
      )}
      {lines.length > 0 && (
        <VStack gap={0.5}>
          {lines.slice(0, 3).map((l, i) => (
            <Text key={i} type="supporting" maxLines={2}>
              {l}
            </Text>
          ))}
        </VStack>
      )}
      {step.when && (
        <Text type="supporting" color="secondary">
          {t('when', { condition: conditionText(step.when) })}
        </Text>
      )}
      {meta.length > 0 && (
        <Text type="supporting" size="xsm" display="block">
          {meta.join(' · ')}
        </Text>
      )}
      {run?.reason && <Text type="supporting">{t(`skipped.${run.reason}`)}</Text>}
      {run?.people && run.people.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {run.people.slice(0, 6).map((p, i) => (
            <li key={i} className="min-w-0">
              <Token
                size="sm"
                label={p.name}
                color={
                  p.status === 'approved'
                    ? 'green'
                    : p.status === 'rejected'
                      ? 'red'
                      : p.status === 'cancelled' || p.status === 'delegated'
                        ? 'gray'
                        : 'default'
                }
                icon={<UserAvatar name={p.name} src={p.avatarUrl} className="size-4 text-[8px]" />}
                endContent={
                  p.status === 'approved' ? (
                    <Icon icon={CheckCircle2Icon} size="xsm" label={t('status.approved')} />
                  ) : p.status === 'rejected' ? (
                    <Icon icon={XCircleIcon} size="xsm" label={t('status.rejected')} />
                  ) : p.status === 'delegated' ? (
                    <Icon icon={ForwardIcon} size="xsm" label={t('status.delegated')} />
                  ) : p.status === 'cancelled' ? (
                    <Icon icon={CircleMinusIcon} size="xsm" label={t('status.cancelled')} />
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
      {issues?.length ? (
        <ul className="grid gap-0.5">
          {issues.map((m, i) => (
            <li key={i}>
              <Text type="supporting" className="text-(--color-text-red)">
                {m}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
    </VStack>
  );
  const dimmed = status === 'skipped' || status === 'waiting' || ctx.dimmed;

  return (
    <motion.div
      layout="position"
      className={cn('group/step relative w-72 max-w-[80vw]', dimmed && 'opacity-70')}
    >
      {ctx.onSelect ? (
        <SelectableCard
          label={`${t(`types.${step.type}`)}: ${name}`}
          isSelected={selected}
          onChange={() => ctx.onSelect!(step.id)}
          variant={variant}
          padding={3}
        >
          {body}
        </SelectableCard>
      ) : (
        <Card variant={variant} padding={3}>
          {body}
        </Card>
      )}
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
                'absolute top-0 h-px bg-(--color-border)',
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
                'absolute bottom-0 h-px bg-(--color-border)',
                first && last
                  ? 'hidden'
                  : first
                    ? 'right-0 left-1/2'
                    : last
                      ? 'right-1/2 left-0'
                      : 'inset-x-0',
              )}
            />
            <div className="h-4 w-px bg-(--color-border)" />
            <div
              className={cn('max-w-60', dimmed && 'opacity-50')}
              title={when ? conditionText(when) : undefined}
            >
              <Badge
                variant={chosen === b.id ? 'info' : 'neutral'}
                label={
                  isOtherwise
                    ? localize(b.name, locale) || t('otherwise')
                    : localize(b.name, locale) || conditionText(when)
                }
              />
            </div>
            <Sequence steps={b.steps} parent={ref} ctx={{ ...ctx, dimmed }} />
            <div className="w-px flex-1 bg-(--color-border)" />
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
              <div className={cn('h-4 w-px bg-(--color-border)', ctx.dimmed && 'opacity-40')} />
              <Branches step={step} ctx={ctx} />
            </>
          )}
        </Fragment>
      ))}
      <Connector insert={ctx.renderInsert?.({ parent, index: steps.length })} dimmed={ctx.dimmed} />
      {parent.kind === 'branch' && !steps.length && !ctx.renderInsert && (
        <Text type="supporting" color="secondary">
          {t('noSteps')}
        </Text>
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
      <Badge variant="neutral" icon={<Icon icon={PlayIcon} />} label={t('start')} />
      <Sequence steps={graph.steps} parent={{ kind: 'root' }} ctx={ctx} />
      <Badge
        variant={outcome === 'approved' ? 'success' : outcome === 'rejected' ? 'error' : 'neutral'}
        icon={<Icon icon={outcome === 'rejected' ? XCircleIcon : FlagIcon} />}
        label={endLabel}
      />
    </div>
  );
}
