'use client';

import { Button } from '@astryxdesign/core/Button';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  AlarmClockOffIcon,
  ArrowRightIcon,
  InboxIcon,
  LifeBuoyIcon,
  type LucideIcon,
  UserCheckIcon,
} from 'lucide-react';
import { useNow, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { TicketListItem } from '../../contracts';
import { PriorityBadge, SlaChip } from '../components/badges';
import { ticketHref } from '../lib';
import { mostUrgent } from '../logic';
import type { QueueCounts } from '../types';

const SUMMARY: { view: string; count: keyof QueueCounts; icon: LucideIcon; alert?: boolean }[] = [
  { view: 'assigned', count: 'assigned', icon: UserCheckIcon },
  { view: 'unassigned', count: 'unassigned', icon: InboxIcon },
  { view: 'attention', count: 'attention', icon: AlarmClockOffIcon, alert: true },
];

/**
 * "Your work" card on the home dashboard (`core.dashboard.work`): the queues that need the agent and their most
 * urgent tickets. Renders nothing when nothing waits (Home shows only what needs the person).
 */
export default function DashboardWorkCard() {
  const t = useTranslations('itsm.dashboardCard');
  const tq = useTranslations('itsm.desk.queues');
  const counts = useApiQuery<QueueCounts>('/itsm/queues', undefined, { refetchInterval: 60_000 });
  const now = useNow({ updateInterval: 60_000 });
  const mine = useApiQuery<Page<TicketListItem>>('/itsm/tickets', {
    view: 'assigned',
    status: 'open',
    sort: 'priority',
    pageSize: 50,
  });
  const urgent = useMemo(() => mostUrgent(mine.data?.items ?? [], now).slice(0, 3), [mine.data, now]);
  const c = counts.data;
  if (c && !c.assigned && !c.unassigned && !c.attention) return null;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon icon={LifeBuoyIcon} color="accent" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Button
            label={t('open')}
            variant="ghost"
            size="sm"
            endContent={<Icon icon={ArrowRightIcon} />}
            href="/itsm"
          />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Label on top with the full tile width, so the queues fit side by side in a half-width card. */}
        <Grid columns={3} gap={2} role="group" aria-label={t('queues')}>
          {SUMMARY.map((q) => {
            const value = counts.data?.[q.count];
            const hot = q.alert && (value ?? 0) > 0;
            return (
              <ClickableCard
                key={q.view}
                label={tq(q.view)}
                href={`/itsm?view=${q.view}`}
                padding={3}
                variant={hot ? 'red' : 'default'}
              >
                <VStack gap={1}>
                  <Text type="supporting" maxLines={2}>
                    {tq(q.view)}
                  </Text>
                  <HStack gap={1.5} vAlign="center">
                    <Icon icon={q.icon} size="sm" color={hot ? 'error' : 'secondary'} />
                    {value === undefined ? (
                      <Skeleton className="h-6 w-8" />
                    ) : (
                      <Text type="large" weight="semibold" hasTabularNumbers>
                        {value}
                      </Text>
                    )}
                  </HStack>
                </VStack>
              </ClickableCard>
            );
          })}
        </Grid>
        {/* min-w-0: long (nowrap) titles truncate instead of widening the card at 375 px. */}
        <VStack gap={1} className="min-w-0">
          <Heading level={4} accessibilityLevel={3} color="secondary">
            {t('mostUrgent')}
          </Heading>
          {mine.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !urgent.length ? (
            <Text as="p" color="secondary">
              {t('nothingAssigned')}
            </Text>
          ) : (
            <List hasDividers density="compact">
              {urgent.map((r) => (
                <ListItem
                  key={r.id}
                  href={ticketHref(r.reference)}
                  label={r.title}
                  startContent={
                    <Text type="code" color="secondary">
                      {r.reference}
                    </Text>
                  }
                  endContent={
                    <HStack gap={2} vAlign="center">
                      <PriorityBadge priority={r.priority} />
                      <SlaChip sla={r.sla} className="hidden sm:inline-flex" />
                    </HStack>
                  }
                />
              ))}
            </List>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}
