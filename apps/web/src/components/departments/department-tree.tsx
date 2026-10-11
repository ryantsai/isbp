'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { DepartmentNode } from '@/components/pickers/use-departments';
import { Badge } from '@astryxdesign/core/Badge';
import { Code } from '@astryxdesign/core/Code';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TreeList } from '@astryxdesign/core/TreeList';
import type { TreeListItemData } from '@astryxdesign/core/TreeList';

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

function visibleChildren(node: DepartmentNode, visibleIds: ReadonlySet<string> | null) {
  return visibleIds ? node.children.filter((c) => visibleIds.has(c.id)) : node.children;
}

/**
 * The org tree: Astryx `TreeList` (WAI-ARIA tree, roving tab stop, arrow keys, type-ahead). The tree keeps its own
 * expansion, so the open branches the page asks for (`expanded`: first load, expand/collapse all, a filter, a reveal)
 * seed it and a change to them starts it afresh; branches the person opens by hand stay open until then.
 */
export function DepartmentTree({
  roots,
  expanded,
  resetKey,
  selectedId,
  onSelect,
  visibleIds,
  matchIds,
  query,
  label,
}: {
  roots: DepartmentNode[];
  expanded: ReadonlySet<string>;
  /** Changing it starts the tree afresh from `expanded` (expand / collapse all). */
  resetKey: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  visibleIds: ReadonlySet<string> | null;
  matchIds: ReadonlySet<string> | null;
  query: string;
  label: string;
}) {
  const t = useTranslations('departments.tree');

  const items = useMemo(() => {
    const build = (node: DepartmentNode): TreeListItemData => {
      const kids = visibleChildren(node, visibleIds);
      const selected = selectedId === node.id;
      const dimmed = matchIds !== null && !matchIds.has(node.id);
      return {
        id: node.id,
        label: (
          <Text color={dimmed ? 'secondary' : 'primary'} weight={selected ? 'medium' : undefined}>
            <Highlight text={node.name} query={query} />
            <span className="sr-only">
              , {node.code}, {t('people', { count: node.memberCount })}
            </span>
          </Text>
        ),
        endContent: (
          <span aria-hidden>
            <HStack gap={2} vAlign="center">
              <span className="hidden sm:inline">
                <Code>
                  <Highlight text={node.code} query={query} />
                </Code>
              </span>
              <Badge variant="neutral" label={node.memberCount} />
            </HStack>
          </span>
        ),
        isSelected: selected,
        isExpanded: expanded.has(node.id),
        onClick: () => onSelect(node.id),
        children: kids.length ? kids.map(build) : undefined,
      };
    };
    const visibleRoots = visibleIds ? roots.filter((r) => visibleIds.has(r.id)) : roots;
    return visibleRoots.map(build);
  }, [roots, expanded, selectedId, visibleIds, matchIds, query, onSelect, t]);

  // Starts the tree afresh when the branches the page wants open change (see above).
  const seed = useMemo(() => [...expanded].sort().join(','), [expanded]);

  return <TreeList key={`${resetKey}:${seed}`} aria-label={label} items={items} density="compact" />;
}
