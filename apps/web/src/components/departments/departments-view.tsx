'use client';

import { ApiError, useCan, usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Card } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { easeOut } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  MousePointerClickIcon,
  NetworkIcon,
  PlusIcon,
  SearchXIcon,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { type DepartmentNode, useDepartments } from '@/components/pickers/use-departments';
import { useApiMutation, useErrorText } from '@/lib/api';
import { DepartmentDetail } from './department-detail';
import { DEPARTMENT_INVALIDATE, DepartmentFormSheet } from './department-form';
import { ancestorIds, DepartmentTree } from './department-tree';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem } from '@astryxdesign/core/Layout';

type FormState = { mode: 'create'; parentId: string | null } | { mode: 'edit'; id: string };

const MOBILE_QUERY = '(max-width: 1023.98px)';

function matches(d: DepartmentNode, q: string) {
  return d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q);
}

/** Org hierarchy: filterable tree on the left, details of the selected department on the right. */
export function DepartmentsView() {
  const t = useTranslations('departments');
  const sp = useSearchParams();
  const errorText = useErrorText();
  const reduceMotion = useReducedMotion();
  const { roots, ordered, byId, isLoading, error } = useDepartments();
  const { permissions } = usePlatform();
  const canManageAny = useCan('core.departments.manage');
  const canCreateRoot = permissions.can('core.departments.manage');

  const focusParam = sp.get('focus');
  const [selectedId, setSelectedId] = useState<string | null>(focusParam);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState<FormState>({ mode: 'create', parentId: null });
  const [formOpen, setFormOpen] = useState(() => sp.get('create') === '1');
  const [deleteTarget, setDeleteTarget] = useState<DepartmentNode | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reveal, setReveal] = useState<string | null>(null);
  /** Bumped by expand / collapse all: the tree keeps branches opened by hand, so it must start afresh. */
  const [treeReset, setTreeReset] = useState(0);
  const handledFocus = useRef<string | null>(null);
  const initialised = useRef(false);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  /* ───────── filtering ───────── */

  const query = filter.trim().toLowerCase();
  const matchIds = useMemo(
    () => (query ? new Set(ordered.filter((d) => matches(d, query)).map((d) => d.id)) : null),
    [query, ordered],
  );
  const visibleIds = useMemo(() => {
    if (!matchIds) return null;
    const out = new Set<string>();
    for (const id of matchIds) {
      out.add(id);
      const node = byId.get(id);
      if (node) ancestorIds(node).forEach((a) => out.add(a));
    }
    return out;
  }, [matchIds, byId]);

  const onFilterChange = (value: string) => {
    setFilter(value);
    const q = value.trim().toLowerCase();
    if (!q) return;
    // Auto-expand every ancestor of a match so all hits are visible.
    const open = new Set<string>();
    for (const d of ordered) if (matches(d, q)) ancestorIds(d).forEach((a) => open.add(a));
    if (open.size) setExpanded((prev) => new Set([...prev, ...open]));
  };

  /* ───────── expansion, selection & scrolling ───────── */

  const expandTo = useCallback(
    (id: string) => {
      const node = byId.get(id);
      if (!node) return;
      const path = ancestorIds(node);
      setExpanded((prev) => (path.every((a) => prev.has(a)) ? prev : new Set([...prev, ...path])));
    },
    [byId],
  );

  const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;

  /** Centres a department's row inside the tree's own scroll area (never scrolls the page). */
  const scrollTreeTo = useCallback(
    (id: string) => {
      // Wait for ancestor groups to finish their expand animation before measuring.
      window.setTimeout(() => {
        const container = treeScrollRef.current;
        const row = container?.querySelector<HTMLElement>(`[data-tree-id="${id}"] .astryx-tree-list-item`);
        if (!container || !row) return;
        const c = container.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        container.scrollTo({
          top: container.scrollTop + (r.top - c.top) - c.height / 2 + r.height / 2,
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
      }, 260);
    },
    [reduceMotion],
  );

  /** On narrow screens the detail sits below the tree — bring it into view after a selection. */
  const revealDetail = useCallback(() => {
    if (!isMobile()) return;
    window.requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }),
    );
  }, [reduceMotion]);

  /** Selects a department and mirrors it to `?focus=` so the view is shareable. */
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    handledFocus.current = id;
    const next = new URLSearchParams(window.location.search);
    if (id) next.set('focus', id);
    else next.delete('focus');
    next.delete('create');
    const qs = next.toString();
    window.history.replaceState(
      null,
      '',
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
  }, []);

  // First load: open the top level.
  useEffect(() => {
    if (initialised.current || roots.length === 0) return;
    initialised.current = true;
    setExpanded((prev) => new Set([...prev, ...roots.map((r) => r.id)]));
  }, [roots]);

  // `?focus=<id>` from a link or the global search: select it and bring it into view.
  useEffect(() => {
    if (!focusParam || focusParam === handledFocus.current || !byId.has(focusParam)) return;
    handledFocus.current = focusParam;
    setSelectedId(focusParam);
    setReveal(focusParam);
  }, [focusParam, byId]);

  // Open the branch of a department and scroll to it — waits until it exists (e.g. right after creating it).
  useEffect(() => {
    if (!reveal || !byId.has(reveal)) return;
    setReveal(null);
    expandTo(reveal);
    if (isMobile()) revealDetail();
    else scrollTreeTo(reveal);
  }, [reveal, byId, expandTo, revealDetail, scrollTreeTo]);

  // Nothing chosen yet → show the top of the organisation.
  const effectiveId = selectedId ?? roots[0]?.id ?? null;
  const selected = effectiveId ? byId.get(effectiveId) : undefined;
  const canManageSelected = selected
    ? permissions.can('core.departments.manage', { departmentId: selected.id })
    : false;

  /* ───────── actions ───────── */

  const openCreate = (parentId: string | null) => {
    setForm({ mode: 'create', parentId });
    setFormOpen(true);
  };
  const closeForm = (open: boolean) => {
    setFormOpen(open);
    if (!open && new URLSearchParams(window.location.search).has('create')) select(selectedId);
  };
  const editing = form.mode === 'edit' ? byId.get(form.id) : undefined;

  const del = useApiMutation((api, id: string) => api.delete(`/departments/${id}`), {
    invalidate: DEPARTMENT_INVALIDATE,
    silent: true,
  });
  const confirmDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    del.mutate(target.id, {
      onSuccess: () => {
        toast.success(t('delete.deleted', { name: target.name }));
        setDeleteOpen(false);
        select(target.parentId);
      },
      onError: (err) => {
        toast.error(
          err instanceof ApiError && err.code === 'HAS_CHILDREN'
            ? t('delete.hasChildren', { name: target.name })
            : errorText(err),
        );
      },
    });
  };

  const allParents = useMemo(() => ordered.filter((d) => d.children.length > 0).map((d) => d.id), [ordered]);

  /* ───────── render ───────── */

  const header = (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        canManageAny && (
          <Button
            label={t('add')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            onClick={() =>
              openCreate(canCreateRoot ? null : canManageSelected ? (selected?.id ?? null) : null)
            }
          />
        )
      }
    />
  );

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="grid gap-4 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)]">
        <Card className="gap-2 p-3">
          <Skeleton className="mb-2 h-9 w-full" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className={cn('h-7', ['ms-0', 'ms-4', 'ms-8'][i % 3])} />
          ))}
        </Card>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  } else if (error) {
    body = (
      <Card>
        <EmptyState icon={<NetworkIcon />} title={errorText(error)} />
      </Card>
    );
  } else if (ordered.length === 0) {
    body = (
      <Card>
        <EmptyState
          icon={<NetworkIcon />}
          title={t('tree.emptyTitle')}
          description={t('tree.emptyDescription')}
          action={
            canCreateRoot && (
              <Button
                label={t('add')}
                variant="primary"
                size="sm"
                icon={<Icon icon={PlusIcon} />}
                onClick={() => openCreate(null)}
              />
            )
          }
        />
      </Card>
    );
  } else {
    body = (
      <div className="grid gap-4 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:items-start xl:grid-cols-[24rem_minmax(0,1fr)]">
        <Card className="gap-0 overflow-hidden py-0 lg:sticky lg:top-20">
          <HStack gap={1.5} vAlign="center" padding={3}>
            <StackItem size="fill">
              <SearchInput
                value={filter}
                onChange={onFilterChange}
                delay={80}
                placeholder={t('tree.filterPlaceholder')}
                clearLabel={t('tree.clearFilter')}
                className="min-w-0 flex-1 sm:w-auto"
              />
            </StackItem>
            <IconButton
              label={t('tree.expandAll')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={ChevronsUpDownIcon} />}
              onClick={() => {
                setExpanded(new Set(allParents));
                setTreeReset((n) => n + 1);
              }}
            />
            <IconButton
              label={t('tree.collapseAll')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={ChevronsDownUpIcon} />}
              onClick={() => {
                setExpanded(new Set());
                setTreeReset((n) => n + 1);
              }}
            />
          </HStack>
          <Divider />
          <p aria-live="polite" className={query ? 'px-3.5 pt-2 text-xs text-muted-foreground' : 'sr-only'}>
            {query ? t('tree.matches', { count: matchIds?.size ?? 0 }) : ''}
          </p>
          <div ref={treeScrollRef} className="max-h-[60vh] overflow-y-auto p-2 lg:max-h-[calc(100dvh-13rem)]">
            {visibleIds && visibleIds.size === 0 ? (
              <EmptyState
                icon={<SearchXIcon />}
                title={t('tree.noMatchesTitle')}
                description={t('tree.noMatchesDescription')}
                className="py-10"
              />
            ) : (
              <DepartmentTree
                roots={roots}
                expanded={expanded}
                resetKey={treeReset}
                selectedId={effectiveId}
                onSelect={(id) => {
                  select(id);
                  revealDetail();
                }}
                visibleIds={visibleIds}
                matchIds={matchIds}
                query={query}
                label={t('tree.label')}
              />
            )}
          </div>
        </Card>

        <div ref={detailRef} className="min-w-0 scroll-mt-20">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={selected?.id ?? 'none'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: easeOut } }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            >
              {selected ? (
                <DepartmentDetail
                  node={selected}
                  byId={byId}
                  canManage={canManageSelected}
                  onSelect={(id) => {
                    select(id);
                    setReveal(id);
                  }}
                  onEdit={() => {
                    setForm({ mode: 'edit', id: selected.id });
                    setFormOpen(true);
                  }}
                  onAddChild={() => openCreate(selected.id)}
                  onDelete={() => {
                    setDeleteTarget(selected);
                    setDeleteOpen(true);
                  }}
                />
              ) : (
                <Card>
                  <EmptyState
                    icon={<MousePointerClickIcon />}
                    title={t('detail.selectTitle')}
                    description={selectedId ? t('detail.notFound') : t('detail.selectDescription')}
                  />
                </Card>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <>
      {header}
      {body}
      {canManageAny && (
        <>
          <DepartmentFormSheet
            open={formOpen}
            onOpenChange={closeForm}
            department={editing}
            parentId={form.mode === 'create' ? form.parentId : undefined}
            onSaved={(id) => {
              // A new or moved department may sit under a collapsed branch: select it, then reveal it.
              select(id);
              setReveal(id);
            }}
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={t('delete.title', { name: deleteTarget?.name ?? '' })}
            description={t('delete.body', { count: deleteTarget?.memberCount ?? 0 })}
            confirmLabel={t('detail.delete')}
            destructive
            loading={del.isPending}
            onConfirm={confirmDelete}
          />
        </>
      )}
    </>
  );
}
