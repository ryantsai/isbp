'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Label } from '@isbp/ui/label';
import { useApiMutation } from '@isbp/ui/query';
import { Textarea } from '@isbp/ui/textarea';
import { CheckIcon, PartyPopperIcon, RotateCcwIcon, StarIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { TicketDetail } from '../../contracts';
import { INVALIDATE, ticketApi } from '../lib';

/** Accessible 1–5 star rating: native radios (arrow keys work), stars are decoration. */
export function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const t = useTranslations('itsm.confirm');
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{t('rateLegend')}</legend>
      <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className="cursor-pointer rounded-md p-1 transition-transform hover:scale-110 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 motion-reduce:hover:scale-100"
            onMouseEnter={() => setHover(n)}
          >
            <input
              type="radio"
              name={`${id}-rating`}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="sr-only"
            />
            <StarIcon
              aria-hidden
              className={cn(
                'size-7 transition-colors',
                n <= shown ? 'fill-warning text-warning-foreground' : 'text-muted-foreground',
              )}
            />
            <span className="sr-only">{t(`rating.${n}`)}</span>
          </label>
        ))}
        {value !== null && (
          <Button type="button" variant="link" size="sm" className="ml-1" onClick={() => onChange(null)}>
            {t('clearRating')}
          </Button>
        )}
      </div>
      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {shown ? t(`rating.${shown}`) : ''}
      </p>
    </fieldset>
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
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      aria-labelledby={`${id}-title`}
      className="grid gap-4 rounded-xl border border-success/30 bg-success/5 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/12 text-success">
          <PartyPopperIcon className="size-4" aria-hidden />
        </span>
        <div className="grid gap-0.5">
          <h2 id={`${id}-title`} className="text-base font-semibold">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('hint')}</p>
        </div>
      </div>
      {mode === 'ask' && (
        <div className="flex flex-wrap gap-2">
          {ticket.viewer.canConfirm && (
            <Button onClick={() => setMode('fixed')}>
              <CheckIcon />
              {t('yes')}
            </Button>
          )}
          {ticket.viewer.canReopen && (
            <Button variant="outline" onClick={() => setMode('broken')}>
              <RotateCcwIcon />
              {t('no')}
            </Button>
          )}
        </div>
      )}
      {mode === 'fixed' && (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirm.mutate({ rating: rating ?? undefined, comment: comment.trim() || undefined });
          }}
        >
          <StarRating value={rating} onChange={setRating} />
          <div className="grid gap-2">
            <Label htmlFor={`${id}-comment`}>{t('commentLabel')}</Label>
            <Textarea
              id={`${id}-comment`}
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={confirm.isPending}>
              <CheckIcon />
              {t('closeIt')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode('ask')}>
              {tc('back')}
            </Button>
          </div>
        </form>
      )}
      {mode === 'broken' && (
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!reasonInvalid) reopen.mutate({ reason: reason.trim() });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-reason`}>{t('reasonLabel')}</Label>
            <Textarea
              id={`${id}-reason`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={touched && reasonInvalid ? true : undefined}
              aria-describedby={touched && reasonInvalid ? `${id}-reason-error` : undefined}
            />
            {touched && reasonInvalid && (
              <p id={`${id}-reason-error`} className="text-sm text-destructive">
                {t('reasonRequired')}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={reopen.isPending}>
              <RotateCcwIcon />
              {t('reopen')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode('ask')}>
              {tc('back')}
            </Button>
          </div>
        </form>
      )}
    </motion.section>
  );
}
