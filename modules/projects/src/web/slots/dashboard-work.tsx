'use client';

import { usePlatform } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, ListTodoIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { MyTasks } from '../../contracts';
import { DueDate, KeyBadge, TaskStatusBadge } from '../components/badges';
import { localToday, taskHref } from '../lib';

/** "My tasks" on the home dashboard (`core.dashboard.work`): overdue and due this week, up to six. */
export default function DashboardMyTasks() {
  const t = useTranslations('projects.dashboard');
  const { user } = usePlatform();
  const today = localToday(user.timezone);
  const { data, isLoading } = useApiQuery<MyTasks>('/projects/me/tasks', undefined, {
    refetchInterval: 120_000,
  });
  const due = data ? [...data.groups.overdue, ...data.groups.today, ...data.groups.thisWeek] : [];
  const shown = due.slice(0, 6);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListTodoIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>
          {data
            ? t('summary', {
                overdue: data.groups.overdue.length,
                week: data.groups.today.length + data.groups.thisWeek.length,
              })
            : t('description')}
        </CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/projects/my-tasks">
              {t('open')}
              <ArrowRightIcon />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !shown.length ? (
          <p className="py-3 text-sm text-muted-foreground">{data?.total ? t('nothingDue') : t('nothing')}</p>
        ) : (
          <ul className="divide-y">
            {shown.map((task) => (
              <li key={task.id}>
                <Link
                  href={taskHref(task.reference)}
                  className="flex min-w-0 items-center gap-3 py-2.5 text-sm outline-none hover:underline focus-visible:underline"
                >
                  <KeyBadge projectKey={task.project.key} className="hidden sm:inline-flex" />
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.reference}</span>
                  <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  <TaskStatusBadge status={task.status} className="hidden md:inline-flex" />
                  <DueDate date={task.dueDate} status={task.status} today={today} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {due.length > shown.length && (
          <p className="pt-2 text-xs text-muted-foreground">
            {t('more', { count: due.length - shown.length })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
