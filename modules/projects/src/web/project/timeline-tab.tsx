'use client';

import { usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Kbd } from '@isbp/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { toast } from '@isbp/ui/sonner';
import { Skeleton } from '@isbp/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import { ChartGanttIcon, CircleHelpIcon, DiamondIcon, TableIcon, TriangleAlertIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  addDays,
  daysBetween,
  type Milestone,
  type ProjectDetail,
  type Timeline,
  type TimelineTask,
  weekStart,
} from '../../contracts';
import { TaskStatusBadge, TaskStatusIcon, TaskTypeIcon } from '../components/badges';
import { useTaskErrorText } from '../components/task-actions';
import { dateValue, INVALIDATE, isClosed, localToday, projectApi, taskApi, useSearchParam } from '../lib';
import { TaskFilters, useTaskFilters } from './task-filters';

type Zoom = 'week' | 'month' | 'quarter';
const ZOOMS: Zoom[] = ['week', 'month', 'quarter'];
const DAY_WIDTH: Record<Zoom, number> = { week: 36, month: 14, quarter: 5 };
const ROW = 36;

type Row =
  | { kind: 'group'; key: string; milestone: Milestone | null; count: number }
  | { kind: 'task'; key: string; task: TimelineTask };

interface Span {
  start: string;
  end: string;
}

const spanOf = (t: TimelineTask): Span => ({
  start: t.startDate ?? t.dueDate!,
  end: t.dueDate ?? t.startDate!,
});

/** Segmented toggle buttons (aria-pressed). */
function Toggle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border bg-background p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5',
            value === o.value && 'bg-secondary text-foreground',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function KeyboardHelp() {
  const t = useTranslations('projects.timeline.help');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <CircleHelpIcon />
          {t('button')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        <h3 className="mb-2 font-semibold">{t('title')}</h3>
        <ul className="grid gap-1.5 text-muted-foreground">
          <li>
            <Kbd>Tab</Kbd> {t('tab')}
          </li>
          <li>
            <Kbd>Enter</Kbd> {t('enter')}
          </li>
          <li>
            <Kbd>Alt</Kbd> + <Kbd>←</Kbd> / <Kbd>→</Kbd> {t('shift')}
          </li>
          <li>
            <Kbd>Alt</Kbd> + <Kbd>Shift</Kbd> + <Kbd>←</Kbd> / <Kbd>→</Kbd> {t('resize')}
          </li>
          <li>{t('pointer')}</li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** A task bar: focusable button; drag to move, drag an edge to resize, Alt+arrows to shift. */
function Bar({
  task,
  span,
  x,
  dayWidth,
  canEdit,
  warning,
  helpId,
  onOpen,
  onCommit,
}: {
  task: TimelineTask;
  span: Span;
  x: (day: string) => number;
  dayWidth: number;
  canEdit: boolean;
  warning: string | null;
  helpId: string;
  onOpen: () => void;
  onCommit: (span: Span) => void;
}) {
  const t = useTranslations('projects.timeline');
  const ts = useTranslations('projects.taskStatus');
  const format = useFormatter();
  const [preview, setPreview] = useState<Span | null>(null);
  const drag = useRef<{ mode: 'move' | 'start' | 'end'; originX: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const shown = preview ?? span;
  const left = x(shown.start);
  const width = Math.max(dayWidth, x(addDays(shown.end, 1)) - left);
  const done = task.status === 'done';
  const fmt = (d: string) => format.dateTime(dateValue(d), { month: 'short', day: 'numeric' });

  const shift = (s: Span, mode: 'move' | 'start' | 'end', delta: number): Span => {
    if (mode === 'move') return { start: addDays(s.start, delta), end: addDays(s.end, delta) };
    if (mode === 'start') {
      const start = addDays(s.start, delta);
      return { start: start > s.end ? s.end : start, end: s.end };
    }
    const end = addDays(s.end, delta);
    return { start: s.start, end: end < s.start ? s.start : end };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canEdit || e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offset = e.clientX - rect.left;
    const edge = Math.min(8, rect.width / 4);
    drag.current = {
      mode: offset <= edge ? 'start' : offset >= rect.width - edge ? 'end' : 'move',
      originX: e.clientX,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.originX) / dayWidth);
    if (delta !== 0) d.moved = true;
    if (d.moved) setPreview(shift(span, d.mode, delta));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d?.moved) {
      suppressClick.current = true;
      const next = preview ?? span;
      setPreview(null);
      if (next.start !== span.start || next.end !== span.end) onCommit(next);
    }
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!canEdit || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    onCommit(shift(span, e.shiftKey ? 'end' : 'move', e.key === 'ArrowLeft' ? -1 : 1));
  };

  return (
    <button
      type="button"
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onOpen();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }}
      onKeyDown={onKeyDown}
      aria-label={t('barLabel', {
        reference: task.reference,
        title: task.title,
        start: fmt(shown.start),
        end: fmt(shown.end),
        status: ts(task.status),
      })}
      aria-describedby={
        [warning ? `${helpId}-${task.id}` : null, canEdit ? helpId : null].filter(Boolean).join(' ') ||
        undefined
      }
      className={cn(
        'group absolute top-1.5 flex h-6 items-center overflow-hidden rounded-md border text-left text-[11px] font-medium outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/60',
        canEdit && 'cursor-grab touch-none active:cursor-grabbing',
        isClosed(task.status)
          ? 'border-success/40 bg-success/15 text-foreground'
          : 'border-primary/40 bg-primary/15 text-foreground',
        task.status === 'cancelled' && 'border-dashed opacity-70',
        preview && 'ring-2 ring-primary/50',
      )}
      style={{ left, width }}
    >
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0', done ? 'bg-success/35' : 'bg-primary/30')}
        style={{ width: `${Math.round(task.progress * 100)}%` }}
      />
      {canEdit && (
        <>
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize group-hover:bg-primary/30"
          />
          <span
            aria-hidden
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize group-hover:bg-primary/30"
          />
        </>
      )}
      <span className="relative flex min-w-0 items-center gap-1 px-1.5">
        {warning && <TriangleAlertIcon className="size-3 shrink-0 text-warning-foreground" aria-hidden />}
        <span className="truncate">{width > 60 ? task.title : ''}</span>
      </span>
      {warning && (
        <span id={`${helpId}-${task.id}`} className="sr-only">
          {warning}
        </span>
      )}
    </button>
  );
}

function TimelineChart({
  data,
  zoom,
  today,
  helpId,
}: {
  data: Timeline;
  zoom: Zoom;
  today: string;
  helpId: string;
}) {
  const t = useTranslations('projects.timeline');
  const format = useFormatter();
  const [, openTask] = useSearchParam('task');
  const dayWidth = DAY_WIDTH[zoom];

  // Optimistic dates while a PATCH is in flight (dropped when new timeline data arrives).
  const [pending, setPending] = useState<{ base: Timeline; spans: Record<string, Span> } | null>(null);
  const spans = pending && pending.base === data ? pending.spans : {};
  const spanFor = (task: TimelineTask) => spans[task.id] ?? spanOf(task);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const groups = [
      ...data.milestones.map((m) => ({ milestone: m as Milestone | null })),
      { milestone: null },
    ];
    for (const g of groups) {
      const list = data.tasks.filter((x) => (x.milestoneId ?? null) === (g.milestone?.id ?? null));
      if (!list.length && !g.milestone) continue;
      out.push({
        kind: 'group',
        key: `g:${g.milestone?.id ?? 'none'}`,
        milestone: g.milestone,
        count: list.length,
      });
      for (const task of list) out.push({ kind: 'task', key: task.id, task });
    }
    return out;
  }, [data]);

  const range = useMemo(() => {
    const days = [
      today,
      ...data.tasks.flatMap((x) => [x.startDate, x.dueDate]),
      ...data.milestones.map((m) => m.dueDate),
      data.project.startDate,
      data.project.targetDate,
    ].filter((d): d is string => Boolean(d));
    const min = days.reduce((a, b) => (a < b ? a : b));
    const max = days.reduce((a, b) => (a > b ? a : b));
    const start = weekStart(addDays(min, -3));
    const end = addDays(weekStart(addDays(max, 7)), 6);
    return { start, end, days: daysBetween(start, end) + 1 };
  }, [data, today]);

  const x = (day: string) => daysBetween(range.start, day) * dayWidth;
  const width = range.days * dayWidth;
  const rowIndex = new Map(rows.map((r, i) => [r.key, i]));
  const byId = new Map(data.tasks.map((x) => [x.id, x]));

  // Header ticks: days (week zoom), weeks (month zoom) or months (quarter zoom).
  const ticks = useMemo(() => {
    const out: { day: string; label: string; major: boolean }[] = [];
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
      const date = dateValue(d);
      const first = d.endsWith('-01');
      if (zoom === 'week')
        out.push({ day: d, label: String(date.getDate()), major: first || d === range.start });
      else if (zoom === 'month' && daysBetween(range.start, d) % 7 === 0)
        out.push({ day: d, label: format.dateTime(date, { month: 'short', day: 'numeric' }), major: false });
      else if (zoom === 'quarter' && (first || d === range.start))
        out.push({ day: d, label: format.dateTime(date, { month: 'short', year: '2-digit' }), major: true });
    }
    return out;
  }, [range, zoom, format]);
  const months = useMemo(() => {
    if (zoom === 'quarter') return [];
    const out: { day: string; label: string }[] = [];
    for (let d = range.start; d <= range.end; d = addDays(d, 1))
      if (d === range.start || d.endsWith('-01'))
        out.push({ day: d, label: format.dateTime(dateValue(d), { month: 'long', year: 'numeric' }) });
    return out;
  }, [range, zoom, format]);

  const setDates = useSetDates();
  const update = (task: TimelineTask, span: Span) => {
    setPending((p) => ({ base: data, spans: { ...(p && p.base === data ? p.spans : {}), [task.id]: span } }));
    void setDates(task.reference, span).then((ok) => {
      if (!ok) setPending(null);
    });
  };

  const warningOf = (task: TimelineTask) => {
    const own = spanFor(task);
    const late = data.dependencies
      .filter((d) => d.taskId === task.id)
      .map((d) => byId.get(d.dependsOnId))
      .filter((dep): dep is TimelineTask => Boolean(dep && !isClosed(dep.status)))
      .filter((dep) => own.start <= spanFor(dep).end);
    return late.length
      ? t('startsBeforeDependency', { refs: late.map((d) => d.reference).join(', ') })
      : null;
  };

  const height = rows.length * ROW;
  const todayX = x(today) + dayWidth / 2;

  // Open on today (a quarter of the way in), and again when the zoom changes.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const label = el.querySelector<HTMLElement>('[data-timeline-label]')?.offsetWidth ?? 0;
    el.scrollLeft = Math.max(0, todayX - (el.clientWidth - label) / 4);
  }, [todayX]);

  return (
    <div
      ref={scroller}
      className="relative min-w-0 overflow-x-auto rounded-xl border bg-card [--label:10rem] sm:[--label:16rem]"
      role="region"
      aria-label={t('chartLabel')}
      tabIndex={0}
    >
      <div className="relative" style={{ width: `calc(var(--label) + ${width}px)` }}>
        {/* Header */}
        <div
          className="sticky top-0 z-20 grid border-b bg-card"
          style={{ gridTemplateColumns: `var(--label) ${width}px` }}
        >
          <div
            data-timeline-label
            className="sticky left-0 z-10 flex items-end border-r bg-card px-3 pb-1.5 text-xs font-medium text-muted-foreground"
          >
            {t('task')}
          </div>
          <div className="relative h-12" aria-hidden>
            {months.map((m) => (
              <span
                key={m.day}
                className="absolute top-1 border-l pl-1 text-xs font-medium whitespace-nowrap text-foreground"
                style={{ left: x(m.day) }}
              >
                {m.label}
              </span>
            ))}
            {ticks.map((tick) => (
              <span
                key={tick.day}
                className={cn(
                  'absolute bottom-1 text-[10px] whitespace-nowrap text-muted-foreground',
                  zoom === 'week' && 'w-9 text-center',
                  zoom !== 'week' && 'border-l pl-1',
                  tick.day === today && 'font-semibold text-primary',
                )}
                style={{ left: x(tick.day) }}
              >
                {tick.label}
              </span>
            ))}
            <span className="absolute bottom-0 h-1.5 w-px bg-destructive" style={{ left: todayX }} />
          </div>
        </div>

        {/* Body */}
        <div className="relative">
          {/* Weekend shading and the today line (week/month zoom), behind the rows. */}
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{ left: 'var(--label)', width }}
            aria-hidden
          >
            {zoom !== 'quarter' &&
              Array.from({ length: Math.ceil(range.days / 7) }, (_, w) => (
                <span
                  key={w}
                  className="absolute inset-y-0 bg-muted/50"
                  style={{ left: (w * 7 + 5) * dayWidth, width: 2 * dayWidth }}
                />
              ))}
            <span className="absolute inset-y-0 w-px bg-destructive/70" style={{ left: todayX }} />
          </div>

          <ul aria-label={t('rowsLabel')}>
            {rows.map((row) =>
              row.kind === 'group' ? (
                <li
                  key={row.key}
                  className="relative grid border-b bg-muted/30"
                  style={{ gridTemplateColumns: `var(--label) ${width}px`, height: ROW }}
                >
                  <div className="sticky left-0 z-10 flex min-w-0 items-center gap-2 border-r bg-muted px-3 text-xs font-semibold">
                    <DiamondIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="truncate">{row.milestone?.name ?? t('noMilestone')}</span>
                    <span className="ml-auto text-muted-foreground tabular-nums">{row.count}</span>
                  </div>
                  <div className="relative">
                    {row.milestone?.dueDate && (
                      <span
                        role="img"
                        aria-label={t('milestoneLabel', {
                          name: row.milestone.name,
                          date: format.dateTime(dateValue(row.milestone.dueDate), { dateStyle: 'medium' }),
                        })}
                        className={cn(
                          'absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2',
                          row.milestone.status === 'done'
                            ? 'border-success bg-success'
                            : 'border-primary bg-card',
                        )}
                        style={{ left: x(row.milestone.dueDate) + dayWidth / 2 }}
                      />
                    )}
                  </div>
                </li>
              ) : (
                <li
                  key={row.key}
                  className="relative grid border-b last:border-b-0"
                  style={{ gridTemplateColumns: `var(--label) ${width}px`, height: ROW }}
                >
                  <div className="sticky left-0 z-10 flex min-w-0 items-center gap-1.5 border-r bg-card px-3 text-xs">
                    <TaskTypeIcon type={row.task.type} label={false} className="size-3.5" />
                    <span className="shrink-0 font-mono text-muted-foreground">{row.task.reference}</span>
                    <span className="truncate">{row.task.title}</span>
                  </div>
                  <div className="relative">
                    <Bar
                      task={row.task}
                      span={spanFor(row.task)}
                      x={x}
                      dayWidth={dayWidth}
                      canEdit={data.canEdit && row.task.status !== 'cancelled'}
                      warning={warningOf(row.task)}
                      helpId={helpId}
                      onOpen={() => openTask(row.task.reference)}
                      onCommit={(span) => update(row.task, span)}
                    />
                  </div>
                </li>
              ),
            )}
          </ul>

          {/* Dependency arrows (finish → start). The table view lists the same dependencies. */}
          <svg
            className="pointer-events-none absolute top-0 overflow-visible"
            style={{ left: 'var(--label)' }}
            width={width}
            height={height}
            aria-hidden
          >
            <defs>
              <marker
                id="pj-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" className="fill-muted-foreground" />
              </marker>
              <marker
                id="pj-arrow-late"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" className="fill-destructive" />
              </marker>
            </defs>
            {data.dependencies.map((d) => {
              const from = byId.get(d.dependsOnId);
              const to = byId.get(d.taskId);
              const fi = rowIndex.get(d.dependsOnId);
              const ti = rowIndex.get(d.taskId);
              if (!from || !to || fi === undefined || ti === undefined) return null;
              const x1 = x(addDays(spanFor(from).end, 1));
              const y1 = fi * ROW + ROW / 2;
              const x2 = x(spanFor(to).start);
              const y2 = ti * ROW + ROW / 2;
              const late = !isClosed(from.status) && spanFor(to).start <= spanFor(from).end;
              const mid = y2 > y1 ? y1 + ROW / 2 : y1 - ROW / 2;
              const path =
                x2 >= x1 + 12
                  ? `M${x1},${y1} H${x1 + 6} V${y2} H${x2 - 1}`
                  : `M${x1},${y1} H${x1 + 6} V${mid} H${x2 - 8} V${y2} H${x2 - 1}`;
              return (
                <path
                  key={`${d.taskId}:${d.dependsOnId}`}
                  d={path}
                  fill="none"
                  strokeWidth={1.25}
                  className={late ? 'stroke-destructive' : 'stroke-muted-foreground/70'}
                  markerEnd={`url(#${late ? 'pj-arrow-late' : 'pj-arrow'})`}
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

/** PATCHes new dates, one request at a time (so quick Alt+arrow presses apply in order). */
function useSetDates() {
  const errorText = useTaskErrorText();
  const mutation = useApiMutation(
    (api, v: { ref: string; span: Span }) =>
      api.patch(taskApi(v.ref), { startDate: v.span.start, dueDate: v.span.end }),
    { invalidate: INVALIDATE, silent: true },
  );
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const { mutateAsync } = mutation;
  return useCallback(
    (ref: string, span: Span) => {
      const run = queue.current.then(() =>
        mutateAsync({ ref, span }).then(
          () => true,
          (err: unknown) => {
            toast.error(errorText(err));
            return false;
          },
        ),
      );
      queue.current = run;
      return run;
    },
    [mutateAsync, errorText],
  );
}

function TimelineTable({ data, today }: { data: Timeline; today: string }) {
  const t = useTranslations('projects.timeline');
  const tf = useTranslations('projects.fields');
  const format = useFormatter();
  const [, openTask] = useSearchParam('task');
  const byId = new Map(data.tasks.map((x) => [x.id, x]));
  const milestoneName = new Map(data.milestones.map((m) => [m.id, m.name]));
  const fmt = (d: string | null) => (d ? format.dateTime(dateValue(d), { dateStyle: 'medium' }) : '—');
  return (
    <div className="grid min-w-0 gap-4">
      <div className="relative min-w-0 overflow-x-auto rounded-xl border bg-card">
        <Table aria-label={t('tableLabel')}>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>{tf('reference')}</TableHead>
              <TableHead>{tf('title')}</TableHead>
              <TableHead>{tf('startDate')}</TableHead>
              <TableHead>{tf('dueDate')}</TableHead>
              <TableHead>{tf('status')}</TableHead>
              <TableHead>{t('dependsOn')}</TableHead>
              <TableHead>{tf('milestone')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.tasks.map((task) => {
              const deps = data.dependencies
                .filter((d) => d.taskId === task.id)
                .map((d) => byId.get(d.dependsOnId)?.reference)
                .filter(Boolean);
              const overdue = task.dueDate && task.dueDate < today && !isClosed(task.status);
              return (
                <TableRow key={task.id}>
                  <TableCell className="font-mono text-xs">{task.reference}</TableCell>
                  <TableCell className="max-w-72">
                    <button
                      type="button"
                      className="block max-w-full truncate text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                      onClick={() => openTask(task.reference)}
                    >
                      {task.title}
                    </button>
                  </TableCell>
                  <TableCell>{fmt(task.startDate)}</TableCell>
                  <TableCell className={cn(overdue && 'font-medium text-destructive')}>
                    {fmt(task.dueDate)}
                    {overdue && <span className="sr-only"> ({t('overdue')})</span>}
                  </TableCell>
                  <TableCell>
                    <TaskStatusBadge status={task.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{deps.length ? deps.join(', ') : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {task.milestoneId ? (milestoneName.get(task.milestoneId) ?? '—') : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {data.milestones.length > 0 && (
        <div className="relative min-w-0 overflow-x-auto rounded-xl border bg-card">
          <Table aria-label={t('milestonesLabel')}>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>{tf('milestone')}</TableHead>
                <TableHead>{tf('dueDate')}</TableHead>
                <TableHead>{tf('status')}</TableHead>
                <TableHead>{t('progress')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.milestones.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{fmt(m.dueDate)}</TableCell>
                  <TableCell>{t(`milestoneStatus.${m.status}`)}</TableCell>
                  <TableCell>{t('milestoneProgress', { done: m.doneCount, total: m.taskCount })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** Gantt chart: bars from start to due, milestones, dependency arrows, today line, zoom and a table view. */
export function TimelineTab({ project }: { project: ProjectDetail }) {
  const t = useTranslations('projects.timeline');
  const { user } = usePlatform();
  const today = localToday(user.timezone);
  const helpId = useId();
  const { query, str } = useTaskFilters();
  const [zoomParam, setZoom] = useSearchParam('zoom');
  const [layout, setLayout] = useSearchParam('layout');
  const [, openTask] = useSearchParam('task');
  const zoom: Zoom = ZOOMS.includes(zoomParam as Zoom) ? (zoomParam as Zoom) : 'month';
  const asTable = layout === 'table';
  const { data, isLoading } = useApiQuery<Timeline>(`${projectApi(project.key)}/timeline`, {
    ...query,
    closed: str('closed') === 'false' ? 'false' : undefined,
  });
  return (
    <div className="grid min-w-0 gap-4">
      <TaskFilters project={project} extra="closed" />
      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          label={t('viewLabel')}
          value={asTable ? 'table' : 'chart'}
          onChange={(v) => setLayout(v === 'table' ? 'table' : null)}
          options={[
            { value: 'chart', label: t('chart'), icon: <ChartGanttIcon aria-hidden /> },
            { value: 'table', label: t('viewAsTable'), icon: <TableIcon aria-hidden /> },
          ]}
        />
        {!asTable && (
          <Toggle
            label={t('zoomLabel')}
            value={zoom}
            onChange={(z) => setZoom(z === 'month' ? null : z)}
            options={ZOOMS.map((z) => ({ value: z, label: t(`zoom.${z}`) }))}
          />
        )}
        <span className="ml-auto">{!asTable && <KeyboardHelp />}</span>
      </div>
      {isLoading || !data ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : !data.tasks.length && !data.unscheduled.length ? (
        <EmptyState icon={<ChartGanttIcon />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <>
          {data.tasks.length > 0 &&
            (asTable ? (
              <TimelineTable data={data} today={today} />
            ) : (
              <>
                <p id={helpId} className="sr-only">
                  {t('help.summary')}
                </p>
                <TimelineChart data={data} zoom={zoom} today={today} helpId={helpId} />
              </>
            ))}
          {data.unscheduled.length > 0 && (
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>{t('unscheduled', { count: data.unscheduled.length })}</CardTitle>
                <CardDescription>{t('unscheduledHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {data.unscheduled.map((task) => (
                    <li key={task.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => openTask(task.reference)}
                        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <TaskStatusIcon status={task.status} className="text-muted-foreground" />
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {task.reference}
                        </span>
                        <span className="min-w-0 truncate">{task.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
