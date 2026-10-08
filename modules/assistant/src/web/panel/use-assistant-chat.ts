'use client';

import type { ErrorBody } from '@isbp/sdk';
import { type PageContextInfo, useApi, usePlatform } from '@isbp/sdk/web';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageContext } from '../../contracts';
import { createSseParser, toChatEvent } from '../../lib/sse';
import {
  CHANGE_SETS_PATH,
  type ChangeSetSummaryDto,
  type ConfirmationDto,
  confirmationApiPath,
  CONVERSATIONS_PATH,
  type ConversationDetailDto,
  INVALIDATE,
  type MessageDto,
} from '../lib';

export type ToolStatus = 'running' | 'done' | 'error';

/** The turn being streamed (and the question it answers) until the stored conversation catches up. */
export interface PendingTurn {
  conversationId: string;
  /** Stored messages before this turn. */
  base: number;
  question: string;
  text: string;
  tools: { name: string; status: ToolStatus }[];
  /** Destructive calls waiting for the person's confirmation. */
  confirmations: ConfirmationDto[];
  done: boolean;
}

const cut = (s: string | undefined, n: number) => (s && s.length > n ? s.slice(0, n) : s);

/** The page context as the API takes it (bounded lengths). */
export function toPageContext(page: PageContextInfo): PageContext {
  return {
    path: page.path.slice(0, 500),
    ...(page.title ? { title: cut(page.title, 300) } : {}),
    record: page.record
      ? {
          type: page.record.type.slice(0, 100),
          id: page.record.id.slice(0, 200),
          ...(page.record.label ? { label: cut(page.record.label, 300) } : {}),
        }
      : null,
  };
}

/**
 * A conversation with the assistant: the stored messages plus the turn in flight, streamed over Server-Sent
 * Events from `POST /assistant/conversations/:id/messages` (`fetch` + `ReadableStream`, CSRF header). The
 * conversation's change set comes from the stored conversation and from `change_set` events.
 */
export function useAssistantChat(conversationId: string | null, onCreated: (id: string) => void) {
  const api = useApi();
  const { csrfToken } = usePlatform();
  const query = useApiQuery<ConversationDetailDto>(
    conversationId ? `${CONVERSATIONS_PATH}/${conversationId}` : null,
  );
  // Paging keeps the previous key's data as a placeholder: only trust it for this conversation.
  const detail = query.data && query.data.id === conversationId ? query.data : null;
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<{ conversationId: string; changeSet: ChangeSetSummaryDto } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const refresh = useApiMutation(async () => undefined, { invalidate: INVALIDATE, silent: true });
  // Mid-turn, only the change set is refreshed: the stored conversation would hide the streamed answer.
  const refreshChangeSets = useApiMutation(async () => undefined, {
    invalidate: [CHANGE_SETS_PATH],
    silent: true,
  });

  const stored: MessageDto[] = detail?.messages ?? [];
  const mine = pending && pending.conversationId === conversationId ? pending : null;
  const busy = !!pending && !pending.done;

  const send = useCallback(
    async (content: string, page: PageContext): Promise<boolean> => {
      const question = content.trim();
      if (!question || busy) return false;
      setError(null);
      let id = conversationId;
      try {
        if (!id) {
          id = (await api.post<{ id: string }>(CONVERSATIONS_PATH, { page })).id;
          onCreated(id);
        }
      } catch (err) {
        setError((err as { code?: string }).code ?? 'generic');
        return false;
      }
      const conversation = id;
      const base = conversation === conversationId ? stored.length : 0;
      const update = (patch: (p: PendingTurn) => Partial<PendingTurn>) =>
        setPending((p) => (p && p.conversationId === conversation ? { ...p, ...patch(p) } : p));
      setPending({
        conversationId: conversation,
        base,
        question,
        text: '',
        tools: [],
        confirmations: [],
        done: false,
      });

      const controller = new AbortController();
      abort.current = controller;
      let accepted = true;
      try {
        const res = await fetch(`/api/v1${CONVERSATIONS_PATH}/${conversation}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ content: question, page }),
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as ErrorBody | null;
          setError(body?.error.code ?? 'generic');
          accepted = false;
        } else {
          const parser = createSseParser((raw) => {
            const evt = toChatEvent(raw);
            if (!evt) return;
            switch (evt.event) {
              case 'delta':
                update((p) => ({ text: p.text + evt.data.text }));
                break;
              case 'tool': {
                const { name, status } = evt.data;
                update((p) => {
                  if (status === 'running') return { tools: [...p.tools, { name, status }] };
                  const tools = [...p.tools];
                  for (let i = tools.length - 1; i >= 0; i--)
                    if (tools[i]!.name === name && tools[i]!.status === 'running') {
                      tools[i] = { name, status };
                      return { tools };
                    }
                  return { tools: [...tools, { name, status }] };
                });
                break;
              }
              case 'change_set':
                // Dates arrive as strings: the wire shape of the summary.
                setLive({
                  conversationId: conversation,
                  changeSet: evt.data as unknown as ChangeSetSummaryDto,
                });
                void refreshChangeSets.mutateAsync(undefined).catch(() => undefined);
                break;
              case 'confirm':
                update((p) => ({
                  confirmations: [...p.confirmations, evt.data as unknown as ConfirmationDto],
                }));
                break;
              case 'done':
                update(() => ({ done: true }));
                break;
              case 'error':
                setError(evt.data.code);
                break;
            }
          });
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) parser.push(value);
          }
          parser.flush();
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError('NETWORK');
      }
      // The stored conversation now holds the turn; swap the live copy for it.
      await refresh.mutateAsync(undefined).catch(() => undefined);
      setPending(null);
      return accepted;
    },
    [api, busy, conversationId, csrfToken, onCreated, refresh, refreshChangeSets, stored.length],
  );

  /**
   * The person's answer to a pending confirmation: the call runs (or not) as them and the conversation records it.
   * Errors stay on the card; the conversation is re-read either way (an expired card shows as expired).
   */
  const decide = useApiMutation(
    (a, v: { toolCallId: string; approve: boolean }) =>
      a.post<ConversationDetailDto>(confirmationApiPath(conversationId!, v.toolCallId), {
        approve: v.approve,
      }),
    { invalidate: INVALIDATE, silent: true },
  );
  const confirm = useCallback(
    (toolCallId: string, approve: boolean) =>
      decide.mutate(
        { toolCallId, approve },
        { onError: () => void refresh.mutateAsync(undefined).catch(() => undefined) },
      ),
    [decide, refresh],
  );

  const count = stored.length;
  const liveChangeSet = live && live.conversationId === conversationId ? live.changeSet : null;
  return {
    conversation: detail,
    loading: !!conversationId && query.isLoading && !detail,
    loadError: query.error,
    messages: stored,
    /** The question, shown until the server copy arrives. */
    pendingQuestion: mine && count <= mine.base ? mine.question : null,
    /** The streamed answer, shown until the server copy arrives. */
    pendingAnswer: mine && count <= mine.base + 1 ? mine : null,
    /** The conversation's change set: the latest one a tool touched in this session, else the stored one. */
    changeSetId: liveChangeSet?.id ?? detail?.changeSetId ?? null,
    changeSet: liveChangeSet ?? detail?.changeSet ?? null,
    busy,
    error,
    clearError: () => setError(null),
    send,
    /** The confirmation being decided, its error, and the way to decide one. */
    decide,
    confirm,
  };
}

export type AssistantChat = ReturnType<typeof useAssistantChat>;
