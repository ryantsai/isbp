'use client';

import { ApiError } from '@isbp/sdk/web';
import { useLocale } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiMode,
  ChatLocale,
  ChatSession,
  Citation,
  ConversationDetail,
  EscalateResult,
  PublicChat,
  PublishedArticle,
  TicketProposal,
} from '../../contracts';
import { createSseParser, toChatEvent } from '../../lib/sse';
import {
  authReason,
  type ConnectMessage,
  PUBLISHED_API,
  publicFetch,
  readStoredChat,
  storeChat,
} from './api';

/** The answer being streamed (and its question) until the stored conversation catches up. */
export interface PendingAnswer {
  base: number;
  question: string;
  text: string;
  citations: Citation[];
  proposal: TicketProposal | null;
  tool: string | null;
  done: { mode: AiMode } | null;
}

export type ChatState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'sign_in'; popupBlocked: boolean }
  | { status: 'ready' };

/** The session expiry as sent (an ISO string in JSON). */
const expiryOf = (s: ChatSession) => String(s.expiresAt);

/**
 * A published chat (no platform context): its public info, a session (a visitor's own, or — for signed-in chats
 * — one the platform gives the signed-in person, directly or through the sign-in window), one conversation per tab
 * and the streamed answers.
 */
export function usePublishedChat(token: string) {
  const locale = useLocale() as ChatLocale;
  const base = `${PUBLISHED_API}/${encodeURIComponent(token)}`;
  const [info, setInfo] = useState<PublicChat | null>(null);
  const [state, setState] = useState<ChatState>({ status: 'loading' });
  const [session, setSession] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'resolve' | 'escalate' | null>(null);
  const popup = useRef<Window | null>(null);

  const adopt = useCallback(
    (s: ChatSession, conversation: string | null) => {
      storeChat(token, { session: s.session, expiresAt: expiryOf(s), conversationId: conversation });
      setSession(s.session);
      setUserName(s.user?.displayName ?? null);
      setState({ status: 'ready' });
    },
    [token],
  );

  /** A fresh session: a visitor's, or the signed-in person's when the platform's cookie reaches us. */
  const startSession = useCallback(
    async (chat: PublicChat) => {
      if (chat.access === 'anyone') {
        adopt(await publicFetch<ChatSession>(`${base}/sessions`, { method: 'POST' }), null);
        return;
      }
      try {
        // Opened as a link (or framed on the platform's own site): the session cookie is sent.
        const me = await publicFetch<{ csrfToken: string }>('/api/v1/auth/session');
        adopt(
          await publicFetch<ChatSession>(`${base}/sessions/me`, { method: 'POST', csrf: me.csrfToken }),
          null,
        );
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403))
          setState({ status: 'sign_in', popupBlocked: false });
        else throw err;
      }
    },
    [adopt, base],
  );

  // The chat, then this tab's session (kept across reloads) or a new one.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const chat = await publicFetch<PublicChat>(base);
        if (!live) return;
        setInfo(chat);
        const stored = readStoredChat(token);
        if (stored) {
          setSession(stored.session);
          setConversationId(stored.conversationId);
          setState({ status: 'ready' });
        } else await startSession(chat);
      } catch (err) {
        if (!live) return;
        if (err instanceof ApiError && err.status === 404) setState({ status: 'unavailable' });
        else setError(err instanceof ApiError ? err.code : 'generic');
      }
    })();
    return () => {
      live = false;
    };
  }, [base, token, startSession]);

  // The stored conversation (after a reload, and after each answer).
  const reload = useCallback(
    async (id: string, s: string) => {
      try {
        setDetail(await publicFetch<ConversationDetail>(`${base}/conversations/${id}`, { session: s }));
      } catch (err) {
        if (authReason(err) || (err instanceof ApiError && err.status === 404)) {
          // The session ended or the conversation is gone: start over.
          storeChat(token, null);
          setConversationId(null);
          setDetail(null);
        }
      }
    },
    [base, token],
  );
  useEffect(() => {
    if (session && conversationId && !detail) void reload(conversationId, session);
  }, [session, conversationId, detail, reload]);

  // The sign-in window hands over a session. Only from the window this chat opened, on the platform's origin.
  useEffect(() => {
    const onMessage = (e: MessageEvent<ConnectMessage>) => {
      if (e.origin !== window.location.origin || !popup.current || e.source !== popup.current) return;
      if (e.data?.type !== 'isbp-chat:session' || e.data.token !== token) return;
      popup.current = null;
      adopt(e.data.session, null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [adopt, token]);

  const signIn = useCallback(() => {
    const w = window.open(
      `/p/helpdesk-ai/chat/${encodeURIComponent(token)}/connect`,
      'isbp-chat-connect',
      'popup,width=480,height=680',
    );
    if (!w) setState({ status: 'sign_in', popupBlocked: true });
    popup.current = w;
  }, [token]);

  /** After the session ended: a visitor gets a new one silently; a signed-in person signs in again. */
  const sessionEnded = useCallback(async () => {
    storeChat(token, null);
    setSession(null);
    setConversationId(null);
    setDetail(null);
    if (info) await startSession(info).catch(() => setState({ status: 'sign_in', popupBlocked: false }));
  }, [info, startSession, token]);

  const busy = !!pending && !pending.done;

  const send = useCallback(
    async (content: string): Promise<boolean> => {
      const question = content.trim();
      if (!question || busy || !session) return false;
      setError(null);
      let id = conversationId;
      try {
        if (!id) {
          id = (
            await publicFetch<{ id: string }>(`${base}/conversations`, {
              method: 'POST',
              body: { locale },
              session,
            })
          ).id;
          setConversationId(id);
          const stored = readStoredChat(token);
          if (stored) storeChat(token, { ...stored, conversationId: id });
        }
      } catch (err) {
        if (authReason(err)) await sessionEnded();
        else setError(err instanceof ApiError ? err.code : 'generic');
        return false;
      }
      const conversation = id;
      const baseCount = detail?.messages.length ?? 0;
      setPending({
        base: baseCount,
        question,
        text: '',
        citations: [],
        proposal: null,
        tool: null,
        done: null,
      });
      const update = (patch: (p: PendingAnswer) => Partial<PendingAnswer>) =>
        setPending((p) => (p ? { ...p, ...patch(p) } : p));
      let accepted = true;
      try {
        const res = await fetch(`${base}/conversations/${conversation}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            'x-isbp-chat-session': session,
          },
          body: JSON.stringify({ content: question }),
          credentials: 'same-origin',
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as {
            error?: { code?: string; details?: unknown };
          } | null;
          accepted = false;
          if (res.status === 401) await sessionEnded();
          else setError(body?.error?.code ?? 'generic');
        } else {
          const parser = createSseParser((raw) => {
            const evt = toChatEvent(raw);
            if (!evt) return;
            if (evt.event === 'delta') update((p) => ({ text: p.text + evt.data.text, tool: null }));
            else if (evt.event === 'tool') update(() => ({ tool: evt.data.name }));
            else if (evt.event === 'citations') update(() => ({ citations: evt.data.items }));
            else if (evt.event === 'proposal') update(() => ({ proposal: evt.data }));
            else if (evt.event === 'done') update(() => ({ done: { mode: evt.data.mode }, tool: null }));
            else if (evt.event === 'error') setError(evt.data.code);
          });
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) parser.push(value);
          }
          parser.flush();
        }
      } catch {
        setError('NETWORK');
      }
      await reload(conversation, session);
      setPending(null);
      return accepted;
    },
    [base, busy, conversationId, detail?.messages.length, locale, reload, session, sessionEnded, token],
  );

  const resolve = useCallback(async () => {
    if (!conversationId || !session) return;
    setBusyAction('resolve');
    try {
      await publicFetch(`${base}/conversations/${conversationId}/resolve`, { method: 'POST', session });
      await reload(conversationId, session);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'generic');
    } finally {
      setBusyAction(null);
    }
  }, [base, conversationId, reload, session]);

  const escalate = useCallback(
    async (proposal: TicketProposal): Promise<EscalateResult | null> => {
      if (!conversationId || !session) return null;
      setBusyAction('escalate');
      try {
        const out = await publicFetch<EscalateResult>(`${base}/conversations/${conversationId}/escalate`, {
          method: 'POST',
          body: proposal,
          session,
        });
        await reload(conversationId, session);
        return out;
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'generic');
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [base, conversationId, reload, session],
  );

  const article = useCallback(
    (id: string) => publicFetch<PublishedArticle>(`${base}/articles/${id}`, { session }),
    [base, session],
  );

  /** A new conversation (the previous one stays with the session until it ends). */
  const restart = useCallback(() => {
    const stored = readStoredChat(token);
    if (stored) storeChat(token, { ...stored, conversationId: null });
    setConversationId(null);
    setDetail(null);
    setError(null);
  }, [token]);

  const stored = detail?.messages ?? [];
  return {
    info,
    state,
    userName,
    conversation: detail,
    messages: stored,
    pendingQuestion: pending && stored.length <= pending.base ? pending.question : null,
    pendingAnswer: pending && stored.length <= pending.base + 1 ? pending : null,
    busy,
    busyAction,
    error,
    clearError: () => setError(null),
    signIn,
    send,
    resolve,
    escalate,
    article,
    restart,
  };
}
