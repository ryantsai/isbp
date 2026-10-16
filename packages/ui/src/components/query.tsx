'use client';

/** Data hooks shared by core pages and module pages (same DX for built-in and custom modules). */

import { localize } from '@isbp/sdk';
import { type ApiClient, ApiError, type Query, useApi } from '@isbp/sdk/web';
import { inUseReferences } from './in-use';
import { toast } from './toast';
import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback } from 'react';

/** Translates API error codes; falls back to the server's English message. */
export function useErrorText() {
  const t = useTranslations('errors');
  const tUse = useTranslations('ui.inUse');
  const locale = useLocale();
  return useCallback(
    (err: unknown) => {
      if (!(err instanceof ApiError)) return t('generic');
      const text = t.has(err.code) ? t(err.code) : err.message;
      // A refused delete says what still uses it ("Still used by REQ-01039 · New laptop and 2 more.").
      const used = inUseReferences(err);
      if (!used) return text;
      const first = localize(used.items[0]!.label, locale);
      return `${text} ${tUse('summary', { first, more: used.items.length - 1 + (used.more ? 1 : 0) })}`;
    },
    [t, tUse, locale],
  );
}

/** GET with a cache key of `[path, query]`; keeps the previous page visible while paging. */
export function useApiQuery<T>(
  path: string | null,
  query?: Query,
  opts: { enabled?: boolean; refetchInterval?: number } = {},
) {
  const api = useApi();
  return useQuery({
    queryKey: [path, query ?? {}],
    queryFn: ({ signal }) => api.get<T>(path!, query, signal),
    enabled: path !== null && (opts.enabled ?? true),
    placeholderData: keepPreviousData,
    refetchInterval: opts.refetchInterval,
  });
}

/**
 * Cursor paging for `{ items, nextCursor }` responses (`nextCursor` is null on the last page): `fetchNextPage` asks for
 * the page after the last one. Loaded pages stay cached under the query key, like `useApiQuery`'s.
 */
export function useApiInfiniteQuery<T extends { nextCursor: string | null }>(
  path: string | null,
  query?: Query,
  opts: { enabled?: boolean } = {},
) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: [path, query ?? {}, 'pages'],
    queryFn: ({ pageParam, signal }) => api.get<T>(path!, { ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: path !== null && (opts.enabled ?? true),
    placeholderData: keepPreviousData,
  });
}

export function invalidatePaths(client: QueryClient, prefixes: string[]) {
  return client.invalidateQueries({
    predicate: (q) =>
      typeof q.queryKey[0] === 'string' && prefixes.some((p) => (q.queryKey[0] as string).startsWith(p)),
  });
}

/**
 * Mutation with consistent UX: success toast, translated error toast, and cache invalidation by
 * path prefix (`invalidate: ['/users']` refreshes lists and details).
 */
export function useApiMutation<V, R = unknown>(
  fn: (api: ApiClient, vars: V) => Promise<R>,
  opts: {
    success?: string | ((r: R) => string);
    invalidate?: string[];
    onSuccess?: (r: R, v: V) => void;
    silent?: boolean;
  } = {},
) {
  const api = useApi();
  const client = useQueryClient();
  const errorText = useErrorText();
  return useMutation({
    mutationFn: (vars: V) => fn(api, vars),
    onSuccess: async (result, vars) => {
      if (opts.invalidate?.length) await invalidatePaths(client, opts.invalidate);
      if (opts.success)
        toast.success(typeof opts.success === 'function' ? opts.success(result) : opts.success);
      opts.onSuccess?.(result, vars);
    },
    onError: (err) => {
      if (!opts.silent) toast.error(errorText(err));
    },
  });
}

/** Maps `VALIDATION_FAILED` issue paths onto react-hook-form fields. */
export function applyServerErrors(
  err: unknown,
  setError: (name: never, e: { message: string }) => void,
): boolean {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_FAILED') return false;
  const issues = (err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
  issues.forEach((i) => setError(i.path as never, { message: i.message }));
  return issues.length > 0;
}
