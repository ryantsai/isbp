'use client';

import {
  type ApprovalStep,
  type ConditionBranch,
  type ConditionStep,
  type NotifyStep,
  type ParallelStep,
  type SlaPolicy,
  type WorkflowStep,
} from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { ConditionBuilder } from '@isbp/ui/condition-builder';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Separator } from '@isbp/ui/separator';
import { Switch } from '@isbp/ui/switch';
import { cn } from '@isbp/ui';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import { ApproverList } from './approver-editor';
import { useBuilder } from './builder-context';
import { newBranch } from './graph-ops';

function Group({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0.25,
  suffix,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  suffix?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs font-normal">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          min={min}
          step="any"
          className="w-28"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function WhenEditor({ step, onChange }: { step: WorkflowStep; onChange: (s: WorkflowStep) => void }) {
  const t = useTranslations('workflows.builder.editor');
  const { facts } = useBuilder();
  return (
    <Group title={t('when')} description={t('whenHint')}>
      <ToggleRow
        label={t('onlySometimes')}
        checked={Boolean(step.when)}
        onChange={(v) => onChange({ ...step, when: v ? { all: [] } : undefined })}
      />
      {step.when && (
        <ConditionBuilder
          value={step.when}
          facts={facts}
          onChange={(when) => onChange({ ...step, when: when ?? { all: [] } })}
        />
      )}
    </Group>
  );
}

function ApprovalEditor({ step, onChange }: { step: ApprovalStep; onChange: (s: WorkflowStep) => void }) {
  const t = useTranslations('workflows.builder.editor');
  const id = useId();
  const sla = step.sla;
  const setSla = (patch: Partial<SlaPolicy> | null) =>
    onChange({
      ...step,
      sla: patch === null ? undefined : ({ dueHours: 48, onBreach: 'notify', ...sla, ...patch } as SlaPolicy),
    });
  return (
    <>
      <Group title={t('approvers')} description={t('approversHint')}>
        <ApproverList
          rules={step.approvers}
          onChange={(approvers) => onChange({ ...step, approvers })}
          addLabel={t('addApprover')}
        />
        <div className="grid gap-1.5 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-mode`} className="text-xs font-normal">
              {t('mode')}
            </Label>
            <Select
              value={step.mode}
              onValueChange={(v) =>
                onChange({
                  ...step,
                  mode: v as ApprovalStep['mode'],
                  quorum:
                    v === 'quorum' ? (step.quorum ?? Math.min(2, step.approvers.length || 1)) : undefined,
                })
              }
            >
              <SelectTrigger id={`${id}-mode`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t('modes.any')}</SelectItem>
                <SelectItem value="all">{t('modes.all')}</SelectItem>
                <SelectItem value="quorum">{t('modes.quorum')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {step.mode === 'quorum' && (
            <NumberField
              label={t('quorum')}
              min={1}
              value={step.quorum}
              onChange={(v) => onChange({ ...step, quorum: v ? Math.round(v) : undefined })}
              suffix={t('ofSlots', { count: step.approvers.length })}
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t(`modeHints.${step.mode}`)}</p>
      </Group>
      <Separator />
      <Group title={t('deadline')} description={t('deadlineHint')}>
        <ToggleRow label={t('useDeadline')} checked={Boolean(sla)} onChange={(v) => setSla(v ? {} : null)} />
        {sla && (
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap gap-4">
              <NumberField
                label={t('dueIn')}
                value={sla.dueHours}
                onChange={(v) => setSla({ dueHours: v ?? 1 })}
                suffix={t('hours')}
              />
              <NumberField
                label={t('remindAfter')}
                value={sla.remindHours}
                onChange={(v) => setSla({ remindHours: v })}
                suffix={t('hours')}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-breach`} className="text-xs font-normal">
                {t('whenLate')}
              </Label>
              <Select
                value={sla.onBreach}
                onValueChange={(v) =>
                  setSla({
                    onBreach: v as SlaPolicy['onBreach'],
                    escalateTo:
                      v === 'escalate' ? (sla.escalateTo ?? [{ type: 'manager', level: 2 }]) : undefined,
                  })
                }
              >
                <SelectTrigger id={`${id}-breach`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['notify', 'escalate', 'approve', 'reject'] as const).map((b) => (
                    <SelectItem key={b} value={b}>
                      {t(`breach.${b}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {sla.onBreach === 'escalate' && (
              <div className="grid gap-1.5">
                <span className="text-xs">{t('escalateTo')}</span>
                <ApproverList
                  rules={sla.escalateTo ?? []}
                  onChange={(escalateTo) => setSla({ escalateTo })}
                  addLabel={t('addApprover')}
                />
              </div>
            )}
          </div>
        )}
      </Group>
      <Separator />
      <Group title={t('options')}>
        <ToggleRow
          label={t('allowDelegation')}
          hint={t('allowDelegationHint')}
          checked={step.allowDelegation !== false}
          onChange={(v) => onChange({ ...step, allowDelegation: v ? undefined : false })}
        />
        <ToggleRow
          label={t('allowSelf')}
          hint={t('allowSelfHint')}
          checked={Boolean(step.allowSelfApproval)}
          onChange={(v) => onChange({ ...step, allowSelfApproval: v || undefined })}
        />
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-none`} className="text-xs font-normal">
            {t('ifNobody')}
          </Label>
          <Select
            value={step.ifNoApprover ?? 'reject'}
            onValueChange={(v) => onChange({ ...step, ifNoApprover: v as 'reject' | 'skip' })}
          >
            <SelectTrigger id={`${id}-none`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reject">{t('nobody.reject')}</SelectItem>
              <SelectItem value="skip">{t('nobody.skip')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-instructions`} className="text-xs font-normal">
            {t('instructions')}
          </Label>
          <LocalizedInput
            id={`${id}-instructions`}
            multiline
            value={step.instructions}
            onChange={(instructions) =>
              onChange({ ...step, instructions: Object.keys(instructions).length ? instructions : undefined })
            }
            placeholder={t('instructionsPlaceholder')}
          />
        </div>
      </Group>
    </>
  );
}

function ConditionEditor({ step, onChange }: { step: ConditionStep; onChange: (s: WorkflowStep) => void }) {
  const t = useTranslations('workflows.builder.editor');
  const locale = useLocale();
  const { facts } = useBuilder();
  const set = (branches: ConditionBranch[]) => onChange({ ...step, branches });
  return (
    <Group
      title={t('paths')}
      description={t('pathsHint')}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            set([
              ...step.branches,
              {
                ...newBranch({ [locale]: t('newPath', { n: step.branches.length + 1 }) }),
                when: { all: [] },
              },
            ])
          }
        >
          <PlusIcon />
          {t('addPath')}
        </Button>
      }
    >
      <ol className="grid gap-3">
        {step.branches.map((b, i) => (
          <li key={b.id} className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                {i + 1}
              </span>
              <LocalizedInput
                className="flex-1"
                aria-label={t('pathName')}
                value={b.name}
                onChange={(name) => set(step.branches.map((x) => (x.id === b.id ? { ...x, name } : x)))}
              />
              <div className="flex">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('moveUp')}
                  disabled={i === 0}
                  onClick={() =>
                    set(step.branches.map((x, j) => (j === i - 1 ? b : j === i ? step.branches[i - 1]! : x)))
                  }
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('moveDown')}
                  disabled={i === step.branches.length - 1}
                  onClick={() =>
                    set(step.branches.map((x, j) => (j === i + 1 ? b : j === i ? step.branches[i + 1]! : x)))
                  }
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('removePath')}
                  disabled={step.branches.length <= 1}
                  onClick={() => set(step.branches.filter((x) => x.id !== b.id))}
                >
                  <XIcon />
                </Button>
              </div>
            </div>
            <ConditionBuilder
              value={b.when}
              facts={facts}
              onChange={(when) =>
                set(step.branches.map((x) => (x.id === b.id ? { ...x, when: when ?? { all: [] } } : x)))
              }
            />
            {b.steps.length > 0 && (
              <p className="text-xs text-muted-foreground">{t('pathSteps', { count: b.steps.length })}</p>
            )}
          </li>
        ))}
        <li className="grid gap-2 rounded-lg border border-dashed p-3">
          <span className="text-xs font-medium text-muted-foreground">{t('otherwise')}</span>
          <LocalizedInput
            aria-label={t('pathName')}
            value={step.otherwise.name}
            onChange={(name) => onChange({ ...step, otherwise: { ...step.otherwise, name } })}
          />
        </li>
      </ol>
    </Group>
  );
}

function ParallelEditor({ step, onChange }: { step: ParallelStep; onChange: (s: WorkflowStep) => void }) {
  const t = useTranslations('workflows.builder.editor');
  const locale = useLocale();
  return (
    <Group
      title={t('branches')}
      description={t('branchesHint')}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              ...step,
              branches: [
                ...step.branches,
                newBranch({ [locale]: t('newBranch', { n: step.branches.length + 1 }) }),
              ],
            })
          }
        >
          <PlusIcon />
          {t('addBranch')}
        </Button>
      }
    >
      <ol className="grid gap-2">
        {step.branches.map((b, i) => (
          <li key={b.id} className="flex items-start gap-2">
            <span className="mt-2 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
              {i + 1}
            </span>
            <LocalizedInput
              className="flex-1"
              aria-label={t('branchName')}
              value={b.name}
              onChange={(name) =>
                onChange({
                  ...step,
                  branches: step.branches.map((x) => (x.id === b.id ? { ...x, name } : x)),
                })
              }
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('removeBranch')}
              disabled={step.branches.length <= 2}
              onClick={() => onChange({ ...step, branches: step.branches.filter((x) => x.id !== b.id) })}
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
      </ol>
    </Group>
  );
}

function NotifyEditor({ step, onChange }: { step: NotifyStep; onChange: (s: WorkflowStep) => void }) {
  const t = useTranslations('workflows.builder.editor');
  const id = useId();
  return (
    <Group title={t('recipients')} description={t('recipientsHint')}>
      <ApproverList
        rules={step.recipients}
        allowRequester
        onChange={(recipients) => onChange({ ...step, recipients })}
        addLabel={t('addRecipient')}
      />
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-message`} className="text-xs font-normal">
          {t('message')}
        </Label>
        <LocalizedInput
          id={`${id}-message`}
          multiline
          value={step.message}
          onChange={(message) =>
            onChange({ ...step, message: Object.keys(message).length ? message : undefined })
          }
        />
      </div>
    </Group>
  );
}

/** Settings of the selected step. */
export function StepEditor({
  step,
  onChange,
  issues,
}: {
  step: WorkflowStep;
  onChange: (s: WorkflowStep) => void;
  issues: string[];
}) {
  const t = useTranslations('workflows.builder.editor');
  const { readOnly } = useBuilder();
  const id = useId();
  return (
    <fieldset disabled={readOnly} className="grid gap-6">
      <legend className="sr-only">{t('legend')}</legend>
      {issues.length > 0 && (
        <ul
          className="grid gap-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="status"
        >
          {issues.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`}>{t('name')}</Label>
        <LocalizedInput
          id={`${id}-name`}
          value={step.name}
          onChange={(name) => onChange({ ...step, name })}
        />
      </div>
      <div className={cn('grid gap-6')}>
        {step.type === 'approval' && <ApprovalEditor step={step} onChange={onChange} />}
        {step.type === 'condition' && <ConditionEditor step={step} onChange={onChange} />}
        {step.type === 'parallel' && <ParallelEditor step={step} onChange={onChange} />}
        {step.type === 'notify' && <NotifyEditor step={step} onChange={onChange} />}
        {step.type !== 'condition' && (
          <>
            <Separator />
            <WhenEditor step={step} onChange={onChange} />
          </>
        )}
      </div>
    </fieldset>
  );
}
