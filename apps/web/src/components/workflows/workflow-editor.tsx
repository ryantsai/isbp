'use client';

import type { Role, WorkflowDefinition, WorkflowTrigger } from '@isbp/contracts';
import {
  type ApproverRule,
  type FieldDef,
  findStep,
  type LocalizedText,
  localize,
  type StepType,
  validateWorkflowGraph,
  walkSteps,
  type WorkflowGraph,
  type WorkflowStep,
  workflowGraphSchema,
} from '@isbp/sdk';
import { ApiError, useApi, useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import type { FactOption } from '@isbp/ui/condition-builder';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Hint } from '@isbp/ui/tooltip';
import { type StepRuntime, WorkflowDiagram } from '@isbp/ui/workflow-diagram';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BellIcon,
  CopyIcon,
  MoreHorizontalIcon,
  MousePointerClickIcon,
  PlusIcon,
  SplitIcon,
  Trash2Icon,
  UserCheckIcon,
  WorkflowIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import enWorkflows from '@isbp/i18n/messages/en/workflows.json';
import jaWorkflows from '@isbp/i18n/messages/ja-JP/workflows.json';
import zhWorkflows from '@isbp/i18n/messages/zh-TW/workflows.json';
import { createTranslator, useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canonical, useTodayFact } from '@/components/fields/field-utils';
import { useApiQuery, useErrorText } from '@/lib/api';
import { BuilderContext, type BuilderContextValue } from './builder-context';
import { useCustomFieldFacts, useFieldFacts } from './field-facts';
import {
  cloneStep,
  getSequence,
  insertStep,
  moveStep,
  newStep,
  removeStep,
  replaceStep,
  type StepNames,
} from './graph-ops';
import { type SimulationView, Simulator } from './simulator';
import { StepEditor } from './step-editor';
import { useStepFacts } from './step-facts';
import { useFactOptions } from './use-fact-label';

const STEP_TYPES: { type: StepType; icon: ReactNode }[] = [
  { type: 'approval', icon: <UserCheckIcon /> },
  { type: 'condition', icon: <SplitIcon /> },
  { type: 'parallel', icon: <WorkflowIcon /> },
  { type: 'notify', icon: <BellIcon /> },
];

function incompleteRule(r: ApproverRule): boolean {
  if (r.type === 'user' && !r.userId) return true;
  if (r.type === 'group' && !r.groupKey) return true;
  if (r.type === 'role' && !r.roleKey) return true;
  if (r.type === 'fact' && !r.fact) return true;
  return 'fallback' in r && r.fallback ? incompleteRule(r.fallback) : false;
}

export type DraftIssue = { stepId: string | null; code: string };

/** Client-side checks: the shared validator plus empty approver targets. */
export function draftIssues(graph: WorkflowGraph): DraftIssue[] {
  const issues: DraftIssue[] = validateWorkflowGraph(graph).map((i) => ({
    stepId: i.stepId,
    code: i.code as string,
  }));
  for (const { step } of walkSteps(graph.steps)) {
    const rules =
      step.type === 'approval'
        ? [...step.approvers, ...(step.sla?.escalateTo ?? [])]
        : step.type === 'notify'
          ? step.recipients
          : [];
    if (rules.some(incompleteRule)) issues.push({ stepId: step.id, code: 'incomplete' });
  }
  return issues;
}

/** A failure the editor already put into words (translated): show `message` as it is. */
export class WorkflowEditorError extends Error {}

/** The editing state of one workflow definition: the draft graph, its name, checks, save and publish. */
export interface WorkflowEditor {
  def: WorkflowDefinition;
  draft: WorkflowGraph;
  edit: (next: WorkflowGraph) => void;
  name: string;
  setName: (name: string) => void;
  description: string;
  setDescription: (description: string) => void;
  /** Local changes not saved yet. */
  dirty: boolean;
  /** What requests use differs from what you see (never published, or a newer draft). */
  unpublished: boolean;
  canManage: boolean;
  readOnly: boolean;
  issues: DraftIssue[];
  byStep: Record<string, string[]>;
  globalIssues: DraftIssue[];
  /** Saves the draft. Throws `WorkflowEditorError` (translated) when it can't. */
  save: () => Promise<WorkflowDefinition>;
  /** Saves when needed, then publishes. Throws `WorkflowEditorError` (translated) when it can't. */
  publish: () => Promise<WorkflowDefinition>;
  busy: 'saving' | 'publishing' | null;
}

export function useWorkflowName() {
  const tr = useTranslations();
  return useCallback((name: string) => (tr.has(name) ? tr(name) : name), [tr]);
}

/** Stands in while there is no workflow (a form without an approval): an empty, read-only editor. */
const NO_WORKFLOW = {
  id: '',
  key: '',
  name: '',
  description: null,
  triggerKey: '',
  isDefault: false,
  isSystem: false,
  publishedVersion: null,
  archived: false,
  hasUnpublishedChanges: false,
  stepCount: 0,
  running: 0,
  updatedAt: new Date(0).toISOString(),
  updatedBy: null,
  draft: { steps: [] },
  versions: [],
  issues: [],
  names: { groups: {}, roles: {}, users: {} },
  usedBy: { forms: [], roles: [] },
} as unknown as WorkflowDefinition;

/** The editor of `def`, or null without one. Switching to another definition starts from its draft. */
export function useOptionalWorkflowEditor(def: WorkflowDefinition | undefined): WorkflowEditor | null {
  const editor = useWorkflowEditor(def ?? NO_WORKFLOW);
  return def ? editor : null;
}

export function useWorkflowEditor(def: WorkflowDefinition): WorkflowEditor {
  const t = useTranslations('workflows.builder');
  const ti = useTranslations('workflows.issues');
  const display = useWorkflowName();
  const api = useApi();
  const client = useQueryClient();
  const errorText = useErrorText();
  const canManage = useCan('core.workflows.manage');
  const [draft, setDraft] = useState<WorkflowGraph>(def.draft);
  const [name, setName] = useState(() => display(def.name));
  const [description, setDescription] = useState(def.description ?? '');
  const [publishIssues, setPublishIssues] = useState<WorkflowDefinition['issues'] | null>(null);
  const [busy, setBusy] = useState<WorkflowEditor['busy']>(null);
  // Another definition (the form now names another workflow): start over from its draft.
  const [forId, setForId] = useState(def.id);
  if (forId !== def.id) {
    setForId(def.id);
    setDraft(def.draft);
    setName(display(def.name));
    setDescription(def.description ?? '');
    setPublishIssues(null);
  }
  const serverIssues = publishIssues ?? def.issues;

  // Key order differs between what the browser builds and what the database returns (jsonb): compare canonically.
  const dirty =
    canonical(draft) !== canonical(def.draft) ||
    name !== display(def.name) ||
    description !== (def.description ?? '');
  const unpublished = dirty || def.publishedVersion === null || def.hasUnpublishedChanges;
  const issues = useMemo(() => {
    const local = draftIssues(draft);
    const unchanged = canonical(draft) === canonical(def.draft);
    const server = unchanged ? serverIssues.filter((i) => i.code.startsWith('unknown')) : [];
    return [...local, ...server];
  }, [draft, def.draft, serverIssues]);
  const byStep = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const i of issues) if (i.stepId) (map[i.stepId] ??= []).push(ti.has(i.code) ? ti(i.code) : i.code);
    return map;
  }, [issues, ti]);

  const edit = useCallback((next: WorkflowGraph) => {
    setDraft(next);
    setPublishIssues(null);
  }, []);

  /** Takes what the server stored as the new baseline (it may normalise the graph). */
  const adopt = (res: WorkflowDefinition) => {
    client.setQueryData([`/workflows/${res.id}`, {}], res);
    setDraft(res.draft);
    setName(display(res.name));
    setDescription(res.description ?? '');
    void client.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === 'string' &&
        ['/workflows', '/workflow-triggers', '/forms', '/audit-logs'].includes(q.queryKey[0] as string),
    });
  };

  const check = () => {
    if (issues.some((i) => i.code === 'incomplete')) throw new WorkflowEditorError(t('incomplete'));
    if (!workflowGraphSchema.safeParse(draft).success) throw new WorkflowEditorError(t('invalid'));
  };

  const doSave = async () => {
    const res = await api.patch<WorkflowDefinition>(`/workflows/${def.id}`, {
      name: name.trim() || display(def.name),
      description: description.trim() || null,
      draft,
    });
    adopt(res);
    return res;
  };

  const save = async () => {
    check();
    setBusy('saving');
    try {
      return await doSave();
    } catch (err) {
      throw new WorkflowEditorError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    check();
    setBusy('publishing');
    try {
      if (dirty) await doSave();
      const res = await api.post<WorkflowDefinition>(`/workflows/${def.id}/publish`);
      adopt(res);
      return res;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WORKFLOW_INVALID') {
        setPublishIssues((err.details as { issues?: WorkflowDefinition['issues'] })?.issues ?? []);
        throw new WorkflowEditorError(t('fixIssues'));
      }
      throw new WorkflowEditorError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return {
    def,
    draft,
    edit,
    name,
    setName,
    description,
    setDescription,
    dirty,
    unpublished,
    canManage,
    readOnly: !canManage || def.archived || !def.id,
    issues,
    byStep,
    globalIssues: issues.filter((i) => !i.stepId),
    save,
    publish,
    busy,
  };
}

/* ───────────────────────── step naming ───────────────────────── */

const AUTO_NAMES = { en: enWorkflows, 'zh-TW': zhWorkflows, 'ja-JP': jaWorkflows } as const;
type AutoKey = keyof typeof enWorkflows.builder.autoName;

/** A step name in the three languages (`workflows.builder.autoName.<key>`), so it reads right for every approver. */
export function autoStepName(key: AutoKey, values: Record<string, string | number> = {}): LocalizedText {
  const out: LocalizedText = {};
  for (const [locale, messages] of Object.entries(AUTO_NAMES)) {
    const t = createTranslator({
      locale,
      messages: { workflows: messages } as never,
      namespace: 'workflows.builder.autoName' as never,
    }) as unknown as (k: string, v?: Record<string, string | number>) => string;
    out[locale as keyof LocalizedText] = t(key, values);
  }
  return out;
}

/**
 * A step name from who approves it: "Manager approval", "Security team approval", "Application: Business owner
 * approval", in the three languages. Several approvers keep the generic "Approval".
 */
export function useApprovalName() {
  return useCallback(
    (
      approvers: readonly ApproverRule[],
      names: BuilderContextValue['names'],
      facts: readonly FactOption[],
    ): LocalizedText => {
      if (approvers.length !== 1) return autoStepName('generic');
      const r = approvers[0]!;
      switch (r.type) {
        case 'manager':
          return (r.level ?? 1) > 1
            ? autoStepName('managerLevel', { level: r.level ?? 1 })
            : autoStepName('manager');
        case 'department-head':
          return autoStepName('departmentHead');
        case 'group':
          return r.groupKey
            ? autoStepName('named', { name: names.groups[r.groupKey] ?? r.groupKey })
            : autoStepName('generic');
        case 'role':
          return r.roleKey
            ? autoStepName('named', { name: names.roles[r.roleKey] ?? r.roleKey })
            : autoStepName('generic');
        case 'user':
          return r.userId && names.users[r.userId]
            ? autoStepName('named', { name: names.users[r.userId]! })
            : autoStepName('generic');
        case 'fact': {
          const label = facts.find((f) => f.path === r.fact)?.label;
          return label ? autoStepName('named', { name: label }) : autoStepName('generic');
        }
        case 'requester':
          return autoStepName('requester');
      }
    },
    [],
  );
}

/* ───────────────────────── canvas ───────────────────────── */

function InsertMenu({ onInsert }: { onInsert: (type: StepType) => void }) {
  const t = useTranslations('workflows.builder');
  return (
    <DropdownMenu>
      <Hint label={t('addHere')}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('addHere')}
            className="grid size-6 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm transition-all hover:scale-110 hover:border-primary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:border-primary data-[state=open]:text-primary motion-reduce:transition-none motion-reduce:hover:scale-100"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="center" className="w-64">
        <DropdownMenuLabel>{t('addStep')}</DropdownMenuLabel>
        {STEP_TYPES.map(({ type, icon }) => (
          <DropdownMenuItem key={type} onSelect={() => onInsert(type)} className="items-start gap-3 py-2">
            <span className="mt-0.5 [&_svg]:size-4">{icon}</span>
            <span className="grid">
              <span className="font-medium">{t(`stepTypes.${type}.name`)}</span>
              <span className="text-xs text-muted-foreground">{t(`stepTypes.${type}.hint`)}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StepMenu({
  name,
  onMove,
  onDuplicate,
  onDelete,
  first,
  last,
}: {
  name: string;
  onMove: (d: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  first: boolean;
  last: boolean;
}) {
  const t = useTranslations('workflows.builder');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 bg-background/80"
          aria-label={t('stepActionsFor', { name })}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}>
          <ArrowUpIcon />
          {t('moveUp')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
          <ArrowDownIcon />
          {t('moveDown')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}>
          <CopyIcon />
          {t('duplicate')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon />
          {t('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The workflow canvas and its inspector (Step · [Workflow] · Test), shared by the workflow designer page and the
 * form builder's Approval tab. `fields` are the answers the workflow may use (`data.*`, `records.*`): the chosen
 * form's on the page, the form being built in the form builder.
 */
export function WorkflowCanvas({
  editor,
  trigger,
  fields,
  settings,
  known,
  initialSelection = null,
  focus,
}: {
  editor: WorkflowEditor;
  trigger: WorkflowTrigger | undefined;
  fields: readonly FieldDef[];
  /** Content of the "Workflow" tab (the designer page); without it the inspector has Step and Test only. */
  settings?: ReactNode;
  /** Facts every request already has here (in a form's builder: the form's key and category). */
  known?: Record<string, unknown>;
  initialSelection?: string | null;
  /** Select this step now (each new `at` selects again). */
  focus?: { id: string; at: number } | null;
}) {
  const t = useTranslations('workflows.builder');
  const locale = useLocale();
  const reduce = useReducedMotion();
  const approvalName = useApprovalName();
  const { def, draft, edit, readOnly, byStep } = editor;
  const [selected, setSelected] = useState<string | null>(initialSelection);
  const [panel, setPanel] = useState<'step' | 'settings' | 'test'>(
    settings && !initialSelection ? 'settings' : 'step',
  );
  const [zoom, setZoom] = useState(1);
  const [simulation, setSimulation] = useState<SimulationView | null>(null);
  const [extraNames, setExtraNames] = useState<BuilderContextValue['names']>({
    groups: {},
    roles: {},
    users: {},
  });
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Bumped to scroll the selected step into view after the next render. */
  const [reveal, setReveal] = useState(0);

  const roles = useApiQuery<{ items: Role[] }>('/roles');
  const triggerFacts = useFactOptions(trigger?.facts ?? []);
  const formFacts = useFieldFacts(fields, 'data');
  // Triggers whose subject has custom fields (`customFieldEntity`) pass them as `attributes.*` and `records.*`.
  const customFacts = useCustomFieldFacts(trigger?.customFieldEntity);
  // `today` (YYYY-MM-DD, UTC) is there for every trigger: "the planned start is within 3 days".
  const today = useTodayFact();
  const facts = useMemo(
    () => [
      ...triggerFacts.filter(
        (f) => !['data', 'records', 'attributes'].includes(f.path) && !f.path.startsWith('attributes.'),
      ),
      ...formFacts,
      ...customFacts,
      today,
    ],
    [triggerFacts, formFacts, customFacts, today],
  );
  // What approvers fill in (`steps.<id>.<key>`): a step sees the fields of the approval steps before it.
  const stepFacts = useStepFacts(draft);
  const allFacts = useMemo(() => [...facts, ...stepFacts.all], [facts, stepFacts.all]);

  const names = useMemo(
    () => ({
      groups: { ...def.names.groups, ...extraNames.groups },
      roles: {
        ...Object.fromEntries(
          (roles.data?.items ?? []).filter((r) => r.application.isPlatform).map((r) => [r.key, r.name]),
        ),
        ...def.names.roles,
      },
      users: { ...def.names.users, ...extraNames.users },
    }),
    [def.names, extraNames, roles.data],
  );
  const ctx: BuilderContextValue = {
    facts,
    names,
    roles: (roles.data?.items ?? [])
      .filter((r) => r.application.isPlatform)
      .map((r) => ({ key: r.key, name: r.name })),
    remember: (kind, key, value) => setExtraNames((n) => ({ ...n, [kind]: { ...n[kind], [key]: value } })),
    readOnly,
  };

  const stepNames: StepNames = {
    approval: autoStepName('manager'),
    condition: { [locale]: t('stepTypes.condition.name') },
    parallel: { [locale]: t('stepTypes.parallel.name') },
    notify: { [locale]: t('stepTypes.notify.name') },
    branch: { [locale]: t('branch') },
    otherwise: { [locale]: t('otherwise') },
    yes: { [locale]: t('yes') },
  };
  const change = (next: WorkflowGraph) => {
    edit(next);
    setSimulation(null);
  };
  const select = (id: string | null, scroll = false) => {
    if (scroll) setReveal((n) => n + 1);
    setSelected(id);
    if (id) setPanel('step');
  };

  // Asked from outside ("Add a fallback" in the checks): select that step.
  const [focusAt, setFocusAt] = useState(focus?.at ?? 0);
  if (focus && focus.at !== focusAt) {
    setFocusAt(focus.at);
    setReveal((n) => n + 1);
    setSelected(focus.id);
    setPanel('step');
  }

  // A new or duplicated step scrolls into view (the inspector shows it at the same time).
  useEffect(() => {
    if (!reveal) return;
    const node = canvasRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [reveal, reduce]);

  const selectedStep = selected ? findStep(draft, selected) : undefined;
  const runtime: Record<string, StepRuntime> | undefined = panel === 'test' ? simulation?.runtime : undefined;
  const stepName = (step: WorkflowStep) => localize(step.name, locale) || t(`stepTypes.${step.type}.name`);

  return (
    <BuilderContext value={ctx}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="relative min-h-[520px] overflow-hidden rounded-xl border bg-muted/20 [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:18px_18px]">
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-lg border bg-background/90 p-1 shadow-sm backdrop-blur">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t('zoomOut')}
              disabled={zoom <= 0.5}
              onClick={() => setZoom((z) => Math.round((z - 0.1) * 10) / 10)}
            >
              <ZoomOutIcon />
            </Button>
            <button
              type="button"
              className="w-12 text-center text-xs tabular-nums"
              onClick={() => setZoom(1)}
              aria-label={t('zoomReset')}
            >
              {Math.round(zoom * 100)}%
            </button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t('zoomIn')}
              disabled={zoom >= 1.4}
              onClick={() => setZoom((z) => Math.round((z + 0.1) * 10) / 10)}
            >
              <ZoomInIcon />
            </Button>
          </div>
          <div ref={canvasRef} className="h-full max-h-[75vh] overflow-auto px-4 pt-14 pb-8">
            <div style={{ zoom }}>
              <WorkflowDiagram
                graph={draft}
                names={{ ...names, facts: allFacts }}
                issues={panel === 'test' ? undefined : byStep}
                runtime={runtime}
                chosen={panel === 'test' ? simulation?.chosen : undefined}
                outcome={panel === 'test' ? simulation?.outcome : undefined}
                selectedId={selected}
                onSelect={(id) => select(id)}
                renderInsert={
                  readOnly
                    ? undefined
                    : ({ parent, index }) => (
                        <InsertMenu
                          onInsert={(type) => {
                            const step = newStep(type, stepNames);
                            change(insertStep(draft, parent, index, step));
                            select(step.id, true);
                          }}
                        />
                      )
                }
                renderActions={
                  readOnly
                    ? undefined
                    : (step, { parent, index }) => {
                        const len = getSequence(draft, parent).length;
                        return (
                          <StepMenu
                            name={stepName(step)}
                            first={index === 0}
                            last={index === len - 1}
                            onMove={(d) => change(moveStep(draft, parent, index, index + d))}
                            onDuplicate={() => {
                              const copy = cloneStep(step);
                              change(insertStep(draft, parent, index + 1, copy));
                              select(copy.id, true);
                            }}
                            onDelete={() => {
                              change(removeStep(draft, step.id));
                              if (selected === step.id) setSelected(null);
                            }}
                          />
                        );
                      }
                }
              />
            </div>
          </div>
        </div>

        <aside className="min-w-0 rounded-xl border bg-card">
          <Tabs value={panel} onValueChange={(v) => setPanel(v as typeof panel)} className="gap-0">
            <div className="border-b px-4 pt-3">
              <TabsList>
                <TabsTrigger value="step" disabled={!selectedStep && Boolean(settings)}>
                  {t('tabs.step')}
                </TabsTrigger>
                {settings && <TabsTrigger value="settings">{t('tabs.settings')}</TabsTrigger>}
                <TabsTrigger value="test">{t('tabs.test')}</TabsTrigger>
              </TabsList>
            </div>
            <div className="max-h-[75vh] overflow-y-auto p-4">
              <TabsContent value="step">
                {selectedStep ? (
                  <motion.div
                    key={selectedStep.id}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <BuilderContext
                      value={{ ...ctx, facts: [...facts, ...stepFacts.before(selectedStep.id)] }}
                    >
                      <StepEditor
                        step={selectedStep}
                        issues={byStep[selectedStep.id] ?? []}
                        onChange={(s: WorkflowStep) => {
                          // A step still named after its approvers follows them ("Manager approval" → "Finance approval").
                          let next = s;
                          if (s.type === 'approval' && selectedStep.type === 'approval') {
                            const before = localize(
                              approvalName(selectedStep.approvers, names, facts),
                              locale,
                            );
                            const after = approvalName(s.approvers, names, facts);
                            const current = localize(s.name, locale);
                            const generic = localize(autoStepName('generic'), locale);
                            if (
                              before !== localize(after, locale) &&
                              (current === before || current === generic)
                            )
                              next = { ...s, name: after };
                          }
                          change(replaceStep(draft, next));
                        }}
                      />
                    </BuilderContext>
                  </motion.div>
                ) : (
                  <div className="grid justify-items-center gap-2 py-6 text-center text-sm text-muted-foreground">
                    <MousePointerClickIcon className="size-5" aria-hidden />
                    <p className="max-w-64">{draft.steps.length ? t('selectStep') : t('startHint')}</p>
                  </div>
                )}
              </TabsContent>
              {settings && <TabsContent value="settings">{settings}</TabsContent>}
              <TabsContent value="test">
                <Simulator graph={draft} facts={allFacts} known={known} onResult={setSimulation} />
              </TabsContent>
            </div>
          </Tabs>
        </aside>
      </div>
    </BuilderContext>
  );
}

/** The workflow's status in a few words: "Version 2", "Not published", plus "Unpublished changes". */
export function useWorkflowStatus(editor: Pick<WorkflowEditor, 'def' | 'dirty'>) {
  const t = useTranslations('workflows.builder');
  const { def, dirty } = editor;
  return {
    version: def.publishedVersion ? t('version', { version: def.publishedVersion }) : t('draftOnly'),
    changed: (dirty || def.hasUnpublishedChanges) && def.publishedVersion !== null,
  };
}
