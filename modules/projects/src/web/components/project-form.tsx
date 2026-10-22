'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, StackItem } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ApiError, usePlatform } from '@isbp/sdk/web';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { memo, useId, useState } from 'react';
import {
  type CreateProjectInput,
  PROJECT_KEY_RE,
  PROJECT_PRIORITIES,
  type ProjectDetail,
  type ProjectPriority,
  suggestProjectKey,
  VISIBILITIES,
  type Visibility,
} from '../../contracts';
import { INVALIDATE } from '../lib';
import { MarkdownEditor, NONE, toIsoDate } from './inputs';

type Errors = Partial<Record<'name' | 'key' | 'ownerId' | 'targetDate' | 'budgetHours' | 'root', string>>;

const error = (message: string | undefined) => (message ? ({ type: 'error', message } as const) : undefined);

/**
 * Project details: create (portfolio "New project") or edit (Settings). The key is suggested from the
 * name until you type your own, and can't change once the project has tasks.
 */
export function ProjectForm({
  project,
  onCancel,
  onSaved,
}: {
  project?: ProjectDetail;
  onCancel?: () => void;
  onSaved: (project: ProjectDetail) => void;
}) {
  const t = useTranslations('projects.form');
  const tf = useTranslations('projects.fields');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const { user } = usePlatform();
  const [name, setName] = useState(project?.name ?? '');
  const [key, setKey] = useState(project?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(Boolean(project));
  const [owner, setOwner] = useState<PersonOption | null>(
    project?.owner ?? { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl },
  );
  const [startDate, setStartDate] = useState(project?.startDate ?? '');
  const [targetDate, setTargetDate] = useState(project?.targetDate ?? '');
  const [budget, setBudget] = useState<number | null>(project?.budgetHours ?? null);
  const [visibility, setVisibility] = useState<Visibility>(project?.visibility ?? 'internal');
  const [priority, setPriority] = useState<ProjectPriority>(project?.priority ?? 'medium');
  const [departmentId, setDepartmentId] = useState<string>(project?.department?.id ?? NONE);
  const [description, setDescription] = useState(project?.description ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const keyLocked = Boolean(project && project.totalTasks + project.taskCounts.cancelled > 0);

  const save = useApiMutation(
    (api, body: CreateProjectInput) =>
      project
        ? api.patch<ProjectDetail>(`/projects/projects/${project.key}`, body)
        : api.post<ProjectDetail>('/projects/projects', body),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: (p) => (project ? tc('saved') : t('created', { key: p.key })),
      onSuccess: onSaved,
    },
  );

  const submit = async () => {
    const next: Errors = {};
    const k = key.trim().toUpperCase();
    if (!name.trim()) next.name = t('nameRequired');
    if (!PROJECT_KEY_RE.test(k)) next.key = t('keyInvalid');
    if (!owner) next.ownerId = t('ownerRequired');
    if (startDate && targetDate && targetDate < startDate) next.targetDate = t('datesInvalid');
    if (budget !== null && (!Number.isInteger(budget) || budget < 0)) next.budgetHours = t('budgetInvalid');
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      await save.mutateAsync({
        name: name.trim(),
        key: k,
        ownerId: owner!.id,
        startDate: startDate || null,
        targetDate: targetDate || null,
        budgetHours: budget,
        visibility,
        priority,
        departmentId: departmentId === NONE ? null : departmentId,
        description: description.trim() || null,
      });
    } catch (err) {
      const issues =
        err instanceof ApiError
          ? ((err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [])
          : [];
      const mapped: Errors = {};
      for (const i of issues)
        if (['name', 'key', 'ownerId', 'targetDate', 'budgetHours'].includes(i.path))
          mapped[i.path as keyof Errors] =
            i.path === 'key' && err instanceof ApiError && err.code === 'CONFLICT'
              ? t('keyTaken')
              : i.message;
      if (!Object.keys(mapped).length) mapped.root = errorText(err);
      setErrors(mapped);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormLayout defaultOptionality="optional">
        <HStack gap={4} wrap="wrap" vAlign="end">
          <StackItem size="fill" className="min-w-60">
            <TextInput
              label={tf('name')}
              isRequired
              hasAutoFocus={!project}
              value={name}
              placeholder={t('namePlaceholder')}
              status={error(errors.name)}
              onChange={(v) => {
                const next = v.slice(0, 200);
                setName(next);
                if (!keyTouched) setKey(suggestProjectKey(next));
              }}
            />
          </StackItem>
          <TextInput
            label={tf('key')}
            isRequired
            width={160}
            value={key}
            isDisabled={keyLocked}
            description={keyLocked ? t('keyLocked') : t('keyHint')}
            status={error(errors.key)}
            onChange={(v) => {
              setKeyTouched(true);
              setKey(
                v
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, 10),
              );
            }}
          />
        </HStack>
        <PlanFields
          owner={owner}
          startDate={startDate}
          targetDate={targetDate}
          visibility={visibility}
          priority={priority}
          ownerError={errors.ownerId}
          targetDateError={errors.targetDate}
          onOwner={setOwner}
          onStartDate={setStartDate}
          onTargetDate={setTargetDate}
          onVisibility={setVisibility}
          onPriority={setPriority}
        />
        <MoreFields
          departmentId={departmentId}
          budget={budget}
          description={description}
          budgetError={errors.budgetHours}
          onDepartment={setDepartmentId}
          onBudget={setBudget}
          onDescription={setDescription}
        />
        {errors.root && <Banner status="error" title={errors.root} collapsible={false} />}
        <HStack gap={2} hAlign="end" wrap="wrap">
          {onCancel && <Button label={tc('cancel')} variant="secondary" onClick={onCancel} />}
          <Button
            label={project ? tc('saveChanges') : t('submit')}
            variant="primary"
            isLoading={save.isPending}
            type="submit"
          />
        </HStack>
      </FormLayout>
    </form>
  );
}

/**
 * Owner, dates, visibility and priority. Memoized with {@link MoreFields}: typing the name or key re-renders only those
 * two inputs, not every selector and date input of the form.
 */
const PlanFields = memo(function PlanFields({
  owner,
  startDate,
  targetDate,
  visibility,
  priority,
  ownerError,
  targetDateError,
  onOwner,
  onStartDate,
  onTargetDate,
  onVisibility,
  onPriority,
}: {
  owner: PersonOption | null;
  startDate: string;
  targetDate: string;
  visibility: Visibility;
  priority: ProjectPriority;
  ownerError?: string;
  targetDateError?: string;
  onOwner: (owner: PersonOption | null) => void;
  onStartDate: (date: string) => void;
  onTargetDate: (date: string) => void;
  onVisibility: (visibility: Visibility) => void;
  onPriority: (priority: ProjectPriority) => void;
}) {
  const t = useTranslations('projects.form');
  const tf = useTranslations('projects.fields');
  const tv = useTranslations('projects.visibility');
  const tp = useTranslations('projects.projectPriority');
  const id = useId();
  return (
    <>
      <Field
        label={tf('owner')}
        inputID={`${id}-owner`}
        isRequired
        description={t('ownerHint')}
        status={error(ownerError)}
        descriptionID={`${id}-owner-hint`}
      >
        <PersonPicker
          id={`${id}-owner`}
          value={owner}
          invalid={Boolean(ownerError)}
          aria-describedby={`${id}-owner-hint`}
          onChange={onOwner}
        />
      </Field>
      <Grid columns={{ minWidth: 220 }} gap={4}>
        <DateInput
          label={tf('startDate')}
          hasClear
          value={toIsoDate(startDate)}
          onChange={(v) => onStartDate(v ?? '')}
        />
        <DateInput
          label={tf('targetDate')}
          hasClear
          value={toIsoDate(targetDate)}
          status={error(targetDateError)}
          onChange={(v) => onTargetDate(v ?? '')}
        />
        <Selector
          label={tf('visibility')}
          value={visibility}
          description={tv(`${visibility}Hint`)}
          onChange={(v) => onVisibility(v as Visibility)}
          options={VISIBILITIES.map((v) => ({ value: v, label: tv(v) }))}
        />
        <Selector
          label={tf('priority')}
          value={priority}
          onChange={(v) => onPriority(v as ProjectPriority)}
          options={PROJECT_PRIORITIES.map((p) => ({ value: p, label: tp(p) }))}
        />
      </Grid>
    </>
  );
});

/** Department, budget and description, folded (see {@link PlanFields}). */
const MoreFields = memo(function MoreFields({
  departmentId,
  budget,
  description,
  budgetError,
  onDepartment,
  onBudget,
  onDescription,
}: {
  departmentId: string;
  budget: number | null;
  description: string;
  budgetError?: string;
  onDepartment: (id: string) => void;
  onBudget: (budget: number | null) => void;
  onDescription: (description: string) => void;
}) {
  const t = useTranslations('projects.form');
  const tf = useTranslations('projects.fields');
  const list = useFieldList();
  const departments = useApiQuery<{ items: { id: string; name: string; hint: string }[] }>(
    '/projects/lookups/departments',
  );
  return (
    <OptionalFields
      hint={list([tf('department'), tf('budgetHours'), tf('description')])}
      filled={countFilled(
        departmentId === NONE ? '' : departmentId,
        budget === null ? '' : String(budget),
        description,
      )}
      contentClassName="grid gap-4 pt-3 sm:grid-cols-2"
    >
      <Selector
        label={tf('department')}
        value={departmentId}
        hasSearch
        onChange={onDepartment}
        options={[
          { value: NONE, label: t('noDepartment') },
          ...(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })),
        ]}
      />
      <NumberInput
        label={tf('budgetHours')}
        hasClear
        min={0}
        step={1}
        isIntegerOnly
        value={budget}
        description={t('budgetHint')}
        status={error(budgetError)}
        onChange={onBudget}
      />
      <div className="sm:col-span-2">
        <MarkdownEditor
          value={description}
          onChange={onDescription}
          label={tf('description')}
          isLabelHidden={false}
          rows={5}
        />
      </div>
    </OptionalFields>
  );
});

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: ProjectDetail) => void;
}) {
  const t = useTranslations('projects.form');
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={672} purpose="form">
      <Layout
        header={
          <DialogHeader title={t('createTitle')} subtitle={t('createHint')} onOpenChange={onOpenChange} />
        }
        content={
          <LayoutContent padding={4}>
            {open && (
              <ProjectForm
                onCancel={() => onOpenChange(false)}
                onSaved={(p) => {
                  onOpenChange(false);
                  onCreated(p);
                }}
              />
            )}
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
