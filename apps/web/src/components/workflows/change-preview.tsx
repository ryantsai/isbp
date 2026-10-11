'use client';

import type { Group, Role, WorkflowTrigger } from '@isbp/contracts';
import type { AssistantPreviewProps } from '@isbp/module-assistant/contracts';
import {
  type ApproverRule,
  type FieldDef,
  type FormSchema,
  formFields,
  type Page,
  walkSteps,
  type WorkflowGraph,
  workflowGraphSchema,
} from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { usePeople } from '@isbp/ui/person-picker';
import { type StepRuntime, WorkflowDiagram } from '@isbp/ui/workflow-diagram';
import { CircleAlertIcon, FlaskConicalIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { Segmented } from '@isbp/ui/segmented';
import { useFieldFacts } from './field-facts';
import { type SimulationView, Simulator } from './simulator';
import { useFactOptions } from './use-fact-label';

/** The parts of a `core.workflow` value the preview draws (`{ name, description, triggerKey, graph, isDefault }`). */
function workflowOf(value: unknown): { triggerKey: string | null; graph: WorkflowGraph } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { triggerKey?: unknown; graph?: unknown };
  const graph = workflowGraphSchema.safeParse(v.graph);
  if (!graph.success) return null;
  return { triggerKey: typeof v.triggerKey === 'string' ? v.triggerKey : null, graph: graph.data };
}

/** People a graph names directly (approvers, recipients, fallbacks, escalations). */
function userIdsOf(graph: WorkflowGraph | undefined): string[] {
  if (!graph) return [];
  const out: string[] = [];
  const rule = (r: ApproverRule) => {
    if (r.type === 'user') out.push(r.userId);
    if ('fallback' in r && r.fallback) rule(r.fallback);
  };
  for (const { step } of walkSteps(graph.steps)) {
    if (step.type === 'approval') [...step.approvers, ...(step.sla?.escalateTo ?? [])].forEach(rule);
    if (step.type === 'notify') step.recipients.forEach(rule);
  }
  return out;
}

/**
 * The fields of the request forms in the same change set that use this workflow (by `"$ref:<name>"` while it is a
 * draft, by id once applied), so its approvers and conditions read "Which application?: Delivery team" rather than a
 * fact path, and Try it asks for the form's answers.
 */
function proposedForms(
  props: AssistantPreviewProps,
): { key: unknown; category: unknown; fields: FieldDef[] }[] {
  const { item, items } = props;
  const names = new Set(
    [item.ref ? `$ref:${item.ref}` : null, item.targetId, item.appliedId].filter((x): x is string => !!x),
  );
  return (items ?? [])
    .filter((i) => i.kind === 'core.form')
    .flatMap((i) => {
      const v = (i.after?.value ?? i.value) as {
        workflowId?: unknown;
        schema?: unknown;
        key?: unknown;
        category?: unknown;
      } | null;
      return v && typeof v.workflowId === 'string' && names.has(v.workflowId)
        ? [{ key: v.key, category: v.category, fields: formFields(v.schema as FormSchema) }]
        : [];
    });
}

type Shown = 'proposed' | 'current';

/**
 * Preview of a proposed approval workflow on the change set page (`assistant.preview.core.workflow`): the diagram
 * of the proposed graph (or the current one, to compare) with the builder's simulator, run by the same interpreter
 * as the server. Nothing is saved.
 */
export default function WorkflowChangePreview(props: AssistantPreviewProps) {
  const { value, current } = props;
  const t = useTranslations('workflows.changePreview');
  const id = useId();
  const proposed = useMemo(() => workflowOf(value), [value]);
  const before = useMemo(() => workflowOf(current?.value), [current]);
  const [shown, setShown] = useState<Shown>('proposed');
  const [simulation, setSimulation] = useState<SimulationView | null>(null);
  const showing = shown === 'current' && before ? before : proposed;

  const canTriggers = useCan('core.workflows.read');
  const canRoles = useCan('core.roles.read');
  const canGroups = useCan('core.groups.read');
  const triggers = useApiQuery<{ items: WorkflowTrigger[] }>(canTriggers ? '/workflow-triggers' : null);
  const roles = useApiQuery<{ items: Role[] }>(canRoles ? '/roles' : null);
  const groups = useApiQuery<Page<Group>>(canGroups ? '/groups' : null, { pageSize: 100 });
  const people = usePeople(userIdsOf(showing?.graph));
  const trigger = triggers.data?.items.find((x) => x.key === showing?.triggerKey);
  const triggerFacts = useFactOptions(trigger?.facts ?? []);
  const forms = useMemo(
    () => (showing?.triggerKey === 'core.form-submission' ? proposedForms(props) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.item, props.items, showing?.triggerKey],
  );
  const fields = useMemo(() => forms.flatMap((f) => f.fields), [forms]);
  const formFacts = useFieldFacts(fields, 'data');
  // Try it knows which form it is (one form: its key and category aren't asked for).
  const known = useMemo(
    () => (forms.length === 1 ? { form: { key: forms[0]!.key, category: forms[0]!.category } } : undefined),
    [forms],
  );
  // As the builder does: a form's own answers replace the trigger's generic "data" and "records".
  const facts = useMemo(
    () =>
      formFacts.length
        ? [...triggerFacts.filter((f) => !['data', 'records'].includes(f.path)), ...formFacts]
        : triggerFacts,
    [triggerFacts, formFacts],
  );
  // Groups the same change set creates (a pack's approvers) are named too, before they exist.
  const proposedGroups = useMemo(
    () =>
      (props.items ?? []).flatMap((i) => {
        const v = (i.after?.value ?? i.value) as { key?: unknown; name?: unknown } | null;
        return i.kind === 'core.group' && i.op !== 'delete' && v && typeof v.key === 'string'
          ? [[v.key, typeof v.name === 'string' && v.name ? v.name : i.label] as const]
          : [];
      }),
    [props.items],
  );
  const names = useMemo(
    () => ({
      groups: {
        ...Object.fromEntries(proposedGroups),
        ...Object.fromEntries((groups.data?.items ?? []).map((g) => [g.key, g.name])),
      },
      roles: Object.fromEntries(
        (roles.data?.items ?? []).filter((r) => r.application.isPlatform).map((r) => [r.key, r.name]),
      ),
      users: Object.fromEntries([...people].map(([key, p]) => [key, p.displayName])),
      facts,
    }),
    [groups.data, roles.data, people, facts, proposedGroups],
  );

  if (!proposed)
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('invalid')}
      </p>
    );

  const runtime: Record<string, StepRuntime> | undefined = simulation?.runtime;
  // Side by side only where the card is wide enough (the item cards are narrower than the page).
  return (
    <div className="@container min-w-0">
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 @3xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid min-w-0 gap-3">
          {before && (
            <Segmented<Shown>
              label={t('show')}
              value={shown}
              onChange={(v) => {
                setShown(v);
                setSimulation(null);
              }}
              options={[
                { value: 'proposed', label: t('proposed') },
                { value: 'current', label: t('current') },
              ]}
              className="w-fit"
            />
          )}
          <section
            aria-labelledby={`${id}-diagram`}
            className="min-w-0 overflow-auto rounded-lg border bg-muted/20 py-3"
            tabIndex={0}
          >
            <h4 id={`${id}-diagram`} className="sr-only">
              {shown === 'current' && before ? t('currentDiagram') : t('proposedDiagram')}
            </h4>
            <WorkflowDiagram
              graph={showing!.graph}
              names={names}
              runtime={runtime}
              chosen={simulation?.chosen}
              outcome={simulation?.outcome}
            />
          </section>
        </div>
        <section aria-labelledby={`${id}-test`} className="grid min-w-0 gap-3 rounded-lg border p-4">
          <h4 id={`${id}-test`} className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConicalIcon className="size-4 text-primary" aria-hidden />
            {t('simulate')}
          </h4>
          <Simulator
            key={shown}
            graph={showing!.graph}
            facts={facts}
            known={known}
            onResult={setSimulation}
          />
        </section>
      </div>
    </div>
  );
}
