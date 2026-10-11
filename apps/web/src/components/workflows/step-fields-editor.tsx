'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { Heading, Text } from '@astryxdesign/core/Text';
import {
  type ApprovalStep,
  type FieldDef,
  fieldDefSchema,
  type FieldType,
  localize,
  MAX_STEP_FIELDS,
  type WorkflowStep,
} from '@isbp/sdk';
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
            <Button label={tc('cancel')} variant="secondary" onClick={() => onOpenChange(false)} />
            <Button label={t('saveField')} variant="primary" type="submit" />
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
  bare,
}: {
  step: ApprovalStep;
  onChange: (s: WorkflowStep) => void;
  /** Inside a section that already has the title: only the hint and the button. */
  bare?: boolean;
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
    <VStack gap={3} as="section" aria-labelledby={`${id}-title`}>
      <HStack gap={2} vAlign="start" hAlign="between">
        <VStack gap={0.5} className="min-w-0">
          {bare ? (
            <span id={`${id}-title`} className="sr-only">
              {t('stepFields')}
            </span>
          ) : (
            <Heading level={3} id={`${id}-title`}>
              {t('stepFields')}
            </Heading>
          )}
          <Text type="supporting" color="secondary">
            {t('stepFieldsHint')}
          </Text>
        </VStack>
        {!readOnly && (
          <div className="shrink-0">
            <DropdownMenu
              button={{
                label: t('addField'),
                variant: 'secondary',
                size: 'sm',
                icon: <Icon icon={PlusIcon} />,
                isDisabled: full,
              }}
              hasChevron={false}
              alignment="end"
              items={[
                {
                  type: 'section',
                  title: t('fieldType'),
                  items: FIELD_TYPE_ORDER.map((type) => ({
                    label: tt(`${type}.name`),
                    icon: <ElementTypeIcon type={type} size="sm" />,
                    onClick: () => add(type),
                  })),
                },
              ]}
            />
          </div>
        )}
      </HStack>
      {!fields.length ? (
        <Text
          type="supporting"
          color="secondary"
          as="p"
          className="rounded-lg border border-dashed px-3 py-2.5"
        >
          {t('noStepFields')}
        </Text>
      ) : (
        <List hasDividers density="compact">
          {fields.map((f, i) => (
            <ListItem
              key={f.key}
              label={label(f)}
              startContent={<ElementTypeIcon type={f.type} size="sm" />}
              description={
                <Text type="code" color="secondary" size="xsm" maxLines={1}>
                  steps.{step.id}.{f.key}
                </Text>
              }
              endContent={
                <HStack gap={0.5} vAlign="center">
                  {f.required && <Badge variant="neutral" label={t('requiredField')} />}
                  {!readOnly && (
                    <>
                      <IconButton
                        label={t('moveFieldUp', { label: label(f) })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={ArrowUpIcon} />}
                        isDisabled={i === 0}
                        onClick={() => move(i, -1)}
                      />
                      <IconButton
                        label={t('moveFieldDown', { label: label(f) })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={ArrowDownIcon} />}
                        isDisabled={i === fields.length - 1}
                        onClick={() => move(i, 1)}
                      />
                      <IconButton
                        label={t('editField', { label: label(f) })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={PencilIcon} />}
                        onClick={() => setEditing({ index: i, field: f })}
                      />
                      <IconButton
                        label={t('removeField', { label: label(f) })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={Trash2Icon} />}
                        onClick={() => set(fields.filter((_, j) => j !== i))}
                      />
                    </>
                  )}
                </HStack>
              }
            />
          ))}
        </List>
      )}
      {full && (
        <Text type="supporting" color="secondary">
          {t('fieldsMax', { max: MAX_STEP_FIELDS })}
        </Text>
      )}
      {fields.some((f) => f.required) && (
        <Selector
          label={t('requiredOn')}
          width="100%"
          value={step.fieldsRequiredOn ?? 'approve'}
          options={[
            { value: 'approve', label: t('requiredOnApprove') },
            { value: 'both', label: t('requiredOnBoth') },
          ]}
          onChange={(v) => onChange({ ...step, fieldsRequiredOn: v === 'both' ? 'both' : undefined })}
        />
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
    </VStack>
  );
}
