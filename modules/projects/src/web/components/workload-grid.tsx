'use client';

import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { Popover, PopoverContent, PopoverTrigger } from '@isbp/ui/popover';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ChevronLeftIcon, ChevronRightIcon, TriangleAlertIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { addDays, type Workload, type WorkloadCell } from '../../contracts';
import { dateValue, taskHref, useSearchParam } from '../lib';

const fmtHours = (n: number) => (Math.round(n * 10) / 10).toString();

function CellButton({
  cell,
  person,
  onOpenTask,
  unassigned,
}: {
  cell: WorkloadCell;
  person: string;
  onOpenTask?: (reference: string) => void;
  /** Unassigned work has no capacity to compare with. */
  unassigned?: boolean;
}) {
  const t = useTranslations('projects.workload');
  const format = useFormatter();
  const over = cell.overBy > 0;
  const pct =
    cell.capacity > 0 ? Math.min(100, (cell.planned / cell.capacity) * 100) : cell.planned > 0 ? 100 : 0;
  const week = format.dateTime(dateValue(cell.week), { month: 'short', day: 'numeric' });
  const empty = cell.planned === 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={empty}
          aria-label={
            unassigned
              ? t('unassignedCellLabel', { week, planned: fmtHours(cell.planned) })
              : t('cellLabel', {
                  person,
                  week,
                  planned: fmtHours(cell.planned),
                  capacity: fmtHours(cell.capacity),
                })
          }
          className={cn(
            'grid w-full gap-1 rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 enabled:hover:bg-accent disabled:cursor-default',
            over && 'bg-destructive/5',
          )}
        >
          <span className={cn('text-xs tabular-nums', empty ? 'text-muted-foreground' : 'font-medium')}>
            {unassigned
              ? t('hours', { hours: fmtHours(cell.planned) })
              : t('hoursOf', { planned: fmtHours(cell.planned), capacity: fmtHours(cell.capacity) })}
          </span>
          <span
            className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', unassigned && 'hidden')}
            aria-hidden
          >
            <span
              className={cn('block h-full rounded-full', over ? 'bg-destructive' : 'bg-primary')}
              style={{ width: `${pct}%` }}
            />
          </span>
          {over && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
              <TriangleAlertIcon className="size-3 shrink-0" aria-hidden />
              {t('overBy', { hours: fmtHours(cell.overBy) })}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <h3 className="text-sm font-semibold">{t('tasksTitle', { person, week })}</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          {unassigned
            ? t('hours', { hours: fmtHours(cell.planned) })
            : t('hoursOf', { planned: fmtHours(cell.planned), capacity: fmtHours(cell.capacity) })}
        </p>
        <ul className="grid max-h-72 gap-1 overflow-y-auto">
          {cell.tasks.map((task) => (
            <li key={task.id} className="flex min-w-0 items-center gap-2 text-sm">
              {onOpenTask ? (
                <button
                  type="button"
                  onClick={() => onOpenTask(task.reference)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.reference}</span>
                  <span className="min-w-0 truncate">{task.title}</span>
                </button>
              ) : (
                <Link
                  href={taskHref(task.reference)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.reference}</span>
                  <span className="min-w-0 truncate">{task.title}</span>
                </Link>
              )}
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t('hours', { hours: fmtHours(task.hours) })}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * People × weeks: planned hours against capacity, over-allocation marked with an icon and "Over by 6 h".
 * Clicking a cell lists that person's tasks that week. `path` is the workload endpoint.
 */
export function WorkloadGrid({ path, inSheet }: { path: string; inSheet?: boolean }) {
  const t = useTranslations('projects.workload');
  const format = useFormatter();
  const [from, setFrom] = useSearchParam('from');
  const [, openTask] = useSearchParam('task');
  const { data, isLoading } = useApiQuery<Workload>(path, { from: from ?? undefined, weeks: 8 });
  if (isLoading || !data) return <Skeleton className="h-80 w-full rounded-xl" />;
  const rows = [...data.people];
  const weekLabel = (w: string) => format.dateTime(dateValue(w), { month: 'short', day: 'numeric' });
  const overCount = rows.filter((p) => p.cells.some((c) => c.overBy > 0)).length;
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('previous')}
            onClick={() => setFrom(addDays(data.from, -7 * data.weeks.length))}
          >
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" size="sm" disabled={!from} onClick={() => setFrom(null)}>
            {t('thisWeek')}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('next')}
            onClick={() => setFrom(addDays(data.from, 7 * data.weeks.length))}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('range', {
            from: weekLabel(data.weeks[0]!),
            to: format.dateTime(dateValue(addDays(data.weeks[data.weeks.length - 1]!, 6)), {
              month: 'short',
              day: 'numeric',
            }),
          })}
        </p>
        <p className="ml-auto text-xs text-muted-foreground">
          {t('capacityHint', { hours: data.hoursPerWeek })}
        </p>
      </div>
      {overCount > 0 && (
        <p role="status" className="flex items-center gap-2 text-sm font-medium text-destructive">
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
          {t('overSummary', { count: overCount })}
        </p>
      )}
      {!rows.length && !data.unassigned.some((c) => c.planned > 0) ? (
        <EmptyState icon={<UsersIcon />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <div
          className="relative min-w-0 overflow-x-auto rounded-xl border bg-card shadow-xs"
          role="region"
          aria-label={t('tableLabel')}
          tabIndex={0}
        >
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <caption className="sr-only">{t('caption')}</caption>
            <thead className="bg-muted/40">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 w-48 border-b bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                >
                  {t('person')}
                </th>
                {data.weeks.map((w) => (
                  <th
                    key={w}
                    scope="col"
                    className={cn(
                      'border-b px-2 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground',
                      w <= data.today && data.today <= addDays(w, 6) && 'text-primary',
                    )}
                  >
                    {t('weekOf', { date: weekLabel(w) })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.user.id} className="border-b last:border-b-0">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-normal">
                    <span className="flex min-w-0 items-center gap-2">
                      <UserAvatar
                        name={p.user.displayName}
                        src={p.user.avatarUrl}
                        className="size-6 text-[10px]"
                      />
                      <span className="grid min-w-0">
                        <span className="truncate font-medium">{p.user.displayName}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {p.projects.length > 1
                            ? p.projects.map((x) => `${x.key} ${x.allocationPct}%`).join(' · ')
                            : t('allocation', { pct: p.allocationPct })}
                        </span>
                      </span>
                    </span>
                  </th>
                  {p.cells.map((c) => (
                    <td key={c.week} className="px-1 py-1 align-top">
                      <CellButton
                        cell={c}
                        person={p.user.displayName}
                        onOpenTask={inSheet ? (ref) => openTask(ref) : undefined}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="bg-muted/20">
                <th scope="row" className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">
                  {t('unassigned')}
                </th>
                {data.unassigned.map((c) => (
                  <td key={c.week} className="px-1 py-1 align-top">
                    <CellButton
                      unassigned
                      cell={c}
                      person={t('unassigned')}
                      onOpenTask={inSheet ? (ref) => openTask(ref) : undefined}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
