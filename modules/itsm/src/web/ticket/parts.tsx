'use client';

import { type LocalizedText, localize } from '@isbp/sdk';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { FadeIn } from '@isbp/ui/motion';
import { DateTime } from '@isbp/ui/relative-time';
import { CheckCircle2Icon, FileInputIcon, SirenIcon, StampIcon, StarIcon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
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

/** An SLA policy's name in the viewer's language (names may be plain text or localized). */
function usePolicyName() {
  const locale = useLocale();
  return (name: unknown) =>
    typeof name === 'string'
      ? name
      : name && typeof name === 'object'
        ? localize(name as LocalizedText, locale)
        : '';
}

/**
 * Response and resolution timers in one line under the title: metric, state ("2h 10m left") and due time; the policy
 * that set them is in the tooltip. Only the latest target per metric.
 */
export function SlaTimers({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm');
  const policyName = usePolicyName();
  const latest = (['response', 'resolution'] as const)
    .map((m) => ticket.slas.filter((s) => s.metric === m && s.status !== 'cancelled').at(-1))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  if (!latest.length) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5" aria-label={t('slas.title')}>
      {latest.map((s) => {
        const policy = policyName(s.policy.label ?? s.policy.name);
        return (
          <li
            key={s.id}
            className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs"
            title={policy ? t('slas.policy', { name: policy }) : undefined}
          >
            <span className="font-medium text-foreground">{t(`slaMetric.${s.metric}`)}</span>
            <SlaChip sla={s} />
            <span className="text-muted-foreground">
              {s.stoppedAt ? t('slas.stopped') : t('slas.due')} <DateTime date={s.stoppedAt ?? s.dueAt} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Resolution code, notes and the requester's rating once the ticket is resolved. */
export function ResolutionCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm');
  const resolved = Boolean(ticket.resolutionCode || ticket.resolutionNotes);
  // It expands in when the ticket gets resolved while the page is open, not on every visit.
  const [resolvedAtOpen] = useState(resolved);
  if (!resolved) return null;
  const waiting = Boolean(ticket.signOff);
  const card = (
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
  return resolvedAtOpen ? card : <FadeIn>{card}</FadeIn>;
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
