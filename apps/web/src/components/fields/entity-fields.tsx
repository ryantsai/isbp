'use client';

import type { CustomField } from '@isbp/contracts';
import { defaultFieldValues, type FieldDef, type FormElement, validateFields } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { FormAnswers, FormFields, useFieldErrorText, useFieldsRefinement } from '@isbp/ui/form-renderer';
import { usePeople } from '@isbp/ui/person-picker';
import { Skeleton } from '@isbp/ui/skeleton';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo } from 'react';
import type { FieldErrors, FieldValues, Resolver, UseFormReturn } from 'react-hook-form';
import { useApiQuery } from '@/lib/api';

export type EntityType = 'core.user' | 'core.group' | 'core.department';

const EMPTY: readonly FieldDef[] = [];

/** Active custom fields of an entity type (any signed-in user may read them to render forms). */
export function useEntityFields(entityType: EntityType, enabled = true) {
  const query = useApiQuery<{ items: CustomField[] }>(enabled ? '/custom-fields' : null, { entityType });
  const fields = useMemo(
    () => (query.data ? query.data.items.filter((f) => !f.archived).map((f) => f.field as FieldDef) : EMPTY),
    [query.data],
  );
  const elements = useMemo<FormElement[]>(() => fields.map((f) => ({ ...f, id: f.key })), [fields]);
  return { fields, elements, ready: query.isSuccess, isLoading: query.isLoading };
}

/** Wraps a form resolver so custom-field values under `attributes` are checked by the shared validator. */
export function useAttributesResolver<V extends FieldValues>(
  base: Resolver<V>,
  fields: readonly FieldDef[],
): Resolver<V> {
  const refine = useFieldsRefinement(fields, 'attributes');
  return useCallback<Resolver<V>>(
    async (values, context, options) => {
      const result = await base(values, context, options);
      const issues = refine((values as { attributes?: Record<string, unknown> }).attributes ?? {});
      if (!issues.length) return result;
      const attributes = Object.fromEntries(
        issues.map((i) => [i.path.slice('attributes.'.length), { type: 'custom', message: i.message }]),
      );
      return { values: {}, errors: { ...result.errors, attributes } as FieldErrors<V> };
    },
    [base, refine],
  );
}

/** Cleaned, typed values of the visible custom fields (what the API stores). */
export function attributesPayload(fields: readonly FieldDef[], values: Record<string, unknown> | undefined) {
  return validateFields(fields, values ?? {}).values;
}

/**
 * Fills `attributes` with stored values (or the fields' defaults) once the definitions are known, so the
 * custom-field section works whether the definitions load before or after the form opens.
 */
export function useAttributeDefaults(
  form: UseFormReturn<FieldValues>,
  fields: readonly FieldDef[],
  ready: boolean,
  open: boolean,
  stored: Record<string, unknown> | undefined,
) {
  useEffect(() => {
    if (!open || !ready || !fields.length) return;
    const current = (form.getValues('attributes') ?? {}) as Record<string, unknown>;
    const touched = Object.fromEntries(
      Object.entries(current).filter(
        ([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length),
      ),
    );
    form.setValue('attributes', defaultFieldValues(fields, { ...(stored ?? {}), ...touched }));
  }, [open, ready, fields, stored, form]);
}

/**
 * Maps `VALIDATION_FAILED` issues onto the form: custom-field issues (`attributes.<key>`, message =
 * field error code) are translated; other issues keep the server's message.
 */
export function useApplyEntityErrors() {
  const fieldError = useFieldErrorText();
  return useCallback(
    (err: unknown, setError: (name: never, e: { message: string }) => void): boolean => {
      if (!(err instanceof ApiError) || err.code !== 'VALIDATION_FAILED') return false;
      const issues =
        (
          err.details as
            | { issues?: { path: string; message: string; code?: string; params?: Record<string, number> }[] }
            | undefined
        )?.issues ?? [];
      for (const i of issues) {
        const message =
          i.path.startsWith('attributes.') && i.code
            ? fieldError({ code: i.code as never, params: i.params })
            : i.message;
        setError(i.path as never, { message });
      }
      return issues.length > 0;
    },
    [fieldError],
  );
}

/** "Additional information" inside an entity's create/edit form. */
export function CustomFieldsSection({
  elements,
  form,
  className,
}: {
  elements: readonly FormElement[];
  form: UseFormReturn<FieldValues>;
  className?: string;
}) {
  const t = useTranslations('fields.entity');
  if (!elements.length) return null;
  return (
    <fieldset className={cn('space-y-4', className)}>
      <legend className="mb-3 text-xs font-semibold text-muted-foreground">{t('sectionTitle')}</legend>
      <FormFields elements={elements} form={form} namePrefix="attributes" className="-mb-4" />
    </fieldset>
  );
}

/** Read-only custom-field values on an entity's detail page; hidden when the entity has no custom fields. */
export function CustomFieldsCard({
  entityType,
  attributes,
  className,
  variant = 'card',
}: {
  entityType: EntityType;
  attributes: Record<string, unknown>;
  className?: string;
  /** `section`: a titled block for embedding in another card. */
  variant?: 'card' | 'section';
}) {
  const t = useTranslations('fields.entity');
  const headingId = useId();
  const { fields, elements, isLoading } = useEntityFields(entityType);
  const personIds = useMemo(
    () => fields.filter((f) => f.type === 'user').map((f) => attributes[f.key] as string | undefined),
    [fields, attributes],
  );
  const peopleMap = usePeople(personIds);
  const people = useMemo(
    () => Object.fromEntries([...peopleMap.values()].map((p) => [p.id, p.displayName])),
    [peopleMap],
  );
  if (isLoading)
    return variant === 'section' ? null : <Skeleton className={cn('h-32 w-full rounded-xl', className)} />;
  if (!elements.length) return null;
  const answers = (
    <FormAnswers elements={elements} data={attributes} people={people} emptyText={t('notSet')} />
  );
  if (variant === 'section')
    return (
      <section aria-labelledby={headingId} className={cn('space-y-3', className)}>
        <h3 id={headingId} className="text-sm font-medium">
          {t('cardTitle')}
        </h3>
        {answers}
      </section>
    );
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t('cardTitle')}</CardTitle>
        <CardDescription>{t('cardDescription')}</CardDescription>
      </CardHeader>
      <CardContent>{answers}</CardContent>
    </Card>
  );
}
