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
import type { FormDetail, UpdateFormInput, WorkflowDefinitionSummary } from '@isbp/contracts';
import {
  type DisplayType,
  type FieldDef,
  type FieldType,
  type FormElement,
  type FormSchema,
  formSchemaSchema,
  isField,
  localize,
} from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { useConditionText } from '@isbp/ui/condition-builder';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { Kbd } from '@isbp/ui/kbd';
import { FadeIn } from '@isbp/ui/motion';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Hint } from '@isbp/ui/tooltip';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ClipboardListIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileQuestionMarkIcon,
  HammerIcon,
  InboxIcon,
  MoreHorizontalIcon,
  MousePointerClickIcon,
  PencilIcon,
  Redo2Icon,
  RocketIcon,
  SaveIcon,
  Settings2Icon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  XIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  type RefObject,
  useCallback,
  useEffect,
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
import { FormIconTile, FormStatusBadges } from './form-meta';
import { FormPreview } from './form-preview';
import { FormSettings, settingsIssues } from './form-settings';
import { FormSubmissions } from './form-submissions';
import {
  type BuilderState,
  createElement,
  duplicateElement,
  fromDetail,
  toDraft,
  toPatch,
  useHistory,
} from './use-builder';

const TABS = ['build', 'preview', 'settings', 'submissions'] as const;
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

const noSubscribe = () => () => {};

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
  const back = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
      <Link href="/admin/forms">
        <ArrowLeftIcon /> {t('title')}
      </Link>
    </Button>
  );
  if (isLoading)
    return (
      <div className="space-y-6">
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
      <div className="space-y-6">
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

  const rootRef = useRef<HTMLDivElement>(null);
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
    // List state of the submissions tab does not carry over.
    if (next !== 'submissions') ['page', 'pageSize', 'status'].forEach((k) => params.delete(k));
    router.replace(`/admin/forms/${form.id}${params.size ? `?${params}` : ''}`, { scroll: false });
  };

  /* ───────── derived ───────── */

  const elements = state.elements;
  const fields = useMemo(() => elements.filter(isField), [elements]);
  const issues = useMemo(() => formIssues(elements), [elements]);
  const formSettingsIssues = settingsIssues(state);
  const issueCount = [...issues.values()].reduce((n, l) => n + l.length, 0) + formSettingsIssues.length;
  const patch = useMemo(() => toPatch(state), [state]);
  const baseline = useMemo(() => canonical(toPatch(fromDetail(form))), [form]);
  const dirty = canonical(patch) !== baseline;
  const published = (form.published as FormSchema | null) ?? null;
  const publishedFields = useMemo(
    () => new Map((published?.elements ?? []).filter(isField).map((f) => [f.id, f])),
    [published],
  );
  const lockedIds = useMemo(
    () => new Set(fields.filter((f) => publishedFields.has(f.id)).map((f) => f.id)),
    [fields, publishedFields],
  );
  const draftChanged = !published || canonical(toDraft(elements)) !== canonical(published);
  const facts = useMemo(() => fieldFacts(fields, locale), [fields, locale]);
  const conditionText = useConditionText(facts);
  const selected = elements.find((e) => e.id === selectedId) ?? null;

  const workflows = useApiQuery<{ items: WorkflowDefinitionSummary[] }>('/workflows', {
    triggerKey: 'core.form-submission',
  });
  const attached = workflows.data?.items.find((w) => w.id === state.workflowDefinitionId);
  const workflowDraftOnly = Boolean(
    state.workflowDefinitionId && attached && attached.publishedVersion === null,
  );

  const publishBlock: string | null = form.archived
    ? t('publishBlocked.archived')
    : !fields.length
      ? t('publishBlocked.noFields')
      : issueCount > 0
        ? t('publishBlocked.issues', { count: issueCount })
        : workflowDraftOnly
          ? t('publishBlocked.workflow')
          : form.publishedVersion !== null && !draftChanged
            ? t('publishBlocked.upToDate', { version: form.publishedVersion })
            : null;

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

  const save = async (): Promise<boolean> => {
    if (issueCount > 0) {
      toast.error(t('fixIssues', { count: issueCount }));
      revealFirstIssue();
      return false;
    }
    const body = toPatch(state);
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
      toast.error(errorText(err));
      return false;
    }
  };

  const onSave = async () => {
    if (await save()) toast.success(t('saved'));
  };

  const onPublish = async () => {
    if (dirty && !(await save())) return;
    try {
      const res = await publishMutation.mutateAsync(undefined);
      setDetail(res);
      setConfirm(null);
      toast.success(t('published', { version: res.publishedVersion ?? 1 }));
      setAnnouncement(t('published', { version: res.publishedVersion ?? 1 }));
    } catch (err) {
      setConfirm(null);
      if (err instanceof ApiError && err.code === 'WORKFLOW_NOT_CONFIGURED')
        toast.error(t('publishBlocked.workflow'));
      else toast.error(errorText(err));
    }
  };

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

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /* ───────── render ───────── */

  const status = {
    publishedVersion: form.publishedVersion,
    hasUnpublishedChanges: draftChanged,
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
    <div className="flex items-start gap-3 border-b pb-4">
      <FormIconTile name={state.icon} className="size-10" />
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold tracking-tight break-words">{name}</h2>
        {hasText(state.description) && (
          <p className="mt-0.5 text-sm text-muted-foreground">{localize(state.description, locale)}</p>
        )}
      </div>
      <Hint label={t('editDetails')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('editDetails')}
          onClick={() => setTab('settings')}
        >
          <PencilIcon />
        </Button>
      </Hint>
    </div>
  );

  return (
    <div ref={rootRef} className="@container space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link
          href="/admin/forms"
          onClick={(e) => {
            if (!dirty) return;
            e.preventDefault();
            setConfirm('leave');
          }}
        >
          <ArrowLeftIcon /> {tforms('title')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <FormIconTile name={state.icon} className="size-12 rounded-xl" />
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">{name}</h1>
              <motion.span
                key={`${form.publishedVersion}-${form.archived}`}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              >
                <FormStatusBadges form={status} />
              </motion.span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{form.key}</code>
              <span>{t('fieldCount', { count: fields.length })}</span>
              <span aria-live="polite" className="inline-flex items-center gap-1.5">
                <AnimatePresence initial={false}>
                  {dirty && (
                    <motion.span
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className="inline-flex items-center gap-1.5 font-medium text-warning-foreground"
                    >
                      <span className="size-2 rounded-full bg-warning" aria-hidden />
                      {t('unsaved')}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="flex items-center">
            <Hint label={t('undoHint')}>
              <Button variant="ghost" size="icon" aria-label={t('undo')} disabled={!canUndo} onClick={undo}>
                <Undo2Icon />
              </Button>
            </Hint>
            <Hint label={t('redoHint')}>
              <Button variant="ghost" size="icon" aria-label={t('redo')} disabled={!canRedo} onClick={redo}>
                <Redo2Icon />
              </Button>
            </Hint>
          </div>
          <Button
            variant="outline"
            onClick={() => void onSave()}
            disabled={!dirty}
            loading={saving && !publishMutation.isPending}
          >
            <SaveIcon /> {t('save')}
          </Button>
          {publishBlock ? (
            <Hint label={publishBlock}>
              <span
                tabIndex={0}
                className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Button disabled aria-describedby="publish-blocked">
                  <RocketIcon /> {t('publish')}
                </Button>
                <span id="publish-blocked" className="sr-only">
                  {publishBlock}
                </span>
              </span>
            </Hint>
          ) : (
            <Button onClick={() => setConfirm('publish')} loading={publishMutation.isPending}>
              <RocketIcon /> {t('publish')}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('more')}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem
                disabled={form.publishedVersion === null || form.archived || !form.active}
                onSelect={() => router.push(portalHref)}
              >
                <ExternalLinkIcon /> {t('openInPortal')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTab('preview')}>
                <EyeIcon /> {t('previewAction')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {form.archived ? (
                <DropdownMenuItem onSelect={() => archiveMutation.mutate(false)}>
                  <ArchiveRestoreIcon /> {t('restore')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirm('archive')}>
                  <ArchiveIcon /> {t('archive')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </FadeIn>

      {form.archived && (
        <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          <ArchiveIcon className="size-4 shrink-0" aria-hidden /> {t('archivedNote')}
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="build">
            <HammerIcon /> {t('tabs.build')}
            {issues.size > 0 && (
              <Badge variant="destructive" className="px-1.5 tabular-nums">
                <TriangleAlertIcon aria-hidden />
                {[...issues.values()].reduce((n, l) => n + l.length, 0)}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="preview">
            <EyeIcon /> {t('tabs.preview')}
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2Icon /> {t('tabs.settings')}
            {formSettingsIssues.length > 0 && (
              <Badge variant="destructive" className="px-1.5 tabular-nums">
                <TriangleAlertIcon aria-hidden />
                {formSettingsIssues.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="submissions">
            <InboxIcon /> {t('tabs.submissions')}
            <Badge variant="muted" className="px-1.5 tabular-nums">
              {form.submissionCount.toLocaleString(locale)}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="build">
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
                    <Button size="sm" variant="outline" onClick={() => insert('text')}>
                      <MousePointerClickIcon /> {t('addFirst')}
                    </Button>
                  }
                />
              </div>
              {mode !== 'compact' && (
                <aside
                  aria-label={t('properties')}
                  className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-2xl border bg-card p-4 shadow-xs"
                >
                  {properties}
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
          {mode === 'compact' && (
            <Sheet
              open={Boolean(selected)}
              onOpenChange={(open) => !open && selected && (setFocusId(selected.id), setSelectedId(null))}
            >
              <SheetContent className="sm:max-w-md" closeLabel={tforms('builder.closeProperties')}>
                <SheetHeader>
                  <SheetTitle>{t('properties')}</SheetTitle>
                  <SheetDescription>{selected ? elementName(selected) : ''}</SheetDescription>
                </SheetHeader>
                <SheetBody className="pb-6">{properties}</SheetBody>
              </SheetContent>
            </Sheet>
          )}
        </TabsContent>

        <TabsContent value="preview">
          <FormPreview
            elements={elements}
            name={state.name}
            description={state.description}
            icon={state.icon}
          />
        </TabsContent>

        <TabsContent value="settings">
          <FormSettings
            form={form}
            state={state}
            onChange={(fn, tag) => update(fn, tag)}
            workflows={workflows.data?.items ?? []}
            workflowsLoading={workflows.isLoading}
          />
        </TabsContent>

        <TabsContent value="submissions">
          <FormSubmissions formId={form.id} />
        </TabsContent>
      </Tabs>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <PublishDialog
        open={confirm === 'publish'}
        onOpenChange={(o) => setConfirm(o ? 'publish' : null)}
        form={form}
        elements={elements}
        dirty={dirty}
        loading={publishMutation.isPending || saving}
        onConfirm={() => void onPublish()}
      />
      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={(o) => setConfirm(o ? 'archive' : null)}
        title={t('archiveTitle', { name })}
        description={t('archiveBody')}
        confirmLabel={t('archive')}
        destructive
        loading={archiveMutation.isPending}
        onConfirm={() => archiveMutation.mutate(true)}
      />
      <ConfirmDialog
        open={confirm === 'leave'}
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
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      className="grid gap-5"
    >
      <div className="flex items-center gap-3">
        <ElementTypeIcon type={element.type} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{typeName}</h2>
          <p className="text-xs text-muted-foreground">
            {t('position', { position: index + 1, total: count })}
          </p>
        </div>
        {!inSheet && (
          <>
            <Hint label={t('remove')}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('remove')}
                onClick={onRemove}
                className="hover:text-destructive"
              >
                <Trash2Icon />
              </Button>
            </Hint>
            <Hint label={t('closeProperties')}>
              <Button variant="ghost" size="icon-sm" aria-label={t('closeProperties')} onClick={onClose}>
                <XIcon />
              </Button>
            </Hint>
          </>
        )}
      </div>
      {lockedKey && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t('publishedFieldNote')}
        </p>
      )}
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
        <Button variant="outline" className="justify-self-start text-destructive" onClick={onRemove}>
          <Trash2Icon /> {t('remove')}
        </Button>
      )}
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
  const mac = useSyncExternalStore(
    noSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
  const mod = mac ? '⌘' : 'Ctrl';
  return (
    <div className="grid gap-5">
      <div className="grid justify-items-center gap-2 py-4 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
          <ClipboardListIcon className="size-5" aria-hidden />
        </span>
        <h2 className="text-sm font-semibold">{t('propertiesEmptyTitle')}</h2>
        <p className="max-w-60 text-sm text-muted-foreground">{t('propertiesEmptyDescription')}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border p-2">
          <dt className="text-xs text-muted-foreground">{t('summaryFields')}</dt>
          <dd className="text-lg font-semibold tabular-nums">{fieldCount}</dd>
        </div>
        <div className="rounded-lg border p-2">
          <dt className="text-xs text-muted-foreground">{t('summaryConditional')}</dt>
          <dd className="text-lg font-semibold tabular-nums">{conditional}</dd>
        </div>
      </dl>
      {issueCount > 0 && (
        <button
          type="button"
          onClick={onRevealIssue}
          className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-left text-sm text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
          {t('issuesSummary', { count: issueCount })}
        </button>
      )}
      <div className="grid gap-2 text-xs text-muted-foreground">
        <h3 className="font-semibold tracking-wide uppercase">{t('tips')}</h3>
        <p>{t('tipDrag')}</p>
        <p className="flex flex-wrap items-center gap-1">
          <Kbd>Alt</Kbd>+<Kbd>↑</Kbd>/<Kbd>↓</Kbd> {t('tipMove')}
        </p>
        <p className="flex flex-wrap items-center gap-1">
          <Kbd>{mod}</Kbd>+<Kbd>Z</Kbd> {t('tipUndo')}
        </p>
        <p className="flex flex-wrap items-center gap-1">
          <Kbd>{mod}</Kbd>+<Kbd>S</Kbd> {t('tipSave')}
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────── publish ───────────────────────── */

function PublishDialog({
  open,
  onOpenChange,
  form,
  elements,
  dirty,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: FormDetail;
  elements: readonly FormElement[];
  dirty: boolean;
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
      title={t('publishTitle', { version: next })}
      description={form.publishedVersion === null ? t('publishFirstBody') : t('publishBody')}
      confirmLabel={dirty ? t('saveAndPublish') : t('publish')}
      loading={loading}
      onConfirm={onConfirm}
    >
      {form.publishedVersion !== null && (
        <ul className="grid gap-1.5 text-sm">
          {added.length > 0 && (
            <li>
              <Badge variant="success">{t('diffAdded', { count: added.length })}</Badge>{' '}
              <span className="text-muted-foreground">{list(added)}</span>
            </li>
          )}
          {changed.length > 0 && (
            <li>
              <Badge variant="info">{t('diffChanged', { count: changed.length })}</Badge>{' '}
              <span className="text-muted-foreground">{list(changed)}</span>
            </li>
          )}
          {removed.length > 0 && (
            <li>
              <Badge variant="destructive">{t('diffRemoved', { count: removed.length })}</Badge>{' '}
              <span className="text-muted-foreground">{list(removed)}</span>
            </li>
          )}
          {!added.length && !changed.length && !removed.length && (
            <li className="text-muted-foreground">{t('diffLayoutOnly')}</li>
          )}
        </ul>
      )}
    </ConfirmDialog>
  );
}
