import type { Navigation, SessionResponse } from '@isbp/contracts';
import { headers } from 'next/headers';
import { cache } from 'react';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export class ServerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Server Component → API call that forwards the browser's cookies (session) and language. */
export async function serverApi<T>(path: string): Promise<T> {
  const h = await headers();
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      cookie: h.get('cookie') ?? '',
      'accept-language': h.get('accept-language') ?? '',
      'x-forwarded-for': h.get('x-forwarded-for') ?? '',
      'user-agent': h.get('user-agent') ?? '',
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ServerApiError(
      res.status,
      body?.error?.code ?? 'HTTP_ERROR',
      body?.error?.message ?? res.statusText,
    );
  }
  return (await res.json()) as T;
}

/** Current session or null (deduplicated per request). */
export const getSession = cache(async (): Promise<SessionResponse | null> => {
  try {
    return await serverApi<SessionResponse>('/auth/session');
  } catch (err) {
    if (err instanceof ServerApiError && err.status === 401) return null;
    throw err;
  }
});

/** The person's sidebar (`items`) and Administration hub entries (`admin`). */
export const getNavigation = cache(async (): Promise<Navigation> => {
  const nav = await serverApi<Navigation>('/platform/navigation');
  return { items: nav.items, admin: nav.admin ?? [] };
});

export async function currentPath(): Promise<string> {
  return (await headers()).get('x-isbp-path') ?? '/';
}
