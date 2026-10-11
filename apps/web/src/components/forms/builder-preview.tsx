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
import { Card, CardContent, CardDescription, CardHeader } from '@isbp/ui/card';
import { Skeleton } from '@isbp/ui/skeleton';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRightIcon, HourglassIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { ApprovalPath } from '@/components/requests/request-access-view';
import { useErrorText } from '@/lib/api';
import { Banner } from '@astryxdesign/core/Banner';
import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { Item } from '@astryxdesign/core/Item';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';

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
    <VStack gap={4}>
      <Card role="region" aria-labelledby={`${uid}-who`}>
        <CardHeader>
          <Heading level={3} id={`${uid}-who`}>
            {t('whoTitle')}
          </Heading>
          {!loading && (
            <CardDescription>{graph?.steps.length ? t('whoDescription') : t('whoNone')}</CardDescription>
          )}
        </CardHeader>
        {loading ? (
          <CardContent>
            <Skeleton className="h-24 w-full rounded-lg" />
          </CardContent>
        ) : graph?.steps.length ? (
          <CardContent>
            <VStack gap={3}>
              <Field label={t('previewAs')} inputID={`${uid}-as`}>
                <UserPicker
                  id={`${uid}-as`}
                  value={as}
                  onChange={setAs}
                  placeholder={user ? t('previewAsYou', { name: user.displayName }) : undefined}
                />
              </Field>
              <div aria-live="polite" aria-busy={preview.isFetching}>
                {preview.isError ? (
                  <Banner status="error" title={errorText(preview.error)} collapsible={false} />
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
                      <VStack as="ul" gap={1} paddingBlockStart={3}>
                        {preview.data.steps
                          .filter((x) => waiting.has(x.id))
                          .map((x) => (
                            <Item
                              as="li"
                              key={x.id}
                              density="compact"
                              align="start"
                              startContent={<Icon icon={HourglassIcon} color="secondary" />}
                              label={localize(x.name, locale)}
                              description={t('dependsOn', { field: waiting.get(x.id)! })}
                            />
                          ))}
                      </VStack>
                    )}
                  </>
                )}
              </div>
            </VStack>
          </CardContent>
        ) : null}
      </Card>
      <Card role="region" aria-labelledby={`${uid}-next`}>
        <CardHeader>
          <Heading level={3} id={`${uid}-next`}>
            {t('nextTitle')}
          </Heading>
        </CardHeader>
        <CardContent>
          {actions.length ? (
            <VStack as="ul" gap={2}>
              {outcomes.map((on) => {
                const list = actions.filter((a) => a.on === on);
                if (!list.length) return null;
                return (
                  <VStack as="li" key={on} gap={0.5}>
                    <Text type="supporting" weight="medium">
                      {graph?.steps.length || on === 'submitted'
                        ? ta(`outcomes.${on}`)
                        : ta('outcomes.submitted')}
                    </Text>
                    {list.map((a) => (
                      <HStack key={a.id} gap={1.5} vAlign="center">
                        <Icon icon={ArrowRightIcon} size="sm" color="secondary" />
                        <Text>{actionName(a)}</Text>
                        {a.when && <Text type="supporting">{t('nextConditional')}</Text>}
                      </HStack>
                    ))}
                  </VStack>
                );
              })}
            </VStack>
          ) : (
            <Text color="secondary">{t('nextNone')}</Text>
          )}
        </CardContent>
      </Card>
    </VStack>
  );
}
