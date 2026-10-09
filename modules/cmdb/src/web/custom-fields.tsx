'use client';

import type { CustomField } from '@isbp/contracts';
import {
  defaultFieldValues,
  type FieldDef,
  type FormElement,
  isField,
  validateFields,
  visibleElements,
} from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { FormAnswers, FormFields, useFieldErrorText, useFieldsRefinement } from '@isbp/ui/form-renderer';
import { usePeople } from '@isbp/ui/person-picker';
import { useApiQuery } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo } from 'react';
import type { FieldErrors, FieldValues, Resolver, UseFormReturn } from 'react-hook-form';

/** Custom fields admins defined for CIs (Administration → Custom fields → Configuration item). */
export const CI_ENTITY_TYPE = 'cmdb.ci';

const EMPTY: readonly FieldDef[] = [];

export function useCiFields(enabled = true) {
  const query = useApiQuery<{ items: CustomField[] }>(enabled ? '/custom-fields' : null, {
    entityType: CI_ENTITY_TYPE,
  });
  const fields = useMemo(
    () => (query.data ? query.data.items.filter((f) => !f.archived).map((f) => f.field as FieldDef) : EMPTY),
    [query.data],
  );
  const elements = useMemo<FormElement[]>(() => fields.map((f) => ({ ...f, id: f.key })), [fields]);
  return { fields, elements, ready: query.isSuccess, isLoading: query.isLoading };
}

/** Adds the shared custom-field validator (values under `attributes`) to a form resolver. */
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

/** Values of the visible custom fields, cleaned the way the API stores them. */
export function attributesPayload(fields: readonly FieldDef[], values: Record<string, unknown> | undefined) {
  return validateFields(fields, values ?? {}).values;
}

/** Fills `attributes` with stored values (or field defaults) once the definitions have loaded. */
export function useAttributeDefaults(
  form: UseFormReturn<FieldValues>,
  fields: readonly FieldDef[],
  ready: boolean,
  open: boolean,
  stored: Record<string, unknown> | undefined,
) {
  useEffect(() => {
    if (!open || !ready || !fields.length) return;
    form.setValue('attributes', defaultFieldValues(fields, stored ?? {}));
  }, [open, ready, fields, stored, form]);
}

/** Maps `VALIDATION_FAILED` issues onto the form (custom-field codes are translated). */
export function useApplyServerErrors() {
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

/** "Additional information" inside the CI form. */
export function CustomFieldsSection({
  elements,
  form,
}: {
  elements: readonly FormElement[];
  form: UseFormReturn<FieldValues>;
}) {
  const t = useTranslations('fields.entity');
  if (!elements.length) return null;
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('sectionTitle')}
      </legend>
      <FormFields elements={elements} form={form} namePrefix="attributes" className="-mb-4" />
    </fieldset>
  );
}

/** A stored custom-field value that says something (not empty, not an empty list). */
export function hasAttributeValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Whether any field people can see on this CI has a value. */
export function anyAttributeValue(elements: readonly FormElement[], attributes: Record<string, unknown>) {
  return visibleElements({ elements: [...elements] }, attributes)
    .filter(isField)
    .some((f) => hasAttributeValue(attributes[f.key]));
}

/**
 * Read-only custom-field values. Hidden when admins defined no fields, or when every field is still empty (an empty
 * card of "Not set" rows says nothing; values are added with Edit).
 */
export function CustomFieldsCard({ attributes }: { attributes: Record<string, unknown> }) {
  const t = useTranslations('fields.entity');
  const { fields, elements } = useCiFields();
  const personIds = useMemo(
    () => fields.filter((f) => f.type === 'user').map((f) => attributes[f.key] as string | undefined),
    [fields, attributes],
  );
  const peopleMap = usePeople(personIds);
  const people = useMemo(
    () => Object.fromEntries([...peopleMap.values()].map((p) => [p.id, p.displayName])),
    [peopleMap],
  );
  if (!elements.length || !anyAttributeValue(elements, attributes)) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('cardTitle')}</CardTitle>
        <CardDescription>{t('cardDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FormAnswers elements={elements} data={attributes} people={people} emptyText={t('notSet')} />
      </CardContent>
    </Card>
  );
}
