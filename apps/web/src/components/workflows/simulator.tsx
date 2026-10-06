'use client';

import { localize, simulateWorkflow, walkSteps, type WorkflowGraph } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import type { FactOption } from '@isbp/ui/condition-builder';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import type { StepRuntime } from '@isbp/ui/workflow-diagram';
import { cn } from '@isbp/ui';
import { CheckIcon, FlaskConicalIcon, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';

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

/**
 * "What happens if…": enter facts, choose how each approval goes, and see the path on the canvas.
 * Runs the same interpreter as the server.
 */
export function Simulator({
  graph,
  facts,
  onResult,
}: {
  graph: WorkflowGraph;
  facts: readonly FactOption[];
  onResult: (view: SimulationView | null) => void;
}) {
  const t = useTranslations('workflows.builder.test');
  const locale = useLocale();
  const id = useId();
  const testable = facts.filter((f) => f.type !== 'id' && f.type !== 'list');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'rejected'>>({});
  const [result, setResult] = useState<ReturnType<typeof simulateWorkflow> | null>(null);
  const approvals = walkSteps(graph.steps)
    .map((s) => s.step)
    .filter((s) => s.type === 'approval');

  const run = () => {
    const obj: Record<string, unknown> = {};
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
        reason: st?.reason,
      };
    }
    onResult({ runtime, chosen, outcome: r.outcome });
  };

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {testable.length > 0 && (
        <div className="grid gap-3">
          <h3 className="text-sm font-semibold">{t('facts')}</h3>
          {testable.map((f) => {
            const fid = `${id}-${f.path}`;
            const v = values[f.path];
            return (
              <div key={f.path} className="grid gap-1.5">
                <Label htmlFor={fid} className="text-xs font-normal">
                  {f.label}
                </Label>
                {f.type === 'boolean' ? (
                  <Switch
                    id={fid}
                    checked={v === true}
                    onCheckedChange={(c) => setValues({ ...values, [f.path]: c })}
                  />
                ) : f.options?.length ? (
                  <Select
                    value={typeof v === 'string' ? v : undefined}
                    onValueChange={(x) => setValues({ ...values, [f.path]: x })}
                  >
                    <SelectTrigger id={fid} className="w-full">
                      <SelectValue placeholder={t('any')} />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={fid}
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    value={v === undefined ? '' : String(v)}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [f.path]:
                          f.type === 'number' && e.target.value !== ''
                            ? Number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {approvals.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">{t('decisions')}</h3>
          <ul className="grid gap-1.5">
            {approvals.map((s) => {
              const d = decisions[s.id] ?? 'approved';
              return (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{localize(s.name, locale)}</span>
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
                          'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
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
              return (
                <li key={sid}>
                  {i + 1}. {step ? localize(step.name, locale) : sid} —{' '}
                  {t(`status.${st?.status ?? 'waiting'}`)}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
