'use client';

import type { ErrorBody } from '@isbp/sdk';
import { ApiError, type ApiClient, useApi, usePlatform } from '@isbp/sdk/web';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { useLocale } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiMode,
  ChatLocale,
  ChatMessage,
  Citation,
  ConversationDetail,
  EscalateResult,
  TicketProposal,
} from '../../contracts';
import { createSseParser, toChatEvent } from '../../lib/sse';

/** The answer being streamed (and the question it answers) until the stored conversation catches up. */
export interface PendingTurn {
  conversationId: string;
  /** Stored messages before this turn. */
  base: number;
  question: string;
  text: string;
  citations: Citation[];
  proposal: TicketProposal | null;
  /** A tool the model is running (e.g. searching articles). */
  tool: string | null;
  done: { messageId: string; mode: AiMode; model: string | null } | null;
}

const LIST = '/helpdesk-ai/conversations';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** After a failed escalation: the conversation's ticket, if one was raised (waits briefly while one is). */
async function raisedTicket(api: ApiClient, id: string, err: unknown): Promise<EscalateResult | null> {
  const inProgress =
    err instanceof ApiError &&
    (err.details as { reason?: string } | undefined)?.reason === 'escalation_in_progress';
  for (const wait of inProgress ? [0, 1_500, 3_000] : [0]) {
    if (wait) await sleep(wait);
    const fresh = await api.get<ConversationDetail>(`${LIST}/${id}`).catch(() => null);
    if (fresh?.status === 'escalated' && fresh.ticketId && fresh.ticketRef)
      return {
        ticket: { id: fresh.ticketId, reference: fresh.ticketRef, href: `/itsm/tickets/${fresh.ticketRef}` },
        conversation: fresh,
        warning: null,
      };
  }
  return null;
}

/**
 * Conversation state for the chat UI: the stored messages plus the turn in flight, streamed over
 * Server-Sent Events from `POST /conversations/:id/messages` (`fetch` + `ReadableStream`, CSRF header).
 */
export function useChat(conversationId: string | null, onCreated: (id: string) => void) {
  const api = useApi();
  const { csrfToken } = usePlatform();
  const locale = useLocale() as ChatLocale;
  const query = useApiQuery<ConversationDetail>(conversationId ? `${LIST}/${conversationId}` : null);
  // Paging keeps the previous key's data as a placeholder: only trust it for this conversation.
  const detail = query.data && query.data.id === conversationId ? query.data : null;
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const refresh = useApiMutation(async () => undefined, { invalidate: [LIST], silent: true });
  const resolve = useApiMutation((a, id: string) => a.post(`${LIST}/${id}/resolve`), { invalidate: [LIST] });
  const escalate = useApiMutation(
    async (a, v: { id: string; proposal: TicketProposal }) => {
      try {
        return await a.post<EscalateResult>(`${LIST}/${v.id}/escalate`, v.proposal);
      } catch (err) {
        // The ticket may exist although the request failed (a dropped connection, a raise still finishing):
        // show "Ticket … was raised" rather than an error, and never invite a second ticket.
        const raised = await raisedTicket(a, v.id, err);
        if (raised) return raised;
        throw err;
      }
    },
    { invalidate: [LIST] },
  );

  const stored: ChatMessage[] = detail?.messages ?? [];
  const mine = pending && pending.conversationId === conversationId ? pending : null;
  const busy = !!pending && !pending.done;

  const send = useCallback(
    async (content: string): Promise<boolean> => {
      const question = content.trim();
      if (!question || busy) return false;
      setError(null);
      let id = conversationId;
      try {
        if (!id) {
          id = (await api.post<{ id: string }>(LIST, { locale })).id;
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
        citations: [],
        proposal: null,
        tool: null,
        done: null,
      });

      const controller = new AbortController();
      abort.current = controller;
      let accepted = true;
      try {
        const res = await fetch(`/api/v1${LIST}/${conversation}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ content: question }),
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
                update((p) => ({ text: p.text + evt.data.text, tool: null }));
                break;
              case 'tool':
                update(() => ({ tool: evt.data.name }));
                break;
              case 'citations':
                update(() => ({ citations: evt.data.items }));
                break;
              case 'proposal':
                update(() => ({ proposal: evt.data }));
                break;
              case 'done':
                update(() => ({ done: evt.data, tool: null }));
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
    [api, busy, conversationId, csrfToken, locale, onCreated, refresh, stored.length],
  );

  const count = stored.length;
  return {
    conversation: detail,
    loading: !!conversationId && query.isLoading && !detail,
    loadError: query.error,
    reload: () => void query.refetch(),
    messages: stored,
    /** The question, shown until the server copy arrives. */
    pendingQuestion: mine && count <= mine.base ? mine.question : null,
    /** The streamed answer, shown until the server copy arrives. */
    pendingAnswer: mine && count <= mine.base + 1 ? mine : null,
    busy,
    error,
    clearError: () => setError(null),
    send,
    resolve,
    escalate,
  };
}
