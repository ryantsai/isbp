'use client';

import { usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { ProjectsTabs } from '../section-tabs';
import { useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { CircleCheckBigIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import {
  DUE_BUCKETS,
  type DueBucket,
  type MyTasks,
  TASK_STATUSES,
  type TaskListItem,
  type TaskStatus,
} from '../../contracts';
import { DueDate, PriorityLabel, TaskStatusIcon, TaskTypeIcon } from '../components/badges';
import { useMoveTask } from '../components/task-actions';
import { localToday, taskHref, useSearchParam } from '../lib';

const ALL = '__all__';
const TONE: Record<DueBucket, string> = {
  overdue: 'text-destructive',
  today: 'text-foreground',
  thisWeek: 'text-foreground',
  later: 'text-muted-foreground',
  noDate: 'text-muted-foreground',
};

function StatusQuickChange({ task }: { task: TaskListItem }) {
  const t = useTranslations('projects.myTasks');
  const ts = useTranslations('projects.taskStatus');
  const { move, isPending } = useMoveTask();
  const change = async (status: TaskStatus) => {
    const before = task.status;
    try {
      await move({ ref: task.reference, status });
    } catch {
      return;
    }
    // A closed task leaves this list: say so, with a way back.
    toast.success(t('moved', { reference: task.reference, status: ts(status) }), {
      action: {
        label: t('undo'),
        onClick: () => void move({ ref: task.reference, status: before }).catch(() => undefined),
      },
    });
  };
  return (
    <Select value={task.status} disabled={isPending} onValueChange={(v) => void change(v as TaskStatus)}>
      <SelectTrigger
        size="sm"
        className="w-full sm:w-40"
        aria-label={t('changeStatus', { reference: task.reference })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TASK_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            <TaskStatusIcon status={s} className="text-muted-foreground" />
            {ts(s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TaskRow({ task, today }: { task: TaskListItem; today: string }) {
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <TaskTypeIcon type={task.type} />
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.reference}</span>
          <Link
            href={taskHref(task.reference)}
            className="min-w-0 truncate text-sm font-medium outline-none hover:underline focus-visible:underline"
          >
            {task.title}
          </Link>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {/* The reference already starts with the project key: the name is enough here. */}
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={task.project.key}>
            {task.project.name}
          </span>
          <PriorityLabel priority={task.priority} compact />
          <DueDate date={task.dueDate} status={task.status} today={today} />
        </div>
      </div>
      <StatusQuickChange task={task} />
    </div>
  );
}

/** My open tasks across projects: Overdue, Today, This week, Later, No date — with quick status changes. */
export default function MyTasksPage() {
  const t = useTranslations('projects.myTasks');
  const { user } = usePlatform();
  const today = localToday(user.timezone);
  const [project, setProject] = useSearchParam('project');
  const { data, isLoading } = useApiQuery<MyTasks>('/projects/me/tasks', { project: project ?? undefined });
  // The project filter lists the projects of my unfiltered tasks.
  const all = useApiQuery<MyTasks>('/projects/me/tasks');
  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of DUE_BUCKETS)
      for (const x of all.data?.groups[g] ?? []) map.set(x.project.key, x.project.name);
    return [...map].sort((a, b) => a[0].localeCompare(b[0]));
  }, [all.data]);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          projects.length > 0 && (
            <Select value={project ?? ALL} onValueChange={(v) => setProject(v === ALL ? null : v)}>
              <SelectTrigger className="w-56" aria-label={t('filterProject')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('allProjects')}</SelectItem>
                {projects.map(([key, name]) => (
                  <SelectItem key={key} value={key}>
                    {key} · {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      />
      <ProjectsTabs />
      {isLoading || !data ? (
        <div className="grid gap-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : data.total === 0 ? (
        <EmptyState
          icon={<CircleCheckBigIcon />}
          title={t('empty')}
          description={t('emptyHint')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <AnimatedList className="grid">
          {DUE_BUCKETS.filter((g) => data.groups[g].length).map((g) => (
            <AnimatedItem key={g} className="pb-4 last:pb-0">
              <section aria-labelledby={`my-${g}`}>
                <Card className="min-w-0 gap-2">
                  <CardHeader>
                    <CardTitle id={`my-${g}`} className={cn('flex items-center gap-2', TONE[g])}>
                      {t(`groups.${g}`)}
                      <Badge variant={g === 'overdue' ? 'destructive' : 'muted'} className="tabular-nums">
                        {data.groups[g].length}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AnimatedList as="ul" className="divide-y">
                      {data.groups[g].map((task) => (
                        <AnimatedItem as="li" key={task.id}>
                          <TaskRow task={task} today={today} />
                        </AnimatedItem>
                      ))}
                    </AnimatedList>
                  </CardContent>
                </Card>
              </section>
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}
    </>
  );
}
