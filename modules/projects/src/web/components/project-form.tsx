'use client';

import { ApiError, usePlatform } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@isbp/ui/dialog';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
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
import { MarkdownEditor, NONE } from './inputs';

type Errors = Partial<Record<'name' | 'key' | 'ownerId' | 'targetDate' | 'budgetHours' | 'root', string>>;

function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `grid min-w-0 gap-2 ${className}` : 'grid min-w-0 gap-2'}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

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
  const tv = useTranslations('projects.visibility');
  const tp = useTranslations('projects.projectPriority');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const { user } = usePlatform();
  const id = useId();
  const list = useFieldList();
  const departments = useApiQuery<{ items: { id: string; name: string; hint: string }[] }>(
    '/projects/lookups/departments',
  );
  const [name, setName] = useState(project?.name ?? '');
  const [key, setKey] = useState(project?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(Boolean(project));
  const [owner, setOwner] = useState<PersonOption | null>(
    project?.owner ?? { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl },
  );
  const [startDate, setStartDate] = useState(project?.startDate ?? '');
  const [targetDate, setTargetDate] = useState(project?.targetDate ?? '');
  const [budget, setBudget] = useState(
    project?.budgetHours === null || !project ? '' : String(project.budgetHours),
  );
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
    if (budget && (!Number.isInteger(Number(budget)) || Number(budget) < 0))
      next.budgetHours = t('budgetInvalid');
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      await save.mutateAsync({
        name: name.trim(),
        key: k,
        ownerId: owner!.id,
        startDate: startDate || null,
        targetDate: targetDate || null,
        budgetHours: budget ? Number(budget) : null,
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

  const describedBy = (field: keyof Errors, hint?: boolean) =>
    errors[field] ? `${id}-${field}-error` : hint ? `${id}-${field}-hint` : undefined;

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field id={`${id}-name`} label={tf('name')} error={errors.name}>
          <Input
            id={`${id}-name`}
            autoFocus={!project}
            value={name}
            maxLength={200}
            aria-invalid={Boolean(errors.name) || undefined}
            aria-describedby={describedBy('name')}
            placeholder={t('namePlaceholder')}
            onChange={(e) => {
              setName(e.target.value);
              if (!keyTouched) setKey(suggestProjectKey(e.target.value));
            }}
          />
        </Field>
        <Field
          id={`${id}-key`}
          label={tf('key')}
          error={errors.key}
          hint={keyLocked ? t('keyLocked') : t('keyHint')}
        >
          <Input
            id={`${id}-key`}
            value={key}
            maxLength={10}
            disabled={keyLocked}
            className="font-mono uppercase"
            aria-invalid={Boolean(errors.key) || undefined}
            aria-describedby={describedBy('key', true)}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
            }}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-owner`} label={tf('owner')} error={errors.ownerId} hint={t('ownerHint')}>
          <PersonPicker
            id={`${id}-owner`}
            value={owner}
            invalid={Boolean(errors.ownerId)}
            aria-describedby={describedBy('ownerId', true)}
            onChange={setOwner}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-start`} label={tf('startDate')}>
          <Input
            id={`${id}-start`}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field id={`${id}-target`} label={tf('targetDate')} error={errors.targetDate}>
          <Input
            id={`${id}-target`}
            type="date"
            value={targetDate}
            aria-invalid={Boolean(errors.targetDate) || undefined}
            aria-describedby={describedBy('targetDate')}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-visibility`} label={tf('visibility')} hint={tv(`${visibility}Hint`)}>
          <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
            <SelectTrigger
              id={`${id}-visibility`}
              className="w-full"
              aria-describedby={`${id}-visibility-hint`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISIBILITIES.map((v) => (
                <SelectItem key={v} value={v}>
                  {tv(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id={`${id}-priority`} label={tf('priority')}>
          <Select value={priority} onValueChange={(v) => setPriority(v as ProjectPriority)}>
            <SelectTrigger id={`${id}-priority`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {tp(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <OptionalFields
        hint={list([tf('department'), tf('budgetHours'), tf('description')])}
        filled={countFilled(departmentId === NONE ? '' : departmentId, budget, description)}
        contentClassName="grid gap-4 pt-3 sm:grid-cols-2"
      >
        <Field id={`${id}-department`} label={tf('department')}>
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger id={`${id}-department`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>
                <span className="text-muted-foreground">{t('noDepartment')}</span>
              </SelectItem>
              {(departments.data?.items ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          id={`${id}-budget`}
          label={tf('budgetHours')}
          error={errors.budgetHours}
          hint={t('budgetHint')}
        >
          <Input
            id={`${id}-budget`}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={budget}
            aria-invalid={Boolean(errors.budgetHours) || undefined}
            aria-describedby={describedBy('budgetHours', true)}
            onChange={(e) => setBudget(e.target.value)}
          />
        </Field>
        <div className="grid gap-2 sm:col-span-2">
          <span className="text-sm font-medium">{tf('description')}</span>
          <MarkdownEditor value={description} onChange={setDescription} label={tf('description')} rows={5} />
        </div>
      </OptionalFields>
      {errors.root && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.root}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {tc('cancel')}
          </Button>
        )}
        <Button type="submit" loading={save.isPending}>
          {project ? tc('saveChanges') : t('submit')}
        </Button>
      </div>
    </form>
  );
}

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
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
          <DialogDescription>{t('createHint')}</DialogDescription>
        </DialogHeader>
        {open && (
          <ProjectForm
            onCancel={() => onOpenChange(false)}
            onSaved={(p) => {
              onOpenChange(false);
              onCreated(p);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
