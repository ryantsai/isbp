'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Heading, Text } from '@astryxdesign/core/Text';
import {
  type ApprovalStep,
  type ConditionBranch,
  type ConditionStep,
  type NotifyStep,
  type ParallelStep,
  type SlaPolicy,
  type WorkflowStep,
} from '@isbp/sdk';
import { ConditionBuilder, useConditionText } from '@isbp/ui/condition-builder';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { Disclosure } from '@isbp/ui/motion';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import { ApproverList } from './approver-editor';
import { useBuilder } from './builder-context';
import { newBranch } from './graph-ops';
import { StepFieldsEditor } from './step-fields-editor';

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
    <VStack gap={3} as="section">
      <HStack gap={2} vAlign="start" hAlign="between">
        <VStack gap={0.5} className="min-w-0">
          <Heading level={3}>{title}</Heading>
          {description && (
            <Text type="supporting" color="secondary">
              {description}
            </Text>
          )}
        </VStack>
        {action && <div className="shrink-0">{action}</div>}
      </HStack>
      {children}
    </VStack>
  );
}

/** A collapsed part of the inspector that says in one line what it holds ("Due within 48 h", "Always"). */
function Section({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Disclosure
      defaultOpen={defaultOpen}
      className="rounded-lg border px-3"
      summary={
        <VStack gap={0.5}>
          <Text weight="semibold">{title}</Text>
          <Text type="supporting" color="secondary">
            {summary}
          </Text>
        </VStack>
      }
      contentClassName="grid gap-3 pb-3"
    >
      {children}
    </Disclosure>
  );
}

/** A step number or a path number: a count, so a `Badge`. */
function Ordinal({ n }: { n: number }) {
  return (
    <span className="mt-2 shrink-0">
      <Badge label={String(n)} />
    </span>
  );
}

function WhenEditor({ step, onChange }: { step: WorkflowStep; onChange: (s: WorkflowStep) => void }) {
  const t = useTranslations('workflows.builder.editor');
  const { facts } = useBuilder();
  const conditionText = useConditionText(facts);
  return (
    <Section title={t('when')} summary={conditionText(step.when)} defaultOpen={Boolean(step.when)}>
      <Text type="supporting" color="secondary">
        {t('whenHint')}
      </Text>
      <Switch
        label={t('onlySometimes')}
        labelSpacing="spread"
        value={Boolean(step.when)}
        onChange={(v) => onChange({ ...step, when: v ? { all: [] } : undefined })}
      />
      {step.when && (
        <ConditionBuilder
          value={step.when}
          facts={facts}
          emptyText={t('whenEmpty')}
          onChange={(when) => onChange({ ...step, when: when ?? { all: [] } })}
        />
      )}
    </Section>
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
  // With one approver line the mode doesn't change anything: show it once there are several (or it was changed).
  const showMode = step.approvers.length > 1 || step.mode !== 'any';
  const fieldCount = step.fields?.length ?? 0;
  const deadlineSummary = sla
    ? [
        t('summary.due', { hours: sla.dueHours }),
        sla.remindHours ? t('summary.remind', { hours: sla.remindHours }) : null,
        t(`summary.breach.${sla.onBreach}`),
      ]
        .filter(Boolean)
        .join(' · ')
    : t('summary.noDeadline');
  const optionsSummary = [
    t(`summary.nobody.${step.ifNoApprover ?? 'reject'}`),
    step.allowSelfApproval ? t('summary.selfAllowed') : null,
    step.allowDelegation === false ? t('summary.noHandover') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Group title={t('approvers')} description={t('approversHint')}>
        <ApproverList
          rules={step.approvers}
          onChange={(approvers) => onChange({ ...step, approvers })}
          addLabel={t('addApprover')}
        />
        {showMode && (
          <>
            <div className="grid items-start gap-3 sm:grid-cols-2">
              <Selector
                label={t('mode')}
                width="100%"
                value={step.mode}
                options={[
                  { value: 'any', label: t('modes.any') },
                  { value: 'all', label: t('modes.all') },
                  { value: 'quorum', label: t('modes.quorum') },
                ]}
                onChange={(v) =>
                  onChange({
                    ...step,
                    mode: v as ApprovalStep['mode'],
                    quorum:
                      v === 'quorum' ? (step.quorum ?? Math.min(2, step.approvers.length || 1)) : undefined,
                  })
                }
              />
              {step.mode === 'quorum' && (
                <NumberInput
                  label={t('quorum')}
                  min={1}
                  step={1}
                  isIntegerOnly
                  hasClear
                  units={t('ofSlots', { count: step.approvers.length })}
                  value={step.quorum ?? null}
                  onChange={(v) => onChange({ ...step, quorum: v ? Math.round(v) : undefined })}
                />
              )}
            </div>
            <Text type="supporting" color="secondary">
              {t(`modeHints.${step.mode}`)}
            </Text>
          </>
        )}
        <Selector
          label={t('ifNobody')}
          width="100%"
          value={step.ifNoApprover ?? 'reject'}
          options={[
            { value: 'reject', label: t('nobody.reject') },
            { value: 'skip', label: t('nobody.skip') },
          ]}
          onChange={(v) => onChange({ ...step, ifNoApprover: v as 'reject' | 'skip' })}
        />
      </Group>
      <Section
        title={t('stepFields')}
        summary={fieldCount ? t('summary.fields', { count: fieldCount }) : t('noStepFields')}
        defaultOpen={fieldCount > 0}
      >
        <StepFieldsEditor step={step} onChange={onChange} bare />
      </Section>
      <Section title={t('deadline')} summary={deadlineSummary} defaultOpen={Boolean(sla)}>
        <Text type="supporting" color="secondary">
          {t('deadlineHint')}
        </Text>
        <Switch
          label={t('useDeadline')}
          labelSpacing="spread"
          value={Boolean(sla)}
          onChange={(v) => setSla(v ? {} : null)}
        />
        {sla && (
          <Card padding={3} variant="muted">
            <VStack gap={3}>
              <HStack gap={4} wrap="wrap" vAlign="start">
                <NumberInput
                  label={t('dueIn')}
                  min={0.25}
                  step={0.25}
                  hasClear
                  units={t('hours')}
                  width={200}
                  value={sla.dueHours ?? null}
                  onChange={(v) => setSla({ dueHours: v ?? 1 })}
                />
                <NumberInput
                  label={t('remindAfter')}
                  min={0.25}
                  step={0.25}
                  hasClear
                  units={t('hours')}
                  width={200}
                  value={sla.remindHours ?? null}
                  onChange={(v) => setSla({ remindHours: v ?? undefined })}
                />
              </HStack>
              <Selector
                label={t('whenLate')}
                width="100%"
                value={sla.onBreach}
                options={(['notify', 'escalate', 'approve', 'reject'] as const).map((b) => ({
                  value: b,
                  label: t(`breach.${b}`),
                }))}
                onChange={(v) =>
                  setSla({
                    onBreach: v as SlaPolicy['onBreach'],
                    escalateTo:
                      v === 'escalate' ? (sla.escalateTo ?? [{ type: 'manager', level: 2 }]) : undefined,
                  })
                }
              />
              {sla.onBreach === 'escalate' && (
                <VStack gap={1.5}>
                  <Text type="label" as="div">
                    {t('escalateTo')}
                  </Text>
                  <ApproverList
                    rules={sla.escalateTo ?? []}
                    onChange={(escalateTo) => setSla({ escalateTo })}
                    addLabel={t('addApprover')}
                  />
                </VStack>
              )}
            </VStack>
          </Card>
        )}
      </Section>
      <Section title={t('options')} summary={optionsSummary}>
        <Switch
          label={t('allowDelegation')}
          description={t('allowDelegationHint')}
          labelSpacing="spread"
          value={step.allowDelegation !== false}
          onChange={(v) => onChange({ ...step, allowDelegation: v ? undefined : false })}
        />
        <Switch
          label={t('allowSelf')}
          description={t('allowSelfHint')}
          labelSpacing="spread"
          value={Boolean(step.allowSelfApproval)}
          onChange={(v) => onChange({ ...step, allowSelfApproval: v || undefined })}
        />
        <Field label={t('instructions')} inputID={`${id}-instructions`}>
          <LocalizedInput
            id={`${id}-instructions`}
            multiline
            value={step.instructions}
            onChange={(instructions) =>
              onChange({ ...step, instructions: Object.keys(instructions).length ? instructions : undefined })
            }
            placeholder={t('instructionsPlaceholder')}
          />
        </Field>
      </Section>
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
          label={t('addPath')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          onClick={() =>
            set([
              ...step.branches,
              {
                ...newBranch({ [locale]: t('newPath', { n: step.branches.length + 1 }) }),
                when: { all: [] },
              },
            ])
          }
        />
      }
    >
      <ol className="grid gap-3">
        {step.branches.map((b, i) => (
          <li key={b.id}>
            <Card padding={3}>
              <VStack gap={3}>
                <HStack gap={2} vAlign="start">
                  <Ordinal n={i + 1} />
                  <StackItem size="fill" className="min-w-0">
                    <LocalizedInput
                      aria-label={t('pathName')}
                      value={b.name}
                      onChange={(name) => set(step.branches.map((x) => (x.id === b.id ? { ...x, name } : x)))}
                    />
                  </StackItem>
                  <HStack>
                    <IconButton
                      label={t('moveUp')}
                      variant="ghost"
                      icon={<Icon icon={ArrowUpIcon} />}
                      isDisabled={i === 0}
                      onClick={() =>
                        set(
                          step.branches.map((x, j) =>
                            j === i - 1 ? b : j === i ? step.branches[i - 1]! : x,
                          ),
                        )
                      }
                    />
                    <IconButton
                      label={t('moveDown')}
                      variant="ghost"
                      icon={<Icon icon={ArrowDownIcon} />}
                      isDisabled={i === step.branches.length - 1}
                      onClick={() =>
                        set(
                          step.branches.map((x, j) =>
                            j === i + 1 ? b : j === i ? step.branches[i + 1]! : x,
                          ),
                        )
                      }
                    />
                    <IconButton
                      label={t('removePath')}
                      variant="ghost"
                      icon={<Icon icon={XIcon} />}
                      isDisabled={step.branches.length <= 1}
                      onClick={() => set(step.branches.filter((x) => x.id !== b.id))}
                    />
                  </HStack>
                </HStack>
                <ConditionBuilder
                  value={b.when}
                  facts={facts}
                  onChange={(when) =>
                    set(step.branches.map((x) => (x.id === b.id ? { ...x, when: when ?? { all: [] } } : x)))
                  }
                />
                {b.steps.length > 0 && (
                  <Text type="supporting" color="secondary">
                    {t('pathSteps', { count: b.steps.length })}
                  </Text>
                )}
              </VStack>
            </Card>
          </li>
        ))}
        <li>
          <Card padding={3} variant="muted">
            <VStack gap={2}>
              <Text type="supporting" color="secondary" weight="medium">
                {t('otherwise')}
              </Text>
              <LocalizedInput
                aria-label={t('pathName')}
                value={step.otherwise.name}
                onChange={(name) => onChange({ ...step, otherwise: { ...step.otherwise, name } })}
              />
            </VStack>
          </Card>
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
          label={t('addBranch')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          onClick={() =>
            onChange({
              ...step,
              branches: [
                ...step.branches,
                newBranch({ [locale]: t('newBranch', { n: step.branches.length + 1 }) }),
              ],
            })
          }
        />
      }
    >
      <ol className="grid gap-2">
        {step.branches.map((b, i) => (
          <li key={b.id}>
            <HStack gap={2} vAlign="start">
              <Ordinal n={i + 1} />
              <StackItem size="fill" className="min-w-0">
                <LocalizedInput
                  aria-label={t('branchName')}
                  value={b.name}
                  onChange={(name) =>
                    onChange({
                      ...step,
                      branches: step.branches.map((x) => (x.id === b.id ? { ...x, name } : x)),
                    })
                  }
                />
              </StackItem>
              <IconButton
                label={t('removeBranch')}
                variant="ghost"
                icon={<Icon icon={Trash2Icon} />}
                isDisabled={step.branches.length <= 2}
                onClick={() => onChange({ ...step, branches: step.branches.filter((x) => x.id !== b.id) })}
              />
            </HStack>
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
      <Field label={t('message')} inputID={`${id}-message`}>
        <LocalizedInput
          id={`${id}-message`}
          multiline
          value={step.message}
          onChange={(message) =>
            onChange({ ...step, message: Object.keys(message).length ? message : undefined })
          }
        />
      </Field>
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
    <fieldset disabled={readOnly} className="grid gap-4">
      <legend className="sr-only">{t('legend')}</legend>
      {issues.length > 0 && (
        <Banner status="error" title={issues[0]!} collapsible={false}>
          {issues.length > 1 && (
            <VStack gap={1}>
              {issues.slice(1).map((m, i) => (
                <Text key={i}>{m}</Text>
              ))}
            </VStack>
          )}
        </Banner>
      )}
      <Field label={t('name')} inputID={`${id}-name`}>
        <LocalizedInput
          id={`${id}-name`}
          value={step.name}
          onChange={(name) => onChange({ ...step, name })}
        />
      </Field>
      <VStack gap={3}>
        {step.type === 'approval' && <ApprovalEditor step={step} onChange={onChange} />}
        {step.type === 'condition' && <ConditionEditor step={step} onChange={onChange} />}
        {step.type === 'parallel' && <ParallelEditor step={step} onChange={onChange} />}
        {step.type === 'notify' && <NotifyEditor step={step} onChange={onChange} />}
        {step.type !== 'condition' && <WhenEditor step={step} onChange={onChange} />}
      </VStack>
    </fieldset>
  );
}
