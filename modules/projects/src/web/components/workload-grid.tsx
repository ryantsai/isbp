'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Popover } from '@astryxdesign/core/Popover';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Heading, Text } from '@astryxdesign/core/Text';
import { UserAvatar } from '@isbp/ui/avatar';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ChevronLeftIcon, ChevronRightIcon, TriangleAlertIcon, UsersIcon } from 'lucide-react';
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
  const hours = unassigned
    ? t('hours', { hours: fmtHours(cell.planned) })
    : t('hoursOf', { planned: fmtHours(cell.planned), capacity: fmtHours(cell.capacity) });
  const label = unassigned
    ? t('unassignedCellLabel', { week, planned: fmtHours(cell.planned) })
    : t('cellLabel', {
        person,
        week,
        planned: fmtHours(cell.planned),
        capacity: fmtHours(cell.capacity),
      });
  const body = (
    <VStack gap={1} className="w-full">
      <Text
        type="supporting"
        weight={empty ? 'normal' : 'medium'}
        color={empty ? 'secondary' : 'primary'}
        hasTabularNumbers
      >
        {hours}
      </Text>
      {!unassigned && (
        <ProgressBar
          label={label}
          isLabelHidden
          aria-hidden
          value={pct}
          variant={over ? 'error' : 'accent'}
        />
      )}
      {over && (
        <Badge
          variant="error"
          label={t('overBy', { hours: fmtHours(cell.overBy) })}
          icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
        />
      )}
    </VStack>
  );
  // Nothing planned: plain content, not a button (there is no list of tasks to open).
  if (empty) return <VStack padding={1.5}>{body}</VStack>;
  return (
    <Popover
      label={t('tasksTitle', { person, week })}
      placement="below"
      width={320}
      content={
        <VStack gap={2}>
          <VStack gap={0.5}>
            <Heading level={3}>{t('tasksTitle', { person, week })}</Heading>
            <Text type="supporting">{hours}</Text>
          </VStack>
          <ul className="grid max-h-72 gap-1 overflow-y-auto">
            {cell.tasks.map((task) => (
              <li key={task.id}>
                <HStack gap={2} vAlign="center">
                  <StackItem size="fill" className="min-w-0">
                    <HStack gap={2} vAlign="center">
                      <Text type="code" color="secondary">
                        {task.reference}
                      </Text>
                      <span className="min-w-0 flex-1 truncate">
                        {onOpenTask ? (
                          <Link onClick={() => onOpenTask(task.reference)}>{task.title}</Link>
                        ) : (
                          <Link href={taskHref(task.reference)}>{task.title}</Link>
                        )}
                      </span>
                    </HStack>
                  </StackItem>
                  <Text type="supporting" hasTabularNumbers>
                    {t('hours', { hours: fmtHours(task.hours) })}
                  </Text>
                </HStack>
              </li>
            ))}
          </ul>
        </VStack>
      }
    >
      <ClickableCard label={label} variant="transparent" padding={1.5}>
        {body}
      </ClickableCard>
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
      <HStack gap={2} vAlign="center" wrap="wrap">
        <HStack gap={1} vAlign="center">
          <IconButton
            label={t('previous')}
            variant="secondary"
            size="sm"
            icon={<Icon icon={ChevronLeftIcon} />}
            onClick={() => setFrom(addDays(data.from, -7 * data.weeks.length))}
          />
          <Button
            label={t('thisWeek')}
            variant="secondary"
            size="sm"
            isDisabled={!from}
            onClick={() => setFrom(null)}
          />
          <IconButton
            label={t('next')}
            variant="secondary"
            size="sm"
            icon={<Icon icon={ChevronRightIcon} />}
            onClick={() => setFrom(addDays(data.from, 7 * data.weeks.length))}
          />
        </HStack>
        <Text type="supporting" aria-live="polite">
          {t('range', {
            from: weekLabel(data.weeks[0]!),
            to: format.dateTime(dateValue(addDays(data.weeks[data.weeks.length - 1]!, 6)), {
              month: 'short',
              day: 'numeric',
            }),
          })}
        </Text>
        <span className="ml-auto">
          <Text type="supporting">{t('capacityHint', { hours: data.hoursPerWeek })}</Text>
        </span>
      </HStack>
      {overCount > 0 && (
        <Banner status="warning" title={t('overSummary', { count: overCount })} collapsible={false} />
      )}
      {!rows.length && !data.unassigned.some((c) => c.planned > 0) ? (
        <EmptyState icon={<UsersIcon />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <Card padding={0} className="min-w-0 overflow-hidden">
          <div
            className="relative min-w-0 overflow-x-auto"
            role="region"
            aria-label={t('tableLabel')}
            tabIndex={0}
          >
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <caption className="sr-only">{t('caption')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-48 border-b bg-card px-3 py-2 text-left">
                    <Text type="supporting" weight="medium">
                      {t('person')}
                    </Text>
                  </th>
                  {data.weeks.map((w) => (
                    <th key={w} scope="col" className="border-b px-2 py-2 text-left whitespace-nowrap">
                      <Text
                        type="supporting"
                        weight="medium"
                        color={w <= data.today && data.today <= addDays(w, 6) ? 'accent' : 'secondary'}
                      >
                        {t('weekOf', { date: weekLabel(w) })}
                      </Text>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.user.id} className="border-b last:border-b-0">
                    <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-normal">
                      <HStack gap={2} vAlign="center">
                        <UserAvatar
                          name={p.user.displayName}
                          src={p.user.avatarUrl}
                          className="size-6 text-[10px]"
                        />
                        <VStack className="min-w-0">
                          <Text weight="medium" maxLines={1}>
                            {p.user.displayName}
                          </Text>
                          <Text type="supporting" maxLines={1}>
                            {p.projects.length > 1
                              ? p.projects.map((x) => `${x.key} ${x.allocationPct}%`).join(' · ')
                              : t('allocation', { pct: p.allocationPct })}
                          </Text>
                        </VStack>
                      </HStack>
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
                <tr>
                  <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left">
                    <Text weight="medium">{t('unassigned')}</Text>
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
        </Card>
      )}
    </div>
  );
}
