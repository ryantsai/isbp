'use client';

import { localize } from '@isbp/sdk';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { DateTime } from '@isbp/ui/relative-time';
import { CheckCircle2Icon, FileInputIcon, SirenIcon, StampIcon, StarIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { TicketDetail } from '../../contracts';
import { SlaChip } from '../components/badges';

/** "From request REQ-01042 · Laptop request" for catalog service requests. */
export function SourceChip({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.ticket');
  const locale = useLocale();
  if (!ticket.source) return null;
  return (
    <Link
      href={`/requests/${encodeURIComponent(ticket.source.reference)}`}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <FileInputIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {t('fromRequest', {
          reference: ticket.source.reference,
          form: localize(ticket.source.formName, locale),
        })}
      </span>
    </Link>
  );
}

export function MajorBanner() {
  const t = useTranslations('itsm.ticket');
  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm dark:bg-destructive/20">
      <SirenIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      <div>
        <p className="font-semibold text-destructive">{t('majorTitle')}</p>
        <p className="text-foreground">{t('majorBody')}</p>
      </div>
    </div>
  );
}

/** Response and resolution timers: label, due time and state (the latest target per metric). */
export function SlaTimers({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm');
  const latest = (['response', 'resolution'] as const)
    .map((m) => ticket.slas.filter((s) => s.metric === m && s.status !== 'cancelled').at(-1))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  if (!latest.length) return null;
  return (
    <ul className="flex flex-wrap gap-3" aria-label={t('slas.title')}>
      {latest.map((s) => (
        <li key={s.id} className="grid min-w-44 gap-1 rounded-lg border bg-card px-3 py-2 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground">{t(`slaMetric.${s.metric}`)}</span>
          <SlaChip sla={s} className="w-fit" />
          <span className="text-xs text-muted-foreground">
            {s.stoppedAt ? t('slas.stopped') : t('slas.due')} <DateTime date={s.stoppedAt ?? s.dueAt} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Resolution code, notes and the requester's rating once the ticket is resolved. */
export function ResolutionCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm');
  if (!ticket.resolutionCode && !ticket.resolutionNotes) return null;
  const waiting = Boolean(ticket.signOff);
  return (
    <Card
      className={waiting ? 'gap-3 border-warning/40 bg-warning/10' : 'gap-3 border-success/30 bg-success/5'}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {waiting ? (
            <StampIcon className="size-4 text-warning-foreground" aria-hidden />
          ) : (
            <CheckCircle2Icon className="size-4 text-success" aria-hidden />
          )}
          {waiting ? t('signOff.resolutionTitle') : t('ticket.resolution')}
          {ticket.resolutionCode && (
            <span className="text-sm font-normal text-muted-foreground">
              · {t(`resolution.${ticket.resolutionCode}`)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {waiting && <p className="text-muted-foreground">{t('signOff.resolutionHint')}</p>}
        {ticket.resolutionNotes && <p className="whitespace-pre-line">{ticket.resolutionNotes}</p>}
        {ticket.satisfaction !== null && (
          <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span className="inline-flex items-center gap-0.5" aria-hidden>
              {[1, 2, 3, 4, 5].map((n) => (
                <StarIcon
                  key={n}
                  className={
                    n <= (ticket.satisfaction ?? 0)
                      ? 'size-4 fill-warning text-warning-foreground'
                      : 'size-4 text-muted-foreground/50'
                  }
                />
              ))}
            </span>
            <span>{t('ticket.rated', { rating: ticket.satisfaction })}</span>
            {ticket.satisfactionComment && (
              <span className="text-foreground">“{ticket.satisfactionComment}”</span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Service-request answers from the catalog form. */
export function AnswersCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.ticket');
  const locale = useLocale();
  if (!ticket.answers?.length) return null;
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{t('answers')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {ticket.answers.map((a) => (
            <div key={a.key} className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">{localize(a.label, locale)}</dt>
              <dd className="mt-0.5 break-words whitespace-pre-line">{a.value || '—'}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
