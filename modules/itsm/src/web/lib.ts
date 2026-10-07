'use client';

import { localize } from '@isbp/sdk';
import { useApiQuery } from '@isbp/ui/query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import type { Category, PersonRef, TicketType } from '../contracts';
import { categoryTree } from './logic';
import type { AssignmentGroup } from './types';

export type { CategoryNode } from './logic';

/** Every ITSM mutation refreshes ITSM data (lists, the ticket, queues, the calendar). */
export const INVALIDATE = ['/itsm/'];

/** API path of a ticket (by reference or id). */
export const ticketApi = (ref: string) => `/itsm/tickets/${encodeURIComponent(ref)}`;
/** Web path of a ticket. */
export const ticketHref = (ref: string) => `/itsm/tickets/${encodeURIComponent(ref)}`;

/** CMDB page of a CI (by its `CI-00042` reference, or its id when no reference is known). */
export const ciHref = (ci: { id: string; reference?: string | null }) =>
  `/cmdb/${encodeURIComponent(ci.reference || ci.id)}`;

/** Assignment groups (core groups) for pickers. */
export function useGroups(enabled = true) {
  const q = useApiQuery<{ items: AssignmentGroup[] }>(enabled ? '/itsm/groups' : null);
  return { groups: q.data?.items ?? [], isLoading: q.isLoading };
}

/** Members of an assignment group who can work tickets. */
export function useGroupAgents(groupId: string | null | undefined) {
  const q = useApiQuery<{ items: PersonRef[] }>(groupId ? `/itsm/groups/${groupId}/agents` : null);
  return { agents: q.data?.items ?? [], isLoading: q.isLoading && Boolean(groupId) };
}

/** Ticket categories for a type (tree order). */
export function useCategories(type?: TicketType, includeInactive = false) {
  const locale = useLocale();
  const q = useApiQuery<{ items: Category[] }>('/itsm/categories', {
    type,
    includeInactive: includeInactive || undefined,
  });
  const tree = useMemo(() => categoryTree(q.data?.items ?? [], locale), [q.data, locale]);
  return { categories: q.data?.items ?? [], tree, isLoading: q.isLoading, error: q.error };
}

/** Localized category path from a ref (`ancestors` aren't on refs, so the English path is the fallback). */
export function useCategoryLabel() {
  const locale = useLocale();
  return useCallback(
    (c: { name: Category['name']; path: string } | null | undefined) => {
      if (!c) return null;
      const own = localize(c.name, locale);
      const parts = c.path.split(' › ');
      return parts.length > 1 ? [...parts.slice(0, -1), own].join(' › ') : own;
    },
    [locale],
  );
}

/** `<input type="datetime-local">` value ↔ ISO string (in the browser's time zone). */
export const toLocalInput = (iso: string | Date | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

/** Compact duration: "2d 4h", "3h 20m", "45m". */
export function useDuration() {
  const t = useTranslations('itsm.common.duration');
  return useCallback(
    (ms: number) => {
      const minutes = Math.max(0, Math.round(Math.abs(ms) / 60_000));
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      const mins = minutes % 60;
      if (days > 0) return t('days', { days, hours });
      if (hours > 0) return t('hours', { hours, minutes: mins });
      return t('minutes', { minutes: mins });
    },
    [t],
  );
}

/** Hours (possibly fractional) as a compact duration. */
export function useHours() {
  const duration = useDuration();
  return useCallback((hours: number) => duration(hours * 3_600_000), [duration]);
}

/** The ticket as a platform record (`itsm.change` for changes, `itsm.ticket` otherwise). */
export function recordRef(ticket: { id: string; type: string }) {
  return { type: ticket.type === 'change' ? 'itsm.change' : 'itsm.ticket', id: ticket.id };
}
