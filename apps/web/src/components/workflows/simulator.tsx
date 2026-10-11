'use client';

import { Button } from '@astryxdesign/core/Button';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { Card } from '@astryxdesign/core/Card';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Department, UserDetail } from '@isbp/contracts';
import {
  findStep,
  localize,
  type SimulatedDecision,
  simulateWorkflow,
  stepsBefore,
  TODAY_FACT,
  walkSteps,
  type WorkflowGraph,
} from '@isbp/sdk';
import { useApi } from '@isbp/sdk/web';
import type { FactOption } from '@isbp/ui/condition-builder';
import { Disclosure } from '@isbp/ui/motion';
import type { StepRuntime } from '@isbp/ui/workflow-diagram';
import { CheckIcon, FlaskConicalIcon, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { type PickedUser, UserPicker } from '../pickers/user-picker';
import { GroupPicker } from '../roles/group-picker';

export interface SimulationView {
  runtime: Record<string, StepRuntime>;
  chosen: Record<string, string>;
  outcome: 'approved' | 'rejected';
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const segs = path.split('.');
  let cur = obj;
  segs.slice(0, -1).forEach((s) => {
    cur[s] = (cur[s] as Record<string, unknown>) ?? {};
    cur = cur[s] as Record<string, unknown>;
  });
  cur[segs.at(-1)!] = value;
}

function flatten(obj: Record<string, unknown> | undefined, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v))
      Object.assign(out, flatten(v as Record<string, unknown>, path));
    else out[path] = v;
  }
  return out;
}

/** Facts about the person: filled by "Try as…", typed in only under "Enter values yourself". */
const isPersonFact = (path: string) =>
  path.startsWith('requester.') || path.startsWith('subjectUser.') || path === TODAY_FACT;
const isDepartmentFact = (path: string) => path.endsWith('.departmentCode');

function FactInput({
  fact,
  value,
  onChange,
  departments,
}: {
  fact: FactOption;
  value: unknown;
  onChange: (v: unknown) => void;
  departments: Department[];
}) {
  const t = useTranslations('workflows.builder.test');
  const [groupName, setGroupName] = useState<string | null>(null);
  if (fact.type === 'boolean')
    return <Switch label={fact.label} value={value === true} onChange={(c) => onChange(c)} />;
  if (fact.options?.length || isDepartmentFact(fact.path)) {
    const options = fact.options?.length
      ? fact.options
      : departments.map((d) => ({ value: d.code, label: d.name }));
    return (
      <Selector
        label={fact.label}
        placeholder={t('any')}
        width="100%"
        hasSearch={options.length > 12}
        value={typeof value === 'string' && value ? value : undefined}
        options={options.map((o) => ({ value: o.value, label: o.label }))}
        onChange={(x) => onChange(x)}
      />
    );
  }
  if (fact.ref === 'group')
    return (
      <GroupPicker
        label={fact.label}
        value={
          typeof value === 'string' && value ? { id: value, key: value, name: groupName ?? value } : null
        }
        onChange={(g) => {
          setGroupName(g?.name ?? null);
          onChange(g?.key ?? '');
        }}
      />
    );
  if (fact.type === 'number')
    return (
      <NumberInput
        label={fact.label}
        value={typeof value === 'number' ? value : null}
        onChange={(n) => onChange(n)}
      />
    );
  if (fact.type === 'date')
    return (
      <DateInput
        label={fact.label}
        value={typeof value === 'string' && value ? (value as ISODateString) : undefined}
        onChange={(d) => onChange(d ?? '')}
      />
    );
  return (
    <TextInput
      label={fact.label}
      value={value === undefined ? '' : String(value)}
      onChange={(v) => onChange(v)}
    />
  );
}

/**
 * "What happens if…": pick who asks, fill in example answers, choose how each approval goes, and see the path on the
 * canvas. Runs the same interpreter as the server. `known` facts (the form itself) are filled in for you.
 */
export function Simulator({
  graph,
  facts,
  known,
  onResult,
}: {
  graph: WorkflowGraph;
  facts: readonly FactOption[];
  known?: Record<string, unknown>;
  onResult: (view: SimulationView | null) => void;
}) {
  const t = useTranslations('workflows.builder.test');
  const tRepeat = useTranslations('workflows.builder.repeatApprovers');
  const locale = useLocale();
  const api = useApi();
  const knownPaths = flatten(known);
  // Whole objects (`data`, `records`) and people's ids can't be typed in; the form's own facts are known.
  const testable = facts.filter(
    (f) =>
      f.type !== 'id' &&
      f.type !== 'list' &&
      !['data', 'records', 'attributes'].includes(f.path) &&
      !(f.path in knownPaths),
  );
  const answers = testable.filter((f) => !isPersonFact(f.path));
  const personal = testable.filter((f) => isPersonFact(f.path));
  const departments = useApiQuery<{ items: Department[] }>(
    testable.some((f) => isDepartmentFact(f.path)) ? '/departments' : null,
  );
  const [person, setPerson] = useState<PickedUser | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [decisions, setDecisions] = useState<Record<string, SimulatedDecision>>({});
  const [result, setResult] = useState<ReturnType<typeof simulateWorkflow> | null>(null);
  const approvals = walkSteps(graph.steps)
    .map((s) => s.step)
    .filter((s) => s.type === 'approval');

  /** "Try as…": the person's department and job title, as a request of theirs would carry them. */
  const tryAs = async (u: PickedUser | null) => {
    setPerson(u);
    const clear = Object.fromEntries(
      Object.entries(values).filter(([k]) => !k.startsWith('requester.') && !k.startsWith('subjectUser.')),
    );
    if (!u) {
      setValues(clear);
      return;
    }
    try {
      const d = await api.get<UserDetail>(`/users/${u.id}`);
      const code = departments.data?.items.find((x) => x.id === d.department?.id)?.code ?? '';
      const own = { departmentCode: code, jobTitle: d.jobTitle ?? '' };
      setValues({
        ...clear,
        ...Object.fromEntries(
          Object.entries(own).flatMap(([k, v]) => [
            [`requester.${k}`, v],
            [`subjectUser.${k}`, v],
          ]),
        ),
      });
    } catch {
      setValues(clear);
    }
  };

  const run = () => {
    const obj: Record<string, unknown> = structuredClone(known ?? {});
    for (const [path, v] of Object.entries(values)) if (v !== '' && v !== undefined) setPath(obj, path, v);
    const r = simulateWorkflow(graph, obj, (s) => decisions[s.id] ?? 'approved');
    setResult(r);
    const runtime: Record<string, StepRuntime> = {};
    const chosen: Record<string, string> = {};
    for (const { step } of walkSteps(graph.steps)) {
      const st = r.state.steps[step.id];
      if (st?.branch) chosen[step.id] = st.branch;
      runtime[step.id] = {
        status: st ? (st.status === 'active' ? 'waiting' : st.status) : 'waiting',
        // "Already approved at …" is written in the list below; the diagram only shows skip reasons.
        reason: st?.reason === 'already-approved' ? undefined : st?.reason,
      };
    }
    onResult({ runtime, chosen, outcome: r.outcome });
  };

  const set = (path: string) => (v: unknown) => setValues((cur) => ({ ...cur, [path]: v }));

  return (
    <VStack gap={5}>
      <Text color="secondary">{t('intro')}</Text>
      {personal.length > 0 && (
        <VStack gap={1.5}>
          <Text type="label" as="div">
            {t('tryAs')}
          </Text>
          <UserPicker
            aria-label={t('tryAs')}
            value={person}
            onChange={(u) => void tryAs(u)}
            placeholder={t('tryAsHint')}
          />
        </VStack>
      )}
      {answers.length > 0 && (
        <VStack gap={3}>
          <Heading level={3}>{t('facts')}</Heading>
          {answers.map((f) => (
            <FactInput
              key={f.path}
              fact={f}
              value={values[f.path]}
              onChange={set(f.path)}
              departments={departments.data?.items ?? []}
            />
          ))}
        </VStack>
      )}
      {personal.length > 0 && (
        <Disclosure summary={t('enterYourself')} contentClassName="grid gap-3 pt-1">
          {personal.map((f) => (
            <FactInput
              key={f.path}
              fact={f}
              value={values[f.path]}
              onChange={set(f.path)}
              departments={departments.data?.items ?? []}
            />
          ))}
        </Disclosure>
      )}
      {approvals.length > 0 && (
        <VStack gap={2}>
          <Heading level={3}>{t('decisions')}</Heading>
          <ul className="grid gap-1.5">
            {approvals.map((s) => {
              const name = localize(s.name, locale);
              const d = decisions[s.id] ?? 'approved';
              // With `repeatApprovers: skip`, the approver may be someone who already approved an earlier step.
              const earlier = graph.repeatApprovers === 'skip' ? stepsBefore(graph, s.id) : [];
              const choice = typeof d === 'string' ? 'ask' : `at:${d.alreadyApprovedAt}`;
              return (
                <li key={s.id}>
                  <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
                    <StackItem size="fill" className="min-w-0">
                      <Text maxLines={1}>{name}</Text>
                    </StackItem>
                    {earlier.length > 0 && (
                      <Selector
                        label={name}
                        isLabelHidden
                        size="sm"
                        value={choice}
                        options={[
                          { value: 'ask', label: tRepeat('ask') },
                          ...earlier.map((e) => ({
                            value: `at:${e.id}`,
                            label: t('alreadyAt', { step: localize(e.name, locale) }),
                          })),
                        ]}
                        onChange={(v) =>
                          setDecisions({
                            ...decisions,
                            [s.id]: v === 'ask' ? 'approved' : { alreadyApprovedAt: v.slice('at:'.length) },
                          })
                        }
                      />
                    )}
                    {typeof d === 'string' && (
                      <SegmentedControl
                        label={name}
                        size="sm"
                        value={d}
                        onChange={(x) => setDecisions({ ...decisions, [s.id]: x as 'approved' | 'rejected' })}
                      >
                        <SegmentedControlItem
                          value="approved"
                          label={t('approved')}
                          icon={<Icon icon={CheckIcon} />}
                        />
                        <SegmentedControlItem
                          value="rejected"
                          label={t('rejected')}
                          icon={<Icon icon={XIcon} />}
                        />
                      </SegmentedControl>
                    )}
                  </HStack>
                </li>
              );
            })}
          </ul>
        </VStack>
      )}
      <HStack gap={2}>
        <Button label={t('run')} variant="primary" icon={<Icon icon={FlaskConicalIcon} />} onClick={run} />
        {result && (
          <Button
            label={t('clear')}
            variant="ghost"
            onClick={() => {
              setResult(null);
              onResult(null);
            }}
          />
        )}
      </HStack>
      {result && (
        <div aria-live="polite">
          <Card padding={3}>
            <VStack gap={2}>
              <Text weight="medium">
                {t(result.outcome === 'approved' ? 'outcomeApproved' : 'outcomeRejected')}
              </Text>
              <ol className="grid gap-1">
                {result.order.map((sid, i) => {
                  const step = walkSteps(graph.steps).find((s) => s.step.id === sid)?.step;
                  const st = result.state.steps[sid];
                  const from =
                    st?.reason === 'already-approved' && st.from ? findStep(graph, st.from) : undefined;
                  return (
                    <li key={sid}>
                      <Text type="supporting" color="secondary">
                        {i + 1}. {step ? localize(step.name, locale) : sid} —{' '}
                        {from
                          ? t('alreadyAt', { step: localize(from.name, locale) })
                          : t(`status.${st?.status ?? 'waiting'}`)}
                      </Text>
                    </li>
                  );
                })}
              </ol>
            </VStack>
          </Card>
        </div>
      )}
    </VStack>
  );
}
