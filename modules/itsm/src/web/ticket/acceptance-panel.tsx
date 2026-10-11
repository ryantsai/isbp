'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiMutation } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
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
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';

type State = NonNullable<TicketDetail['acceptance']>['state'];

const STATE: Record<State, { icon: LucideIcon; variant: 'success' | 'warning' | 'neutral' }> = {
  pending: { icon: HourglassIcon, variant: 'neutral' },
  accepted: { icon: CircleCheckIcon, variant: 'success' },
  problem: { icon: CircleAlertIcon, variant: 'warning' },
};

/** The requester's verdict on a change: icon + text (never colour alone). */
export function AcceptanceBadge({ state }: { state: State }) {
  const t = useTranslations('itsm.acceptance.state');
  const { icon, variant } = STATE[state];
  return <Badge variant={variant} icon={<AstryxIcon icon={icon} />} label={t(state)} />;
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
        <CardTitle id={`${id}-title`}>
          <HStack gap={2} wrap="wrap" vAlign="center">
            <AstryxIcon icon={ClipboardCheckIcon} color="accent" />
            {t('title')}
            <AcceptanceBadge state={a.state} />
          </HStack>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack gap={4}>
          <Text color="secondary">
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
          </Text>
          {a.note && (
            <blockquote className="rounded-lg border-l-2 border-muted-foreground/40 bg-muted/40 px-3 py-2 whitespace-pre-line">
              {a.note}
            </blockquote>
          )}
          {canAnswer && mode === 'ask' && (
            <HStack gap={2} wrap="wrap">
              <Button
                label={t('accept')}
                variant="primary"
                icon={<AstryxIcon icon={CircleCheckIcon} />}
                isLoading={respond.isPending && respond.variables?.accepted === true}
                onClick={() => respond.mutate({ accepted: true })}
              />
              <Button
                label={t('reportProblem')}
                variant="secondary"
                icon={<AstryxIcon icon={CircleAlertIcon} />}
                onClick={() => setMode('problem')}
              />
            </HStack>
          )}
          {canAnswer && mode === 'problem' && (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                setTouched(true);
                if (!noteInvalid) respond.mutate({ accepted: false, note: note.trim() });
              }}
            >
              <VStack gap={3}>
                <TextArea
                  label={t('problemLabel')}
                  rows={3}
                  value={note}
                  maxLength={5000}
                  onChange={setNote}
                  status={
                    touched && noteInvalid ? { type: 'error', message: t('problemRequired') } : undefined
                  }
                />
                <HStack gap={2} wrap="wrap">
                  <Button
                    label={t('sendProblem')}
                    variant="primary"
                    isLoading={respond.isPending}
                    type="submit"
                  />
                  <Button label={tc('back')} variant="ghost" onClick={() => setMode('ask')} />
                </HStack>
              </VStack>
            </form>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}
