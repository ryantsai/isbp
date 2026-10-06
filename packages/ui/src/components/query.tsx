'use client';

/** Data hooks shared by core pages and module pages (same DX for built-in and custom modules). */

import { type ApiClient, ApiError, type Query, useApi } from '@isbp/sdk/web';
import { toast } from './sonner';
import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/** Translates API error codes; falls back to the server's English message. */
export function useErrorText() {
  const t = useTranslations('errors');
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) return t.has(err.code) ? t(err.code) : err.message;
      return t('generic');
    },
    [t],
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
    queryFn: () => api.get<T>(path!, query),
    enabled: path !== null && (opts.enabled ?? true),
    placeholderData: keepPreviousData,
    refetchInterval: opts.refetchInterval,
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
