'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { DropdownMenu, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@astryxdesign/core/DropdownMenu';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { Markdown } from '@isbp/ui/markdown';
import { Disclosure } from '@isbp/ui/motion';
import { useApiMutation } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import { CornerLeftUpIcon, ExternalLinkIcon, LinkIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
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
import {
  DueDate,
  PriorityIcon,
  PriorityLabel,
  TaskStatusIcon,
  TaskStatusBadge,
  TaskTypeIcon,
} from './badges';
import { Conversation } from './conversation';
import { CustomFieldsCard } from './custom-fields';
import { LabelInput, MarkdownEditor, MemberSelect, MilestoneSelect, toIsoDate } from './inputs';
import { useMoveTask, useTaskErrorText, useUpdateTask } from './task-actions';
import { TaskPicker } from './task-picker';

/** How a task reference opens: in the sheet (board, list) or as a page. */
export type OpenTask = (reference: string) => void;

function TaskLink({ task, onOpen }: { task: TaskRef; onOpen?: OpenTask }) {
  const closed = !isOpenTask(task.status);
  const content = (
    <HStack as="span" gap={2} vAlign="center">
      <TaskStatusIcon status={task.status} />
      <Text type="code" color="secondary">
        {task.reference}
      </Text>
      <Text color={closed ? 'secondary' : 'primary'} hasStrikethrough={closed} maxLines={1}>
        {task.title}
      </Text>
    </HStack>
  );
  return (
    <span className="min-w-0 flex-1">
      {onOpen ? (
        <Link color="primary" onClick={() => onOpen(task.reference)}>
          {content}
        </Link>
      ) : (
        <Link color="primary" href={taskHref(task.reference)}>
          {content}
        </Link>
      )}
    </span>
  );
}

/** Title as a heading with an inline editor. */
function TitleEditor({ task, level }: { task: TaskDetail; level: 1 | 2 }) {
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
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <HStack gap={2} vAlign="end" wrap="wrap">
          <StackItem size="fill" className="min-w-48">
            <TextInput
              label={t('titleLabel')}
              isLabelHidden
              hasAutoFocus
              value={draft}
              onChange={(v) => setDraft(v.slice(0, 300))}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
            />
          </StackItem>
          <Button label={tc('save')} variant="primary" size="sm" isLoading={isPending} type="submit" />
          <Button label={tc('cancel')} variant="ghost" size="sm" onClick={() => setEditing(false)} />
        </HStack>
      </form>
    );
  return (
    <HStack gap={2} vAlign="start">
      <StackItem size="fill" className="min-w-0">
        <Heading level={level} textWrap="balance">
          {task.title}
        </Heading>
      </StackItem>
      {task.viewer.canEdit && (
        <IconButton
          label={t('editTitle')}
          variant="ghost"
          size="sm"
          icon={<Icon icon={PencilIcon} />}
          onClick={() => {
            setDraft(task.title);
            setEditing(true);
          }}
        />
      )}
    </HStack>
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
    <DropdownMenu
      alignment="start"
      menuWidth={256}
      button={{
        label: ts(task.status),
        'aria-label': t('changeStatus', { status: ts(task.status) }),
        variant: 'secondary',
        size: 'sm',
        isDisabled: isPending,
        icon: <TaskStatusIcon status={task.status} />,
      }}
    >
      <DropdownMenuRadioGroup
        label={t('moveTo')}
        value={task.status}
        onChange={(v) => {
          if (v !== task.status)
            void move({ ref: task.reference, status: v as TaskStatus }).catch(() => undefined);
        }}
      >
        {TASK_STATUSES.map((s) => {
          const blocked = s === 'in_progress' && blockers.length > 0 && task.status !== 'in_progress';
          return (
            <DropdownMenuRadioItem
              key={s}
              value={s}
              label={ts(s)}
              icon={<TaskStatusIcon status={s} />}
              isDisabled={blocked}
              description={
                blocked ? t('blockedBy', { refs: blockers.map((b) => b.reference).join(', ') }) : undefined
              }
            />
          );
        })}
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
}

/** Number input that saves on blur (hours). */
function HoursInput({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: number | null;
  disabled?: boolean;
  onSave: (v: number | null) => void;
}) {
  // Remounted (keyed by the saved value) when the task changes elsewhere.
  const [draft, setDraft] = useState<number | null>(value);
  return (
    <NumberInput
      label={label}
      hasClear
      min={0}
      step={0.5}
      value={draft}
      isDisabled={disabled}
      onChange={setDraft}
      onBlur={() => {
        const next = draft === null ? null : Math.max(0, draft);
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
  const can = task.viewer.canEdit;
  const members = project?.members ?? [];
  const date = (field: 'startDate' | 'dueDate', label: string) => (
    <VStack gap={1}>
      <DateInput
        label={label}
        hasClear
        value={toIsoDate(task[field])}
        isDisabled={!can}
        onChange={(v) => {
          const next = v ?? null;
          if (next !== task[field]) void update({ [field]: next });
        }}
      />
      {field === 'dueDate' && task.dueDate && task.dueDate < today && isOpenTask(task.status) && (
        <DueDate date={task.dueDate} status={task.status} today={today} long />
      )}
    </VStack>
  );
  return (
    <Grid columns={{ minWidth: 164, max: 2 }} gap={4}>
      <MemberSelect
        members={members}
        value={task.assignee?.id ?? null}
        isDisabled={!can || !project}
        onChange={(assigneeId) => void update({ assigneeId })}
      />
      <VStack gap={1}>
        <Text type="label">{t('reporter')}</Text>
        {task.reporter ? (
          <HStack gap={2} vAlign="center" className="h-8 min-w-0">
            <UserAvatar
              name={task.reporter.displayName}
              src={task.reporter.avatarUrl}
              className="size-5 text-[9px]"
            />
            <Text maxLines={1}>{task.reporter.displayName}</Text>
          </HStack>
        ) : (
          <Text type="supporting">—</Text>
        )}
      </VStack>
      <Selector
        label={t('type')}
        value={task.type}
        isDisabled={!can}
        onChange={(v) => void update({ type: v as TaskDetail['type'] })}
        options={TASK_TYPES.map((ty) => ({
          value: ty,
          label: tt(ty),
          icon: <TaskTypeIcon type={ty} label={false} />,
        }))}
      />
      <Selector
        label={t('priority')}
        value={task.priority}
        isDisabled={!can}
        onChange={(v) => void update({ priority: v as TaskDetail['priority'] })}
        options={TASK_PRIORITIES.map((p) => ({
          value: p,
          label: tp(p),
          icon: <PriorityIcon priority={p} />,
        }))}
      />
      <MilestoneSelect
        milestones={project?.milestones ?? (task.milestone ? [task.milestone] : [])}
        value={task.milestone?.id ?? null}
        isDisabled={!can || !project}
        onChange={(milestoneId) => void update({ milestoneId })}
      />
      <div className="hidden sm:block" aria-hidden />
      {date('startDate', t('startDate'))}
      {date('dueDate', t('dueDate'))}
      <Disclosure
        summary={t('planning')}
        defaultOpen={Boolean(task.estimateHours || task.remainingHours || task.labels.length)}
        className="col-span-full"
        triggerClassName="w-auto justify-start py-1 text-sm font-medium text-muted-foreground"
      >
        <Grid columns={{ minWidth: 164, max: 2 }} gap={4} className="pt-2">
          <HoursInput
            key={`e:${task.estimateHours ?? ''}`}
            label={t('estimateHours')}
            value={task.estimateHours}
            disabled={!can}
            onSave={(estimateHours) => void update({ estimateHours })}
          />
          <HoursInput
            key={`r:${task.remainingHours ?? ''}`}
            label={t('remainingHours')}
            value={task.remainingHours}
            disabled={!can}
            onSave={(remainingHours) => void update({ remainingHours })}
          />
          <div className="col-span-full">
            {can ? (
              <LabelInput
                label={t('labels')}
                value={task.labels}
                suggestions={project?.labels ?? []}
                placeholder={t('labelsPlaceholder')}
                onChange={(labels) => void update({ labels })}
              />
            ) : (
              <VStack gap={1}>
                <Text type="label">{t('labels')}</Text>
                {task.labels.length ? (
                  <HStack gap={1.5} wrap="wrap">
                    {task.labels.map((l) => (
                      <Token key={l} label={l} size="sm" />
                    ))}
                  </HStack>
                ) : (
                  <Text type="supporting">—</Text>
                )}
              </VStack>
            )}
          </div>
        </Grid>
      </Disclosure>
    </Grid>
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
      <HStack gap={2} vAlign="center" hAlign="between">
        <Heading level={3} accessibilityLevel={2}>
          {t('description')}
        </Heading>
        {task.viewer.canEdit && !editing && (
          <Button
            label={tc('edit')}
            variant="ghost"
            size="sm"
            icon={<Icon icon={PencilIcon} />}
            onClick={() => {
              setDraft(task.description ?? '');
              setEditing(true);
            }}
          />
        )}
      </HStack>
      {editing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await update({ description: draft.trim() || null })) setEditing(false);
          }}
        >
          <VStack gap={2}>
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              label={t('description')}
              rows={8}
              hasAutoFocus
            />
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="secondary" size="sm" onClick={() => setEditing(false)} />
              <Button label={tc('save')} variant="primary" size="sm" isLoading={isPending} type="submit" />
            </HStack>
          </VStack>
        </form>
      ) : task.description ? (
        <Markdown>{task.description}</Markdown>
      ) : (
        <Text type="supporting">{t('noDescription')}</Text>
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
        <Banner
          status="warning"
          title={t('blockedExplain', { refs: blockers.map((b) => b.reference).join(', ') })}
          collapsible={false}
        />
      )}
      <div className="grid gap-1.5">
        <HStack gap={2} vAlign="center" hAlign="between">
          <Heading level={3}>{t('blockedByTitle')}</Heading>
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
        </HStack>
        {task.blockedBy.length ? (
          <ul className="grid gap-1">
            {task.blockedBy.map((b) => (
              <li key={b.id} className="flex min-w-0 items-center gap-2">
                <TaskLink task={b} onOpen={onOpen} />
                {can && (
                  <IconButton
                    label={t('removeDependency', { reference: b.reference })}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={XIcon} />}
                    onClick={() =>
                      removeDep.mutateAsync(b.reference).catch((err) => toast.error(errorText(err)))
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Text type="supporting">{t('noDependencies')}</Text>
        )}
      </div>
      {task.blocking.length > 0 && (
        <div className="grid gap-1.5">
          <Heading level={3}>{t('blockingTitle')}</Heading>
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
        <HStack gap={2} vAlign="center" hAlign="between">
          <Heading level={3}>{t('parent')}</Heading>
          {can && (
            <TaskPicker
              projectKey={task.project.key}
              excludeIds={[task.id, ...task.children.map((c) => c.id)]}
              label={task.parent ? t('changeParent') : t('setParent')}
              onPick={(picked) => void update({ parentId: picked.id })}
            />
          )}
        </HStack>
        {task.parent ? (
          <div className="flex min-w-0 items-center gap-2">
            <Icon icon={CornerLeftUpIcon} size="sm" color="secondary" />
            <TaskLink task={task.parent} onOpen={onOpen} />
            {can && (
              <IconButton
                label={t('clearParent')}
                variant="ghost"
                size="sm"
                icon={<Icon icon={XIcon} />}
                onClick={() => void update({ parentId: null })}
              />
            )}
          </div>
        ) : (
          <Text type="supporting">{t('noParent')}</Text>
        )}
      </div>
      {task.children.length > 0 && (
        <div className="grid gap-1.5">
          <Heading level={3}>{t('children', { count: task.children.length })}</Heading>
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
      <MoreMenu
        label={t('more')}
        variant="secondary"
        size="sm"
        alignment="end"
        items={[
          ...(fullPage
            ? [{ label: t('openPage'), icon: ExternalLinkIcon, href: taskHref(task.reference) }]
            : []),
          { label: t('copyLink'), icon: LinkIcon, onClick: copy },
          ...(task.viewer.canDelete
            ? [
                { type: 'divider' as const },
                {
                  label: t('delete'),
                  icon: Trash2Icon,
                  variant: 'destructive' as const,
                  onClick: () => setConfirm(true),
                },
              ]
            : []),
        ]}
      />
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t('deleteTitle', { reference: task.reference })}
        description={t('deleteBody')}
        actionLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate(undefined)}
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
      <HStack gap={3} vAlign="center" wrap="wrap">
        <HStack gap={1.5} vAlign="center">
          <TaskTypeIcon type={task.type} label={false} />
          <Text type="code" weight="medium">
            {task.reference}
          </Text>
        </HStack>
        <Text type="supporting">{tt(task.type)}</Text>
        <Text type="supporting" aria-hidden>
          ·
        </Text>
        <Link href={projectHref(task.project.key)} color="secondary">
          {task.project.name}
        </Link>
      </HStack>
      <TitleEditor task={task} level={sheet ? 2 : 1} />
      <HStack gap={2} vAlign="center" wrap="wrap">
        <StatusMenu task={task} />
        <PriorityLabel priority={task.priority} />
        <span className="ml-auto flex gap-2">
          <TaskMenu
            task={task}
            fullPage={sheet}
            onDeleted={onDeleted ?? (() => router.push(projectHref(task.project.key)))}
          />
        </span>
      </HStack>
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
              <CardTitle>{t('project')}</CardTitle>
              <CardAction>
                <Button
                  label={t('openOnBoard')}
                  variant="ghost"
                  size="sm"
                  href={`${projectHref(task.project.key)}?view=board&task=${task.reference}`}
                />
              </CardAction>
            </CardHeader>
            <CardContent className="px-4">
              <Link href={projectHref(task.project.key)} color="primary" weight="medium">
                {task.project.key} · {task.project.name}
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
