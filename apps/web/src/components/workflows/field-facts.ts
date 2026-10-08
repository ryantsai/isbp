'use client';

import type { CustomField, RecordTypeInfo } from '@isbp/contracts';
import { type FieldDef, localize } from '@isbp/sdk';
import type { FactOption } from '@isbp/ui/condition-builder';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { tableColumnFacts } from '@/components/fields/field-utils';
import { factsOfTypes, useRecordTypes } from '@/components/records/record-facts';
import { useApiQuery } from '@/lib/api';
import { type FactDefLike, useFactOptions } from './use-fact-label';

/** The condition type of a field's value. */
export function fieldType(f: FieldDef): FactOption['type'] {
  switch (f.type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'user':
      return 'id';
    case 'multiselect':
    case 'rows':
      return 'list';
    case 'record':
      return f.record?.multiple ? 'list' : 'string';
    default:
      return 'string';
  }
}

/**
 * Workflow facts of admin-defined fields: `<prefix>.<key>` for each field (`data` for form answers, `attributes` for
 * custom fields), and `records.<key>.<fact>` for the facts of the records picked in `record` fields (from the record
 * types' facts schemas). People-valued facts keep `ref: 'user'`, group keys `ref: 'group'`, for approver rules.
 */
export function useFieldFacts(fields: readonly FieldDef[], prefix: 'data' | 'attributes'): FactOption[] {
  const locale = useLocale();
  const t = useTranslations('workflows.builder');
  const hasRecords = fields.some((f) => f.type === 'record');
  const { types } = useRecordTypes({ enabled: hasRecords, all: true });
  const recordDefs = useMemo(() => recordFactDefs(fields, types), [fields, types]);
  const recordOptions = useFactOptions(recordDefs);
  return useMemo(() => {
    const labelOf = (f: FieldDef) => localize(f.label, locale) || f.key;
    // A table's columns too (`data.<table>.<column>`: any row matches).
    const own = fields
      .flatMap((f) => [f, ...tableColumnFacts(f, locale)])
      .map((f) => ({
        path: `${prefix}.${f.key}`,
        label: labelOf(f),
        type: fieldType(f),
        ...(f.type === 'user' ? { ref: 'user' as const } : {}),
        options: f.options?.map((o) => ({ value: o.value, label: localize(o.label, locale) || o.value })),
      }));
    const records = recordOptions.map((o, i) => {
      const def = recordDefs[i]!;
      const field = fields.find((f) => f.key === def.field)!;
      return { ...o, label: t('recordFact', { field: labelOf(field), fact: o.label }) };
    });
    return [...own, ...records];
  }, [fields, prefix, locale, recordOptions, recordDefs, t]);
}

function recordFactDefs(
  fields: readonly FieldDef[],
  types: readonly RecordTypeInfo[],
): (FactDefLike & { field: string })[] {
  return fields
    .filter((f) => f.type === 'record')
    .flatMap((f) =>
      factsOfTypes(types, f.record?.types ?? []).map((fact) => ({
        ...fact,
        field: f.key,
        path: `records.${f.key}.${fact.path}`,
      })),
    );
}

/**
 * Facts of an entity's custom fields for triggers with `customFieldEntity` (`attributes.<key>`,
 * `records.<key>.<fact>`), from the active custom field definitions.
 */
export function useCustomFieldFacts(entityType: string | null | undefined) {
  const { data } = useApiQuery<{ items: CustomField[] }>(entityType ? '/custom-fields' : null, {
    entityType: entityType ?? '',
  });
  const fields = useMemo(() => (data?.items ?? []).map((c) => c.field as FieldDef), [data]);
  return useFieldFacts(fields, 'attributes');
}
