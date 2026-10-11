'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { ErrorState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, LifeBuoyIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TicketListItem } from '../../contracts';
import { PriorityBadge, TicketStatusBadge, TypeIcon } from '../components/badges';
import { ticketHref } from '../lib';

/** `cmdb.ci.related`: open tickets that affect the CI (agents with `itsm.tickets.read`). */
export default function CiRelatedTickets({ ci }: { ci: { id: string; number: number; name: string } }) {
  const t = useTranslations('itsm.ciRelated');
  const { data, isLoading, error, refetch } = useApiQuery<Page<TicketListItem>>('/itsm/tickets', {
    ciId: ci.id,
    status: 'open',
    pageSize: 5,
  });
  return (
    <VStack as="section" gap={2} className="min-w-0" aria-labelledby={`itsm-ci-${ci.id}`}>
      <HStack gap={2} hAlign="between" vAlign="center">
        <HStack gap={2} vAlign="center">
          <Icon icon={LifeBuoyIcon} color="accent" />
          <Heading level={4} accessibilityLevel={3} id={`itsm-ci-${ci.id}`}>
            {t('title')}
          </Heading>
          {data && data.total > 0 && <Badge variant="blue" label={data.total} />}
        </HStack>
        {data && data.total > 5 && (
          <Button
            label={t('viewAll')}
            variant="ghost"
            size="sm"
            endContent={<Icon icon={ArrowRightIcon} />}
            href={`/itsm?type=__all__&ciId=${ci.id}`}
          />
        )}
      </HStack>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : error ? (
        <ErrorState compact error={error} onRetry={() => void refetch()} title={t('unavailable')} />
      ) : !data?.items.length ? (
        <Text as="p" color="secondary">
          {t('none')}
        </Text>
      ) : (
        <List hasDividers density="compact">
          {data.items.map((r) => (
            <ListItem
              key={r.id}
              href={ticketHref(r.reference)}
              label={r.title}
              startContent={
                <HStack gap={2} vAlign="center">
                  <TypeIcon type={r.type} label />
                  <Text type="code" color="secondary">
                    {r.reference}
                  </Text>
                </HStack>
              }
              endContent={
                <HStack gap={2} vAlign="center">
                  <PriorityBadge priority={r.priority} />
                  <TicketStatusBadge status={r.status} className="hidden sm:inline-flex" />
                </HStack>
              }
            />
          ))}
        </List>
      )}
    </VStack>
  );
}
