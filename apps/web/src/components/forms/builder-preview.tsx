'use client';

import type { ApprovalPreview, FormBuilderPreviewInput, ProcessActionType } from '@isbp/contracts';
import {
  type ApproverRule,
  type FormAction,
  type FormSchema,
  formFields,
  localize,
  PROCESS_ACTION_OUTCOMES,
  walkSteps,
  type WorkflowGraph,
} from '@isbp/sdk';
import { usePlatform, useApi } from '@isbp/sdk/web';
import { Label } from '@isbp/ui/label';
import { Skeleton } from '@isbp/ui/skeleton';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRightIcon, HourglassIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { ApprovalPath } from '@/components/requests/request-access-view';
import { useErrorText } from '@/lib/api';

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

/**
 * Approval steps whose approvers all come from answers not given yet ("the owner of the application you pick"):
 * they depend on the answer rather than reject, so the preview says so (step id → the field's label).
 */
function waitingSteps(
  graph: WorkflowGraph | null,
  draft: FormSchema,
  values: Record<string, unknown>,
  locale: string,
) {
  const out = new Map<string, string>();
  const fields = formFields(draft);
  const fieldOf = (rule: ApproverRule) => {
    if (rule.type !== 'fact') return null;
    const [root, key] = rule.fact.split('.');
    return root === 'data' || root === 'records' ? (fields.find((f) => f.key === key) ?? null) : null;
  };
  for (const { step } of walkSteps(graph?.steps ?? [])) {
    if (step.type !== 'approval' || !step.approvers.length) continue;
    const from = step.approvers.map(fieldOf);
    if (from.every((f) => f && isEmpty(values[f.key])))
      out.set(step.id, localize(from[0]!.label, locale) || from[0]!.key);
  }
  return out;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

/**
 * The preview's side panel while building: "Who will approve this?" for the sample answers (the unsaved questions
 * and approval, as a chosen person) and "What happens next" (the form's actions by when they run).
 */
export function BuilderApprovalPreview({
  formId,
  draft,
  graph,
  category,
  values,
  actions,
  actionTypes,
  loading,
}: {
  formId: string;
  draft: FormSchema;
  /** The approval being built; null when the form has none. */
  graph: WorkflowGraph | null;
  category: string | null;
  values: Record<string, unknown>;
  actions: readonly FormAction[];
  actionTypes: readonly ProcessActionType[] | null;
  /** The approval is still loading. */
  loading?: boolean;
}) {
  const t = useTranslations('forms.preview');
  const ta = useTranslations('forms.actions');
  const tr = useTranslations();
  const locale = useLocale();
  const api = useApi();
  const errorText = useErrorText();
  const { user } = usePlatform();
  const uid = useId();
  const [as, setAs] = useState<PickedUser | null>(null);
  // Debounced as text: the draft is rebuilt on every render.
  const input = useDebounced(
    graph?.steps.length
      ? JSON.stringify({
          data: values,
          draft,
          graph,
          category,
          asUserId: as?.id ?? null,
        } satisfies FormBuilderPreviewInput)
      : '',
    500,
  );
  const preview = useQuery({
    queryKey: ['/forms/preview', formId, input],
    queryFn: () => api.post<ApprovalPreview>(`/forms/${formId}/preview`, JSON.parse(input) as unknown),
    enabled: input !== '',
    placeholderData: keepPreviousData,
    retry: false,
  });
  const waiting = waitingSteps(graph, draft, values, locale);
  const actionName = (a: FormAction) => {
    if (a.name && localize(a.name, locale)) return localize(a.name, locale);
    const type = actionTypes?.find((x) => x.type === a.type);
    return type && tr.has(type.name) ? tr(type.name) : a.type;
  };
  // Without an approval, "after approval" actions run when the request is sent (and "after rejection" never).
  const outcomes = graph?.steps.length ? PROCESS_ACTION_OUTCOMES : (['submitted', 'approved'] as const);

  return (
    <div className="grid gap-4">
      <section aria-labelledby={`${uid}-who`} className="grid gap-3 rounded-xl border bg-muted/30 p-4">
        <div className="grid gap-0.5">
          <h3 id={`${uid}-who`} className="text-sm font-semibold">
            {t('whoTitle')}
          </h3>
          {!loading && (
            <p className="text-xs text-muted-foreground">
              {graph?.steps.length ? t('whoDescription') : t('whoNone')}
            </p>
          )}
        </div>
        {loading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : graph?.steps.length ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-as`} className="text-xs font-normal">
                {t('previewAs')}
              </Label>
              <UserPicker
                id={`${uid}-as`}
                value={as}
                onChange={setAs}
                placeholder={user ? t('previewAsYou', { name: user.displayName }) : undefined}
              />
            </div>
            <div aria-live="polite" aria-busy={preview.isFetching}>
              {preview.isError ? (
                <p className="text-sm text-destructive">{errorText(preview.error)}</p>
              ) : (
                <>
                  <ApprovalPath
                    preview={
                      preview.data && {
                        steps: preview.data.steps.filter((x) => !waiting.has(x.id)),
                      }
                    }
                  />
                  {preview.data && waiting.size > 0 && (
                    <ul className="mt-3 grid gap-2">
                      {preview.data.steps
                        .filter((x) => waiting.has(x.id))
                        .map((x) => (
                          <li key={x.id} className="flex gap-3 text-sm">
                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                              <HourglassIcon className="size-4" aria-hidden />
                            </span>
                            <span className="grid pt-1">
                              <span className="font-medium">{localize(x.name, locale)}</span>
                              <span className="text-xs text-muted-foreground">
                                {t('dependsOn', { field: waiting.get(x.id)! })}
                              </span>
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </>
        ) : null}
      </section>
      <section aria-labelledby={`${uid}-next`} className="grid gap-2 rounded-xl border p-4">
        <h3 id={`${uid}-next`} className="text-sm font-semibold">
          {t('nextTitle')}
        </h3>
        {actions.length ? (
          <ul className="grid gap-2 text-sm">
            {outcomes.map((on) => {
              const list = actions.filter((a) => a.on === on);
              if (!list.length) return null;
              return (
                <li key={on} className="grid gap-0.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {graph?.steps.length || on === 'submitted'
                      ? ta(`outcomes.${on}`)
                      : ta('outcomes.submitted')}
                  </span>
                  {list.map((a) => (
                    <span key={a.id} className="flex items-center gap-1.5">
                      <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      {actionName(a)}
                      {a.when && (
                        <span className="text-xs text-muted-foreground">{t('nextConditional')}</span>
                      )}
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('nextNone')}</p>
        )}
      </section>
    </div>
  );
}
