'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Popover } from '@astryxdesign/core/Popover';
import { Spinner } from '@astryxdesign/core/Spinner';
import type { NotificationPage } from '@isbp/contracts';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { BellIcon, CheckCheckIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { BADGES_PATH, useBadges } from './live';

/** Topbar bell: unread count (live), the latest notifications, mark as read. */
export function NotificationBell() {
  const t = useTranslations('shell.notifications');
  const unread = useBadges().notifications;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useApiQuery<NotificationPage>(open ? '/me/notifications' : null, {
    pageSize: 8,
  });
  const markRead = useApiMutation(
    (api, body: { ids?: string[]; all?: boolean }) => api.post('/me/notifications/read', body),
    {
      invalidate: ['/me/notifications', BADGES_PATH],
    },
  );

  const panel = (
    <VStack gap={0} width="min(24rem, calc(100vw - 2rem))">
      <HStack gap={2} vAlign="center" hAlign="between" padding={3}>
        <Heading level={4}>{t('title')}</Heading>
        <Button
          label={t('markAllRead')}
          variant="ghost"
          size="sm"
          icon={<Icon icon={CheckCheckIcon} />}
          isDisabled={!unread || markRead.isPending}
          onClick={() => markRead.mutate({ all: true })}
        />
      </HStack>
      <div className="max-h-[min(28rem,60vh)] overflow-y-auto border-y">
        {isLoading ? (
          <VStack hAlign="center" padding={8}>
            <Spinner />
          </VStack>
        ) : !data?.items.length ? (
          <EmptyState isCompact title={t('empty')} />
        ) : (
          <List>
            {data.items.map((n) => (
              <ListItem
                key={n.id}
                label={n.title}
                startContent={
                  <span
                    aria-hidden
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-primary'}`}
                  />
                }
                description={
                  <>
                    {!n.readAt && <span className="sr-only">{t('unread')} </span>}
                    {n.body && (
                      <Text as="div" type="supporting" color="secondary" maxLines={2}>
                        {n.body}
                      </Text>
                    )}
                    <RelativeTime date={n.createdAt} />
                  </>
                }
                onClick={() => {
                  if (!n.readAt) markRead.mutate({ ids: [n.id] });
                  setOpen(false);
                  if (n.href) router.push(n.href);
                }}
              />
            ))}
          </List>
        )}
      </div>
      <HStack padding={2}>
        <StackItem size="fill">
          <Button
            label={t('viewAll')}
            variant="ghost"
            size="sm"
            href="/notifications"
            width="100%"
            onClick={() => setOpen(false)}
          />
        </StackItem>
      </HStack>
    </VStack>
  );

  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      content={open ? panel : null}
      label={t('title')}
      placement="below"
      alignment="end"
      padding={0}
    >
      <span className="relative inline-flex">
        <IconButton
          label={unread ? t('labelUnread', { count: unread }) : t('label')}
          variant="ghost"
          icon={<Icon icon={BellIcon} />}
        />
        {unread > 0 && (
          <Badge
            variant="error"
            label={unread > 99 ? '99+' : String(unread)}
            aria-hidden
            className="pointer-events-none absolute -top-1 -right-1"
          />
        )}
      </span>
    </Popover>
  );
}
