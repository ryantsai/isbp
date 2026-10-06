'use client';

import type { Locale } from '@isbp/i18n';
import { createContext, use, useMemo, type ComponentType } from 'react';
import type { ErrorBody } from './http';
import type { ModuleManifest } from './manifest';
import { PermissionSet, type Grant, type ResourceScope } from './permissions';

/* ───────────────────────────── module definition ───────────────────────────── */

export interface WebPageProps {
  /** Path params from the route pattern, e.g. `{ id: '…' }` for `/items/:id`. */
  params: Record<string, string>;
}

export type PageLoader = () => Promise<{ default: ComponentType<WebPageProps> }>;

export interface WebRoute {
  /** Relative to the module root: `/`, `/items/:id`, `/settings`. */
  path: string;
  load: PageLoader;
  /** Required permission at any scope; the API still enforces the real check. */
  permission?: string;
}

export interface WebModule {
  readonly manifest: ModuleManifest;
  readonly routes: readonly WebRoute[];
}

export function defineWebModule(manifest: ModuleManifest, options: { routes: WebRoute[] }): WebModule {
  for (const r of options.routes) {
    if (!r.path.startsWith('/'))
      throw new Error(`[${manifest.id}] web route "${r.path}" must start with "/"`);
  }
  return Object.freeze({ manifest, routes: options.routes });
}

/** Matches `/items/:id` style patterns; returns params or null. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    const val = s[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(val);
    else if (seg !== val) return null;
  }
  return params;
}

/* ───────────────────────────── platform context ───────────────────────────── */

export interface PlatformUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  locale: Locale;
  timezone: string;
  departmentId: string | null;
  avatarUrl: string | null;
}

export interface PlatformContextValue {
  user: PlatformUser;
  grants: readonly Grant[];
  csrfToken: string;
  enabledModules: readonly string[];
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

export const PlatformProvider = PlatformContext.Provider;

export function usePlatform() {
  const value = use(PlatformContext);
  if (!value) throw new Error('usePlatform() must be used inside <PlatformProvider>');
  const permissions = useMemo(() => new PermissionSet(value.grants), [value.grants]);
  return { ...value, permissions };
}

/** UI gating only — the API is the source of truth. */
export function useCan(permission: string, resource?: ResourceScope): boolean {
  const { permissions } = usePlatform();
  return resource ? permissions.can(permission, resource) : permissions.hasAny(permission);
}

/* ───────────────────────────── API client ───────────────────────────── */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type Query = Record<string, string | number | boolean | null | undefined | readonly string[]>;

export function toQueryString(query?: Query): string {
  if (!query) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((item) => sp.append(k, item));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function createApiClient(csrfToken: string, base = '/api/v1') {
  async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && method !== 'HEAD') headers['x-csrf-token'] = csrfToken;
    const res = await fetch(`${base}${path}${toQueryString(query)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const err = (data as ErrorBody | undefined)?.error;
      // An expired/revoked session sends the user to sign in again (not e.g. a wrong password at login).
      if (
        res.status === 401 &&
        err?.code === 'UNAUTHENTICATED' &&
        typeof window !== 'undefined' &&
        window.location.pathname !== '/login'
      ) {
        window.location.assign(
          `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
      }
      throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? res.statusText, err?.details);
    }
    return data as T;
  }
  return {
    get: <T,>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
    post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
    put: <T,>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
    patch: <T,>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
    delete: <T = void,>(path: string) => request<T>('DELETE', path),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function useApi(): ApiClient {
  const { csrfToken } = usePlatform();
  return useMemo(() => createApiClient(csrfToken), [csrfToken]);
}
