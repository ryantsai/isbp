'use client';

import type { FieldDef, RecordFieldOptions } from '@isbp/sdk';
import { ConditionBuilder } from '@isbp/ui/condition-builder';
import { Skeleton } from '@isbp/ui/skeleton';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { factsOfTypes, useRecordTypes } from '@/components/records/record-facts';
import { useFactOptions } from '@/components/workflows/use-fact-label';
import { NavIcon } from '../nav-icon';
import type { FieldIssue } from './field-utils';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Switch } from '@astryxdesign/core/Switch';

/**
 * Options of a `record` field: which record types can be picked (those the editor may use), single or several, and
 * an optional filter on the records' facts ("only production CIs").
 */
export function RecordOptionsEditor({
  field,
  onChange,
  issues,
}: {
  field: FieldDef;
  onChange: (record: RecordFieldOptions) => void;
  issues: readonly FieldIssue[];
}) {
  const t = useTranslations('fields.editor.record');
  const ti = useTranslations('fields.issues');
  const root = useTranslations();
  const uid = useId();
  const { types, loading } = useRecordTypes();
  const record: RecordFieldOptions = field.record ?? { types: [] };
  const known = new Set(types.map((x) => x.type));
  const unknown = record.types.filter((x) => !known.has(x));
  const facts = useFactOptions(useMemo(() => factsOfTypes(types, record.types), [types, record.types]));
  const set = (patch: Partial<RecordFieldOptions>) => onChange({ ...record, ...patch });
  const toggle = (type: string, on: boolean) =>
    set({ types: on ? [...record.types, type] : record.types.filter((x) => x !== type) });

  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2" aria-describedby={`${uid}-types-hint ${uid}-types-issues`}>
        <legend className="mb-1 text-sm font-medium">{t('types')}</legend>
        <p id={`${uid}-types-hint`} className="-mt-1 text-xs text-muted-foreground">
          {t('typesHint')}
        </p>
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : !types.length && !unknown.length ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{t('noTypes')}</p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {types.map((x) => (
              <CheckboxInput
                key={x.type}
                label={root.has(x.name) ? root(x.name) : x.type}
                labelIcon={
                  <NavIcon name={x.icon ?? undefined} className="size-4 shrink-0 text-muted-foreground" />
                }
                value={record.types.includes(x.type)}
                onChange={(c) => toggle(x.type, c)}
              />
            ))}
            {unknown.map((type) => (
              <CheckboxInput key={type} label={type} value onChange={(c) => toggle(type, c)} />
            ))}
          </div>
        )}
        <div id={`${uid}-types-issues`}>
          {issues.map((i) => (
            <p key={i.code} className="text-xs font-medium text-destructive">
              {ti(i.code, i.params ?? {})}
            </p>
          ))}
        </div>
      </fieldset>

      <Switch
        label={t('multiple')}
        description={t('multipleHint')}
        labelPosition="start"
        labelSpacing="spread"
        value={Boolean(record.multiple)}
        onChange={(multiple) => set({ multiple })}
      />

      <div className="grid gap-3">
        <div className="grid gap-0.5">
          <p className="text-sm font-medium">{t('where')}</p>
          <p className="text-xs text-muted-foreground">{t('whereHint')}</p>
        </div>
        {!record.types.length ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            {t('chooseTypeFirst')}
          </p>
        ) : !facts.length && !record.where ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{t('noFacts')}</p>
        ) : (
          <ConditionBuilder
            value={record.where}
            onChange={(where) => set({ where })}
            facts={facts}
            emptyText={t('whereEmpty')}
          />
        )}
      </div>
    </div>
  );
}
