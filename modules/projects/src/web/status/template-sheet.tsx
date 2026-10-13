'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Divider } from '@astryxdesign/core/Divider';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { LocalizedText } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { OptionalFields } from '@isbp/ui/optional-fields';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useId, useState } from 'react';
import {
  MAX_REPORT_SECTIONS,
  PROJECT_DETAILS,
  REPORT_SECTION_TYPES,
  REPORT_STATES,
  REPORT_TEMPLATE_KEY_RE,
  type ReportSection,
  type ReportSectionType,
  type ReportTemplate,
  type ReportTemplateInput,
} from '../../contracts';
import { INVALIDATE } from '../lib';
import { useSectionHeading } from './report-sections';

/** A new section of a type, with the options it needs. */
function newSection(type: ReportSectionType, taken: readonly string[]): ReportSection {
  let n = 1;
  while (taken.includes(n === 1 ? type : `${type}-${n}`)) n++;
  const id = n === 1 ? type : `${type}-${n}`;
  if (type === 'projects') return { id, type, states: ['delayed', 'at_risk'], detail: 'brief' };
  if (type === 'milestones') return { id, type, days: 14 };
  return { id, type } as ReportSection;
}

const hasText = (v: LocalizedText | null | undefined) =>
  Boolean(v && Object.values(v).some((x) => x?.trim()));

/** New or edit a status report template: name, description and the ordered sections. */
export function TemplateSheet({
  open,
  onOpenChange,
  template,
  copyOf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template to edit; null for a new one. */
  template: ReportTemplate | null;
  /** Start a new template from this one ("Copy"). */
  copyOf?: ReportTemplate | null;
}) {
  const t = useTranslations('projects.templates');
  const tc = useTranslations('common');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{template ? t('editTitle') : t('newTitle')}</SheetTitle>
          <SheetDescription>{t('formHint')}</SheetDescription>
        </SheetHeader>
        {open && (
          <TemplateForm template={template} copyOf={copyOf ?? null} onDone={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SectionEditor({
  section,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  section: ReportSection;
  index: number;
  count: number;
  onChange: (s: ReportSection) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('projects.templates');
  const tt = useTranslations('projects.report.sections');
  const ts = useTranslations('projects.reportState');
  const heading = useSectionHeading();
  const titleId = useId();
  const statesId = useId();
  const name = heading(section);
  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text weight="medium">{t('sectionN', { n: index + 1, type: tt(section.type) })}</Text>
        <span className="grow" />
        <IconButton
          label={t('moveUp', { name })}
          icon={<Icon icon={ArrowUpIcon} />}
          variant="ghost"
          size="sm"
          isDisabled={index === 0}
          onClick={() => onMove(-1)}
        />
        <IconButton
          label={t('moveDown', { name })}
          icon={<Icon icon={ArrowDownIcon} />}
          variant="ghost"
          size="sm"
          isDisabled={index === count - 1}
          onClick={() => onMove(1)}
        />
        <IconButton
          label={t('remove', { name })}
          icon={<Icon icon={Trash2Icon} />}
          variant="ghost"
          size="sm"
          isDisabled={count === 1}
          onClick={onRemove}
        />
      </HStack>
      <Text type="supporting">{t(`about.${section.type}`)}</Text>
      {section.type === 'projects' && (
        <>
          <VStack gap={1}>
            <Text type="label" id={statesId}>
              {t('states')}
            </Text>
            <HStack gap={3} wrap="wrap" role="group" aria-labelledby={statesId}>
              {REPORT_STATES.map((st) => (
                <CheckboxInput
                  key={st}
                  label={ts(st)}
                  value={section.states.includes(st)}
                  onChange={(checked) => {
                    const states = checked
                      ? REPORT_STATES.filter((x) => x === st || section.states.includes(x))
                      : section.states.filter((x) => x !== st);
                    if (states.length) onChange({ ...section, states });
                  }}
                />
              ))}
            </HStack>
          </VStack>
          <Selector
            label={t('detail')}
            width={280}
            value={section.detail}
            onChange={(v) => onChange({ ...section, detail: v as (typeof PROJECT_DETAILS)[number] })}
            options={PROJECT_DETAILS.map((d) => ({ value: d, label: t(`details.${d}`) }))}
          />
        </>
      )}
      {section.type === 'milestones' && (
        <NumberInput
          label={t('days')}
          min={7}
          max={90}
          isIntegerOnly
          width={160}
          value={section.days}
          onChange={(v) => onChange({ ...section, days: Math.min(90, Math.max(7, v ?? 14)) })}
        />
      )}
      {section.type === 'summary' && (
        <TextArea
          label={t('instructions')}
          isOptional
          rows={2}
          maxLength={1000}
          description={t('instructionsHint')}
          value={section.instructions ?? ''}
          onChange={(v) => onChange({ ...section, instructions: v || null })}
        />
      )}
      <OptionalFields label={t('ownHeading')} filled={hasText(section.title) ? 1 : 0}>
        <Field label={t('heading')} inputID={titleId} isOptional description={t('headingHint')}>
          <LocalizedInput
            id={titleId}
            value={section.title ?? null}
            onChange={(v) => onChange({ ...section, title: hasText(v) ? v : null })}
          />
        </Field>
      </OptionalFields>
    </VStack>
  );
}

function TemplateForm({
  template,
  copyOf,
  onDone,
}: {
  template: ReportTemplate | null;
  copyOf: ReportTemplate | null;
  onDone: () => void;
}) {
  const t = useTranslations('projects.templates');
  const tt = useTranslations('projects.report.sections');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const ids = { name: useId(), description: useId() };
  const source = template ?? copyOf;
  const [key, setKey] = useState(template?.key ?? (copyOf ? `${copyOf.key}-copy`.slice(0, 40) : ''));
  const [name, setName] = useState<LocalizedText>(source?.name ?? {});
  const [description, setDescription] = useState<LocalizedText>(source?.description ?? {});
  const [sections, setSections] = useState<ReportSection[]>(
    (source?.sections as ReportSection[] | undefined) ?? [
      newSection('summary', []),
      newSection('counts', []),
    ],
  );
  const [adding, setAdding] = useState<ReportSectionType>('projects');
  const [errors, setErrors] = useState<{ key?: string; name?: string; root?: string }>({});

  const save = useApiMutation(
    (api, body: ReportTemplateInput) =>
      template
        ? api.put<ReportTemplate>(`/projects/report-templates/${template.id}`, body)
        : api.post<ReportTemplate>('/projects/report-templates', body),
    {
      invalidate: INVALIDATE,
      success: template ? t('saved') : t('created'),
      onSuccess: onDone,
      silent: true,
    },
  );

  const submit = async () => {
    const next: typeof errors = {};
    if (!REPORT_TEMPLATE_KEY_RE.test(key)) next.key = t('keyInvalid');
    if (!hasText(name)) next.name = t('nameRequired');
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      await save.mutateAsync({
        key,
        name,
        description: hasText(description) ? description : null,
        sections,
        sortOrder: template?.sortOrder,
      });
    } catch (err) {
      const issues =
        err instanceof ApiError
          ? ((err.details as { issues?: { path: string; message: string; code?: string }[] } | undefined)
              ?.issues ?? [])
          : [];
      const keyIssue = issues.find((i) => i.path === 'key');
      if (keyIssue) setErrors({ key: keyIssue.code === 'duplicate' ? t('keyTaken') : keyIssue.message });
      else setErrors({ root: errorText(err) });
    }
  };

  const update = (i: number, s: ReportSection) =>
    setSections((list) => list.map((x, j) => (j === i ? s : x)));
  const move = (i: number, by: -1 | 1) =>
    setSections((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item!);
      return next;
    });

  return (
    <SheetForm
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <SheetBody className="py-2">
        <FormLayout defaultOptionality="required">
          <TextInput
            label={t('key')}
            description={t('keyHint')}
            value={key}
            isDisabled={Boolean(template)}
            hasAutoFocus={!template}
            status={errors.key ? { type: 'error', message: errors.key } : undefined}
            onChange={(v) =>
              setKey(
                v
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, '')
                  .slice(0, 40),
              )
            }
          />
          <Field
            label={t('name')}
            inputID={ids.name}
            status={errors.name ? { type: 'error', message: errors.name } : undefined}
          >
            <LocalizedInput id={ids.name} value={name} onChange={setName} invalid={Boolean(errors.name)} />
          </Field>
          <Field label={t('templateDescription')} inputID={ids.description} isOptional>
            <LocalizedInput id={ids.description} multiline value={description} onChange={setDescription} />
          </Field>
          <VStack gap={3}>
            <Text type="label">{t('sections')}</Text>
            {sections.map((s, i) => (
              <Fragment key={s.id}>
                {i > 0 && <Divider />}
                <SectionEditor
                  section={s}
                  index={i}
                  count={sections.length}
                  onChange={(next) => update(i, next)}
                  onMove={(by) => move(i, by)}
                  onRemove={() => setSections((list) => list.filter((_, j) => j !== i))}
                />
              </Fragment>
            ))}
            <Divider />
            <HStack gap={2} vAlign="end" wrap="wrap">
              <Selector
                label={t('addSection')}
                width={260}
                value={adding}
                onChange={(v) => setAdding(v as ReportSectionType)}
                options={REPORT_SECTION_TYPES.map((type) => ({ value: type, label: tt(type) }))}
              />
              <Button
                label={t('add')}
                variant="secondary"
                icon={<Icon icon={PlusIcon} />}
                isDisabled={sections.length >= MAX_REPORT_SECTIONS}
                onClick={() =>
                  setSections((list) => [
                    ...list,
                    newSection(
                      adding,
                      list.map((x) => x.id),
                    ),
                  ])
                }
              />
            </HStack>
          </VStack>
          {errors.root && <Banner status="error" title={errors.root} collapsible={false} />}
        </FormLayout>
      </SheetBody>
      <SheetFooter>
        <Button label={tc('cancel')} variant="secondary" type="button" onClick={onDone} />
        <Button
          label={template ? tc('saveChanges') : tc('create')}
          variant="primary"
          isLoading={save.isPending}
          type="submit"
        />
      </SheetFooter>
    </SheetForm>
  );
}
