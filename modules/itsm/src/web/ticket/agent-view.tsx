'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot } from '@isbp/sdk/web';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { Markdown } from '@isbp/ui/markdown';
import { FadeIn } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import type { TicketAsideSlotProps, TicketDetail } from '../../contracts';
import { MajorBadge, PriorityBadge, TicketStatusBadge, TypeIcon } from '../components/badges';
import { ActionBar } from './actions';
import { recordRef } from '../lib';
import { CisCard, DetailsCard, LinksCard, SlasCard } from './aside-cards';
import { AcceptancePanel } from './acceptance-panel';
import { ChangeCard } from './change-card';
import { Composer, type ComposerState, type ComposerTab } from './composer';
import { ConfirmPanel } from './confirm-panel';
import { CustomFieldsCard } from './custom-fields-card';
import { AnswersCard, MajorBanner, ResolutionCard, SlaTimers, SourceChip } from './parts';
import { ProblemCard } from './problem-card';
import { Timeline, useActivities } from './timeline';

/** Contributions that render nothing (e.g. ALM's panel on non-change tickets) leave no empty card behind. */
const wrapSlot = (node: ReactNode) => (
  <Card className="min-w-0 gap-0 py-4 has-[[data-slot=card-content]:empty]:hidden">
    <CardContent className="px-4">{node}</CardContent>
  </Card>
);

/** The full agent workspace for one ticket. */
export function AgentView({ ticket, refetch }: { ticket: TicketDetail; refetch: () => void }) {
  const t = useTranslations('itsm.ticket');
  const tt = useTranslations('itsm');
  const activities = useActivities(ticket.reference);
  const [tab, setTab] = useState<ComposerTab>('reply');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const composer: ComposerState = { tab, setTab, reply, setReply, note, setNote, replyRef };
  const refetchActivities = activities.refetch;

  const insertReply = useCallback((text: string) => {
    setTab('reply');
    setReply((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text));
    // After the tab renders: bring the composer into view for review.
    requestAnimationFrame(() => {
      replyRef.current?.focus();
      replyRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, []);
  const refresh = useCallback(() => {
    refetch();
    void refetchActivities();
  }, [refetch, refetchActivities]);
  const slotProps = useMemo<TicketAsideSlotProps>(
    () => ({ ticket, actions: { insertReply, refresh } }),
    [ticket, insertReply, refresh],
  );

  return (
    <div className="grid gap-6">
      <FadeIn y={4} className="grid gap-3">
        <Link
          href="/itsm"
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
          <span>{tt(`types.${ticket.type}`)}</span>
          <SourceChip ticket={ticket} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">{ticket.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <TicketStatusBadge status={ticket.status} signOff={Boolean(ticket.signOff)} />
          <PriorityBadge priority={ticket.priority} long />
          {ticket.major && <MajorBadge />}
        </div>
        <SlaTimers ticket={ticket} />
      </FadeIn>
      {ticket.major && <MajorBanner />}
      <ActionBar ticket={ticket} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          <ConfirmPanel ticket={ticket} />
          <ResolutionCard ticket={ticket} />
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t('description')}</CardTitle>
            </CardHeader>
            <CardContent>
              {ticket.description ? (
                <Markdown>{ticket.description}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noDescription')}</p>
              )}
            </CardContent>
          </Card>
          <Slot<RecordPanelSlotProps> name="core.record.files" props={{ record: recordRef(ticket) }} />
          <AnswersCard ticket={ticket} />
          {ticket.type === 'problem' && <ProblemCard ticket={ticket} />}
          {ticket.type === 'change' && <ChangeCard ticket={ticket} />}
          {ticket.type === 'change' && <AcceptancePanel ticket={ticket} />}
          <section aria-labelledby="itsm-activity" className="grid gap-4">
            <h2 id="itsm-activity" className="text-base font-semibold">
              {t('activity')}
            </h2>
            <Timeline
              ticket={ticket}
              items={activities.items}
              total={activities.total}
              isLoading={activities.isLoading}
            />
            <Composer
              ticketRef={ticket.reference}
              state={composer}
              canComment={ticket.viewer.canComment}
              canWorkNote={ticket.viewer.canWorkNote}
            />
          </section>
        </div>
        <aside className="grid min-w-0 content-start gap-4" aria-label={t('aside')}>
          <Slot
            name="itsm.ticket.aside"
            props={slotProps}
            fallback={<Skeleton className="h-32 w-full rounded-lg" />}
            wrap={wrapSlot}
          />
          <DetailsCard ticket={ticket} />
          <CisCard ticket={ticket} />
          <LinksCard ticket={ticket} />
          <Slot<RecordPanelSlotProps> name="core.record.links" props={{ record: recordRef(ticket) }} />
          <SlasCard ticket={ticket} />
          <CustomFieldsCard ticket={ticket} />
        </aside>
      </div>
    </div>
  );
}
