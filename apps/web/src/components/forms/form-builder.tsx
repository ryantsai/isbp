'use client';

import {
  type CollisionDetection,
  closestCenter,
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type {
  FormDetail,
  UpdateFormInput,
  WorkflowDefinition,
  WorkflowDefinitionSummary,
  WorkflowTrigger,
} from '@isbp/contracts';
import {
  type DisplayType,
  type FieldDef,
  type FieldType,
  type FormElement,
  type FormSchema,
  findStep,
  formSchemaSchema,
  isField,
  localize,
} from '@isbp/sdk';
import { ApiError, useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Card, CardContent } from '@isbp/ui/card';
import { useConditionText } from '@isbp/ui/condition-builder';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { BackLink, DetailHeader } from '@isbp/ui/page-header';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatTile } from '@isbp/ui/stat-tile';
import { toast } from '@isbp/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileQuestionMarkIcon,
  HammerIcon,
  InboxIcon,
  MousePointerClickIcon,
  PencilIcon,
  Redo2Icon,
  RocketIcon,
  SaveIcon,
  Settings2Icon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  UserCheckIcon,
  WorkflowIcon,
  XIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FieldEditor } from '@/components/fields/field-editor';
import { type ElementType, ElementTypeIcon } from '@/components/fields/field-types';
import {
  canonical,
  type EditableElement,
  type FieldIssue,
  fieldFacts,
  formIssues,
  hasText,
} from '@/components/fields/field-utils';
import { useDndAccessibility } from '@/components/fields/dnd';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { BuilderCanvas, CANVAS_END, CanvasGhost, type DropTarget } from './builder-canvas';
import { BuilderPalette, PALETTE_PREFIX, type PaletteData, PaletteGhost } from './builder-palette';
import { FormIcon, FormIconTile, FormStatusBadges } from './form-meta';
import { FormPreview } from './form-preview';
import { actionsIssues, FormActions, useActionCatalog } from './form-actions';
import { FormRules, rulesIssues } from './form-rules';
import { FormSettings, settingsIssues } from './form-settings';
import { FormSubmissions } from './form-submissions';
import { FormAssignments } from '@/components/assignments/form-assignments';
import { useFieldFacts } from '@/components/workflows/field-facts';
import { replaceStep } from '@/components/workflows/graph-ops';
import {
  useOptionalWorkflowEditor,
  useWorkflowName,
  WorkflowEditorError,
} from '@/components/workflows/workflow-editor';
import { FORM_TRIGGER } from '@/components/workflows/workflow-labels';
import { FormApproval } from './form-approval';
import { BuilderApprovalPreview } from './builder-preview';
import { type CheckTab, type ProcessCheck, ProcessCheckList, useProcessChecks } from './process-checks';
import { PublishSuccess } from './publish-success';
import {
  type BuilderState,
  createElement,
  duplicateElement,
  fromDetail,
  toDraft,
  toPatch,
  useHistory,
} from './use-builder';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Kbd } from '@astryxdesign/core/Kbd';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Heading, Text } from '@astryxdesign/core/Text';

/** Building tabs in the order of the process (questions → rules → approval → actions), then using it. */
const TABS = [
  'build',
  'rules',
  'approval',
  'actions',
  'preview',
  'settings',
  'submissions',
  'assignments',
] as const;
type Tab = (typeof TABS)[number];

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}

function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(w);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function isEditable(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    Boolean(el.closest('[role="dialog"]'))
  );
}

/** Pointer: whatever is under the pointer; keyboard: the closest corners of the moved ghost. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length) return hits;
  return args.pointerCoordinates ? closestCenter(args) : closestCorners(args);
};

export function FormBuilderView({ id }: { id: string }) {
  const t = useTranslations('forms');
  const { data, isLoading, error } = useApiQuery<FormDetail>(`/forms/${id}`);
  const back = <BackLink href="/admin/forms" label={t('title')} />;
  if (isLoading)
    return (
      <div className="space-y-5">
        {back}
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-[28rem] w-full rounded-2xl" />
      </div>
    );
  if (error || !data)
    return (
      <div className="space-y-5">
        {back}
        <EmptyState
          icon={<FileQuestionMarkIcon />}
          title={t('builder.notFound')}
          description={t('builder.notFoundDescription')}
        />
      </div>
    );
  return <FormBuilder key={data.id} form={data} />;
}

function FormBuilder({ form }: { form: FormDetail }) {
  const t = useTranslations('forms.builder');
  const tf = useTranslations('fields');
  const tforms = useTranslations('forms');
  const tAssign = useTranslations('assignments.admin');
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const client = useQueryClient();
  const errorText = useErrorText();
  const { state, update, undo, redo, canUndo, canRedo } = useHistory<BuilderState>(() => fromDetail(form));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [confirm, setConfirm] = useState<'publish' | 'archive' | 'leave' | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [justPublished, setJustPublished] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({});
  const [stepFocus, setStepFocus] = useState<{ id: string; at: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const rootId = useId();
  const width = useWidth(rootRef);
  const twoColumns = useMediaQuery('(min-width: 640px)');
  const mode: 'full' | 'split' | 'compact' =
    width === null || width >= 1060 ? 'full' : width >= 760 ? 'split' : 'compact';

  const tabParam = sp.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'build';
  const setTab = (next: string) => {
    const params = new URLSearchParams(sp.toString());
    if (next === 'build') params.delete('tab');
    else params.set('tab', next);
    // List state of the submissions and assignments tabs does not carry over.
    if (next !== tab) ['page', 'pageSize', 'status', 'state', 'period', 'q'].forEach((k) => params.delete(k));
    router.replace(`/admin/forms/${form.id}${params.size ? `?${params}` : ''}`, { scroll: false });
  };

  /* ───────── derived ───────── */

  const elements = state.elements;
  const fields = useMemo(() => elements.filter(isField), [elements]);
  const issues = useMemo(() => formIssues(elements), [elements]);
  const formSettingsIssues = settingsIssues(state);
  const ruleIssues = useMemo(() => rulesIssues(state.rules, fields), [state.rules, fields]);
  const ruleIssueCount = [...ruleIssues.values()].reduce((n, l) => n + l.length, 0);
  const actionCatalog = useActionCatalog(form.id, elements);
  const actionIssues = useMemo(
    () => actionsIssues(state.actions, actionCatalog.items),
    [state.actions, actionCatalog.items],
  );
  const actionIssueCount = [...actionIssues.values()].reduce((n, c) => n + c, 0);
  const issueCount =
    [...issues.values()].reduce((n, l) => n + l.length, 0) +
    formSettingsIssues.length +
    ruleIssueCount +
    actionIssueCount;
  /* ───────── the approval (the form's workflow, built on the Approval tab) ───────── */

  const canReadWorkflows = useCan('core.workflows.read');
  const workflowName = useWorkflowName();
  const workflows = useApiQuery<{ items: WorkflowDefinitionSummary[] }>(
    canReadWorkflows ? '/workflows' : null,
    {
      triggerKey: FORM_TRIGGER,
    },
  );
  const triggers = useApiQuery<{ items: WorkflowTrigger[] }>(canReadWorkflows ? '/workflow-triggers' : null);
  const formTrigger = triggers.data?.items.find((x) => x.key === FORM_TRIGGER);
  const approvalQuery = useApiQuery<WorkflowDefinition>(
    canReadWorkflows && state.workflowDefinitionId ? `/workflows/${state.workflowDefinitionId}` : null,
  );
  const approvalDef =
    approvalQuery.data && approvalQuery.data.id === state.workflowDefinitionId
      ? approvalQuery.data
      : undefined;
  const approval = useOptionalWorkflowEditor(approvalDef);
  const attached = workflows.data?.items.find((w) => w.id === state.workflowDefinitionId);
  const approvalPublished = (approvalDef ?? attached)?.publishedVersion != null;
  const workflowDraftOnly = Boolean(
    state.workflowDefinitionId && (approvalDef ?? attached) && !approvalPublished,
  );
  /** Publishing here publishes the approval too (when you may). */
  const approvalNeedsPublish = Boolean(
    approval && approval.canManage && !approval.def.archived && approval.unpublished,
  );
  // The workflow a form names applies at once: a live form only switches to it when it is published (on Publish).
  const pendingLink =
    form.publishedVersion !== null &&
    state.workflowDefinitionId !== null &&
    state.workflowDefinitionId !== (form.workflow?.id ?? null) &&
    !approvalPublished;
  const approvalIssueCount = approval?.issues.length ?? 0;

  const patch = useMemo(() => toPatch(state), [state]);
  const baseline = useMemo(() => canonical(toPatch(fromDetail(form))), [form]);
  /** What Save stores: a live form keeps its current workflow until the new one is published. */
  const savable = useMemo(
    () => (pendingLink ? { ...patch, workflowDefinitionId: form.workflow?.id ?? null } : patch),
    [patch, pendingLink, form.workflow],
  );
  const formDirty = canonical(savable) !== baseline;
  const dirty = formDirty || Boolean(approval?.dirty);
  const published = (form.published as FormSchema | null) ?? null;
  const publishedFields = useMemo(
    () => new Map((published?.elements ?? []).filter(isField).map((f) => [f.id, f])),
    [published],
  );
  const lockedIds = useMemo(
    () => new Set(fields.filter((f) => publishedFields.has(f.id)).map((f) => f.id)),
    [fields, publishedFields],
  );
  const draftChanged =
    !published ||
    canonical(toDraft(elements, { rules: state.rules, actions: state.actions })) !== canonical(published);
  const facts = useMemo(() => fieldFacts(fields, locale), [fields, locale]);
  const conditionText = useConditionText(facts);
  const selected = elements.find((e) => e.id === selectedId) ?? null;

  const formNeedsPublish = form.publishedVersion === null || draftChanged;
  const publishBlock: string | null = form.archived
    ? t('publishBlocked.archived')
    : !fields.length
      ? t('publishBlocked.noFields')
      : issueCount > 0
        ? t('publishBlocked.issues', { count: issueCount })
        : approvalIssueCount > 0
          ? t('publishBlocked.approval', { count: approvalIssueCount })
          : workflowDraftOnly && !approvalNeedsPublish
            ? t('publishBlocked.workflow')
            : !formNeedsPublish && !approvalNeedsPublish && !pendingLink && !formDirty
              ? t('publishBlocked.upToDate', { version: form.publishedVersion ?? 1 })
              : null;

  /* ───────── before you publish ───────── */

  const dataFacts = useFieldFacts(fields, 'data');
  const go = useCallback(
    (to: CheckTab, target?: string) => {
      setConfirm(null);
      const params = new URLSearchParams(sp.toString());
      if (to === 'build') params.delete('tab');
      else params.set('tab', to);
      router.replace(`/admin/forms/${form.id}${params.size ? `?${params}` : ''}`, { scroll: false });
      if (to === 'build' && target) {
        setSelectedId(target);
        setFocusId(target);
      }
      if (to === 'approval' && target) setStepFocus({ id: target, at: Date.now() });
    },
    [router, sp, form.id],
  );
  const skipStep = useCallback(
    (stepId: string) => {
      if (!approval) return;
      const step = findStep(approval.draft, stepId);
      if (step?.type === 'approval')
        approval.edit(replaceStep(approval.draft, { ...step, ifNoApprover: 'skip' }));
    },
    [approval],
  );
  const checks: ProcessCheck[] = useProcessChecks({
    fields,
    audience: state.audience,
    graph: approval?.draft ?? null,
    facts: dataFacts,
    groupNames: approval?.def.names.groups ?? {},
    enabled: !form.archived,
    go,
    skipStep: approval?.readOnly ? undefined : skipStep,
  });
  const checksOn = (tab: CheckTab) => checks.filter((c) => c.tab === tab);

  /* ───────── element operations ───────── */

  const typeLabel = useCallback(
    (type: ElementType) =>
      (['heading', 'paragraph', 'divider'] as string[]).includes(type)
        ? tf(`display.${type}.name`)
        : tf(`types.${type}.name`),
    [tf],
  );
  const elementName = useCallback(
    (el: FormElement) =>
      (isField(el) ? localize(el.label, locale) : localize(el.text, locale)) || typeLabel(el.type),
    [locale, typeLabel],
  );

  const insert = (type: FieldType | DisplayType, index?: number) => {
    const el = createElement(
      type,
      elements,
      {
        label: (ft) => tf(`types.${ft}.defaultLabel`),
        option: (n) => tf('editor.optionN', { n }),
        heading: tf('display.heading.defaultText'),
        paragraph: tf('display.paragraph.defaultText'),
      },
      locale,
    );
    const selIndex = selectedId ? elements.findIndex((e) => e.id === selectedId) : -1;
    const at = index ?? (selIndex >= 0 ? selIndex + 1 : elements.length);
    update((s) => ({ ...s, elements: [...s.elements.slice(0, at), el, ...s.elements.slice(at)] }));
    setSelectedId(el.id);
    setFocusId(el.id);
    setAnnouncement(t('added', { type: typeLabel(type), position: at + 1 }));
  };

  const updateElement = (id: string, next: EditableElement) =>
    update(
      (s) => ({
        ...s,
        elements: s.elements.map((e) => (e.id === id ? ({ ...next, id } as FormElement) : e)),
      }),
      `el:${id}`,
    );

  const moveTo = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= elements.length) return;
    const el = elements[from]!;
    update((s) => {
      const list = [...s.elements];
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved!);
      return { ...s, elements: list };
    });
    setAnnouncement(t('moved', { name: elementName(el), position: to + 1, total: elements.length }));
  };

  const move = (id: string, by: -1 | 1) => {
    const from = elements.findIndex((e) => e.id === id);
    moveTo(from, from + by);
    setFocusId(id);
  };

  const duplicate = (id: string) => {
    const i = elements.findIndex((e) => e.id === id);
    const el = elements[i];
    if (!el) return;
    const copy = duplicateElement(el, elements);
    update((s) => ({ ...s, elements: [...s.elements.slice(0, i + 1), copy, ...s.elements.slice(i + 1)] }));
    setSelectedId(copy.id);
    setFocusId(copy.id);
    setAnnouncement(t('duplicated', { name: elementName(el) }));
  };

  const remove = (id: string) => {
    const i = elements.findIndex((e) => e.id === id);
    const el = elements[i];
    if (!el) return;
    update((s) => ({ ...s, elements: s.elements.filter((e) => e.id !== id) }));
    const neighbour = elements[i + 1] ?? elements[i - 1];
    if (selectedId === id) setSelectedId(null);
    if (neighbour) setFocusId(neighbour.id);
    const message = t('removed', { name: elementName(el) });
    setAnnouncement(message);
    toast(message, { action: { label: t('undo'), onClick: () => undo() } });
  };

  // Keep keyboard focus on the element that was just added, moved or revealed.
  useEffect(() => {
    if (!focusId) return;
    const node = document.querySelector<HTMLElement>(`[data-select="${focusId}"]`);
    if (node) {
      node.focus({ preventScroll: true });
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    setFocusId(null);
  }, [focusId, elements]);

  /* ───────── drag and drop ───────── */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [drag, setDrag] = useState<{ id: string; palette?: ElementType; keyboard: boolean } | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);

  const rowStarts = useMemo(() => {
    const starts: boolean[] = [];
    let col = 0;
    for (const el of elements) {
      const half = twoColumns && isField(el) && el.width === 'half';
      starts.push(!half || col === 0);
      col = half && col === 0 ? 1 : 0;
    }
    return starts;
  }, [elements, twoColumns]);

  const targetAt = (index: number): DropTarget => ({
    index,
    vertical: index < elements.length && !rowStarts[index],
  });

  const computeDrop = (e: DragMoveEvent): DropTarget | null => {
    const { active, over } = e;
    if (!over) return null;
    if (over.id === CANVAS_END) return targetAt(elements.length);
    const overIndex = elements.findIndex((el) => el.id === over.id);
    if (overIndex < 0) return null;
    const fromPalette = (active.data.current as PaletteData | undefined)?.from === 'palette';
    if (!fromPalette && drag?.keyboard) {
      const activeIndex = elements.findIndex((el) => el.id === active.id);
      return targetAt(overIndex > activeIndex ? overIndex + 1 : overIndex);
    }
    const pointer = e.activatorEvent as PointerEvent | null;
    const rect = active.rect.current.translated;
    const x =
      pointer && 'clientX' in pointer ? pointer.clientX + e.delta.x : rect ? rect.left + rect.width / 2 : 0;
    const y =
      pointer && 'clientY' in pointer ? pointer.clientY + e.delta.y : rect ? rect.top + rect.height / 2 : 0;
    const target = elements[overIndex]!;
    const half = twoColumns && isField(target) && target.width === 'half';
    const after = half ? x > over.rect.left + over.rect.width / 2 : y > over.rect.top + over.rect.height / 2;
    return targetAt(after ? overIndex + 1 : overIndex);
  };

  const sameDrop = (a: DropTarget | null, b: DropTarget | null) =>
    a === b || (a !== null && b !== null && a.index === b.index && a.vertical === b.vertical);

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const data = active.data.current as PaletteData | undefined;
    setDrag({
      id: String(active.id),
      palette: data?.from === 'palette' ? data.type : undefined,
      keyboard: activatorEvent instanceof KeyboardEvent,
    });
    if (data?.from !== 'palette') setSelectedId(String(active.id));
  };
  const onDragMove = (e: DragMoveEvent) => {
    const next = computeDrop(e);
    setDrop((cur) => (sameDrop(cur, next) ? cur : next));
  };
  const onDragEnd = (e: DragEndEvent) => {
    const target = computeDrop(e) ?? drop;
    setDrag(null);
    setDrop(null);
    if (!target || !e.over) return;
    const data = e.active.data.current as PaletteData | undefined;
    if (data?.from === 'palette') {
      insert(data.type, target.index);
      return;
    }
    const from = elements.findIndex((el) => el.id === e.active.id);
    if (from < 0) return;
    const to = target.index > from ? target.index - 1 : target.index;
    moveTo(from, to);
    setFocusId(String(e.active.id));
  };
  const onDragCancel = () => {
    setDrag(null);
    setDrop(null);
  };

  const describe = useCallback(
    (id: string) => {
      if (id.startsWith(PALETTE_PREFIX)) return typeLabel(id.slice(PALETTE_PREFIX.length) as ElementType);
      if (id === CANVAS_END) return t('endOfForm');
      const el = elements.find((e) => e.id === id);
      return el ? elementName(el) : id;
    },
    [elements, elementName, typeLabel, t],
  );
  const position = useCallback(
    (id: string) => {
      if (id === CANVAS_END) return { position: elements.length + 1, total: elements.length + 1 };
      const i = elements.findIndex((e) => e.id === id);
      return i < 0 ? null : { position: i + 1, total: elements.length };
    },
    [elements],
  );
  const accessibility = useDndAccessibility(describe, position);
  const activeElement = drag && !drag.palette ? elements.find((e) => e.id === drag.id) : undefined;

  /* ───────── save / publish / archive ───────── */

  const setDetail = (detail: FormDetail) => client.setQueryData([`/forms/${form.id}`, {}], detail);
  const saveMutation = useApiMutation(
    (api, body: UpdateFormInput) => api.patch<FormDetail>(`/forms/${form.id}`, body),
    { invalidate: ['/forms', '/audit-logs'], silent: true },
  );
  const publishMutation = useApiMutation((api) => api.post<FormDetail>(`/forms/${form.id}/publish`), {
    invalidate: ['/forms', '/audit-logs', '/requests'],
    silent: true,
  });
  const archiveMutation = useApiMutation(
    (api, archived: boolean) => api.post(`/forms/${form.id}/${archived ? 'archive' : 'restore'}`),
    {
      invalidate: ['/forms', '/audit-logs', '/requests'],
      success: (_r) => (form.archived ? t('restoredToast') : t('archivedToast')),
      onSuccess: () => setConfirm(null),
    },
  );

  /** Jumps to the first problem (element or settings) so it can be fixed. */
  const revealFirstIssue = () => {
    if (ruleIssueCount && !issues.size) {
      setTab('rules');
      return;
    }
    if (actionIssueCount && !issues.size && !ruleIssueCount) {
      setTab('actions');
      return;
    }
    if (formSettingsIssues.length) {
      setTab('settings');
      return;
    }
    const first = elements.find((e) => issues.has(e.id));
    if (first) {
      setTab('build');
      setSelectedId(first.id);
      setFocusId(first.id);
    }
  };

  /** Saves the form's draft (`withLink`: also the approval it names, once that approval is published). */
  const saveForm = async (opts: { withLink?: boolean } = {}): Promise<boolean> => {
    if (issueCount > 0) {
      toast.error(t('fixIssues', { count: issueCount }));
      revealFirstIssue();
      return false;
    }
    const body = opts.withLink ? toPatch(state) : savable;
    if (!formSchemaSchema.safeParse(body.draft).success) {
      toast.error(t('invalidDraft'));
      return false;
    }
    try {
      const res = await saveMutation.mutateAsync(body);
      setDetail(res);
      return true;
    } catch (err) {
      const path =
        err instanceof ApiError
          ? (err.details as { issues?: { path: string }[] } | undefined)?.issues?.[0]?.path
          : undefined;
      const m = path?.match(/^draft\.elements\.(\d+)/);
      const el = m ? elements[Number(m[1])] : undefined;
      if (el) {
        setTab('build');
        setSelectedId(el.id);
      }
      // Process actions the API refused (a config issue, a permission, a disabled module).
      const actionPath =
        err instanceof ApiError ? (path ?? (err.details as { path?: string } | undefined)?.path) : undefined;
      if (actionPath?.startsWith('draft.actions.')) setTab('actions');
      toast.error(errorText(err));
      return false;
    }
  };

  /** Saves the approval's draft (when changed); false after saying why it couldn't. */
  const saveApproval = async (): Promise<boolean> => {
    if (!approval?.dirty || approval.readOnly) return true;
    try {
      await approval.save();
      return true;
    } catch (err) {
      toast.error(err instanceof WorkflowEditorError ? err.message : errorText(err));
      setTab('approval');
      return false;
    }
  };

  const save = async (): Promise<boolean> => (await saveApproval()) && (!formDirty || (await saveForm()));

  const onSave = async () => {
    if (await save()) toast.success(t('saved'));
  };

  /**
   * One Publish for the whole process: the approval first (so the form never goes live naming an approval that
   * can't run), then the form's draft and its new version.
   */
  const onPublish = async () => {
    setPublishing(true);
    try {
      if (approval && approvalNeedsPublish) {
        try {
          await approval.publish();
        } catch (err) {
          setConfirm(null);
          toast.error(err instanceof WorkflowEditorError ? err.message : errorText(err));
          setTab('approval');
          return;
        }
      } else if (!(await saveApproval())) return;
      const linkChanged = state.workflowDefinitionId !== (form.workflow?.id ?? null);
      if ((formDirty || linkChanged) && !(await saveForm({ withLink: true }))) return;
      let version = form.publishedVersion ?? 1;
      if (formNeedsPublish) {
        const res = await publishMutation.mutateAsync(undefined);
        setDetail(res);
        version = res.publishedVersion ?? 1;
      }
      setConfirm(null);
      setJustPublished(version);
      setAnnouncement(t('published', { version }));
    } catch (err) {
      setConfirm(null);
      if (err instanceof ApiError && err.code === 'WORKFLOW_NOT_CONFIGURED')
        toast.error(t('publishBlocked.workflow'));
      else toast.error(errorText(err));
    } finally {
      setPublishing(false);
    }
  };

  /** The Approval tab names another workflow (or none); a new one is published with the form. */
  const link = (id: string | null) => update((s) => ({ ...s, workflowDefinitionId: id }));

  // Latest values for the global shortcuts (refs are only touched in effects and handlers).
  const latest = useRef({ dirty, save: onSave, undo, redo, selectedId, move });
  useEffect(() => {
    latest.current = { dirty, save: onSave, undo, redo, selectedId, move };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const l = latest.current;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (l.dirty) void l.save();
        return;
      }
      if (isEditable(e.target)) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) l.redo();
        else l.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        l.redo();
      } else if (e.altKey && l.selectedId && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        l.move(l.selectedId, e.key === 'ArrowUp' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const unsaved = dirty || pendingLink;
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  /* ───────── render ───────── */

  const status = {
    publishedVersion: form.publishedVersion,
    hasUnpublishedChanges: draftChanged || pendingLink || approvalNeedsPublish,
    active: state.active,
    archived: form.archived,
  };
  const name = localize(state.name, locale) || form.key;
  const saving = saveMutation.isPending;
  const portalHref = `/requests/forms/${form.key}`;

  const properties = selected ? (
    <PropertiesPanel
      key={selected.id}
      element={selected}
      index={elements.indexOf(selected)}
      count={elements.length}
      siblings={fields.filter((f) => f.id !== selected.id)}
      issues={issues.get(selected.id) ?? []}
      lockedKey={lockedIds.has(selected.id)}
      lockedValues={
        isField(selected)
          ? new Set((publishedFields.get(selected.id)?.options ?? []).map((o) => o.value))
          : undefined
      }
      onChange={(next) => updateElement(selected.id, next)}
      onClose={() => {
        setFocusId(selected.id);
        setSelectedId(null);
      }}
      onRemove={() => remove(selected.id)}
      typeName={typeLabel(selected.type)}
      inSheet={mode === 'compact'}
    />
  ) : (
    <PropertiesEmpty
      fieldCount={fields.length}
      conditional={fields.filter((f) => f.visibleWhen).length}
      issueCount={issueCount}
      onRevealIssue={revealFirstIssue}
    />
  );

  const canvasHeader = (
    <VStack gap={3}>
      <HStack gap={3} vAlign="start">
        <FormIconTile name={state.icon} size="default" />
        <StackItem size="fill">
          <VStack gap={0.5}>
            <Heading level={2} maxLines={2}>
              {name}
            </Heading>
            {hasText(state.description) && (
              <Text type="supporting">{localize(state.description, locale)}</Text>
            )}
          </VStack>
        </StackItem>
        <IconButton
          label={t('editDetails')}
          variant="ghost"
          size="sm"
          icon={<Icon icon={PencilIcon} />}
          onClick={() => setTab('settings')}
        />
      </HStack>
      <Divider />
    </VStack>
  );

  const approvalBadge =
    approvalIssueCount > 0 ? (
      <Badge variant="error" label={approvalIssueCount} icon={<Icon icon={TriangleAlertIcon} size="xsm" />} />
    ) : checksOn('approval').length > 0 ? (
      <Badge
        variant="warning"
        label={checksOn('approval').length}
        icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
      />
    ) : approval?.unpublished && !approval.readOnly ? (
      <StatusDot variant="warning" label={t('tabs.approvalChanged')} />
    ) : undefined;
  const countBadge = (issuesCount: number, total: number) =>
    issuesCount > 0 ? (
      <Badge variant="error" label={issuesCount} icon={<Icon icon={TriangleAlertIcon} size="xsm" />} />
    ) : total > 0 ? (
      <Badge variant="neutral" label={total} />
    ) : undefined;
  const tabLabel: Record<Tab, string> = {
    build: t('tabs.build'),
    rules: t('tabs.rules'),
    approval: t('tabs.approval'),
    actions: t('tabs.actions'),
    preview: t('tabs.preview'),
    settings: t('tabs.settings'),
    submissions: t('tabs.submissions'),
    assignments: tAssign('tab'),
  };
  const panelId = `${rootId}-panel`;

  const publishButton = publishBlock ? (
    <Button
      label={t('publish')}
      variant="primary"
      icon={<Icon icon={RocketIcon} />}
      isDisabled
      tooltip={publishBlock}
    />
  ) : (
    <Button
      label={t('publish')}
      variant="primary"
      icon={<Icon icon={RocketIcon} />}
      isLoading={publishing}
      onClick={() => setConfirm('publish')}
    />
  );

  return (
    <div ref={rootRef} className="@container space-y-5">
      <Button
        label={tforms('title')}
        variant="ghost"
        size="sm"
        icon={<Icon icon={ArrowLeftIcon} />}
        href="/admin/forms"
        onClick={(e) => {
          if (!unsaved) return;
          e.preventDefault();
          setConfirm('leave');
        }}
      />

      <FadeIn y={4}>
        <DetailHeader
          icon={<FormIcon name={state.icon} />}
          title={name}
          status={
            <motion.span
              key={`${form.publishedVersion}-${form.archived}`}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            >
              <FormStatusBadges form={status} />
            </motion.span>
          }
          meta={
            <HStack gap={3} wrap="wrap" vAlign="center">
              <Code>{form.key}</Code>
              <span>{t('fieldCount', { count: fields.length })}</span>
              <span aria-live="polite">
                <AnimatePresence initial={false}>
                  {dirty && (
                    <motion.span
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      <Badge variant="warning" label={t('unsaved')} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </HStack>
          }
          primaryAction={publishButton}
          menu={[
            {
              id: 'portal',
              label: t('openInPortal'),
              icon: <Icon icon={ExternalLinkIcon} />,
              href: portalHref,
              disabled: form.publishedVersion === null || form.archived || !form.active,
            },
            {
              id: 'preview',
              label: t('previewAction'),
              icon: <Icon icon={EyeIcon} />,
              onSelect: () => setTab('preview'),
            },
            form.archived
              ? {
                  id: 'restore',
                  label: t('restore'),
                  icon: <Icon icon={ArchiveRestoreIcon} />,
                  onSelect: () => archiveMutation.mutate(false),
                }
              : {
                  id: 'archive',
                  label: t('archive'),
                  icon: <Icon icon={ArchiveIcon} />,
                  destructive: true,
                  onSelect: () => setConfirm('archive'),
                },
          ]}
        >
          <HStack gap={0.5}>
            <IconButton
              label={t('undo')}
              tooltip={t('undoHint')}
              variant="ghost"
              icon={<Icon icon={Undo2Icon} />}
              isDisabled={!canUndo}
              onClick={undo}
            />
            <IconButton
              label={t('redo')}
              tooltip={t('redoHint')}
              variant="ghost"
              icon={<Icon icon={Redo2Icon} />}
              isDisabled={!canRedo}
              onClick={redo}
            />
          </HStack>
          <Button
            label={t('save')}
            variant="secondary"
            icon={<Icon icon={SaveIcon} />}
            isLoading={(saving || approval?.busy === 'saving') && !publishing}
            isDisabled={!dirty}
            onClick={() => void onSave()}
          />
        </DetailHeader>
      </FadeIn>

      {form.archived && (
        <Banner
          status="info"
          collapsible={false}
          icon={<Icon icon={ArchiveIcon} />}
          title={t('archivedNote')}
        />
      )}

      <PublishSuccess
        open={justPublished !== null}
        version={justPublished ?? 1}
        audience={
          form.audience.type === 'everyone'
            ? t('success.everyone')
            : t('success.groups', { count: form.audience.groupKeys.length })
        }
        href={portalHref}
        live={form.active && !form.archived}
        onClose={() => setJustPublished(null)}
      />

      <VStack gap={3}>
        <HStack gap={4} wrap="wrap" hAlign="between" vAlign="end">
          <TabList role="tablist" aria-label={t('tabs.buildGroup')} value={tab} onChange={setTab}>
            <Tab
              value="build"
              label={tabLabel.build}
              panelId={panelId}
              icon={<Icon icon={HammerIcon} />}
              endContent={
                issues.size > 0 ? (
                  <Badge
                    variant="error"
                    label={[...issues.values()].reduce((n, l) => n + l.length, 0)}
                    icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
                  />
                ) : undefined
              }
            />
            <Tab
              value="rules"
              label={tabLabel.rules}
              panelId={panelId}
              icon={<Icon icon={ShieldCheckIcon} />}
              endContent={countBadge(ruleIssueCount, state.rules.length)}
            />
            <Tab
              value="approval"
              label={tabLabel.approval}
              panelId={panelId}
              icon={<Icon icon={UserCheckIcon} />}
              endContent={approvalBadge}
            />
            <Tab
              value="actions"
              label={tabLabel.actions}
              panelId={panelId}
              icon={<Icon icon={WorkflowIcon} />}
              endContent={countBadge(actionIssueCount, state.actions.length)}
            />
            <Tab value="preview" label={tabLabel.preview} panelId={panelId} icon={<Icon icon={EyeIcon} />} />
            <Tab
              value="settings"
              label={tabLabel.settings}
              panelId={panelId}
              icon={<Icon icon={Settings2Icon} />}
              endContent={
                formSettingsIssues.length > 0 ? (
                  <Badge
                    variant="error"
                    label={formSettingsIssues.length}
                    icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
                  />
                ) : undefined
              }
            />
          </TabList>
          <TabList role="tablist" aria-label={t('tabs.useGroup')} value={tab} onChange={setTab}>
            <Tab
              value="submissions"
              label={tabLabel.submissions}
              panelId={panelId}
              icon={<Icon icon={InboxIcon} />}
              endContent={<Badge variant="neutral" label={form.submissionCount.toLocaleString(locale)} />}
            />
            <Tab
              value="assignments"
              label={tabLabel.assignments}
              panelId={panelId}
              icon={<Icon icon={ClipboardCheckIcon} />}
            />
          </TabList>
        </HStack>

        {tab === 'build' && (
          <div role="tabpanel" id={panelId} aria-label={tabLabel.build}>
            <ProcessCheckList checks={checksOn('build')} className="mb-4" />
            <DndContext
              sensors={sensors}
              collisionDetection={collision}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragOver={onDragMove}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
              accessibility={accessibility}
            >
              <div
                className={cn(
                  'grid items-start gap-5',
                  mode === 'full' && 'grid-cols-[13.5rem_minmax(0,1fr)_minmax(0,22rem)]',
                  mode === 'split' && 'grid-cols-[minmax(0,1fr)_minmax(0,20rem)]',
                  mode === 'compact' && 'grid-cols-1',
                )}
              >
                {mode === 'full' ? (
                  <aside className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pr-1 pb-2">
                    <BuilderPalette onAdd={(type) => insert(type)} />
                  </aside>
                ) : null}
                <div className="min-w-0 space-y-3">
                  {mode !== 'full' && <BuilderPalette compact onAdd={(type) => insert(type)} />}
                  <BuilderCanvas
                    elements={elements}
                    selectedId={selectedId}
                    issues={issues}
                    conditionText={conditionText}
                    lockedIds={lockedIds}
                    drop={drag ? drop : null}
                    draggingId={drag && !drag.palette ? drag.id : null}
                    header={canvasHeader}
                    onSelect={(id) => setSelectedId(id || null)}
                    onMove={move}
                    onDuplicate={duplicate}
                    onRemove={remove}
                    emptyAction={
                      <Button
                        label={t('addFirst')}
                        variant="secondary"
                        size="sm"
                        icon={<Icon icon={MousePointerClickIcon} />}
                        onClick={() => insert('text')}
                      />
                    }
                  />
                </div>
                {mode !== 'compact' && (
                  <aside
                    aria-label={t('properties')}
                    className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto"
                  >
                    <Card>
                      <CardContent>{properties}</CardContent>
                    </Card>
                  </aside>
                )}
              </div>
              <DragOverlay dropAnimation={null}>
                {drag?.palette ? (
                  <PaletteGhost type={drag.palette} />
                ) : activeElement ? (
                  <CanvasGhost el={activeElement} />
                ) : null}
              </DragOverlay>
            </DndContext>
            {mode === 'compact' && selected && (
              <Sheet open onOpenChange={(open) => !open && (setFocusId(selected.id), setSelectedId(null))}>
                <SheetContent className="sm:max-w-md" closeLabel={tforms('builder.closeProperties')}>
                  <SheetHeader>
                    <SheetTitle>{t('properties')}</SheetTitle>
                    <SheetDescription>{elementName(selected)}</SheetDescription>
                  </SheetHeader>
                  <SheetBody className="pb-6">{properties}</SheetBody>
                </SheetContent>
              </Sheet>
            )}
          </div>
        )}

        {tab === 'rules' && (
          <div role="tabpanel" id={panelId} aria-label={tabLabel.rules}>
            <FormRules
              rules={state.rules}
              fields={fields}
              readOnly={form.archived}
              onChange={(rules, tag) => update((s) => ({ ...s, rules }), tag)}
            />
          </div>
        )}

        {tab === 'approval' && (
          <div role="tabpanel" id={panelId} aria-label={tabLabel.approval}>
            <FormApproval
              form={form}
              name={name}
              fields={fields}
              workflowId={state.workflowDefinitionId}
              editor={approval}
              loading={approvalQuery.isLoading || (Boolean(state.workflowDefinitionId) && !approvalDef)}
              trigger={formTrigger}
              workflows={workflows.data?.items ?? []}
              pendingLink={pendingLink}
              readOnly={form.archived}
              focusStep={stepFocus}
              checks={<ProcessCheckList checks={checksOn('approval')} />}
              onLink={link}
            />
          </div>
        )}

        {tab === 'actions' && (
          <div role="tabpanel" id={panelId} aria-label={tabLabel.actions}>
            <FormActions
              actions={state.actions}
              elements={elements}
              items={actionCatalog.items}
              loading={actionCatalog.loading}
              hasApproval={Boolean(state.workflowDefinitionId)}
              workflowId={state.workflowDefinitionId}
              formName={state.name}
              readOnly={form.archived}
              onChange={(actions, tag) => update((s) => ({ ...s, actions }), tag)}
            />
          </div>
        )}

        {tab === 'preview' && (
          <div role="tabpanel" id={panelId} aria-label={tabLabel.preview}>
            <FormPreview
              elements={elements}
              rules={state.rules}
              name={state.name}
              description={state.description}
              icon={state.icon}
              onValues={setPreviewValues}
              aside={
                <BuilderApprovalPreview
                  formId={form.id}
                  draft={patch.draft!}
                  graph={state.workflowDefinitionId ? (approval?.draft ?? null) : null}
                  category={state.category.trim() || null}
                  values={previewValues}
                  actions={state.actions}
                  actionTypes={actionCatalog.items}
                  loading={Boolean(state.workflowDefinitionId) && canReadWorkflows && !approval}
                />
              }
            />
          </div>
        )}

        {tab === 'settings' && (
          <div role="tabpanel" id={panelId} aria-label={tabLabel.settings}>
            <ProcessCheckList checks={checksOn('settings')} className="mb-4" />
            <FormSettings form={form} state={state} onChange={(fn, tag) => update(fn, tag)} />
          </div>
        )}

        {tab === 'submissions' && (
          <div role="tabpanel" id={panelId} aria-label={tabLabel.submissions}>
            <FormSubmissions formId={form.id} />
          </div>
        )}
        {tab === 'assignments' && (
          <div role="tabpanel" id={panelId} aria-label={tabLabel.assignments}>
            <FormAssignments form={form} />
          </div>
        )}
      </VStack>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {confirm === 'publish' && (
        <PublishDialog
          open
          onOpenChange={(o) => setConfirm(o ? 'publish' : null)}
          form={form}
          elements={elements}
          dirty={dirty}
          formNeedsPublish={formNeedsPublish}
          approval={
            approvalNeedsPublish && approval
              ? {
                  name: approval.name || workflowName(approval.def.name),
                  version: (approval.def.publishedVersion ?? 0) + 1,
                }
              : null
          }
          checks={checks}
          loading={publishing}
          onConfirm={() => void onPublish()}
        />
      )}
      {confirm === 'archive' && (
        <ConfirmDialog
          open
          onOpenChange={(o) => setConfirm(o ? 'archive' : null)}
          title={t('archiveTitle', { name })}
          description={t('archiveBody')}
          confirmLabel={t('archive')}
          destructive
          loading={archiveMutation.isPending}
          onConfirm={() => archiveMutation.mutate(true)}
        />
      )}
      {confirm === 'leave' && (
        <ConfirmDialog
          open
          onOpenChange={(o) => setConfirm(o ? 'leave' : null)}
          title={t('leaveTitle')}
          description={t('leaveBody')}
          confirmLabel={t('leaveConfirm')}
          destructive
          onConfirm={() => {
            setConfirm(null);
            router.push('/admin/forms');
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────── properties ───────────────────────── */

function PropertiesPanel({
  element,
  index,
  count,
  siblings,
  issues,
  lockedKey,
  lockedValues,
  onChange,
  onClose,
  onRemove,
  typeName,
  inSheet,
}: {
  element: FormElement;
  index: number;
  count: number;
  siblings: FieldDef[];
  issues: readonly FieldIssue[];
  lockedKey: boolean;
  lockedValues?: ReadonlySet<string>;
  onChange: (next: EditableElement) => void;
  onClose: () => void;
  onRemove: () => void;
  typeName: string;
  /** Shown in a sheet on small screens: the sheet has its own close button, and remove sits at the end. */
  inSheet?: boolean;
}) {
  const t = useTranslations('forms.builder');
  return (
    <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
      <VStack gap={5}>
        <HStack gap={3} vAlign="center">
          <ElementTypeIcon type={element.type} />
          <StackItem size="fill">
            <VStack gap={0.5}>
              <Heading level={2} maxLines={1}>
                {typeName}
              </Heading>
              <Text type="supporting">{t('position', { position: index + 1, total: count })}</Text>
            </VStack>
          </StackItem>
          {!inSheet && (
            <>
              <IconButton
                label={t('remove')}
                variant="ghost"
                size="sm"
                icon={<Icon icon={Trash2Icon} />}
                onClick={onRemove}
              />
              <IconButton
                label={t('closeProperties')}
                variant="ghost"
                size="sm"
                icon={<Icon icon={XIcon} />}
                onClick={onClose}
              />
            </>
          )}
        </HStack>
        {lockedKey && <Banner status="info" collapsible={false} title={t('publishedFieldNote')} />}
        <FieldEditor
          value={element}
          onChange={onChange}
          siblings={siblings}
          issues={issues}
          lockedKey={lockedKey}
          lockedType={lockedKey}
          lockedValues={lockedValues}
        />
        {inSheet && (
          <HStack>
            <Button
              label={t('remove')}
              variant="secondary"
              icon={<Icon icon={Trash2Icon} />}
              onClick={onRemove}
            />
          </HStack>
        )}
      </VStack>
    </motion.div>
  );
}

function PropertiesEmpty({
  fieldCount,
  conditional,
  issueCount,
  onRevealIssue,
}: {
  fieldCount: number;
  conditional: number;
  issueCount: number;
  onRevealIssue: () => void;
}) {
  const t = useTranslations('forms.builder');
  return (
    <VStack gap={5}>
      <EmptyState
        icon={<ClipboardListIcon />}
        title={t('propertiesEmptyTitle')}
        description={t('propertiesEmptyDescription')}
      />
      <HStack gap={2}>
        <StackItem size="fill">
          <StatTile label={t('summaryFields')} value={fieldCount} />
        </StackItem>
        <StackItem size="fill">
          <StatTile label={t('summaryConditional')} value={conditional} />
        </StackItem>
      </HStack>
      {issueCount > 0 && (
        <Button
          label={t('issuesSummary', { count: issueCount })}
          variant="secondary"
          icon={<Icon icon={TriangleAlertIcon} />}
          width="100%"
          onClick={onRevealIssue}
        />
      )}
      <VStack gap={2}>
        <Text type="label" color="secondary">
          {t('tips')}
        </Text>
        <Text type="supporting">{t('tipDrag')}</Text>
        <HStack gap={1} wrap="wrap" vAlign="center">
          <Kbd keys="alt+up" />
          <Kbd keys="alt+down" />
          <Text type="supporting">{t('tipMove')}</Text>
        </HStack>
        <HStack gap={1} wrap="wrap" vAlign="center">
          <Kbd keys="mod+z" />
          <Text type="supporting">{t('tipUndo')}</Text>
        </HStack>
        <HStack gap={1} wrap="wrap" vAlign="center">
          <Kbd keys="mod+s" />
          <Text type="supporting">{t('tipSave')}</Text>
        </HStack>
      </VStack>
    </VStack>
  );
}

/* ───────────────────────── publish ───────────────────────── */

function PublishDialog({
  open,
  onOpenChange,
  form,
  elements,
  dirty,
  formNeedsPublish,
  approval,
  checks,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: FormDetail;
  elements: readonly FormElement[];
  dirty: boolean;
  /** The questions changed (or were never published): a new form version goes live. */
  formNeedsPublish: boolean;
  /** The approval is published too: its name and the version it becomes. */
  approval: { name: string; version: number } | null;
  checks: readonly ProcessCheck[];
  loading: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations('forms.builder');
  const locale = useLocale();
  const published = (form.published as FormSchema | null)?.elements.filter(isField) ?? [];
  const current = elements.filter(isField);
  const before = new Map(published.map((f) => [f.id, f]));
  const added = current.filter((f) => !before.has(f.id));
  const removed = published.filter((f) => !current.some((c) => c.id === f.id));
  const changed = current.filter((f) => before.has(f.id) && canonical(f) !== canonical(before.get(f.id)));
  const next = (form.publishedVersion ?? 0) + 1;
  const list = (items: FieldDef[]) => items.map((f) => localize(f.label, locale) || f.key).join(', ');
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={formNeedsPublish ? t('publishTitle', { version: next }) : t('publishApprovalTitle')}
      description={
        !formNeedsPublish
          ? t('publishApprovalBody')
          : form.publishedVersion === null
            ? t('publishFirstBody')
            : t('publishBody')
      }
      confirmLabel={checks.length ? t('publishAnyway') : dirty ? t('saveAndPublish') : t('publish')}
      loading={loading}
      onConfirm={onConfirm}
    >
      <VStack gap={3}>
        {formNeedsPublish && form.publishedVersion !== null && (
          <VStack as="ul" gap={1.5}>
            {added.length > 0 && (
              <HStack as="li" gap={2} vAlign="start">
                <Badge variant="success" label={t('diffAdded', { count: added.length })} />
                <Text color="secondary">{list(added)}</Text>
              </HStack>
            )}
            {changed.length > 0 && (
              <HStack as="li" gap={2} vAlign="start">
                <Badge variant="info" label={t('diffChanged', { count: changed.length })} />
                <Text color="secondary">{list(changed)}</Text>
              </HStack>
            )}
            {removed.length > 0 && (
              <HStack as="li" gap={2} vAlign="start">
                <Badge variant="error" label={t('diffRemoved', { count: removed.length })} />
                <Text color="secondary">{list(removed)}</Text>
              </HStack>
            )}
            {!added.length && !changed.length && !removed.length && (
              <HStack as="li">
                <Text color="secondary">{t('diffLayoutOnly')}</Text>
              </HStack>
            )}
          </VStack>
        )}
        {approval && (
          <HStack gap={2} vAlign="start">
            <Icon icon={UserCheckIcon} color="accent" />
            <StackItem size="fill">
              <Text>{t('publishWithApproval', { name: approval.name, version: approval.version })}</Text>
            </StackItem>
          </HStack>
        )}
        <ProcessCheckList checks={checks} />
      </VStack>
    </ConfirmDialog>
  );
}
