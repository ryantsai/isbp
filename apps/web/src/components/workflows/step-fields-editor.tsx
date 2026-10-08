'use client';

import {
  type ApprovalStep,
  type FieldDef,
  fieldDefSchema,
  type FieldType,
  localize,
  MAX_STEP_FIELDS,
  type WorkflowStep,
} from '@isbp/sdk';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { FieldEditor } from '../fields/field-editor';
import { ElementTypeIcon, FIELD_TYPE_ORDER } from '../fields/field-types';
import { cleanField, type EditableElement, elementIssues, uniqueName } from '../fields/field-utils';
import { useBuilder } from './builder-context';

/** The sheet that adds or edits one step field, with the form builder's field editor. */
function StepFieldSheet({
  field,
  siblings,
  open,
  onOpenChange,
  onSave,
}: {
  field: FieldDef;
  siblings: readonly FieldDef[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (field: FieldDef) => void;
}) {
  const t = useTranslations('workflows.builder.editor');
  const tc = useTranslations('common');
  const [draft, setDraft] = useState<FieldDef>(field);
  const [attempted, setAttempted] = useState(false);
  const issues = useMemo(() => elementIssues(draft, siblings), [draft, siblings]);
  const save = () => {
    setAttempted(true);
    const clean = cleanField(draft);
    if (issues.length || !fieldDefSchema.safeParse(clean).success) return;
    onSave(clean);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{t('fieldSheetTitle')}</SheetTitle>
          <SheetDescription>{t('fieldSheetDescription')}</SheetDescription>
        </SheetHeader>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <SheetBody className="pb-6">
            <FieldEditor
              value={draft}
              onChange={(next: EditableElement) => setDraft(next as FieldDef)}
              siblings={siblings}
              issues={attempted ? issues : issues.filter((i) => i.code === 'keyDuplicate')}
            />
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit">{t('saveField')}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * "Fields the approver fills in": the step's `fields`, edited with the form builder's field editor. Approvers fill
 * them in with their decision; later steps read them as `steps.<stepId>.<key>`.
 */
export function StepFieldsEditor({
  step,
  onChange,
}: {
  step: ApprovalStep;
  onChange: (s: WorkflowStep) => void;
}) {
  const t = useTranslations('workflows.builder.editor');
  const tt = useTranslations('fields.types');
  const tf = useTranslations('fields.editor');
  const locale = useLocale();
  const id = useId();
  const { readOnly } = useBuilder();
  const fields = useMemo(() => step.fields ?? [], [step.fields]);
  const [editing, setEditing] = useState<{ index: number | null; field: FieldDef } | null>(null);
  const set = (next: FieldDef[]) =>
    onChange({
      ...step,
      fields: next.length ? next : undefined,
      fieldsRequiredOn: next.some((f) => f.required) ? step.fieldsRequiredOn : undefined,
    });
  const add = (type: FieldType) => {
    const key = uniqueName(type, new Set(fields.map((f) => f.key)));
    const base: FieldDef = { key, type, label: {} };
    const field: FieldDef =
      type === 'select' || type === 'multiselect'
        ? {
            ...base,
            options: [1, 2].map((n) => ({ value: `option${n}`, label: { [locale]: tf('optionN', { n }) } })),
          }
        : type === 'record'
          ? { ...base, record: { types: [] } }
          : base;
    setEditing({ index: null, field });
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...fields];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    set(next);
  };
  const label = (f: FieldDef) => localize(f.label, locale) || f.key;
  const full = fields.length >= MAX_STEP_FIELDS;

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            {t('stepFields')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('stepFieldsHint')}</p>
        </div>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={full}>
                <PlusIcon />
                {t('addField')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{t('fieldType')}</DropdownMenuLabel>
              {FIELD_TYPE_ORDER.map((type) => (
                <DropdownMenuItem key={type} onSelect={() => add(type)}>
                  <ElementTypeIcon type={type} size="sm" />
                  {tt(`${type}.name`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {!fields.length ? (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          {t('noStepFields')}
        </p>
      ) : (
        <ol className="grid gap-1.5">
          {fields.map((f, i) => (
            <li
              key={f.key}
              className="flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2 py-1.5"
            >
              <ElementTypeIcon type={f.type} size="sm" />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-sm">{label(f)}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  steps.{step.id}.{f.key}
                </span>
              </span>
              {f.required && (
                <Badge variant="muted" className="shrink-0 font-normal">
                  {t('requiredField')}
                </Badge>
              )}
              {!readOnly && (
                <span className="flex shrink-0">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={t('moveFieldUp', { label: label(f) })}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={t('moveFieldDown', { label: label(f) })}
                    disabled={i === fields.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={t('editField', { label: label(f) })}
                    onClick={() => setEditing({ index: i, field: f })}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={t('removeField', { label: label(f) })}
                    onClick={() => set(fields.filter((_, j) => j !== i))}
                  >
                    <Trash2Icon />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {full && <p className="text-xs text-muted-foreground">{t('fieldsMax', { max: MAX_STEP_FIELDS })}</p>}
      {fields.some((f) => f.required) && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-required-on`} className="text-xs font-normal">
            {t('requiredOn')}
          </Label>
          <Select
            value={step.fieldsRequiredOn ?? 'approve'}
            onValueChange={(v) => onChange({ ...step, fieldsRequiredOn: v === 'both' ? 'both' : undefined })}
          >
            <SelectTrigger id={`${id}-required-on`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="approve">{t('requiredOnApprove')}</SelectItem>
              <SelectItem value="both">{t('requiredOnBoth')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {editing && (
        <StepFieldSheet
          key={editing.index ?? 'new'}
          field={editing.field}
          siblings={fields.filter((_, j) => j !== editing.index)}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          onSave={(field) => {
            set(
              editing.index === null
                ? [...fields, field]
                : fields.map((x, j) => (j === editing.index ? field : x)),
            );
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
