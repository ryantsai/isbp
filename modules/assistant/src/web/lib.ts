'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import type { z } from 'zod';
import type {
  assistantStatusSchema,
  ChangeSetItem,
  changeSetDetailSchema,
  changeSetSummarySchema,
  confirmationSchema,
  conversationDetailSchema,
  conversationSchema,
  kindInfoSchema,
  messageSchema,
} from '../contracts';

/* What the browser receives (dates as ISO strings). */
export type ChangeSetSummaryDto = z.input<typeof changeSetSummarySchema>;
export type ChangeSetDetailDto = z.input<typeof changeSetDetailSchema>;
export type ConversationDto = z.input<typeof conversationSchema>;
export type ConversationDetailDto = z.input<typeof conversationDetailSchema>;
export type MessageDto = z.input<typeof messageSchema>;
export type AssistantStatusDto = z.input<typeof assistantStatusSchema>;
export type KindInfoDto = z.input<typeof kindInfoSchema>;
export type ConfirmationDto = z.input<typeof confirmationSchema>;

export const STATUS_PATH = '/assistant/status';
export const CONVERSATIONS_PATH = '/assistant/conversations';
export const CHANGE_SETS_PATH = '/assistant/change-sets';
export const changeSetApiPath = (id: string) => `${CHANGE_SETS_PATH}/${id}`;
/** Confirm or decline a destructive call the agent made (`{ approve }`); answers with the conversation. */
export const confirmationApiPath = (conversationId: string, toolCallId: string) =>
  `${CONVERSATIONS_PATH}/${conversationId}/confirmations/${encodeURIComponent(toolCallId)}`;
/** Every assistant mutation refreshes the panel, the lists and the open change set. */
export const INVALIDATE = ['/assistant/'];

/** `core.custom-field` → `{ moduleId: 'core', name: 'custom-field' }`. */
export function splitKind(kind: string): { moduleId: string; name: string } {
  const i = kind.indexOf('.');
  return i < 0 ? { moduleId: kind, name: '' } : { moduleId: kind.slice(0, i), name: kind.slice(i + 1) };
}

const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * A kind's singular noun ("Approval workflow"): the owning module's catalog key from `status.kinds`, else the
 * `<module>.customizations.<kind>` convention, else the kind itself.
 */
export function useKindLabel(kinds: readonly KindInfoDto[] | undefined) {
  const t = useTranslations();
  return useCallback(
    (kind: string) => {
      const known = kinds?.find((k) => k.kind === kind)?.label;
      if (known && t.has(known)) return t(known);
      const { moduleId, name } = splitKind(kind);
      const guess = `${moduleId}.customizations.${camel(name)}`;
      return t.has(guess) ? t(guess) : kind;
    },
    [kinds, t],
  );
}

/** A catalog key (`core.customizations.field.label`) as text, or the text itself. */
export function useCatalogText() {
  const t = useTranslations();
  return useCallback((key: string) => (/^[a-z][\w-]*\.[\w.-]+$/.test(key) && t.has(key) ? t(key) : key), [t]);
}

export type CheckState = 'unchecked' | 'ok' | 'needsApprover' | 'failing';

export function checkState(item: Pick<ChangeSetItem, 'check'>): CheckState {
  if (!item.check) return 'unchecked';
  if (item.check.ok) return 'ok';
  return item.check.needsApprover ? 'needsApprover' : 'failing';
}

/** How the items of a change set fared in their latest dry run. */
export function checkCounts(items: readonly Pick<ChangeSetItem, 'check'>[]) {
  const counts: Record<CheckState, number> = { unchecked: 0, ok: 0, needsApprover: 0, failing: 0 };
  for (const i of items) counts[checkState(i)]++;
  return counts;
}

export const isOpenStatus = (status: string) => status === 'draft' || status === 'in_review';

/** Plain object (not an array, not null). */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
