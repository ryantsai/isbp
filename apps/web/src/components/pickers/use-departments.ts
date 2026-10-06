'use client';

import type { Department } from '@isbp/contracts';
import { useMemo } from 'react';
import { useApiQuery } from '@/lib/api';

export interface DepartmentNode extends Department {
  depth: number;
  children: DepartmentNode[];
}

/** The whole org tree (cached); `ordered` is depth-first for indented selects. */
export function useDepartments() {
  const query = useApiQuery<{ items: Department[] }>('/departments');
  const tree = useMemo(() => {
    const items = query.data?.items ?? [];
    const byId = new Map<string, DepartmentNode>(items.map((d) => [d.id, { ...d, depth: 0, children: [] }]));
    const roots: DepartmentNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    const ordered: DepartmentNode[] = [];
    const walk = (nodes: DepartmentNode[], depth: number) => {
      for (const n of nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
        n.depth = depth;
        ordered.push(n);
        walk(n.children, depth + 1);
      }
    };
    walk(roots, 0);
    return { roots, ordered, byId };
  }, [query.data]);
  return { ...query, ...tree };
}
