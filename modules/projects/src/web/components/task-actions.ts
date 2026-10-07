'use client';

import { ApiError } from '@isbp/sdk/web';
import { toast } from '@isbp/ui/sonner';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import type { TaskDetail, TaskStatus, UpdateTaskInput } from '../../contracts';
import { INVALIDATE, taskApi } from '../lib';

/** Error text for task writes: "Blocked by NET-3, NET-5" for blocked starts, else the code's text. */
export function useTaskErrorText() {
  const t = useTranslations('projects.task');
  const errorText = useErrorText();
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === 'INVALID_STATE') {
        const details = err.details as { reason?: string; blockedBy?: { reference: string }[] } | undefined;
        if (details?.reason === 'blocked' && details.blockedBy?.length)
          return t('blockedBy', { refs: details.blockedBy.map((b) => b.reference).join(', ') });
      }
      return errorText(err);
    },
    [t, errorText],
  );
}

/** Board/list/sheet status changes go through the move endpoint (keeps the rank rules in one place). */
export function useMoveTask() {
  const errorText = useTaskErrorText();
  const mutation = useApiMutation(
    (api, vars: { ref: string; status: TaskStatus; before?: string | null; after?: string | null }) =>
      api.post<{ id: string; reference: string; status: TaskStatus; rank: string }>(
        `${taskApi(vars.ref)}/move`,
        {
          status: vars.status,
          before: vars.before ?? null,
          after: vars.after ?? null,
        },
      ),
    { invalidate: INVALIDATE, silent: true },
  );
  const move = useCallback(
    async (vars: { ref: string; status: TaskStatus; before?: string | null; after?: string | null }) => {
      try {
        return await mutation.mutateAsync(vars);
      } catch (err) {
        toast.error(errorText(err));
        throw err;
      }
    },
    [mutation, errorText],
  );
  return { move, isPending: mutation.isPending };
}

/** PATCH a task with a toast on failure; resolves to the updated task or null. */
export function useUpdateTask(ref: string) {
  const errorText = useTaskErrorText();
  const mutation = useApiMutation((api, body: UpdateTaskInput) => api.patch<TaskDetail>(taskApi(ref), body), {
    invalidate: INVALIDATE,
    silent: true,
  });
  const update = useCallback(
    async (body: UpdateTaskInput) => {
      try {
        return await mutation.mutateAsync(body);
      } catch (err) {
        toast.error(errorText(err));
        return null;
      }
    },
    [mutation, errorText],
  );
  return { update, isPending: mutation.isPending };
}
