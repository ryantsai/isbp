'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { ErrorState } from '@isbp/ui/empty-state';
import { AnimatedList } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { CircleCheckIcon, MessageCircleIcon, TicketCheckIcon, TicketPlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ConversationDetail } from '../../contracts';
import { AssistantMessage, UserMessage } from '../chat/message';
import { ModeBadge } from '../shared';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';

/** Read-only transcript of any conversation, for reviewing the virtual agent's answers. */
export default function ConversationPage({ params }: WebPageProps) {
  const t = useTranslations('helpdesk-ai');
  const { data, isLoading, error, refetch } = useApiQuery<ConversationDetail>(
    `/helpdesk-ai/conversations/${params.id}`,
  );

  if (isLoading)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} kind="page" />;

  const mode =
    data.mode === 'llm'
      ? {
          mode: 'llm' as const,
          provider: '',
          model: [...data.messages].reverse().find((m) => m.model)?.model ?? null,
        }
      : { mode: 'builtin' as const, provider: 'none', model: null };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ href: '/helpdesk-ai', label: t('insights.title') }}
        title={data.title || t('history.untitled')}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {data.user && (
              <span className="inline-flex items-center gap-1.5">
                <UserAvatar name={data.user.displayName} src={data.user.avatarUrl} className="size-5" />
                {data.user.displayName}
              </span>
            )}
            <span aria-hidden>·</span>
            <DateTime date={data.createdAt} />
            <span aria-hidden>·</span>
            <span>{t(`language.${data.locale}`)}</span>
          </span>
        }
        actions={
          <>
            <ModeBadge ai={mode} />
            {data.status === 'escalated' ? (
              <Badge
                variant="info"
                label={t('outcome.escalated')}
                icon={<Icon icon={TicketCheckIcon} size="xsm" />}
              />
            ) : data.deflected ? (
              <Badge
                variant="success"
                label={t('outcome.deflected')}
                icon={<Icon icon={CircleCheckIcon} size="xsm" />}
              />
            ) : (
              <Badge
                variant="neutral"
                label={t('outcome.open')}
                icon={<Icon icon={MessageCircleIcon} size="xsm" />}
              />
            )}
            {data.ticketRef && (
              <Link
                href={`/itsm/tickets/${data.ticketRef}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                {t('chat.viewTicketRef', { reference: data.ticketRef })}
              </Link>
            )}
          </>
        }
      />
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        {/* An AnimatedList, so the transcript shows at once (its items only animate when added). */}
        <AnimatedList as="ol" aria-label={t('chat.log')}>
          {data.messages.map((m) =>
            m.role === 'user' ? (
              <UserMessage key={m.id} content={m.content} label={t('chat.you')} />
            ) : (
              <AssistantMessage
                key={m.id}
                content={m.content}
                citations={m.citations}
                numbered={m.mode === 'llm'}
                label={t('chat.agent')}
              >
                {m.proposal && (
                  <p className="flex items-start gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    <TicketPlusIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>{t('review.proposed', { title: m.proposal.title })}</span>
                  </p>
                )}
              </AssistantMessage>
            ),
          )}
        </AnimatedList>
      </div>
    </div>
  );
}
