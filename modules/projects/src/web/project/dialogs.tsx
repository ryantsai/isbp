'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ApiError } from '@isbp/sdk/web';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  type CreateTaskInput,
  PROJECT_HEALTHS,
  type ProjectDetail,
  type ProjectHealth,
  type ProjectStatus,
  TASK_PRIORITIES,
  TASK_TYPES,
  type TaskDetail,
  type TaskPriority,
  type TaskType,
} from '../../contracts';
import { HealthBadge, PriorityIcon, TaskTypeIcon } from '../components/badges';
import { MarkdownEditor, MemberSelect, MilestoneSelect, toIsoDate } from '../components/inputs';
import { INVALIDATE, projectApi } from '../lib';

/** Health with a note (members are notified when it turns at risk or off track). */
export function HealthDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('projects.healthDialog');
  const th = useTranslations('projects.health');
  const tc = useTranslations('common');
  const formId = useId();
  const [health, setHealth] = useState<ProjectHealth>(project.health);
  const [note, setNote] = useState(project.healthNote ?? '');
  const save = useApiMutation(
    (api, body: { health: ProjectHealth; note: string }) =>
      api.post(`${projectApi(project.key)}/health`, body),
    { invalidate: INVALIDATE, success: t('saved'), onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={<DialogHeader title={t('title')} subtitle={t('description')} onOpenChange={onOpenChange} />}
        content={
          <LayoutContent padding={4}>
            <form
              id={formId}
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) save.mutate({ health, note: note.trim() });
              }}
            >
              <FormLayout defaultOptionality="optional">
                <RadioList label={t('health')} value={health} onChange={(v) => setHealth(v as ProjectHealth)}>
                  {PROJECT_HEALTHS.map((h) => (
                    <RadioListItem
                      key={h}
                      value={h}
                      aria-label={th(h)}
                      label={<HealthBadge health={h} />}
                      description={t(`hint.${h}`)}
                    />
                  ))}
                </RadioList>
                <TextArea
                  label={t('note')}
                  isRequired
                  rows={4}
                  value={note}
                  maxLength={2000}
                  placeholder={t('notePlaceholder')}
                  description={health !== 'on_track' && health !== project.health ? t('notifies') : undefined}
                  onChange={setNote}
                />
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={tc('save')}
                variant="primary"
                isLoading={save.isPending}
                isDisabled={!note.trim()}
                type="submit"
                form={formId}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/** Hold, resume, complete (with "complete anyway" when tasks are open) or cancel. */
export function StatusDialog({
  project,
  target,
  onOpenChange,
}: {
  project: ProjectDetail;
  target: ProjectStatus | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('projects.statusDialog');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const formId = useId();
  const [comment, setComment] = useState('');
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = target !== null;
  const openTasks = project.kpis.open;
  const completing = target === 'completed';
  const needsForce = completing && openTasks > 0;
  const save = useApiMutation(
    (api, body: { status: ProjectStatus; comment: string | null; force: boolean }) =>
      api.post(`${projectApi(project.key)}/status`, body),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: () => t('saved'),
      onSuccess: () => {
        setComment('');
        setForce(false);
        onOpenChange(false);
      },
    },
  );
  const blocked = needsForce && (!force || !comment.trim());
  return (
    <Dialog
      isOpen={open}
      onOpenChange={(o) => {
        setError(null);
        onOpenChange(o);
      }}
      width={448}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={target ? t(`title.${target}`) : ''}
            subtitle={target ? t(`description.${target}`) : ''}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <form
              id={formId}
              onSubmit={(e) => {
                e.preventDefault();
                if (!target || blocked) return;
                setError(null);
                save
                  .mutateAsync({
                    status: target,
                    comment: comment.trim() || null,
                    force: needsForce && force,
                  })
                  .catch((err: unknown) =>
                    setError(err instanceof ApiError ? errorText(err) : errorText(null)),
                  );
              }}
            >
              <FormLayout defaultOptionality="optional">
                {needsForce && (
                  <>
                    <Banner
                      status="warning"
                      title={t('openTasks', { count: openTasks })}
                      collapsible={false}
                    />
                    <CheckboxInput label={t('force')} value={force} onChange={setForce} />
                  </>
                )}
                <TextArea
                  label={needsForce ? t('commentRequired') : t('comment')}
                  rows={3}
                  value={comment}
                  maxLength={2000}
                  onChange={setComment}
                />
                {error && <Banner status="error" title={error} collapsible={false} />}
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={target ? t(`confirm.${target}`) : tc('confirm')}
                variant={target === 'cancelled' ? 'destructive' : 'primary'}
                isLoading={save.isPending}
                isDisabled={blocked}
                type="submit"
                form={formId}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/** "New task" with the essentials; opens the task in the sheet when created. */
export function NewTaskDialog({
  project,
  open,
  onOpenChange,
  onCreated,
}: {
  project: ProjectDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (task: TaskDetail) => void;
}) {
  const t = useTranslations('projects.newTask');
  const tf = useTranslations('projects.fields');
  const tt = useTranslations('projects.taskType');
  const tp = useTranslations('projects.priority');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const formId = useId();
  const list = useFieldList();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TaskType>('task');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [titleMissing, setTitleMissing] = useState(false);
  const [more, setMore] = useState(false);
  // Epic / feature / story only matter to projects that sync with a work-item tracker (Azure DevOps).
  const showType = project.members.some((m) => m.via) || project.updates.some((u) => u.via);
  const reset = () => {
    setTitleMissing(false);
    setMore(false);
    setTitle('');
    setType('task');
    setPriority('medium');
    setAssigneeId(null);
    setMilestoneId(null);
    setStartDate('');
    setDueDate('');
    setEstimate(null);
    setDescription('');
    setError(null);
  };
  const create = useApiMutation(
    (api, body: CreateTaskInput) => api.post<TaskDetail>(`${projectApi(project.key)}/tasks`, body),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: (task) => t('created', { reference: task.reference }),
      onSuccess: (task) => {
        reset();
        onOpenChange(false);
        onCreated?.(task);
      },
    },
  );
  const datesInvalid = Boolean(startDate && dueDate && dueDate < startDate);
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={672} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('title')}
            subtitle={`${project.key} · ${project.name}`}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <form
              id={formId}
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (!title.trim()) {
                  setTitleMissing(true);
                  return;
                }
                if (datesInvalid) {
                  setMore(true);
                  return;
                }
                setError(null);
                create
                  .mutateAsync({
                    title: title.trim(),
                    type,
                    priority,
                    assigneeId,
                    milestoneId,
                    startDate: startDate || null,
                    dueDate: dueDate || null,
                    estimateHours: estimate,
                    description: description.trim() || null,
                  })
                  .catch((err: unknown) => setError(errorText(err)));
              }}
            >
              <FormLayout defaultOptionality="optional">
                <TextInput
                  label={tf('title')}
                  isRequired
                  hasAutoFocus
                  value={title}
                  placeholder={t('titlePlaceholder')}
                  status={titleMissing ? { type: 'error', message: t('titleRequired') } : undefined}
                  onChange={(v) => {
                    const next = v.slice(0, 300);
                    setTitle(next);
                    if (next.trim()) setTitleMissing(false);
                  }}
                />
                <Grid columns={{ minWidth: 180 }} gap={4}>
                  <MemberSelect
                    members={project.members}
                    value={assigneeId}
                    label={tf('assignee')}
                    onChange={setAssigneeId}
                  />
                  <DateInput
                    label={tf('dueDate')}
                    hasClear
                    value={toIsoDate(dueDate)}
                    status={datesInvalid ? { type: 'error', message: t('datesInvalid') } : undefined}
                    onChange={(v) => setDueDate(v ?? '')}
                  />
                  <MilestoneSelect
                    milestones={project.milestones.filter((m) => m.status === 'open')}
                    value={milestoneId}
                    label={tf('milestone')}
                    onChange={setMilestoneId}
                  />
                </Grid>
                <OptionalFields
                  open={more}
                  onOpenChange={setMore}
                  hint={list([
                    ...(showType ? [tf('type')] : []),
                    tf('priority'),
                    tf('startDate'),
                    tf('estimateHours'),
                    tf('description'),
                  ])}
                  filled={countFilled(
                    type === 'task' ? '' : type,
                    priority === 'medium' ? '' : priority,
                    startDate,
                    estimate === null ? '' : String(estimate),
                    description,
                  )}
                >
                  <FormLayout defaultOptionality="optional">
                    <Grid columns={{ minWidth: 180 }} gap={4}>
                      {showType && (
                        <Selector
                          label={tf('type')}
                          value={type}
                          onChange={(v) => setType(v as TaskType)}
                          options={TASK_TYPES.map((ty) => ({
                            value: ty,
                            label: tt(ty),
                            icon: <TaskTypeIcon type={ty} label={false} />,
                          }))}
                        />
                      )}
                      <Selector
                        label={tf('priority')}
                        value={priority}
                        onChange={(v) => setPriority(v as TaskPriority)}
                        options={TASK_PRIORITIES.map((p) => ({
                          value: p,
                          label: tp(p),
                          icon: <PriorityIcon priority={p} />,
                        }))}
                      />
                      <DateInput
                        label={tf('startDate')}
                        hasClear
                        value={toIsoDate(startDate)}
                        onChange={(v) => setStartDate(v ?? '')}
                      />
                      <NumberInput
                        label={tf('estimateHours')}
                        hasClear
                        min={0}
                        step={0.5}
                        value={estimate}
                        onChange={setEstimate}
                      />
                    </Grid>
                    <MarkdownEditor
                      value={description}
                      onChange={setDescription}
                      label={tf('description')}
                      isLabelHidden={false}
                      rows={4}
                    />
                  </FormLayout>
                </OptionalFields>
                {error && <Banner status="error" title={error} collapsible={false} />}
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={tc('create')}
                variant="primary"
                isLoading={create.isPending}
                type="submit"
                form={formId}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
