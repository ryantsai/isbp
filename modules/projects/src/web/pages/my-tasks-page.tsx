'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { usePlatform } from '@isbp/sdk/web';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import { CircleCheckBigIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import {
  DUE_BUCKETS,
  type MyTasks,
  TASK_STATUSES,
  type TaskListItem,
  type TaskStatus,
} from '../../contracts';
import { DueDate, PriorityLabel, TaskStatusIcon, TaskTypeIcon } from '../components/badges';
import { useMoveTask } from '../components/task-actions';
import { localToday, taskHref, useSearchParam } from '../lib';
import { ProjectsTabs } from '../section-tabs';

const ALL = '__all__';

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
    <Selector
      label={t('changeStatus', { reference: task.reference })}
      isLabelHidden
      size="sm"
      width={160}
      value={task.status}
      isDisabled={isPending}
      onChange={(v) => void change(v as TaskStatus)}
      options={TASK_STATUSES.map((s) => ({ value: s, label: ts(s), icon: <TaskStatusIcon status={s} /> }))}
    />
  );
}

function TaskRow({ task, today }: { task: TaskListItem; today: string }) {
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <VStack gap={1} className="min-w-0">
        <HStack gap={2} vAlign="center" className="min-w-0">
          <TaskTypeIcon type={task.type} />
          <Text type="code" color="secondary">
            {task.reference}
          </Text>
          <StackItem size="fill" className="min-w-0">
            <span className="block truncate">
              <Link href={taskHref(task.reference)} color="primary" weight="medium">
                {task.title}
              </Link>
            </span>
          </StackItem>
        </HStack>
        <HStack gap={3} vAlign="center" wrap="wrap" className="min-w-0">
          {/* The reference already starts with the project key: the name is enough here. */}
          <span className="min-w-0 truncate" title={task.project.key}>
            <Text type="supporting">{task.project.name}</Text>
          </span>
          <PriorityLabel priority={task.priority} compact />
          <DueDate date={task.dueDate} status={task.status} today={today} />
        </HStack>
      </VStack>
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
            <Selector
              label={t('filterProject')}
              isLabelHidden
              width={224}
              value={project ?? ALL}
              onChange={(v) => setProject(v === ALL ? null : v)}
              options={[
                { value: ALL, label: t('allProjects') },
                ...projects.map(([key, name]) => ({ value: key, label: `${key} · ${name}` })),
              ]}
            />
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
                    <CardTitle id={`my-${g}`} className="flex items-center gap-2">
                      {t(`groups.${g}`)}
                      <Badge
                        variant={g === 'overdue' ? 'error' : 'neutral'}
                        label={String(data.groups[g].length)}
                      />
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
