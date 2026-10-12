'use client';

import type { ErrorBody } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { CHAT_SESSION_HEADER, type ChatSession } from '../../contracts';

/** The module's public API (published chats have no platform context: plain `fetch`, same origin). */
export const PUBLISHED_API = '/api/v1/helpdesk-ai/published';

/** JSON from a published-chat route, or an `ApiError` with the server's code (the UI keys off codes). */
export async function publicFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; session?: string | null; csrf?: string } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.session ? { [CHAT_SESSION_HEADER]: init.session } : {}),
        ...(init.csrf ? { 'x-csrf-token': init.csrf } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'The connection was interrupted');
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (json as ErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? res.statusText, err?.details);
  }
  return json as T;
}

/** The reason a published-chat call needs (another) sign-in or session, from a 401's details. */
export const authReason = (err: unknown): 'sign_in' | 'session_expired' | null => {
  if (!(err instanceof ApiError) || err.status !== 401) return null;
  const reason = (err.details as { reason?: string } | undefined)?.reason;
  return reason === 'sign_in' ? 'sign_in' : 'session_expired';
};

/** The session of a chat in this tab (sessionStorage: gone with the tab, never shared with other sites). */
const sessionKey = (token: string) => `isbp-chat:${token}`;

export interface StoredChat {
  session: string;
  expiresAt: string;
  conversationId: string | null;
}

export function readStoredChat(token: string): StoredChat | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(token));
    const stored = raw ? (JSON.parse(raw) as StoredChat) : null;
    return stored && new Date(stored.expiresAt).getTime() > Date.now() + 30_000 ? stored : null;
  } catch {
    return null;
  }
}

export function storeChat(token: string, value: StoredChat | null) {
  try {
    if (value) sessionStorage.setItem(sessionKey(token), JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey(token));
  } catch {
    // Storage blocked (a private window or a strict browser): the chat still works for this page view.
  }
}

/** Message from the sign-in window to the chat that opened it. */
export interface ConnectMessage {
  type: 'isbp-chat:session';
  token: string;
  session: ChatSession;
}
