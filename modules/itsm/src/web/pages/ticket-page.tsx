'use client';

import { ApiError, type WebPageProps } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { FileQuestionIcon, LockIcon, RotateCwIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TicketDetail } from '../../contracts';
import { ticketApi } from '../lib';
import { AgentView } from '../ticket/agent-view';
import { RequesterView } from '../ticket/requester-view';

function TicketSkeleton() {
  return (
    <div className="grid gap-4" aria-busy>
      <div className="grid gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-6 w-56" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** One ticket by reference (INC-00042) — the agent workspace or the requester's view, as the API says. */
export default function TicketPage({ params }: WebPageProps) {
  const t = useTranslations('itsm.ticket');
  const tc = useTranslations('common');
  const ref = params.ref ?? '';
  const { data, isLoading, isPlaceholderData, error, refetch } = useApiQuery<TicketDetail>(ticketApi(ref));

  // Moving to another ticket: don't show the previous one while the next loads.
  if (isLoading || isPlaceholderData) return <TicketSkeleton />;
  if (error || !data) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <EmptyState
        icon={status === 403 ? <LockIcon /> : <FileQuestionIcon />}
        title={status === 403 ? t('forbidden') : status === 404 ? t('notFound') : t('loadFailed')}
        description={status === 404 ? t('notFoundHint', { reference: ref }) : undefined}
        action={
          status !== 403 && status !== 404 ? (
            <Button variant="outline" onClick={() => void refetch()}>
              <RotateCwIcon />
              {tc('retry')}
            </Button>
          ) : undefined
        }
        className="rounded-xl border border-dashed"
      />
    );
  }
  return data.viewer.role === 'agent' ? (
    <AgentView key={data.id} ticket={data} refetch={() => void refetch()} />
  ) : (
    <RequesterView key={data.id} ticket={data} />
  );
}
