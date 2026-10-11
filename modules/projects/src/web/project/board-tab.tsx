'use client';

import {
  type Announcements,
  closestCorners,
  type KeyboardCoordinateGetter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card as SurfaceCard } from '@astryxdesign/core/Card';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { useListState } from '@isbp/ui/data-table';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowRightLeftIcon,
  BanIcon,
  GripVerticalIcon,
  LinkIcon,
  MessageSquareIcon,
  PanelRightOpenIcon,
  PlusIcon,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD_COLUMNS,
  type Board,
  type ProjectDetail,
  TASK_STATUSES,
  type TaskCard,
  type TaskStatus,
} from '../../contracts';
import { DueDate, PriorityLabel, TaskStatusIcon, TaskTypeIcon } from '../components/badges';
import { useMoveTask } from '../components/task-actions';
import { INVALIDATE, localToday, projectApi, useSearchParam } from '../lib';
import { TaskFilters, useTaskFilters } from './task-filters';

type Columns = Partial<Record<TaskStatus, TaskCard[]>>;

const columnId = (status: TaskStatus) => `column:${status}`;
const isColumnId = (id: UniqueIdentifier) => String(id).startsWith('column:');

function toColumns(board: Board | undefined): Columns {
  const out: Columns = {};
  for (const c of board?.columns ?? []) out[c.status] = c.tasks;
  return out;
}

function findColumn(columns: Columns, id: UniqueIdentifier): TaskStatus | null {
  if (isColumnId(id)) return String(id).slice('column:'.length) as TaskStatus;
  for (const [status, list] of Object.entries(columns))
    if (list?.some((t) => t.id === id)) return status as TaskStatus;
  return null;
}

/**
 * Keyboard moves: ← / → jump to the top of the neighbouring column, ↑ / ↓ move within a column (dnd-kit's
 * sortable coordinates).
 */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight')
    return sortableKeyboardCoordinates(event, args);
  event.preventDefault();
  const { collisionRect, droppableRects, droppableContainers } = args.context;
  if (!collisionRect) return undefined;
  const columns = droppableContainers
    .getEnabled()
    .filter((c) => isColumnId(c.id))
    .map((c) => ({ id: c.id, rect: droppableRects.get(c.id) }))
    .filter((c): c is { id: UniqueIdentifier; rect: NonNullable<typeof c.rect> } => Boolean(c.rect))
    .sort((a, b) => a.rect.left - b.rect.left);
  const center = collisionRect.left + collisionRect.width / 2;
  let current = columns.findIndex((c) => center >= c.rect.left && center <= c.rect.left + c.rect.width);
  if (current < 0)
    current = columns.reduce(
      (best, c, i) =>
        Math.abs(c.rect.left - collisionRect.left) < Math.abs(columns[best]!.rect.left - collisionRect.left)
          ? i
          : best,
      0,
    );
  const target = columns[current + (event.code === 'ArrowRight' ? 1 : -1)];
  if (!target) return undefined;
  return { x: target.rect.left + (target.rect.width - collisionRect.width) / 2, y: target.rect.top };
};

/* ───────────────────────────── card ───────────────────────────── */

function CountChip({ icon, text, srText }: { icon: ReactNode; text: number; srText: string }) {
  return (
    <HStack as="span" gap={1} vAlign="center">
      {icon}
      <span className="sr-only">{srText}</span>
      <Text type="supporting" aria-hidden hasTabularNumbers>
        {text}
      </Text>
    </HStack>
  );
}

function CardBody({
  task,
  today,
  onOpen,
  onMove,
  canEdit,
  handle,
}: {
  task: TaskCard;
  today: string;
  onOpen?: () => void;
  onMove?: (status: TaskStatus) => void;
  canEdit: boolean;
  handle?: ReactNode;
}) {
  const t = useTranslations('projects.board');
  const ts = useTranslations('projects.taskStatus');
  return (
    <VStack gap={2}>
      <HStack gap={1.5} vAlign="center">
        {handle}
        <TaskTypeIcon type={task.type} />
        <Text type="code" color="secondary">
          {task.reference}
        </Text>
        {canEdit && onMove && (
          <span className="ml-auto">
            <MoreMenu
              label={t('moveMenu', { reference: task.reference })}
              icon={<Icon icon={ArrowRightLeftIcon} />}
              size="sm"
              alignment="end"
              items={[
                {
                  type: 'section',
                  title: t('moveTo'),
                  items: TASK_STATUSES.filter((s) => s !== task.status).map((s) => ({
                    label: ts(s),
                    icon: <TaskStatusIcon status={s} />,
                    onClick: () => onMove(s),
                  })),
                },
                ...(onOpen
                  ? [
                      { type: 'divider' as const },
                      { label: t('open'), icon: PanelRightOpenIcon, onClick: onOpen },
                    ]
                  : []),
              ]}
            />
          </span>
        )}
      </HStack>
      <Link color="primary" weight="medium" maxLines={3} onClick={onOpen} className="text-start">
        {task.title}
      </Link>
      {task.labels.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={t('labels')}>
          {task.labels.slice(0, 3).map((l) => (
            <li key={l}>
              <Token label={l} size="sm" />
            </li>
          ))}
          {task.labels.length > 3 && (
            <li>
              <Text type="supporting">+{task.labels.length - 3}</Text>
            </li>
          )}
        </ul>
      )}
      <HStack gap={2} vAlign="center" wrap="wrap" className="min-w-0">
        <PriorityLabel priority={task.priority} compact />
        <DueDate date={task.dueDate} status={task.status} today={today} />
        {task.blocked && task.status !== 'done' && task.status !== 'cancelled' && (
          <Badge variant="warning" label={t('blocked')} icon={<Icon icon={BanIcon} size="xsm" />} />
        )}
        {task.commentCount > 0 && (
          <CountChip
            icon={<Icon icon={MessageSquareIcon} size="xsm" color="secondary" />}
            text={task.commentCount}
            srText={t('comments', { count: task.commentCount })}
          />
        )}
        {task.linkCount > 0 && (
          <CountChip
            icon={<Icon icon={LinkIcon} size="xsm" color="secondary" />}
            text={task.linkCount}
            srText={t('links', { count: task.linkCount })}
          />
        )}
        {task.assignee ? (
          <span className="ml-auto">
            <Tooltip content={task.assignee.displayName}>
              <span>
                <UserAvatar
                  name={task.assignee.displayName}
                  src={task.assignee.avatarUrl}
                  className="size-6 text-[10px]"
                />
                <span className="sr-only">{t('assignedTo', { name: task.assignee.displayName })}</span>
              </span>
            </Tooltip>
          </span>
        ) : (
          <span className="sr-only">{t('unassigned')}</span>
        )}
      </HStack>
    </VStack>
  );
}

function SortableCard({
  task,
  today,
  canEdit,
  onOpen,
  onMove,
  layoutAnimations,
}: {
  task: TaskCard;
  today: string;
  canEdit: boolean;
  onOpen: () => void;
  onMove: (status: TaskStatus) => void;
  layoutAnimations: boolean;
}) {
  const t = useTranslations('projects.board');
  const reduce = useReducedMotion();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({
      id: task.id,
      disabled: !canEdit,
      transition: reduce ? null : undefined,
    });
  const { onKeyDown, ...pointer } = (listeners ?? {}) as Record<string, (e: unknown) => void>;
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
  };
  return (
    <motion.li
      layout={layoutAnimations ? 'position' : false}
      transition={{ duration: 0.2 }}
      className="list-none"
    >
      <SurfaceCard
        ref={setNodeRef}
        style={style}
        {...pointer}
        padding={2}
        className={isDragging ? 'opacity-40' : canEdit ? 'cursor-grab active:cursor-grabbing' : undefined}
      >
        <CardBody
          task={task}
          today={today}
          canEdit={canEdit}
          onOpen={onOpen}
          onMove={onMove}
          handle={
            canEdit ? (
              <IconButton
                ref={setActivatorNodeRef}
                {...attributes}
                onKeyDown={onKeyDown as React.KeyboardEventHandler}
                label={t('dragHandle', { reference: task.reference })}
                variant="ghost"
                size="sm"
                icon={<Icon icon={GripVerticalIcon} size="xsm" />}
              />
            ) : null
          }
        />
      </SurfaceCard>
    </motion.li>
  );
}

/* ───────────────────────────── column ───────────────────────────── */

function QuickAdd({ projectKey, status }: { projectKey: string; status: TaskStatus }) {
  const t = useTranslations('projects.board');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const create = useApiMutation(
    (api, body: { title: string; status: TaskStatus }) =>
      api.post(`${projectApi(projectKey)}/tasks`, { ...body, position: 'top' }),
    { invalidate: INVALIDATE, success: t('created'), onSuccess: () => setTitle('') },
  );
  if (!open)
    return (
      <Button
        label={t('addTask')}
        variant="ghost"
        size="sm"
        icon={<Icon icon={PlusIcon} />}
        onClick={() => setOpen(true)}
      />
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) create.mutate({ title: title.trim(), status });
      }}
    >
      <VStack gap={1.5}>
        <TextInput
          hasAutoFocus
          label={t('quickAddLabel')}
          isLabelHidden
          value={title}
          placeholder={t('quickAddPlaceholder')}
          isDisabled={create.isPending}
          onChange={(v) => setTitle(v.slice(0, 300))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setTitle('');
            }
          }}
        />
        <HStack gap={1.5}>
          <Button
            label={t('add')}
            variant="primary"
            size="sm"
            isLoading={create.isPending}
            isDisabled={!title.trim()}
            type="submit"
          />
          <Button label={t('done')} variant="ghost" size="sm" onClick={() => setOpen(false)} />
        </HStack>
      </VStack>
    </form>
  );
}

function Column({
  status,
  tasks,
  total,
  limit,
  projectKey,
  canEdit,
  today,
  onOpen,
  onMove,
  layoutAnimations,
}: {
  status: TaskStatus;
  tasks: TaskCard[];
  total: number;
  limit: number;
  projectKey: string;
  canEdit: boolean;
  today: string;
  onOpen: (task: TaskCard) => void;
  onMove: (task: TaskCard, status: TaskStatus) => void;
  layoutAnimations: boolean;
}) {
  const t = useTranslations('projects.board');
  const ts = useTranslations('projects.taskStatus');
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status), disabled: !canEdit });
  const headingId = `board-col-${status}`;
  return (
    <SurfaceCard
      role="region"
      aria-labelledby={headingId}
      variant={isOver ? 'blue' : 'muted'}
      padding={2}
      minHeight={192}
      className="flex min-w-0 flex-col gap-2"
    >
      <HStack as="header" gap={2} vAlign="center" paddingInline={1} paddingBlockStart={1}>
        <TaskStatusIcon status={status} />
        <Heading level={3} id={headingId}>
          {ts(status)}
        </Heading>
        <Badge
          variant="neutral"
          label={
            <>
              <span className="sr-only">{t('count', { count: total })}</span>
              <span aria-hidden>{total}</span>
            </>
          }
        />
      </HStack>
      {canEdit && status !== 'cancelled' && <QuickAdd projectKey={projectKey} status={status} />}
      <SortableContext items={tasks.map((x) => x.id)} strategy={verticalListSortingStrategy}>
        <ol ref={setNodeRef} className="flex min-h-16 flex-1 flex-col gap-2" aria-labelledby={headingId}>
          {tasks.map((task) => (
            <SortableCard
              key={task.id}
              task={task}
              today={today}
              canEdit={canEdit}
              onOpen={() => onOpen(task)}
              onMove={(s) => onMove(task, s)}
              layoutAnimations={layoutAnimations}
            />
          ))}
          {!tasks.length && (
            <li className="grid flex-1 place-items-center rounded-lg border border-dashed px-3 py-6 text-center">
              <Text type="supporting">{t('emptyColumn')}</Text>
            </li>
          )}
        </ol>
      </SortableContext>
      {total > tasks.length && (
        <Text type="supporting">{t('truncated', { shown: Math.min(limit, tasks.length), total })}</Text>
      )}
    </SurfaceCard>
  );
}

/* ───────────────────────────── board ───────────────────────────── */

/**
 * Kanban board. Cards move by dragging (pointer or keyboard: Space to pick up, arrows to move, Space to
 * drop) or with the "Move to…" menu. Moves are optimistic and roll back on error; the server computes
 * the rank from the neighbours.
 */
export function BoardTab({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.board');
  const ts = useTranslations('projects.taskStatus');
  const { user } = usePlatform();
  const today = localToday(user.timezone);
  const filters = useTaskFilters();
  const [, setTaskParam] = useSearchParam('task');
  const [state] = useListState();
  const showCancelled = state.cancelled === 'true';
  const { data, isLoading } = useApiQuery<Board>(`${projectApi(project.key)}/board`, {
    ...filters.query,
    cancelled: showCancelled ? 'true' : undefined,
  });
  const { move } = useMoveTask();
  const canEdit = project.viewer.canEditTasks;

  // Optimistic columns: kept while they belong to the board data they were derived from.
  const [override, setOverride] = useState<{ base: Board; columns: Columns } | null>(null);
  const columns = useMemo(
    () => (override && data && override.base === data ? override.columns : toColumns(data)),
    [override, data],
  );
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const snapshot = useRef<Columns | null>(null);
  const origin = useRef<TaskStatus | null>(null);
  const [layoutAnimations, setLayoutAnimations] = useState(true);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  );

  const statuses: TaskStatus[] = showCancelled ? [...BOARD_COLUMNS, 'cancelled'] : [...BOARD_COLUMNS];
  const all = statuses.flatMap((s) => columns[s] ?? []);
  const taskOf = (id: UniqueIdentifier) => all.find((x) => x.id === id);
  const active = activeId ? taskOf(activeId) : undefined;

  const setColumns = (next: Columns) => data && setOverride({ base: data, columns: next });

  const persist = async (task: TaskCard, status: TaskStatus, list: TaskCard[]) => {
    const index = list.findIndex((x) => x.id === task.id);
    try {
      await move({
        ref: task.reference,
        status,
        after: index > 0 ? list[index - 1]!.reference : null,
        before: index >= 0 && index < list.length - 1 ? list[index + 1]!.reference : null,
      });
    } catch {
      // Roll back: show the board as the server has it (nothing was refetched).
      setOverride(null);
    }
  };

  /** "Move to…" menu: to the top of another column. */
  const moveTo = (task: TaskCard, status: TaskStatus) => {
    const from = findColumn(columns, task.id);
    if (!from || from === status) return;
    const next: Columns = {
      ...columns,
      [from]: (columns[from] ?? []).filter((x) => x.id !== task.id),
      [status]: [{ ...task, status }, ...(columns[status] ?? [])],
    };
    setColumns(next);
    void persist(task, status, next[status]!);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    clearTimeout(settleTimer.current);
    setLayoutAnimations(false);
    setActiveId(active.id);
    snapshot.current = columns;
    origin.current = findColumn(columns, active.id);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = findColumn(columns, active.id);
    const to = findColumn(columns, over.id);
    if (!from || !to || from === to) return;
    const fromList = columns[from] ?? [];
    const toList = columns[to] ?? [];
    const moving = fromList.find((x) => x.id === active.id);
    if (!moving) return;
    const overIndex = isColumnId(over.id) ? toList.length : toList.findIndex((x) => x.id === over.id);
    const index = overIndex < 0 ? toList.length : overIndex;
    setColumns({
      ...columns,
      [from]: fromList.filter((x) => x.id !== active.id),
      [to]: [...toList.slice(0, index), { ...moving, status: to }, ...toList.slice(index)],
    });
  };

  const finish = () => {
    setActiveId(null);
    settleTimer.current = setTimeout(() => setLayoutAnimations(true), 300);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const before = snapshot.current ?? columns;
    finish();
    if (!over) {
      setOverride(null);
      return;
    }
    const to = findColumn(columns, active.id);
    if (!to) return;
    let list = columns[to] ?? [];
    const from = list.findIndex((x) => x.id === active.id);
    const overIndex = isColumnId(over.id) ? list.length - 1 : list.findIndex((x) => x.id === over.id);
    if (overIndex >= 0 && from !== overIndex) list = arrayMove(list, from, overIndex);
    const task = list.find((x) => x.id === active.id)!;
    const previous = origin.current ? (before[origin.current] ?? []) : [];
    const unchanged =
      origin.current === to &&
      previous.findIndex((x) => x.id === active.id) === list.findIndex((x) => x.id === active.id);
    if (unchanged) {
      setOverride(null);
      return;
    }
    setColumns({ ...columns, [to]: list });
    void persist(task, to, list);
  };

  const onDragCancel = () => {
    finish();
    setOverride(null);
  };

  /* Screen reader announcements (translated). */
  const describe = (id: UniqueIdentifier | undefined) => {
    if (id === undefined) return '';
    const status = findColumn(columns, id);
    if (!status) return '';
    if (isColumnId(id)) return t('announce.column', { column: ts(status) });
    const list = columns[status] ?? [];
    return t('announce.position', {
      position: list.findIndex((x) => x.id === id) + 1,
      total: list.length,
      column: ts(status),
    });
  };
  const nameOf = (id: UniqueIdentifier) => {
    const task = taskOf(id);
    return task ? `${task.reference} ${task.title}` : '';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('announce.start', { task: nameOf(active.id), where: describe(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t('announce.over', { task: nameOf(active.id), where: describe(over.id) })
        : t('announce.outside', { task: nameOf(active.id) }),
    onDragEnd: ({ active, over }) =>
      over
        ? t('announce.dropped', { task: nameOf(active.id), where: describe(over.id) })
        : t('announce.cancelled', { task: nameOf(active.id) }),
    onDragCancel: ({ active }) => t('announce.cancelled', { task: nameOf(active.id) }),
  };

  return (
    <div className="grid min-w-0 gap-4">
      <TaskFilters project={project} extra="cancelled" />
      {isLoading && !data ? (
        <div className="grid grid-flow-col gap-3 overflow-hidden">
          {BOARD_COLUMNS.map((s) => (
            <Skeleton key={s} className="h-80 w-64 rounded-xl" />
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: t('announce.instructions') },
          }}
        >
          {/* Columns scroll sideways inside this container on small screens; the page never does. */}
          <div
            className="relative -mx-1 min-w-0 overflow-x-auto px-1 pb-2"
            role="region"
            aria-label={t('region')}
            tabIndex={0}
          >
            <div className="grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3">
              {statuses.map((status) => (
                <Column
                  key={status}
                  status={status}
                  tasks={columns[status] ?? []}
                  total={
                    (data?.columns.find((c) => c.status === status)?.total ?? 0) +
                    ((columns[status]?.length ?? 0) -
                      (data?.columns.find((c) => c.status === status)?.tasks.length ?? 0))
                  }
                  limit={data?.limit ?? 200}
                  projectKey={project.key}
                  canEdit={canEdit}
                  today={today}
                  onOpen={(task) => setTaskParam(task.reference)}
                  onMove={moveTo}
                  layoutAnimations={layoutAnimations}
                />
              ))}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {active ? (
              <SurfaceCard padding={2} elevation="med" className="w-64 rotate-1">
                <CardBody task={active} today={today} canEdit={false} />
              </SurfaceCard>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
