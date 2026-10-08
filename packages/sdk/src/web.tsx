'use client';

import type { Locale } from '@isbp/i18n';
import {
  createContext,
  Fragment,
  Suspense,
  use,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react';
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

/**
 * A contribution to another page's extension point, e.g. Helpdesk AI's panel in ITSM's ticket page
 * (`itsm.ticket.aside`). The host renders `<Slot name=… props=… />`; the slot's props are the host's
 * contract (export their type from the host module's contracts).
 */
export interface WebSlot {
  /** `<host module>.<place>`, e.g. `itsm.ticket.aside`, `core.requests.assist`. */
  slot: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  load: () => Promise<{ default: ComponentType<any> }>;
  /** Shown only to viewers holding this permission at any scope. */
  permission?: string;
  /** Lower first (default 100). */
  order?: number;
}

export interface WebModule {
  readonly manifest: ModuleManifest;
  readonly routes: readonly WebRoute[];
  readonly slots: readonly WebSlot[];
}

export function defineWebModule(
  manifest: ModuleManifest,
  options: { routes: WebRoute[]; slots?: WebSlot[] },
): WebModule {
  for (const r of options.routes) {
    if (!r.path.startsWith('/'))
      throw new Error(`[${manifest.id}] web route "${r.path}" must start with "/"`);
  }
  for (const s of options.slots ?? []) {
    if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/.test(s.slot))
      throw new Error(`[${manifest.id}] slot "${s.slot}" must look like "<module>.<place>"`);
  }
  return Object.freeze({ manifest, routes: options.routes, slots: options.slots ?? [] });
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

/* ───────────────────────────── slots ───────────────────────────── */

export interface SlotContribution {
  moduleId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<any>;
  permission?: string;
  order: number;
}

/** Slot name → contributions (components created once, outside render — see the web app's registry). */
export type SlotRegistry = ReadonlyMap<string, readonly SlotContribution[]>;

const SlotContext = createContext<SlotRegistry>(new Map());

export const SlotProvider = SlotContext.Provider;

/** Contributions to `name` from enabled modules the viewer may see, in order. */
export function useSlot(name: string): readonly SlotContribution[] {
  const registry = use(SlotContext);
  const platform = use(PlatformContext);
  return useMemo(() => {
    if (!platform) return [];
    const permissions = new PermissionSet(platform.grants);
    return (registry.get(name) ?? []).filter(
      (c) =>
        platform.enabledModules.includes(c.moduleId) && (!c.permission || permissions.hasAny(c.permission)),
    );
  }, [registry, platform, name]);
}

/**
 * Renders every contribution to an extension point. `wrap` lets the host place each one (e.g. in a
 * card); `fallback` shows while a contribution loads.
 */
export function Slot<P extends object>({
  name,
  props,
  fallback = null,
  wrap,
}: {
  name: string;
  props: P;
  fallback?: ReactNode;
  wrap?: (node: ReactNode, moduleId: string) => ReactNode;
}) {
  const contributions = useSlot(name);
  return contributions.map(({ moduleId, Component }) => {
    const node = (
      <Suspense fallback={fallback}>
        <Component {...props} />
      </Suspense>
    );
    return <Fragment key={moduleId}>{wrap ? wrap(node, moduleId) : node}</Fragment>;
  });
}

/* ───────────────────────────── page context ───────────────────────────── */

/** The record a page shows (`core.record.links` reports it), e.g. `{ type: 'itsm.ticket', id, label: 'INC-00042 VPN drops' }`. */
export interface PageRecord {
  type: string;
  id: string;
  label?: string;
}

/** Where the person is: the path, the document title and the record on the page (if any). */
export interface PageContextInfo {
  path: string;
  title: string;
  record: PageRecord | null;
}

type ReportRecord = (key: string, record: PageRecord | null) => void;

const PageRecordReporter = createContext<ReportRecord | null>(null);
const PageLocation = createContext<{ path: string; record: PageRecord | null }>({ path: '', record: null });

/**
 * Mounted by the shell around every page: holds the current path and the records pages report with
 * {@link usePageRecord} (the most recently mounted one wins, so a record opened in a sheet over its parent's page
 * is "the" record until the sheet closes).
 */
export function PageContextProvider({ path, children }: { path: string; children: ReactNode }) {
  const [reported, setReported] = useState<readonly { key: string; record: PageRecord }[]>([]);
  const report = useCallback<ReportRecord>(
    (key, record) =>
      setReported((prev) => {
        const rest = prev.filter((r) => r.key !== key);
        return record ? [...rest, { key, record }] : rest;
      }),
    [],
  );
  const location = useMemo(() => ({ path, record: reported.at(-1)?.record ?? null }), [path, reported]);
  return (
    <PageRecordReporter value={report}>
      <PageLocation value={location}>{children}</PageLocation>
    </PageRecordReporter>
  );
}

/**
 * Reports the record this page shows to the shell (the assistant uses it as context); cleared on unmount. Record
 * pages get this for free from `core.record.links`. Pass `null` while the record is loading.
 */
export function usePageRecord(record: PageRecord | null | undefined): void {
  const report = use(PageRecordReporter);
  const key = useId();
  const type = record?.type;
  const id = record?.id;
  const label = record?.label;
  useEffect(() => {
    if (!report || !type || !id) return;
    report(key, { type, id, ...(label ? { label } : {}) });
    return () => report(key, null);
  }, [report, key, type, id, label]);
}

function subscribeTitle(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.head, { subtree: true, childList: true, characterData: true });
  return () => observer.disconnect();
}
const documentTitle = () => document.title;
const noTitle = () => '';

/** The page the person is on: path (from the router), title (`document.title`) and the reported record. */
export function usePageContext(): PageContextInfo {
  const { path, record } = use(PageLocation);
  const title = useSyncExternalStore(subscribeTitle, documentTitle, noTitle);
  return useMemo(() => ({ path, title, record }), [path, title, record]);
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
  /** Multipart upload (`FormData`) with progress (0–1); errors surface as `ApiError` like `request`. */
  function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${base}${path}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('accept', 'application/json');
      xhr.setRequestHeader('x-csrf-token', csrfToken);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'The upload failed'));
      xhr.onload = () => {
        let data: unknown;
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
        } catch {
          data = undefined;
        }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data as T);
        const err = (data as ErrorBody | undefined)?.error;
        reject(
          new ApiError(xhr.status, err?.code ?? 'HTTP_ERROR', err?.message ?? xhr.statusText, err?.details),
        );
      };
      xhr.send(form);
    });
  }
  return {
    upload,
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
