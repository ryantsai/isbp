'use client';

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
import { Button } from '@isbp/ui/button';
import type { FactOption } from '@isbp/ui/condition-builder';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Disclosure } from '@isbp/ui/motion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import type { StepRuntime } from '@isbp/ui/workflow-diagram';
import { cn } from '@isbp/ui';
import { CheckIcon, FlaskConicalIcon, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
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
  const fid = `${useId()}-fact`;
  const [groupName, setGroupName] = useState<string | null>(null);
  let control;
  if (fact.type === 'boolean')
    control = <Switch id={fid} checked={value === true} onCheckedChange={(c) => onChange(c)} />;
  else if (fact.options?.length || isDepartmentFact(fact.path)) {
    const options = fact.options?.length
      ? fact.options
      : departments.map((d) => ({ value: d.code, label: d.name }));
    control = (
      <Select value={typeof value === 'string' ? value : undefined} onValueChange={(x) => onChange(x)}>
        <SelectTrigger id={fid} className="w-full">
          <SelectValue placeholder={t('any')} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (fact.ref === 'group')
    control = (
      <GroupPicker
        id={fid}
        value={
          typeof value === 'string' && value ? { id: value, key: value, name: groupName ?? value } : null
        }
        onChange={(g) => {
          setGroupName(g?.name ?? null);
          onChange(g?.key ?? '');
        }}
      />
    );
  else
    control = (
      <Input
        id={fid}
        type={fact.type === 'number' ? 'number' : fact.type === 'date' ? 'date' : 'text'}
        value={value === undefined ? '' : String(value)}
        onChange={(e) =>
          onChange(fact.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)
        }
      />
    );
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={fid} className="text-xs font-normal">
        {fact.label}
      </Label>
      {control}
    </div>
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
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {personal.length > 0 && (
        <div className="grid gap-1.5">
          <Label htmlFor="sim-try-as" className="text-sm font-semibold">
            {t('tryAs')}
          </Label>
          <UserPicker
            id="sim-try-as"
            value={person}
            onChange={(u) => void tryAs(u)}
            placeholder={t('tryAsHint')}
          />
        </div>
      )}
      {answers.length > 0 && (
        <div className="grid gap-3">
          <h3 className="text-sm font-semibold">{t('facts')}</h3>
          {answers.map((f) => (
            <FactInput
              key={f.path}
              fact={f}
              value={values[f.path]}
              onChange={set(f.path)}
              departments={departments.data?.items ?? []}
            />
          ))}
        </div>
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
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">{t('decisions')}</h3>
          <ul className="grid gap-1.5">
            {approvals.map((s) => {
              const name = localize(s.name, locale);
              const d = decisions[s.id] ?? 'approved';
              // With `repeatApprovers: skip`, the approver may be someone who already approved an earlier step.
              const earlier = graph.repeatApprovers === 'skip' ? stepsBefore(graph, s.id) : [];
              const choice = typeof d === 'string' ? 'ask' : `at:${d.alreadyApprovedAt}`;
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{name}</span>
                  {earlier.length > 0 && (
                    <Select
                      value={choice}
                      onValueChange={(v) =>
                        setDecisions({
                          ...decisions,
                          [s.id]: v === 'ask' ? 'approved' : { alreadyApprovedAt: v.slice('at:'.length) },
                        })
                      }
                    >
                      <SelectTrigger aria-label={name} className="h-7 w-auto max-w-[60%] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ask">{tRepeat('ask')}</SelectItem>
                        {earlier.map((e) => (
                          <SelectItem key={e.id} value={`at:${e.id}`}>
                            {t('alreadyAt', { step: localize(e.name, locale) })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {typeof d === 'string' && (
                    <div
                      className="flex shrink-0 rounded-md border p-0.5"
                      role="group"
                      aria-label={localize(s.name, locale)}
                    >
                      {(['approved', 'rejected'] as const).map((x) => (
                        <button
                          key={x}
                          type="button"
                          aria-pressed={d === x}
                          onClick={() => setDecisions({ ...decisions, [s.id]: x })}
                          className={cn(
                            'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none',
                            d === x
                              ? x === 'approved'
                                ? 'bg-success/15 text-success'
                                : 'bg-destructive/10 text-destructive'
                              : 'text-muted-foreground',
                          )}
                        >
                          {x === 'approved' ? <CheckIcon className="size-3" /> : <XIcon className="size-3" />}
                          {t(x)}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" onClick={run}>
          <FlaskConicalIcon />
          {t('run')}
        </Button>
        {result && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setResult(null);
              onResult(null);
            }}
          >
            {t('clear')}
          </Button>
        )}
      </div>
      {result && (
        <div aria-live="polite" className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-medium">
            {t(result.outcome === 'approved' ? 'outcomeApproved' : 'outcomeRejected')}
          </p>
          <ol className="grid gap-1 text-xs text-muted-foreground">
            {result.order.map((sid, i) => {
              const step = walkSteps(graph.steps).find((s) => s.step.id === sid)?.step;
              const st = result.state.steps[sid];
              const from =
                st?.reason === 'already-approved' && st.from ? findStep(graph, st.from) : undefined;
              return (
                <li key={sid}>
                  {i + 1}. {step ? localize(step.name, locale) : sid} —{' '}
                  {from
                    ? t('alreadyAt', { step: localize(from.name, locale) })
                    : t(`status.${st?.status ?? 'waiting'}`)}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
