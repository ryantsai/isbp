'use client';

import type { Page } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
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
  const { data, isLoading } = useApiQuery<Page<Conversation>>('/helpdesk-ai/conversations', { pageSize: 30 });
  return (
    <nav aria-label={t('history.title')} className="flex h-full min-h-0 flex-col gap-3">
      <Button variant="outline" className="w-full justify-start" onClick={onNew}>
        <PlusIcon /> {t('history.new')}
      </Button>
      <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('history.title')}
      </h2>
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : data?.items.length ? (
        <ul className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
          {data.items.map((c) => {
            const active = c.id === selected;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                  )}
                >
                  <StatusIcon status={c.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {c.title || t('history.untitled')}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {c.status !== 'open' && <span>{t(`conversationStatus.${c.status}`)} ·</span>}
                      <RelativeTime date={c.updatedAt} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">{t('history.empty')}</p>
      )}
    </nav>
  );
}

function StatusIcon({ status }: { status: Conversation['status'] }) {
  const Icon =
    status === 'resolved' ? CircleCheckIcon : status === 'escalated' ? TicketCheckIcon : MessageCircleIcon;
  return (
    <Icon
      aria-hidden
      className={cn(
        'mt-0.5 size-4 shrink-0',
        status === 'resolved'
          ? 'text-success'
          : status === 'escalated'
            ? 'text-info'
            : 'text-muted-foreground',
      )}
    />
  );
}
