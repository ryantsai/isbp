'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { Input } from '@isbp/ui/input';
import { Disclosure } from '@isbp/ui/motion';
import { Label } from '@isbp/ui/label';
import { Markdown } from '@isbp/ui/markdown';
import { useApiMutation } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CornerLeftUpIcon,
  ExternalLinkIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import {
  isOpenTask,
  type ProjectDetail,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type TaskDetail,
  type TaskRef,
  type TaskStatus,
} from '../../contracts';
import { INVALIDATE, localToday, projectHref, taskApi, taskHref, useProject } from '../lib';
import { DueDate, PriorityLabel, TaskStatusBadge, TaskStatusIcon, TaskTypeIcon } from './badges';
import { Conversation } from './conversation';
import { CustomFieldsCard } from './custom-fields';
import { ConfirmDialog, LabelInput, MarkdownEditor, MemberSelect, MilestoneSelect } from './inputs';
import { useMoveTask, useTaskErrorText, useUpdateTask } from './task-actions';
import { TaskPicker } from './task-picker';

/** How a task reference opens: in the sheet (board, list) or as a page. */
export type OpenTask = (reference: string) => void;

function TaskLink({ task, onOpen }: { task: TaskRef; onOpen?: OpenTask }) {
  const content = (
    <>
      <TaskStatusIcon status={task.status} className="text-muted-foreground" />
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.reference}</span>
      <span
        className={cn('min-w-0 truncate', !isOpenTask(task.status) && 'text-muted-foreground line-through')}
      >
        {task.title}
      </span>
    </>
  );
  const cls =
    'flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50';
  return onOpen ? (
    <button type="button" className={cls} onClick={() => onOpen(task.reference)}>
      {content}
    </button>
  ) : (
    <Link href={taskHref(task.reference)} className={cls}>
      {content}
    </Link>
  );
}

/** Title as a heading with an inline editor. */
function TitleEditor({ task, as: Heading }: { task: TaskDetail; as: 'h1' | 'h2' }) {
  const t = useTranslations('projects.task');
  const tc = useTranslations('common');
  const { update, isPending } = useUpdateTask(task.reference);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const save = async () => {
    const title = draft.trim();
    if (!title || title === task.title) return setEditing(false);
    if (await update({ title })) setEditing(false);
  };
  if (editing)
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          autoFocus
          value={draft}
          maxLength={300}
          aria-label={t('titleLabel')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          className="h-10 min-w-0 flex-1 text-lg font-semibold"
        />
        <Button type="submit" size="sm" loading={isPending}>
          {tc('save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          {tc('cancel')}
        </Button>
      </form>
    );
  return (
    <div className="flex items-start gap-2">
      <Heading className="min-w-0 flex-1 text-xl font-semibold tracking-tight text-balance break-words">
        {task.title}
      </Heading>
      {task.viewer.canEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('editTitle')}
          onClick={() => {
            setDraft(task.title);
            setEditing(true);
          }}
        >
          <PencilIcon />
        </Button>
      )}
    </div>
  );
}

/** Status menu; "In progress" is disabled (and says why) while a dependency is not done. */
function StatusMenu({ task }: { task: TaskDetail }) {
  const t = useTranslations('projects.task');
  const ts = useTranslations('projects.taskStatus');
  const { move, isPending } = useMoveTask();
  const blockers = task.blockedBy.filter((b) => b.status !== 'done' && b.status !== 'cancelled');
  if (!task.viewer.canEdit) return <TaskStatusBadge status={task.status} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          aria-label={t('changeStatus', { status: ts(task.status) })}
        >
          <TaskStatusIcon status={task.status} />
          {ts(task.status)}
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('moveTo')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={task.status}
          onValueChange={(v) => {
            if (v !== task.status)
              void move({ ref: task.reference, status: v as TaskStatus }).catch(() => undefined);
          }}
        >
          {TASK_STATUSES.map((s) => {
            const blocked = s === 'in_progress' && blockers.length > 0 && task.status !== 'in_progress';
            return (
              <DropdownMenuRadioItem key={s} value={s} disabled={blocked}>
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2">
                    <TaskStatusIcon status={s} className="text-muted-foreground" />
                    {ts(s)}
                  </span>
                  {blocked && (
                    <span className="text-xs text-muted-foreground">
                      {t('blockedBy', { refs: blockers.map((b) => b.reference).join(', ') })}
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FieldRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-1.5">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
          {label}
        </Label>
      ) : (
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Number input that saves on blur (hours). */
function HoursInput({
  id,
  value,
  disabled,
  onSave,
}: {
  id: string;
  value: number | null;
  disabled?: boolean;
  onSave: (v: number | null) => void;
}) {
  // Remounted (keyed by the saved value) when the task changes elsewhere.
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={0}
      step={0.5}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim() === '' ? null : Math.max(0, Number(draft));
        if (next !== value && (next === null || Number.isFinite(next))) onSave(next);
      }}
    />
  );
}

/** The editable properties: assignee, type, priority, milestone, dates, hours and labels. */
function Properties({ task, project }: { task: TaskDetail; project: ProjectDetail | undefined }) {
  const t = useTranslations('projects.fields');
  const tt = useTranslations('projects.taskType');
  const tp = useTranslations('projects.priority');
  const { update } = useUpdateTask(task.reference);
  const { user } = usePlatform();
  const today = localToday(user.timezone);
  const id = useId();
  const can = task.viewer.canEdit;
  const members = project?.members ?? [];
  const date = (field: 'startDate' | 'dueDate', label: string) => (
    <FieldRow label={label} htmlFor={`${id}-${field}`}>
      <Input
        id={`${id}-${field}`}
        type="date"
        key={`${field}:${task[field] ?? ''}`}
        defaultValue={task[field] ?? ''}
        disabled={!can}
        onBlur={(e) => {
          const v = e.target.value || null;
          if (v !== task[field]) void update({ [field]: v });
        }}
      />
      {field === 'dueDate' && task.dueDate && task.dueDate < today && isOpenTask(task.status) && (
        <DueDate date={task.dueDate} status={task.status} today={today} long className="mt-1" />
      )}
    </FieldRow>
  );
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FieldRow label={t('assignee')} htmlFor={`${id}-assignee`}>
        <MemberSelect
          id={`${id}-assignee`}
          members={members}
          value={task.assignee?.id ?? null}
          disabled={!can || !project}
          onChange={(assigneeId) => void update({ assigneeId })}
        />
      </FieldRow>
      <FieldRow label={t('reporter')}>
        {task.reporter ? (
          <span className="flex h-9 min-w-0 items-center gap-2 text-sm">
            <UserAvatar
              name={task.reporter.displayName}
              src={task.reporter.avatarUrl}
              className="size-5 text-[9px]"
            />
            <span className="truncate">{task.reporter.displayName}</span>
          </span>
        ) : (
          <span className="flex h-9 items-center text-sm text-muted-foreground">—</span>
        )}
      </FieldRow>
      <FieldRow label={t('type')} htmlFor={`${id}-type`}>
        <Select
          value={task.type}
          disabled={!can}
          onValueChange={(v) => void update({ type: v as TaskDetail['type'] })}
        >
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
      </FieldRow>
      <FieldRow label={t('priority')} htmlFor={`${id}-priority`}>
        <Select
          value={task.priority}
          disabled={!can}
          onValueChange={(v) => void update({ priority: v as TaskDetail['priority'] })}
        >
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
      </FieldRow>
      <FieldRow label={t('milestone')} htmlFor={`${id}-milestone`}>
        <MilestoneSelect
          id={`${id}-milestone`}
          milestones={project?.milestones ?? (task.milestone ? [task.milestone] : [])}
          value={task.milestone?.id ?? null}
          disabled={!can || !project}
          onChange={(milestoneId) => void update({ milestoneId })}
        />
      </FieldRow>
      <div className="hidden sm:block" aria-hidden />
      {date('startDate', t('startDate'))}
      {date('dueDate', t('dueDate'))}
      <Disclosure
        summary={t('planning')}
        defaultOpen={Boolean(task.estimateHours || task.remainingHours || task.labels.length)}
        className="sm:col-span-2"
        triggerClassName="w-auto justify-start py-1 text-sm font-medium text-muted-foreground"
      >
        <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
          <FieldRow label={t('estimateHours')} htmlFor={`${id}-estimate`}>
            <HoursInput
              key={`e:${task.estimateHours ?? ''}`}
              id={`${id}-estimate`}
              value={task.estimateHours}
              disabled={!can}
              onSave={(estimateHours) => void update({ estimateHours })}
            />
          </FieldRow>
          <FieldRow label={t('remainingHours')} htmlFor={`${id}-remaining`}>
            <HoursInput
              key={`r:${task.remainingHours ?? ''}`}
              id={`${id}-remaining`}
              value={task.remainingHours}
              disabled={!can}
              onSave={(remainingHours) => void update({ remainingHours })}
            />
          </FieldRow>
          <div className="sm:col-span-2">
            <FieldRow label={t('labels')} htmlFor={`${id}-labels`}>
              {can ? (
                <LabelInput
                  id={`${id}-labels`}
                  value={task.labels}
                  suggestions={project?.labels ?? []}
                  placeholder={t('labelsPlaceholder')}
                  onChange={(labels) => void update({ labels })}
                />
              ) : task.labels.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {task.labels.map((l) => (
                    <span
                      key={l}
                      className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                    >
                      {l}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </FieldRow>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

function DescriptionSection({ task }: { task: TaskDetail }) {
  const t = useTranslations('projects.task');
  const tc = useTranslations('common');
  const { update, isPending } = useUpdateTask(task.reference);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.description ?? '');
  return (
    <section className="grid gap-2" aria-label={t('description')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('description')}</h2>
        {task.viewer.canEdit && !editing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(task.description ?? '');
              setEditing(true);
            }}
          >
            <PencilIcon />
            {tc('edit')}
          </Button>
        )}
      </div>
      {editing ? (
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await update({ description: draft.trim() || null })) setEditing(false);
          }}
        >
          <MarkdownEditor value={draft} onChange={setDraft} label={t('description')} rows={8} autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" size="sm" loading={isPending}>
              {tc('save')}
            </Button>
          </div>
        </form>
      ) : task.description ? (
        <Markdown>{task.description}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground">{t('noDescription')}</p>
      )}
    </section>
  );
}

/** Parent and children, "Blocked by" and "Blocking" with add/remove pickers. */
function Relations({ task, onOpen }: { task: TaskDetail; onOpen?: OpenTask }) {
  const t = useTranslations('projects.task');
  const errorText = useTaskErrorText();
  const { update } = useUpdateTask(task.reference);
  const addDep = useApiMutation(
    (api, dependsOn: string) => api.post(`${taskApi(task.reference)}/dependencies`, { dependsOn }),
    { invalidate: INVALIDATE, silent: true, success: t('dependencyAdded') },
  );
  const removeDep = useApiMutation(
    (api, dependsOn: string) =>
      api.delete(`${taskApi(task.reference)}/dependencies/${encodeURIComponent(dependsOn)}`),
    { invalidate: INVALIDATE, silent: true },
  );
  const can = task.viewer.canEdit;
  const exclude = [task.id, ...task.blockedBy.map((b) => b.id)];
  const blockers = task.blockedBy.filter((b) => isOpenTask(b.status));
  return (
    <section className="grid gap-4" aria-label={t('relations')}>
      {blockers.length > 0 && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
          <span>{t('blockedExplain', { refs: blockers.map((b) => b.reference).join(', ') })}</span>
        </p>
      )}
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('blockedByTitle')}</h3>
          {can && (
            <TaskPicker
              projectKey={task.project.key}
              excludeIds={exclude}
              label={t('addDependency')}
              onPick={(picked) =>
                addDep.mutateAsync(picked.reference).catch((err) => toast.error(errorText(err)))
              }
            />
          )}
        </div>
        {task.blockedBy.length ? (
          <ul className="grid gap-1">
            {task.blockedBy.map((b) => (
              <li key={b.id} className="flex min-w-0 items-center gap-2">
                <TaskLink task={b} onOpen={onOpen} />
                {can && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7"
                    aria-label={t('removeDependency', { reference: b.reference })}
                    onClick={() =>
                      removeDep.mutateAsync(b.reference).catch((err) => toast.error(errorText(err)))
                    }
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noDependencies')}</p>
        )}
      </div>
      {task.blocking.length > 0 && (
        <div className="grid gap-1.5">
          <h3 className="text-sm font-semibold">{t('blockingTitle')}</h3>
          <ul className="grid gap-1">
            {task.blocking.map((b) => (
              <li key={b.id} className="flex min-w-0 items-center gap-2">
                <TaskLink task={b} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('parent')}</h3>
          {can && (
            <TaskPicker
              projectKey={task.project.key}
              excludeIds={[task.id, ...task.children.map((c) => c.id)]}
              label={task.parent ? t('changeParent') : t('setParent')}
              onPick={(picked) => void update({ parentId: picked.id })}
            />
          )}
        </div>
        {task.parent ? (
          <div className="flex min-w-0 items-center gap-2">
            <CornerLeftUpIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <TaskLink task={task.parent} onOpen={onOpen} />
            {can && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label={t('clearParent')}
                onClick={() => void update({ parentId: null })}
              >
                <XIcon className="size-3.5" />
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noParent')}</p>
        )}
      </div>
      {task.children.length > 0 && (
        <div className="grid gap-1.5">
          <h3 className="text-sm font-semibold">{t('children', { count: task.children.length })}</h3>
          <ul className="grid gap-1">
            {task.children.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center gap-2">
                <TaskLink task={c} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The core "Linked records" and "Attachments" panels (rendered by the platform through slots). */
export function RecordPanels({ record }: { record: RecordPanelSlotProps['record'] }) {
  return (
    <>
      <Slot name="core.record.links" props={{ record } satisfies RecordPanelSlotProps} />
      <Slot name="core.record.files" props={{ record } satisfies RecordPanelSlotProps} />
    </>
  );
}

function TaskMenu({
  task,
  onDeleted,
  fullPage,
}: {
  task: TaskDetail;
  onDeleted: () => void;
  fullPage?: boolean;
}) {
  const t = useTranslations('projects.task');
  const tc = useTranslations('common');
  const [confirm, setConfirm] = useState(false);
  const remove = useApiMutation((api) => api.delete(taskApi(task.reference)), {
    invalidate: INVALIDATE,
    success: t('deleted', { reference: task.reference }),
    onSuccess: () => {
      setConfirm(false);
      onDeleted();
    },
  });
  const copy = () => {
    const url = `${window.location.origin}${taskHref(task.reference)}`;
    void navigator.clipboard?.writeText(url).then(() => toast.success(tc('copied')));
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label={t('more')}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {fullPage && (
            <DropdownMenuItem asChild>
              <Link href={taskHref(task.reference)}>
                <ExternalLinkIcon /> {t('openPage')}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={copy}>
            <LinkIcon /> {t('copyLink')}
          </DropdownMenuItem>
          {task.viewer.canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
                <Trash2Icon /> {t('delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('deleteTitle', { reference: task.reference })}
        description={t('deleteBody')}
        confirmLabel={tc('delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </>
  );
}

export function TaskDetailSkeleton() {
  return (
    <div className="grid gap-4" aria-busy>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-60 w-full rounded-xl" />
    </div>
  );
}

/**
 * Everything about one task: title, status, properties, description, dependencies and hierarchy, custom
 * fields, the core links and files panels, comments and activity. Shared by the page and the sheet.
 */
export function TaskDetailView({
  task,
  variant,
  onOpenTask,
  onDeleted,
}: {
  task: TaskDetail;
  variant: 'page' | 'sheet';
  onOpenTask?: OpenTask;
  onDeleted?: () => void;
}) {
  const t = useTranslations('projects.task');
  const tt = useTranslations('projects.taskType');
  const router = useRouter();
  const { data: project } = useProject(task.project.key);
  const record = { type: 'projects.task', id: task.id };
  const sheet = variant === 'sheet';

  const header = (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-mono font-medium text-foreground">
          <TaskTypeIcon type={task.type} label={false} />
          {task.reference}
        </span>
        <span>{tt(task.type)}</span>
        <span aria-hidden>·</span>
        <Link href={projectHref(task.project.key)} className="min-w-0 truncate hover:underline">
          {task.project.name}
        </Link>
      </div>
      <TitleEditor task={task} as={sheet ? 'h2' : 'h1'} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusMenu task={task} />
        <PriorityLabel priority={task.priority} />
        <span className="ml-auto flex gap-2">
          <TaskMenu
            task={task}
            fullPage={sheet}
            onDeleted={onDeleted ?? (() => router.push(projectHref(task.project.key)))}
          />
        </span>
      </div>
    </div>
  );

  const properties = (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('properties')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Properties task={task} project={project} />
      </CardContent>
    </Card>
  );

  const custom = (
    <CustomFieldsCard
      entity="task"
      path={taskApi(task.reference)}
      subtitle={`${task.reference} · ${task.title}`}
      attributes={task.attributes}
      canEdit={task.viewer.canEdit}
    />
  );

  const main = (
    <>
      <Card className="min-w-0 gap-4">
        <CardContent className="grid gap-4">
          <DescriptionSection task={task} />
          <Relations task={task} onOpen={onOpenTask} />
        </CardContent>
      </Card>
      <Conversation task={task} />
    </>
  );

  if (sheet)
    return (
      <div className="grid gap-5">
        {header}
        {properties}
        {main}
        {custom}
        <RecordPanels record={record} />
      </div>
    );

  return (
    <div className="grid gap-4">
      {header}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid min-w-0 content-start gap-4">{main}</div>
        <aside className="grid min-w-0 content-start gap-4" aria-label={t('aside')}>
          {properties}
          {custom}
          <RecordPanels record={record} />
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{t('project')}</CardTitle>
              <CardAction>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`${projectHref(task.project.key)}?view=board&task=${task.reference}`}>
                    {t('openOnBoard')}
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="px-4 text-sm">
              <Link href={projectHref(task.project.key)} className="font-medium hover:underline">
                {task.project.key} · {task.project.name}
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
