'use client';

import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Text } from '@astryxdesign/core/Text';
import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { useErrorText } from '@isbp/ui/query';
import {
  ArrowRightIcon,
  BanIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  HourglassIcon,
  ShieldQuestionIcon,
  TimerOffIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { changeSetHref } from '../../contracts';
import { type Meta, ToneBadge, ToneText } from '../badges';
import type { ConfirmationDto } from '../lib';
import { useToolText } from './thread';
import { Button } from '@astryxdesign/core/Button';

function outcome(c: ConfirmationDto): {
  meta: Meta;
  key: 'pending' | 'declined' | 'expired' | 'failed' | 'done';
} {
  switch (c.status) {
    case 'pending':
      return { meta: { icon: HourglassIcon, tone: 'info' }, key: 'pending' };
    case 'declined':
      return { meta: { icon: BanIcon, tone: 'muted' }, key: 'declined' };
    case 'expired':
      return { meta: { icon: TimerOffIcon, tone: 'muted' }, key: 'expired' };
    case 'confirmed':
      return c.result && !c.result.ok
        ? { meta: { icon: CircleXIcon, tone: 'destructive' }, key: 'failed' }
        : { meta: { icon: CircleCheckIcon, tone: 'success' }, key: 'done' };
  }
}

/** A confirmation's error, by code; "already decided" says so in words. */
function useDecideErrorText() {
  const t = useTranslations('assistant.confirm');
  const errorText = useErrorText();
  return (err: unknown) => {
    if (err instanceof ApiError && err.code === 'INVALID_STATE') {
      const status = (err.details as { status?: string } | undefined)?.status;
      if (status === 'expired') return t('alreadyExpired');
      if (status) return t('alreadyDecided');
    }
    return errorText(err);
  };
}

/**
 * A destructive call the agent made (apply or roll back a change set, or a module's destructive tool): it runs
 * only when the person confirms it here, with their own permissions. After deciding, focus moves to the outcome.
 */
export function ConfirmationCard({
  confirmation,
  onDecide,
  deciding,
  disabled,
  error,
  onNavigate,
}: {
  confirmation: ConfirmationDto;
  onDecide: (approve: boolean) => void;
  deciding: boolean;
  disabled?: boolean;
  /** The last failed attempt to decide this one. */
  error?: unknown;
  onNavigate?: () => void;
}) {
  const t = useTranslations('assistant.confirm');
  const toolText = useToolText();
  const errorOf = useDecideErrorText();
  const { meta, key } = outcome(confirmation);
  const pending = confirmation.status === 'pending';
  const statusRef = useRef<HTMLDivElement>(null);
  const [decidedHere, setDecidedHere] = useState(false);

  // The buttons go away once decided: keep the keyboard user's place on the outcome.
  useEffect(() => {
    if (decidedHere && !pending) statusRef.current?.focus();
  }, [decidedHere, pending]);

  const decide = (approve: boolean) => {
    setDecidedHere(true);
    onDecide(approve);
  };
  const input = confirmation.input;
  const hasInput =
    input !== null && input !== undefined && !(typeof input === 'object' && !Object.keys(input).length);
  const isApply = confirmation.name === 'assistant.apply_change_set';

  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      aria-label={t('region', { label: confirmation.label })}
      className={cn(
        'grid min-w-0 gap-2 rounded-xl border-2 bg-card px-3.5 py-3',
        pending ? 'border-info/50' : 'border-border',
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <ShieldQuestionIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{t('title')}</p>
          <p className="text-sm font-semibold break-words">{confirmation.label}</p>
          <p className="text-xs text-muted-foreground">
            {t('tool', { tool: toolText(confirmation.name) })} ·{' '}
            <code className="font-mono">{confirmation.name}</code>
          </p>
        </div>
      </div>

      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className="w-fit rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ToneBadge
          meta={meta}
          label={
            key === 'failed'
              ? t('failed', { message: confirmation.result?.message ?? confirmation.result?.code ?? '' })
              : t(key)
          }
        />
      </div>

      {hasInput && (
        <Collapsible defaultIsOpen={false} trigger={<Text color="accent">{t('input')}</Text>}>
          <pre
            tabIndex={0}
            className="mt-1.5 max-h-60 overflow-auto rounded-md bg-muted/60 p-2.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {JSON.stringify(input, null, 2)}
          </pre>
        </Collapsible>
      )}

      {confirmation.changeSetId && (
        <Link
          href={changeSetHref(confirmation.changeSetId)}
          onClick={onNavigate}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {pending && isApply ? t('reviewFirst') : t('openChangeSet')}
          <ArrowRightIcon className="size-3.5" aria-hidden />
        </Link>
      )}

      {pending && (
        <>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
          {error ? (
            <div role="alert">
              <ToneText meta={{ icon: CircleAlertIcon, tone: 'destructive' }} label={errorOf(error)} wrap />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              label={t('approve')}
              // Names what is being confirmed (the visible "Confirm" is not enough once there are several cards).
              aria-label={t('approveAria', { label: confirmation.label })}
              variant="primary"
              size="sm"
              isLoading={deciding}
              isDisabled={disabled}
              onClick={() => decide(true)}
            />
            <Button
              label={t('decline')}
              aria-label={t('declineAria', { label: confirmation.label })}
              variant="secondary"
              size="sm"
              isDisabled={deciding || disabled}
              onClick={() => decide(false)}
            />
          </div>
        </>
      )}
    </motion.section>
  );
}
