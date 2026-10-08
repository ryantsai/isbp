'use client';

import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { Label } from '@isbp/ui/label';
import { useApiMutation } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Textarea } from '@isbp/ui/textarea';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ClipboardCheckIcon,
  HourglassIcon,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { AcceptanceInput, TicketDetail } from '../../contracts';
import { INVALIDATE, ticketApi } from '../lib';

type State = NonNullable<TicketDetail['acceptance']>['state'];

const STATE: Record<State, { icon: LucideIcon; variant: 'success' | 'warning' | 'muted' }> = {
  pending: { icon: HourglassIcon, variant: 'muted' },
  accepted: { icon: CircleCheckIcon, variant: 'success' },
  problem: { icon: CircleAlertIcon, variant: 'warning' },
};

/** The requester's verdict on a change: icon + text (never colour alone). */
export function AcceptanceBadge({ state }: { state: State }) {
  const t = useTranslations('itsm.acceptance.state');
  const { icon: Icon, variant } = STATE[state];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {t(state)}
    </Badge>
  );
}

/**
 * Post-implementation review of a change: its requester accepts it ("Accept the change") or reports a problem with
 * the reason; everyone sees where it stands. Hidden for changes without a requester or before the review.
 */
export function AcceptancePanel({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.acceptance');
  const tc = useTranslations('common');
  const id = useId();
  const [mode, setMode] = useState<'ask' | 'problem'>('ask');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const respond = useApiMutation(
    (api, body: AcceptanceInput) => api.post<TicketDetail>(`${ticketApi(ticket.reference)}/acceptance`, body),
    {
      invalidate: INVALIDATE,
      success: (r) => (r.acceptance?.state === 'accepted' ? t('acceptedToast') : t('problemToast')),
      onSuccess: () => {
        setMode('ask');
        setNote('');
        setTouched(false);
      },
    },
  );
  const a = ticket.acceptance;
  if (!a) return null;
  const canAnswer = ticket.viewer.canAccept;
  const noteInvalid = note.trim().length < 3;

  return (
    <Card className="gap-4" aria-labelledby={`${id}-title`} role="region">
      <CardHeader>
        <CardTitle id={`${id}-title`} className="flex flex-wrap items-center gap-2 text-base">
          <ClipboardCheckIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
          <AcceptanceBadge state={a.state} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p className="text-muted-foreground">
          {a.state === 'pending'
            ? canAnswer
              ? t('askRequester')
              : a.required
                ? t('waitingRequired')
                : t('waiting')
            : a.state === 'accepted'
              ? t('acceptedBy', { name: a.by?.displayName ?? '—' })
              : t('problemBy', { name: a.by?.displayName ?? '—' })}
          {a.at && (
            <>
              {' '}
              <DateTime date={a.at} />
            </>
          )}
        </p>
        {a.note && (
          <blockquote className="rounded-lg border-l-2 border-muted-foreground/40 bg-muted/40 px-3 py-2 whitespace-pre-line">
            {a.note}
          </blockquote>
        )}
        {canAnswer && mode === 'ask' && (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => respond.mutate({ accepted: true })}
              loading={respond.isPending && respond.variables?.accepted === true}
            >
              <CircleCheckIcon aria-hidden /> {t('accept')}
            </Button>
            <Button variant="outline" onClick={() => setMode('problem')}>
              <CircleAlertIcon aria-hidden /> {t('reportProblem')}
            </Button>
          </div>
        )}
        {canAnswer && mode === 'problem' && (
          <form
            noValidate
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (!noteInvalid) respond.mutate({ accepted: false, note: note.trim() });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor={`${id}-note`}>{t('problemLabel')}</Label>
              <Textarea
                id={`${id}-note`}
                rows={3}
                value={note}
                maxLength={5000}
                onChange={(e) => setNote(e.target.value)}
                aria-invalid={touched && noteInvalid ? true : undefined}
                aria-describedby={touched && noteInvalid ? `${id}-note-error` : undefined}
              />
              {touched && noteInvalid && (
                <p id={`${id}-note-error`} className="text-sm text-destructive">
                  {t('problemRequired')}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={respond.isPending}>
                {t('sendProblem')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setMode('ask')}>
                {tc('back')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
