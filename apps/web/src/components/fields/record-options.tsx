'use client';

import type { FieldDef, RecordFieldOptions } from '@isbp/sdk';
import { Checkbox } from '@isbp/ui/checkbox';
import { ConditionBuilder } from '@isbp/ui/condition-builder';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { factsOfTypes, useRecordTypes } from '@/components/records/record-facts';
import { useFactOptions } from '@/components/workflows/use-fact-label';
import { NavIcon } from '../nav-icon';
import type { FieldIssue } from './field-utils';

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
              <label
                key={x.type}
                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
              >
                <Checkbox
                  checked={record.types.includes(x.type)}
                  onCheckedChange={(c) => toggle(x.type, c === true)}
                />
                <NavIcon name={x.icon ?? undefined} className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{root.has(x.name) ? root(x.name) : x.type}</span>
              </label>
            ))}
            {unknown.map((type) => (
              <label
                key={type}
                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-sm text-muted-foreground"
              >
                <Checkbox checked onCheckedChange={(c) => toggle(type, c === true)} />
                <span className="truncate font-mono text-xs">{type}</span>
              </label>
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

      <label
        htmlFor={`${uid}-multiple`}
        className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
      >
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">{t('multiple')}</span>
          <span className="text-xs text-muted-foreground">{t('multipleHint')}</span>
        </span>
        <Switch
          id={`${uid}-multiple`}
          checked={Boolean(record.multiple)}
          onCheckedChange={(multiple) => set({ multiple })}
        />
      </label>

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
          <ConditionBuilder value={record.where} onChange={(where) => set({ where })} facts={facts} />
        )}
      </div>
    </div>
  );
}
