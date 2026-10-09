'use client';

import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Disclosure } from '@isbp/ui/motion';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { TriangleAlertIcon } from 'lucide-react';
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
import { HealthBadge, PriorityLabel, TaskTypeIcon } from '../components/badges';
import { MarkdownEditor, MemberSelect, MilestoneSelect } from '../components/inputs';
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
  const tc = useTranslations('common');
  const id = useId();
  const [health, setHealth] = useState<ProjectHealth>(project.health);
  const [note, setNote] = useState(project.healthNote ?? '');
  const save = useApiMutation(
    (api, body: { health: ProjectHealth; note: string }) =>
      api.post(`${projectApi(project.key)}/health`, body),
    { invalidate: INVALIDATE, success: t('saved'), onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) save.mutate({ health, note: note.trim() });
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('health')}</legend>
            {PROJECT_HEALTHS.map((h) => (
              <label
                key={h}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
                  health === h && 'border-primary bg-primary/5',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-health`}
                  value={h}
                  checked={health === h}
                  onChange={() => setHealth(h)}
                  className="size-4 accent-[var(--color-primary)]"
                />
                <HealthBadge health={h} />
                <span className="text-sm text-muted-foreground">{t(`hint.${h}`)}</span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-note`}>{t('note')}</Label>
            <Textarea
              id={`${id}-note`}
              rows={4}
              required
              value={note}
              maxLength={2000}
              placeholder={t('notePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
            {health !== 'on_track' && health !== project.health && (
              <p className="text-xs text-muted-foreground">{t('notifies')}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!note.trim()}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
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
  const id = useId();
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
      open={open}
      onOpenChange={(o) => {
        setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{target ? t(`title.${target}`) : ''}</DialogTitle>
          <DialogDescription>{target ? t(`description.${target}`) : ''}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!target || blocked) return;
            setError(null);
            save
              .mutateAsync({ status: target, comment: comment.trim() || null, force: needsForce && force })
              .catch((err: unknown) => setError(err instanceof ApiError ? errorText(err) : errorText(null)));
          }}
        >
          {needsForce && (
            <div
              role="status"
              className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm"
            >
              <p className="flex items-center gap-2 font-medium">
                <TriangleAlertIcon className="size-4 shrink-0 text-warning-foreground" aria-hidden />
                {t('openTasks', { count: openTasks })}
              </p>
              <div className="flex items-center gap-2">
                <Checkbox id={`${id}-force`} checked={force} onCheckedChange={(v) => setForce(v === true)} />
                <Label htmlFor={`${id}-force`} className="font-normal">
                  {t('force')}
                </Label>
              </div>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor={`${id}-comment`}>{needsForce ? t('commentRequired') : t('comment')}</Label>
            <Textarea
              id={`${id}-comment`}
              rows={3}
              value={comment}
              maxLength={2000}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button
              type="submit"
              variant={target === 'cancelled' ? 'destructive' : 'default'}
              loading={save.isPending}
              disabled={blocked}
            >
              {target ? t(`confirm.${target}`) : tc('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
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
  const id = useId();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TaskType>('task');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [estimate, setEstimate] = useState('');
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
    setEstimate('');
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {project.key} · {project.name}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
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
                estimateHours: estimate ? Number(estimate) : null,
                description: description.trim() || null,
              })
              .catch((err: unknown) => setError(errorText(err)));
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-title`}>{tf('title')}</Label>
            <Input
              id={`${id}-title`}
              autoFocus
              required
              maxLength={300}
              value={title}
              placeholder={t('titlePlaceholder')}
              aria-invalid={titleMissing || undefined}
              aria-describedby={titleMissing ? `${id}-title-error` : undefined}
              onChange={(e) => {
                setTitle(e.target.value);
                if (e.target.value.trim()) setTitleMissing(false);
              }}
            />
            {titleMissing && (
              <p id={`${id}-title-error`} className="text-xs text-destructive">
                {t('titleRequired')}
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={`${id}-assignee`}>{tf('assignee')}</Label>
              <MemberSelect
                id={`${id}-assignee`}
                members={project.members}
                value={assigneeId}
                onChange={setAssigneeId}
              />
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={`${id}-due`}>{tf('dueDate')}</Label>
              <Input
                id={`${id}-due`}
                type="date"
                value={dueDate}
                aria-invalid={datesInvalid || undefined}
                aria-describedby={datesInvalid ? `${id}-dates` : undefined}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={`${id}-milestone`}>{tf('milestone')}</Label>
              <MilestoneSelect
                id={`${id}-milestone`}
                milestones={project.milestones.filter((m) => m.status === 'open')}
                value={milestoneId}
                onChange={setMilestoneId}
              />
            </div>
          </div>
          {datesInvalid && (
            <p id={`${id}-dates`} className="text-xs text-destructive">
              {t('datesInvalid')}
            </p>
          )}
          <Disclosure
            summary={t('moreDetails')}
            open={more}
            onOpenChange={setMore}
            triggerClassName="w-auto justify-start py-1 text-sm text-muted-foreground"
          >
            <div className="grid gap-4 pt-2">
              <div className="grid gap-4 sm:grid-cols-3">
                {showType && (
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor={`${id}-type`}>{tf('type')}</Label>
                    <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
                      <SelectTrigger id={`${id}-type`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_TYPES.map((ty) => (
                          <SelectItem key={ty} value={ty}>
                            <TaskTypeIcon type={ty} label={false} />
                            {tt(ty)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor={`${id}-priority`}>{tf('priority')}</Label>
                  <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                    <SelectTrigger id={`${id}-priority`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p} textValue={tp(p)}>
                          <PriorityLabel priority={p} className="text-sm font-normal" />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor={`${id}-start`}>{tf('startDate')}</Label>
                  <Input
                    id={`${id}-start`}
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor={`${id}-estimate`}>{tf('estimateHours')}</Label>
                  <Input
                    id={`${id}-estimate`}
                    type="number"
                    min={0}
                    step={0.5}
                    inputMode="decimal"
                    value={estimate}
                    onChange={(e) => setEstimate(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-description`}>{tf('description')}</Label>
                <MarkdownEditor
                  id={`${id}-description`}
                  value={description}
                  onChange={setDescription}
                  label={tf('description')}
                  rows={4}
                />
              </div>
            </div>
          </Disclosure>
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {tc('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
