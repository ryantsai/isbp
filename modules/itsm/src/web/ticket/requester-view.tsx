'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { Markdown } from '@isbp/ui/markdown';
import { FadeIn } from '@isbp/ui/motion';
import { DateTime } from '@isbp/ui/relative-time';
import { ArrowLeftIcon, BanIcon, CheckIcon, ServerIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import type { TicketDetail, TicketStatus } from '../../contracts';
import { TicketStatusBadge, TypeIcon } from '../components/badges';
import { recordRef, useCategoryLabel } from '../lib';
import { AcceptancePanel } from './acceptance-panel';
import { Composer, type ComposerState, type ComposerTab } from './composer';
import { ConfirmPanel } from './confirm-panel';
import { ResolutionCard, SourceChip } from './parts';
import { Timeline, useActivities } from './timeline';

const STEP_OF: Partial<Record<TicketStatus, number>> = {
  new: 0,
  pending_approval: 0,
  draft: 0,
  resolved: 2,
  fulfilled: 2,
  closed: 3,
};

/** Reported → In progress → Resolved → Closed. */
function Stepper({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.requester.steps');
  const current = STEP_OF[ticket.status] ?? 1;
  const steps = [
    'reported',
    'inProgress',
    ticket.type === 'service_request' ? 'fulfilled' : 'resolved',
    'closed',
  ];
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label={t('label')}>
      {steps.map((s, i) => {
        const done = i < current || (i === current && ticket.status === 'closed');
        const active = i === current && !done;
        return (
          <li
            key={s}
            aria-current={active ? 'step' : undefined}
            className="flex min-w-0 flex-col items-center gap-2 text-center"
          >
            <div className="flex w-full items-center">
              <span
                className={cn(
                  'h-0.5 flex-1',
                  i === 0 ? 'opacity-0' : i <= current ? 'bg-primary' : 'bg-border',
                )}
              />
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold transition-colors',
                  done && 'border-primary bg-primary text-primary-foreground',
                  active && 'border-primary bg-background text-primary ring-4 ring-primary/15',
                  !done && !active && 'border-border bg-background text-muted-foreground',
                )}
              >
                {done ? <CheckIcon className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  'h-0.5 flex-1',
                  i === steps.length - 1 ? 'opacity-0' : i < current ? 'bg-primary' : 'bg-border',
                )}
              />
            </div>
            <span
              className={cn(
                'text-xs sm:text-sm',
                active || done ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {t(s)}
              <span className="sr-only"> ({done ? t('done') : active ? t('current') : t('upcoming')})</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** What the requester sees: progress, the public conversation, and "is it fixed?". */
export function RequesterView({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.requester');
  const tt = useTranslations('itsm');
  const { user } = usePlatform();
  const categoryLabel = useCategoryLabel();
  const activities = useActivities(ticket.reference);
  const conversation = useMemo(
    () => activities.items.filter((a) => a.kind === 'comment' && a.public),
    [activities.items],
  );
  const [tab, setTab] = useState<ComposerTab>('reply');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const composer: ComposerState = { tab, setTab, reply, setReply, note, setNote, replyRef };
  const ended = ticket.status === 'cancelled' || ticket.status === 'rejected';
  const open = !ended && ticket.status !== 'closed';

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <FadeIn y={4} className="grid gap-3">
        <Link
          href="/requests"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
          {t('back')}
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-mono font-medium text-foreground">
            <TypeIcon type={ticket.type} />
            {ticket.reference}
          </span>
          <TicketStatusBadge status={ticket.status} signOff={Boolean(ticket.signOff)} />
          <SourceChip ticket={ticket} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">{ticket.title}</h1>
      </FadeIn>

      <Card className="py-5">
        <CardContent>
          {ended ? (
            <p className="flex items-center gap-2 text-sm">
              <BanIcon className="size-4 text-muted-foreground" aria-hidden />
              {t('cancelled')}
            </p>
          ) : (
            <Stepper ticket={ticket} />
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t(`statusHint.${STEP_OF[ticket.status] ?? 1}`, {
              group: ticket.assignmentGroup?.name ?? tt('common.serviceDesk'),
            })}
          </p>
        </CardContent>
      </Card>

      <ConfirmPanel ticket={ticket} />
      <AcceptancePanel ticket={ticket} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="itsm-conversation" className="grid min-w-0 content-start gap-4">
          <h2 id="itsm-conversation" className="text-base font-semibold">
            {t('conversation')}
          </h2>
          <ResolutionCard ticket={ticket} />
          {conversation.length || activities.isLoading ? (
            <Timeline
              ticket={ticket}
              items={conversation}
              total={conversation.length}
              isLoading={activities.isLoading}
              isMine={(a) => a.author?.id === user.id}
            />
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {t('noMessages')}
            </p>
          )}
          {open && (
            <Composer
              ticketRef={ticket.reference}
              state={composer}
              canComment={ticket.viewer.canComment}
              canWorkNote={false}
            />
          )}
        </section>
        <aside className="grid min-w-0 content-start gap-4" aria-label={t('detailsLabel')}>
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t('yourReport')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              {ticket.description ? (
                <Markdown>{ticket.description}</Markdown>
              ) : (
                <p className="text-muted-foreground">{t('noDescription')}</p>
              )}
              <dl className="grid gap-3 border-t pt-4">
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-muted-foreground">{t('reported')}</dt>
                  <dd>
                    <DateTime date={ticket.createdAt} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-muted-foreground">{t('urgency')}</dt>
                  <dd>{tt(`urgency.${ticket.urgency}`)}</dd>
                </div>
                {ticket.category && (
                  <div className="min-w-0">
                    <dt className="text-xs font-medium text-muted-foreground">{t('category')}</dt>
                    <dd>{categoryLabel(ticket.category)}</dd>
                  </div>
                )}
                {ticket.cis.length > 0 && (
                  <div className="min-w-0">
                    <dt className="text-xs font-medium text-muted-foreground">{t('service')}</dt>
                    <dd className="grid gap-1">
                      {ticket.cis.map((ci) => (
                        <span key={ci.id} className="inline-flex min-w-0 items-center gap-1.5">
                          <ServerIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{ci.name}</span>
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-muted-foreground">{t('handledBy')}</dt>
                  <dd>
                    {ticket.assignee?.displayName ?? ticket.assignmentGroup?.name ?? tt('common.serviceDesk')}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <Slot<RecordPanelSlotProps> name="core.record.files" props={{ record: recordRef(ticket) }} />
        </aside>
      </div>
    </div>
  );
}
