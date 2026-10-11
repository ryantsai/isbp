'use client';

import { Button } from '@astryxdesign/core/Button';
import { Heading, Text } from '@astryxdesign/core/Text';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Icon } from '@astryxdesign/core/Icon';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextArea } from '@astryxdesign/core/TextArea';
import { IconTile } from '@isbp/ui/icon-tile';
import { FadeIn } from '@isbp/ui/motion';
import { useApiMutation } from '@isbp/ui/query';
import { CheckIcon, PartyPopperIcon, RotateCcwIcon, StarIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { TicketDetail } from '../../contracts';
import { INVALIDATE, ticketApi } from '../lib';

/** Accessible 1–5 star rating: one radio per star (arrow keys work), named "5 stars: excellent". */
export function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const t = useTranslations('itsm.confirm');
  const id = useId();
  return (
    <VStack gap={1.5}>
      <Text type="label" id={`${id}-legend`}>
        {t('rateLegend')}
      </Text>
      <HStack gap={2} wrap="wrap" vAlign="center">
        <SegmentedControl
          label={t('rateLegend')}
          value={value === null ? '' : String(value)}
          onChange={(v) => onChange(Number(v))}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <SegmentedControlItem
              key={n}
              value={String(n)}
              label={t(`rating.${n}`)}
              isLabelHidden
              icon={
                <HStack gap={1} vAlign="center">
                  <Icon icon={StarIcon} />
                  <Text type="label">{n}</Text>
                </HStack>
              }
            />
          ))}
        </SegmentedControl>
        {value !== null && (
          <Button label={t('clearRating')} variant="ghost" size="sm" onClick={() => onChange(null)} />
        )}
      </HStack>
      <Text type="supporting">
        <span aria-live="polite">{value ? t(`rating.${value}`) : ''}</span>
      </Text>
    </VStack>
  );
}

/** "Is it fixed?" — the requester closes it (with an optional CSAT rating) or reopens it with a reason. */
export function ConfirmPanel({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.confirm');
  const tc = useTranslations('common');
  const id = useId();
  const [mode, setMode] = useState<'ask' | 'fixed' | 'broken'>('ask');
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const confirm = useApiMutation(
    (api, body: { rating?: number; comment?: string }) =>
      api.post<TicketDetail>(`${ticketApi(ticket.reference)}/confirm`, body),
    { invalidate: INVALIDATE, success: t('closedToast') },
  );
  const reopen = useApiMutation(
    (api, body: { reason: string }) => api.post<TicketDetail>(`${ticketApi(ticket.reference)}/reopen`, body),
    { invalidate: INVALIDATE, success: t('reopenedToast') },
  );
  if (!ticket.viewer.canConfirm && !ticket.viewer.canReopen) return null;
  const reasonInvalid = reason.trim().length < 3;

  return (
    <FadeIn
      role="region"
      aria-labelledby={`${id}-title`}
      className="grid gap-4 rounded-xl border border-success/30 bg-success/5 p-4 sm:p-5"
    >
      <HStack gap={3} vAlign="start">
        <IconTile size="sm" className="text-success" aria-hidden>
          <PartyPopperIcon />
        </IconTile>
        <VStack gap={0.5}>
          <Heading level={4} accessibilityLevel={2} id={`${id}-title`}>
            {t('title')}
          </Heading>
          <Text color="secondary">{t('hint')}</Text>
        </VStack>
      </HStack>
      {mode === 'ask' && (
        <HStack gap={2} wrap="wrap">
          {ticket.viewer.canConfirm && (
            <Button
              label={t('yes')}
              variant="primary"
              icon={<Icon icon={CheckIcon} />}
              onClick={() => setMode('fixed')}
            />
          )}
          {ticket.viewer.canReopen && (
            <Button
              label={t('no')}
              variant="secondary"
              icon={<Icon icon={RotateCcwIcon} />}
              onClick={() => setMode('broken')}
            />
          )}
        </HStack>
      )}
      {mode === 'fixed' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirm.mutate({ rating: rating ?? undefined, comment: comment.trim() || undefined });
          }}
        >
          <VStack gap={4}>
            <StarRating value={rating} onChange={setRating} />
            <TextArea label={t('commentLabel')} rows={3} value={comment} onChange={setComment} />
            <HStack gap={2} wrap="wrap">
              <Button
                label={t('closeIt')}
                variant="primary"
                icon={<Icon icon={CheckIcon} />}
                isLoading={confirm.isPending}
                type="submit"
              />
              <Button label={tc('back')} variant="ghost" onClick={() => setMode('ask')} />
            </HStack>
          </VStack>
        </form>
      )}
      {mode === 'broken' && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!reasonInvalid) reopen.mutate({ reason: reason.trim() });
          }}
        >
          <VStack gap={4}>
            <TextArea
              label={t('reasonLabel')}
              rows={3}
              value={reason}
              onChange={setReason}
              status={touched && reasonInvalid ? { type: 'error', message: t('reasonRequired') } : undefined}
            />
            <HStack gap={2} wrap="wrap">
              <Button
                label={t('reopen')}
                variant="primary"
                icon={<Icon icon={RotateCcwIcon} />}
                isLoading={reopen.isPending}
                type="submit"
              />
              <Button label={tc('back')} variant="ghost" onClick={() => setMode('ask')} />
            </HStack>
          </VStack>
        </form>
      )}
    </FadeIn>
  );
}
