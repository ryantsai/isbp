'use client';

import { cn } from '@isbp/ui';
import { easeOut } from '@isbp/ui/motion';
import { ChevronRightIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useCallback, useId, useMemo, useRef, useState } from 'react';
import type { DepartmentNode } from '@/components/pickers/use-departments';

/** Ancestor ids of a department, root first (from its materialized path `/root/…/id/`). */
export function ancestorIds(node: Pick<DepartmentNode, 'id' | 'path'>): string[] {
  return node.path.split('/').filter((s) => s && s !== node.id);
}

/** Wraps the first case-insensitive occurrence of `query` in a <mark>. */
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-warning/35 px-px text-foreground">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
}

interface TreeContext {
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  tabStop: string | null;
  visibleIds: ReadonlySet<string> | null;
  matchIds: ReadonlySet<string> | null;
  query: string;
  labelPrefix: string;
  onSelect: (id: string) => void;
  onToggle: (id: string, open?: boolean) => void;
  setTabStop: (id: string) => void;
  register: (id: string, el: HTMLLIElement | null) => void;
  peopleLabel: (count: number) => string;
}

function visibleChildren(node: DepartmentNode, visibleIds: ReadonlySet<string> | null) {
  return visibleIds ? node.children.filter((c) => visibleIds.has(c.id)) : node.children;
}

/**
 * Accessible org tree (WAI-ARIA tree pattern): roving tab stop, arrow keys to move / expand /
 * collapse, Home/End, Enter or Space to select, and type-ahead on the first letter.
 */
export function DepartmentTree({
  roots,
  expanded,
  onToggle,
  selectedId,
  onSelect,
  visibleIds,
  matchIds,
  query,
  label,
}: {
  roots: DepartmentNode[];
  expanded: ReadonlySet<string>;
  onToggle: (id: string, open?: boolean) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  visibleIds: ReadonlySet<string> | null;
  matchIds: ReadonlySet<string> | null;
  query: string;
  label: string;
}) {
  const t = useTranslations('departments.tree');
  const hintId = useId();
  const labelPrefix = useId();
  const refs = useRef(new Map<string, HTMLLIElement>());
  const [tabStopState, setTabStop] = useState<string | null>(null);

  const visibleRoots = useMemo(
    () => (visibleIds ? roots.filter((r) => visibleIds.has(r.id)) : roots),
    [roots, visibleIds],
  );

  // Depth-first list of the rows currently rendered — the order arrow keys move through.
  const flat = useMemo(() => {
    const out: DepartmentNode[] = [];
    const walk = (nodes: DepartmentNode[]) => {
      for (const n of nodes) {
        out.push(n);
        if (expanded.has(n.id)) walk(visibleChildren(n, visibleIds));
      }
    };
    walk(visibleRoots);
    return out;
  }, [visibleRoots, expanded, visibleIds]);

  const isRendered = (id: string | null) => Boolean(id && flat.some((n) => n.id === id));
  const tabStop = isRendered(tabStopState)
    ? tabStopState
    : isRendered(selectedId)
      ? selectedId
      : (flat[0]?.id ?? null);

  const register = useCallback((id: string, el: HTMLLIElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  }, []);

  const peopleLabel = useCallback((count: number) => t('people', { count }), [t]);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')?.dataset.id;
    const index = flat.findIndex((n) => n.id === id);
    const node = flat[index];
    if (!id || !node) return;
    const focus = (n: DepartmentNode | undefined) => {
      if (!n) return;
      setTabStop(n.id);
      refs.current.get(n.id)?.focus();
    };
    const kids = visibleChildren(node, visibleIds);
    switch (e.key) {
      case 'ArrowDown':
        focus(flat[index + 1]);
        break;
      case 'ArrowUp':
        focus(flat[index - 1]);
        break;
      case 'Home':
        focus(flat[0]);
        break;
      case 'End':
        focus(flat[flat.length - 1]);
        break;
      case 'ArrowRight':
        if (kids.length && !expanded.has(id)) onToggle(id, true);
        else if (kids.length) focus(kids[0]);
        break;
      case 'ArrowLeft':
        if (kids.length && expanded.has(id)) onToggle(id, false);
        else focus(flat.find((n) => n.id === node.parentId));
        break;
      case 'Enter':
      case ' ':
        onSelect(id);
        break;
      default: {
        // Type-ahead: jump to the next visible department starting with the typed character.
        if (e.key.length !== 1 || !/\S/.test(e.key)) return;
        const ch = e.key.toLowerCase();
        const order = [...flat.slice(index + 1), ...flat.slice(0, index + 1)];
        const hit = order.find(
          (n) => n.name.toLowerCase().startsWith(ch) || n.code.toLowerCase().startsWith(ch),
        );
        if (!hit) return;
        focus(hit);
      }
    }
    e.preventDefault();
  };

  const ctx: TreeContext = {
    expanded,
    selectedId,
    tabStop,
    visibleIds,
    matchIds,
    query,
    labelPrefix,
    onSelect,
    onToggle,
    setTabStop,
    register,
    peopleLabel,
  };

  return (
    <>
      <p id={hintId} className="sr-only">
        {t('keyboardHint')}
      </p>
      <ul role="tree" aria-label={label} aria-describedby={hintId} onKeyDown={onKeyDown} className="text-sm">
        {visibleRoots.map((n, i) => (
          <TreeNode key={n.id} node={n} level={1} posinset={i + 1} setsize={visibleRoots.length} ctx={ctx} />
        ))}
      </ul>
    </>
  );
}

function TreeNode({
  node,
  level,
  posinset,
  setsize,
  ctx,
}: {
  node: DepartmentNode;
  level: number;
  posinset: number;
  setsize: number;
  ctx: TreeContext;
}) {
  const kids = visibleChildren(node, ctx.visibleIds);
  const open = kids.length > 0 && ctx.expanded.has(node.id);
  const selected = ctx.selectedId === node.id;
  const dimmed = ctx.matchIds !== null && !ctx.matchIds.has(node.id);
  const labelId = `${ctx.labelPrefix}-${node.id}`;

  return (
    <li
      ref={(el) => ctx.register(node.id, el)}
      role="treeitem"
      data-id={node.id}
      tabIndex={ctx.tabStop === node.id ? 0 : -1}
      aria-level={level}
      aria-setsize={setsize}
      aria-posinset={posinset}
      aria-selected={selected}
      aria-expanded={kids.length ? open : undefined}
      aria-labelledby={labelId}
      onFocus={(e) => {
        if (e.target === e.currentTarget) ctx.setTabStop(node.id);
      }}
      className="outline-none [&:focus-visible>[data-row]]:ring-2 [&:focus-visible>[data-row]]:ring-ring/60 [&:focus-visible>[data-row]]:ring-inset"
    >
      <div
        data-row
        data-selected={selected || undefined}
        onClick={() => ctx.onSelect(node.id)}
        onDoubleClick={() => {
          if (kids.length) ctx.onToggle(node.id);
        }}
        className={cn(
          'relative flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-1.5 transition-colors select-none',
          selected ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60',
        )}
      >
        {selected && (
          <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden />
        )}
        {kids.length ? (
          <span
            aria-hidden
            onClick={(e) => {
              e.stopPropagation();
              ctx.onToggle(node.id);
            }}
            className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <motion.span
              animate={{ rotate: open ? 90 : 0 }}
              transition={{ duration: 0.18, ease: easeOut }}
              className="grid place-items-center"
            >
              <ChevronRightIcon className="size-4" />
            </motion.span>
          </span>
        ) : (
          <span className="size-5 shrink-0" aria-hidden />
        )}
        <span
          id={labelId}
          className={cn(
            'min-w-0 flex-1 truncate',
            selected && 'font-medium',
            dimmed && 'text-muted-foreground',
          )}
        >
          <Highlight text={node.name} query={ctx.query} />
          <span className="sr-only">
            , {node.code}, {ctx.peopleLabel(node.memberCount)}
          </span>
        </span>
        <code
          aria-hidden
          className="hidden max-w-24 shrink-0 truncate font-mono text-[11px] text-muted-foreground sm:inline"
        >
          <Highlight text={node.code} query={ctx.query} />
        </code>
        <span
          aria-hidden
          className="min-w-6 shrink-0 rounded-full bg-muted px-1.5 text-center text-[11px] leading-5 text-muted-foreground tabular-nums"
        >
          {node.memberCount}
        </span>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            key="children"
            role="group"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: easeOut }}
            className="ms-[15px] overflow-hidden border-s border-border/80 ps-1.5"
          >
            {kids.map((c, i) => (
              <TreeNode
                key={c.id}
                node={c}
                level={level + 1}
                posinset={i + 1}
                setsize={kids.length}
                ctx={ctx}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}
