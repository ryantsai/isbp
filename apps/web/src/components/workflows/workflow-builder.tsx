'use client';

import type { FormDetail, Role, WorkflowDefinition, WorkflowTrigger } from '@isbp/contracts';
import {
  type ApproverRule,
  findStep,
  formFields,
  type StepType,
  validateWorkflowGraph,
  walkSteps,
  type WorkflowGraph,
  type WorkflowStep,
  workflowGraphSchema,
} from '@isbp/sdk';
import { ApiError, useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
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
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Textarea } from '@isbp/ui/textarea';
import { Hint } from '@isbp/ui/tooltip';
import { type StepRuntime, WorkflowDiagram } from '@isbp/ui/workflow-diagram';
import { cn } from '@isbp/ui';
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  BellIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RocketIcon,
  SaveIcon,
  SplitIcon,
  StarIcon,
  StarOffIcon,
  Trash2Icon,
  UndoIcon,
  UserCheckIcon,
  WorkflowIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { BuilderContext, type BuilderContextValue } from './builder-context';
import { cloneStep, getSequence, insertStep, moveStep, newStep, removeStep, replaceStep } from './graph-ops';
import { type SimulationView, Simulator } from './simulator';
import { StepEditor } from './step-editor';
import { useTodayFact } from '../fields/field-utils';
import { useCustomFieldFacts, useFieldFacts } from './field-facts';
import { useStepFacts } from './step-facts';
import { useFactOptions } from './use-fact-label';

const STEP_TYPES: { type: StepType; icon: React.ReactNode }[] = [
  { type: 'approval', icon: <UserCheckIcon /> },
  { type: 'condition', icon: <SplitIcon /> },
  { type: 'parallel', icon: <WorkflowIcon /> },
  { type: 'notify', icon: <BellIcon /> },
];

const canonical = (v: unknown) => JSON.stringify(v);

function incompleteRule(r: ApproverRule): boolean {
  if (r.type === 'user' && !r.userId) return true;
  if (r.type === 'group' && !r.groupKey) return true;
  if (r.type === 'role' && !r.roleKey) return true;
  if (r.type === 'fact' && !r.fact) return true;
  return 'fallback' in r && r.fallback ? incompleteRule(r.fallback) : false;
}

/** Client-side checks: the shared validator plus empty approver targets. */
function draftIssues(graph: WorkflowGraph) {
  const issues = validateWorkflowGraph(graph).map((i) => ({ stepId: i.stepId, code: i.code as string }));
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

/**
 * Fields of the form chosen in "Use the fields of", as `data.<key>` facts, plus `records.<key>.<fact>` for the records
 * its record fields pick.
 */
function useFormFacts(def: WorkflowDefinition | undefined, formId: string | null): FactOption[] {
  const { data } = useApiQuery<FormDetail>(formId ? `/forms/${formId}` : null);
  const fields = useMemo(
    () => (def?.triggerKey === 'core.form-submission' && data ? formFields(data.draft) : []),
    [data, def?.triggerKey],
  );
  return useFieldFacts(fields, 'data');
}

function InsertMenu({ onInsert }: { onInsert: (type: StepType) => void }) {
  const t = useTranslations('workflows.builder');
  return (
    <DropdownMenu>
      <Hint label={t('addHere')}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('addHere')}
            className="grid size-6 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm transition-all hover:scale-110 hover:border-primary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:border-primary data-[state=open]:text-primary motion-reduce:hover:scale-100"
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
  onMove,
  onDuplicate,
  onDelete,
  first,
  last,
}: {
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
          aria-label={t('stepActions')}
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

function Editor({ def, trigger }: { def: WorkflowDefinition; trigger: WorkflowTrigger | undefined }) {
  const t = useTranslations('workflows.builder');
  const tr = useTranslations();
  const ti = useTranslations('workflows.issues');
  const locale = useLocale();
  const errorText = useErrorText();
  const canManage = useCan('core.workflows.manage');
  const readOnly = !canManage || def.archived;
  const [draft, setDraft] = useState<WorkflowGraph>(def.draft);
  const [name, setName] = useState(tr.has(def.name) ? tr(def.name) : def.name);
  const [description, setDescription] = useState(def.description ?? '');
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<'step' | 'settings' | 'test'>('settings');
  const [zoom, setZoom] = useState(1);
  const [simulation, setSimulation] = useState<SimulationView | null>(null);
  const [publishIssues, setPublishIssues] = useState<WorkflowDefinition['issues'] | null>(null);
  const serverIssues = publishIssues ?? def.issues;
  const [extraNames, setExtraNames] = useState<BuilderContextValue['names']>({
    groups: {},
    roles: {},
    users: {},
  });
  const [formId, setFormId] = useState<string | null>(def.usedBy.forms[0]?.id ?? null);

  const roles = useApiQuery<{ items: Role[] }>('/roles');
  const forms = useApiQuery<{ items: { id: string; key: string; name: Record<string, string> }[] }>(
    def.triggerKey === 'core.form-submission' ? '/forms' : null,
  );
  const triggerFacts = useFactOptions(trigger?.facts ?? []);
  const formFacts = useFormFacts(def, formId);
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

  const originalName = tr.has(def.name) ? tr(def.name) : def.name;
  const dirty =
    canonical(draft) !== canonical(def.draft) ||
    name !== originalName ||
    description !== (def.description ?? '');
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
  const globalIssues = issues.filter((i) => !i.stepId);

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

  const stepNames = {
    approval: { [locale]: t('stepTypes.approval.name') },
    condition: { [locale]: t('stepTypes.condition.name') },
    parallel: { [locale]: t('stepTypes.parallel.name') },
    notify: { [locale]: t('stepTypes.notify.name') },
    branch: { [locale]: t('branch') },
    otherwise: { [locale]: t('otherwise') },
    yes: { [locale]: t('yes') },
  };
  const edit = (next: WorkflowGraph) => {
    setDraft(next);
    setSimulation(null);
    setPublishIssues(null);
  };
  const selectedStep = selected ? findStep(draft, selected) : undefined;

  const save = useApiMutation(
    (api) =>
      api.patch<WorkflowDefinition>(`/workflows/${def.id}`, {
        name,
        description: description || null,
        draft,
      }),
    { invalidate: ['/workflows'], silent: true },
  );
  const publish = useApiMutation((api) => api.post<WorkflowDefinition>(`/workflows/${def.id}/publish`), {
    invalidate: ['/workflows', '/workflow-triggers'],
    silent: true,
  });
  const action = useApiMutation((api, path: string) => api.post(path), {
    invalidate: ['/workflows', '/workflow-triggers'],
  });
  const clearDefault = useApiMutation((api) => api.delete(`/workflows/${def.id}/default`), {
    invalidate: ['/workflows', '/workflow-triggers'],
    success: t('defaultCleared'),
  });

  const validForSave = () => {
    if (issues.some((i) => i.code === 'incomplete')) {
      toast.error(t('incomplete'));
      return false;
    }
    if (!workflowGraphSchema.safeParse(draft).success) {
      toast.error(t('invalid'));
      return false;
    }
    return true;
  };
  const onSave = async () => {
    if (!validForSave()) return;
    try {
      await save.mutateAsync(undefined);
      toast.success(t('saved'));
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const onPublish = async () => {
    if (!validForSave()) return;
    try {
      if (dirty) await save.mutateAsync(undefined);
      const r = await publish.mutateAsync(undefined);
      toast.success(t('published', { version: r.publishedVersion ?? 1 }));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WORKFLOW_INVALID') {
        setPublishIssues((err.details as { issues?: WorkflowDefinition['issues'] })?.issues ?? []);
        toast.error(t('fixIssues'));
      } else toast.error(errorText(err));
    }
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const runtime: Record<string, StepRuntime> | undefined = panel === 'test' ? simulation?.runtime : undefined;

  return (
    <BuilderContext value={ctx}>
      <div className="grid gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
            <Link
              href="/admin/workflows"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftIcon className="size-3.5" aria-hidden />
              {t('back')}
            </Link>
            <h1 className="truncate text-2xl font-semibold tracking-tight">{name || originalName}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>
                {trigger ? (tr.has(trigger.name) ? tr(trigger.name) : trigger.name) : def.triggerKey}
              </span>
              {def.publishedVersion ? (
                <Badge variant="success">{t('version', { version: def.publishedVersion })}</Badge>
              ) : (
                <Badge variant="muted">{t('draftOnly')}</Badge>
              )}
              {def.isDefault && (
                <Badge variant="info">
                  <StarIcon aria-hidden />
                  {t('default')}
                </Badge>
              )}
              {(dirty || def.hasUnpublishedChanges) && def.publishedVersion !== null && (
                <Badge variant="warning">{t('unpublished')}</Badge>
              )}
              {def.archived && (
                <Badge variant="muted">
                  <ArchiveIcon aria-hidden />
                  {t('archived')}
                </Badge>
              )}
              {dirty && <span aria-live="polite">{t('unsaved')}</span>}
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {!def.archived && (
                <>
                  <Button variant="outline" onClick={onSave} disabled={!dirty || save.isPending}>
                    <SaveIcon />
                    {t('save')}
                  </Button>
                  <Button
                    onClick={onPublish}
                    disabled={publish.isPending || save.isPending || (!dirty && !def.hasUnpublishedChanges)}
                  >
                    <RocketIcon />
                    {t('publish')}
                  </Button>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('more')}>
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!def.isDefault && def.publishedVersion !== null && !def.archived && (
                    <DropdownMenuItem onSelect={() => action.mutate(`/workflows/${def.id}/default`)}>
                      <StarIcon />
                      {t('makeDefault')}
                    </DropdownMenuItem>
                  )}
                  {def.isDefault && !trigger?.required && (
                    <DropdownMenuItem onSelect={() => clearDefault.mutate(undefined)}>
                      <StarOffIcon />
                      {t('clearDefault')}
                    </DropdownMenuItem>
                  )}
                  {def.archived ? (
                    <DropdownMenuItem onSelect={() => action.mutate(`/workflows/${def.id}/restore`)}>
                      <UndoIcon />
                      {t('restore')}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => action.mutate(`/workflows/${def.id}/archive`)}
                    >
                      <ArchiveIcon />
                      {t('archive')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {globalIssues.length > 0 && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
          >
            <AlertTriangleIcon className="size-4 text-warning-foreground" aria-hidden />
            {globalIssues.map((i) => (ti.has(i.code) ? ti(i.code) : i.code)).join(' ')}
          </div>
        )}

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
            <div className="h-full max-h-[75vh] overflow-auto px-4 pt-14 pb-8">
              <div style={{ zoom }}>
                <WorkflowDiagram
                  graph={draft}
                  names={{ ...names, facts: allFacts }}
                  issues={panel === 'test' ? undefined : byStep}
                  runtime={runtime}
                  chosen={panel === 'test' ? simulation?.chosen : undefined}
                  outcome={panel === 'test' ? simulation?.outcome : undefined}
                  selectedId={selected}
                  onSelect={(id) => {
                    setSelected(id);
                    setPanel('step');
                  }}
                  renderInsert={
                    readOnly
                      ? undefined
                      : ({ parent, index }) => (
                          <InsertMenu
                            onInsert={(type) => {
                              const step = newStep(type, stepNames);
                              edit(insertStep(draft, parent, index, step));
                              setSelected(step.id);
                              setPanel('step');
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
                              first={index === 0}
                              last={index === len - 1}
                              onMove={(d) => edit(moveStep(draft, parent, index, index + d))}
                              onDuplicate={() => {
                                const copy = cloneStep(step);
                                edit(insertStep(draft, parent, index + 1, copy));
                                setSelected(copy.id);
                              }}
                              onDelete={() => {
                                edit(removeStep(draft, step.id));
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

          <aside className="rounded-xl border bg-card">
            <Tabs value={panel} onValueChange={(v) => setPanel(v as typeof panel)} className="gap-0">
              <div className="border-b px-4 pt-3">
                <TabsList>
                  <TabsTrigger value="step" disabled={!selectedStep}>
                    {t('tabs.step')}
                  </TabsTrigger>
                  <TabsTrigger value="settings">{t('tabs.settings')}</TabsTrigger>
                  <TabsTrigger value="test">{t('tabs.test')}</TabsTrigger>
                </TabsList>
              </div>
              <div className="max-h-[75vh] overflow-y-auto p-4">
                <TabsContent value="step">
                  {selectedStep ? (
                    <BuilderContext
                      value={{ ...ctx, facts: [...facts, ...stepFacts.before(selectedStep.id)] }}
                    >
                      <StepEditor
                        key={selectedStep.id}
                        step={selectedStep}
                        issues={byStep[selectedStep.id] ?? []}
                        onChange={(s: WorkflowStep) => edit(replaceStep(draft, s))}
                      />
                    </BuilderContext>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('selectStep')}</p>
                  )}
                </TabsContent>
                <TabsContent value="settings">
                  <fieldset disabled={readOnly} className="grid gap-5">
                    <legend className="sr-only">{t('tabs.settings')}</legend>
                    <div className="grid gap-1.5">
                      <Label htmlFor="wf-name">{t('name')}</Label>
                      <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="wf-desc">{t('description')}</Label>
                      <Textarea
                        id="wf-desc"
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                    {trigger && (
                      <div className="grid gap-1 rounded-lg bg-muted/40 p-3 text-sm">
                        <span className="font-medium">
                          {tr.has(trigger.name) ? tr(trigger.name) : trigger.name}
                        </span>
                        {trigger.description && (
                          <span className="text-muted-foreground">
                            {tr.has(trigger.description) ? tr(trigger.description) : trigger.description}
                          </span>
                        )}
                      </div>
                    )}
                    {def.triggerKey === 'core.form-submission' && (
                      <div className="grid gap-1.5">
                        <Label htmlFor="wf-form">{t('factsFromForm')}</Label>
                        <Select value={formId ?? undefined} onValueChange={setFormId}>
                          <SelectTrigger id="wf-form" className="w-full">
                            <SelectValue placeholder={t('pickForm')} />
                          </SelectTrigger>
                          <SelectContent>
                            {(forms.data?.items ?? []).map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.name[locale] ?? f.name.en ?? f.key}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{t('factsFromFormHint')}</p>
                      </div>
                    )}
                  </fieldset>
                  <div className="mt-6 grid gap-2 text-sm">
                    <h3 className="font-semibold">{t('usedBy')}</h3>
                    {!def.usedBy.forms.length && !def.usedBy.roles.length ? (
                      <p className="text-muted-foreground">
                        {def.isDefault ? t('usedByDefault') : t('usedByNothing')}
                      </p>
                    ) : (
                      <ul className="grid gap-1">
                        {def.usedBy.forms.map((f) => (
                          <li key={f.id}>
                            <Link className="text-primary hover:underline" href={`/admin/forms/${f.id}`}>
                              {f.name[locale as 'en'] ?? f.name.en ?? f.key}
                            </Link>
                          </li>
                        ))}
                        {def.usedBy.roles.map((r) => (
                          <li key={r.id}>
                            <Link className="text-primary hover:underline" href={`/admin/roles/${r.id}`}>
                              {r.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="mt-6 grid gap-2 text-sm">
                    <h3 className="font-semibold">{t('versions')}</h3>
                    {!def.versions.length ? (
                      <p className="text-muted-foreground">{t('noVersions')}</p>
                    ) : (
                      <ol className="grid gap-1.5">
                        {def.versions.map((v) => (
                          <li key={v.version} className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                'font-medium',
                                v.version === def.publishedVersion && 'text-success',
                              )}
                            >
                              {t('version', { version: v.version })}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {v.publishedBy?.displayName ?? t('system')} ·{' '}
                              <RelativeTime date={v.publishedAt} />
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="test">
                  <Simulator graph={draft} facts={allFacts} onResult={setSimulation} />
                </TabsContent>
              </div>
            </Tabs>
          </aside>
        </div>
      </div>
    </BuilderContext>
  );
}

/** Visual builder for one workflow definition. */
export function WorkflowBuilder({ id }: { id: string }) {
  const { data: def, isLoading } = useApiQuery<WorkflowDefinition>(`/workflows/${id}`);
  const triggers = useApiQuery<{ items: WorkflowTrigger[] }>('/workflow-triggers');
  if (isLoading || !def)
    return (
      <div className="grid gap-4">
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-[520px] w-full rounded-xl" />
      </div>
    );
  const trigger = triggers.data?.items.find((x) => x.key === def.triggerKey);
  return <Editor key={def.id} def={def} trigger={trigger} />;
}
