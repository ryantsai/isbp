'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import type { Page } from '@isbp/sdk';
import { ErrorState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { CircleCheckIcon, MessageCircleIcon, PlusIcon, TicketCheckIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Conversation } from '../../contracts';

/** My recent conversations, newest first. */
export function ConversationHistory({
  selected,
  onSelect,
  onNew,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const t = useTranslations('helpdesk-ai');
  const { data, isLoading, error, refetch } = useApiQuery<Page<Conversation>>('/helpdesk-ai/conversations', {
    pageSize: 30,
  });
  return (
    <nav aria-label={t('history.title')} className="flex h-full min-h-0 flex-col gap-3">
      <Button
        label={t('history.new')}
        variant="secondary"
        icon={<Icon icon={PlusIcon} />}
        width="100%"
        onClick={onNew}
      />
      <Text as="div" display="block" type="label" color="secondary">
        {t('history.title')}
      </Text>
      {error && !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} kind="list" compact />
      ) : isLoading ? (
        <VStack gap={2}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </VStack>
      ) : data?.items.length ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <List density="compact">
            {data.items.map((c) => (
              <ListItem
                key={c.id}
                label={c.title || t('history.untitled')}
                description={
                  <>
                    {c.status !== 'open' && <span>{t(`conversationStatus.${c.status}`)} · </span>}
                    <RelativeTime date={c.updatedAt} />
                  </>
                }
                startContent={<StatusIcon status={c.status} />}
                isSelected={c.id === selected}
                onClick={() => onSelect(c.id)}
              />
            ))}
          </List>
        </div>
      ) : (
        <Text as="p" display="block" type="supporting" color="secondary">
          {t('history.empty')}
        </Text>
      )}
    </nav>
  );
}

function StatusIcon({ status }: { status: Conversation['status'] }) {
  const icon =
    status === 'resolved' ? CircleCheckIcon : status === 'escalated' ? TicketCheckIcon : MessageCircleIcon;
  return (
    <Icon
      icon={icon}
      color={status === 'resolved' ? 'success' : status === 'escalated' ? 'accent' : 'secondary'}
    />
  );
}
