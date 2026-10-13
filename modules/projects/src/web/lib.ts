'use client';

import { useApiQuery } from '@isbp/ui/query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { CustomField } from '@isbp/contracts';
import type { FieldDef, FormElement } from '@isbp/sdk';
import type { ProjectDetail, TaskDetail } from '../contracts';

/** Cache prefix every Projects mutation invalidates (lists, boards, timelines, workload, tasks). */
export const INVALIDATE = ['/projects/'];

export const projectApi = (key: string) => `/projects/projects/${encodeURIComponent(key)}`;
export const taskApi = (ref: string) => `/projects/tasks/${encodeURIComponent(ref)}`;
export const projectHref = (key: string) => `/projects/${key}`;
export const taskHref = (ref: string) => `/projects/tasks/${ref}`;

export function useProject(key: string | null) {
  return useApiQuery<ProjectDetail>(key ? projectApi(key) : null);
}

export function useTask(ref: string | null) {
  return useApiQuery<TaskDetail>(ref ? taskApi(ref) : null);
}

/**
 * One URL search parameter (e.g. `view`, `task`) without touching the others, so opening the task sheet
 * keeps the list's page, filters and scroll position.
 */
export function useSearchParam(name: string) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = sp.get(name);
  const set = useCallback(
    (next: string | null, opts: { push?: boolean } = {}) => {
      const params = new URLSearchParams(sp.toString());
      if (next) params.set(name, next);
      else params.delete(name);
      const qs = params.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts.push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [sp, router, pathname, name],
  );
  return [value, set] as const;
}

const NO_FIELDS: readonly FieldDef[] = [];

/** Custom fields admins defined for tasks or projects (Administration → Custom fields). */
export function useCustomFields(entity: 'task' | 'project') {
  const query = useApiQuery<{ items: CustomField[] }>('/custom-fields', { entityType: `projects.${entity}` });
  const fields = useMemo(
    () =>
      query.data ? query.data.items.filter((f) => !f.archived).map((f) => f.field as FieldDef) : NO_FIELDS,
    [query.data],
  );
  const elements = useMemo<FormElement[]>(() => fields.map((f) => ({ ...f, id: f.key })), [fields]);
  return { fields, elements, ready: query.isSuccess };
}

/** Today in the viewer's time zone as `YYYY-MM-DD`. */
export function localToday(timeZone?: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** A `YYYY-MM-DD` date as a local Date at noon (safe for formatting in any zone). */
export const dateValue = (day: string) => new Date(`${day}T12:00:00`);

export const isClosed = (status: string) => status === 'done' || status === 'cancelled';

/** Download URL of an API route with its query (Markdown export). */
export function apiUrl(path: string, query: Record<string, string | number | undefined | null> = {}) {
  const qs = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return `/api/v1${path}${qs ? `?${qs}` : ''}`;
}
