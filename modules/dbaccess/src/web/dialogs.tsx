'use client';

import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Textarea } from '@isbp/ui/textarea';
import { CheckIcon, CopyIcon, EyeIcon, KeyRoundIcon, ShieldAlertIcon, TimerOffIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { Reveal } from '../contracts';
import { INVALIDATE } from './lib';

/** Asks for a reason before revoking, giving back or other irreversible actions. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<unknown>;
  pending?: boolean;
}) {
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open && (
          <ReasonForm
            confirmLabel={confirmLabel}
            pending={pending}
            onCancel={() => onOpenChange(false)}
            onConfirm={async (reason) => {
              await onConfirm(reason);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  confirmLabel: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const t = useTranslations('dbaccess.reason');
  const tc = useTranslations('common');
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (reason.trim().length < 3) {
          setError(t('required'));
          return;
        }
        await onConfirm(reason.trim()).catch(() => undefined);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={id}>{t('label')}</Label>
        <Textarea
          id={id}
          rows={3}
          value={reason}
          maxLength={1_000}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p id={`${id}-error`} className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" variant="destructive" loading={pending}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations('dbaccess.reveal');
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={copied ? t('copied') : label}
      onClick={async () => {
        await navigator.clipboard?.writeText(value).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 2_000);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

/**
 * The one-time credential reveal: the password is fetched only when the person asks for it, shown once,
 * and never stored in the page cache.
 */
export function RevealDialog({
  revealId,
  available,
  open,
  onOpenChange,
}: {
  revealId: string;
  available: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('dbaccess.reveal');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const [shown, setShown] = useState<Reveal | null>(null);
  const [gone, setGone] = useState(false);
  const reveal = useApiMutation((api) => api.post<Reveal>(`/dbaccess/reveals/${revealId}`), {
    invalidate: INVALIDATE,
    silent: true,
    onSuccess: (r) => setShown(r),
  });
  const close = (next: boolean) => {
    if (!next) {
      setShown(null);
      reveal.reset();
    }
    onOpenChange(next);
  };
  const expired =
    gone || (!available && !shown) || (reveal.error instanceof ApiError && reveal.error.status === 410);
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-primary" aria-hidden />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {shown ? (
          <div className="grid gap-3">
            <dl className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">{t('server')}</dt>
                <dd className="min-w-0 font-mono break-all">
                  {shown.connection.host}
                  {shown.connection.port ? `:${shown.connection.port}` : ''}
                  {shown.connection.database ? ` / ${shown.connection.database}` : ''}
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">{t('account')}</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 font-mono break-all">{shown.accountName}</span>
                  <CopyButton value={shown.accountName} label={t('copyAccount')} />
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">{t('password')}</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <span
                    className="min-w-0 flex-1 font-mono text-base break-all"
                    data-testid="revealed-password"
                  >
                    {shown.password}
                  </span>
                  <CopyButton value={shown.password} label={t('copyPassword')} />
                </dd>
              </div>
            </dl>
            <p className="flex items-start gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm text-warning-foreground">
              <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t('onceWarning')}
            </p>
          </div>
        ) : expired ? (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-muted px-3 py-3 text-sm">
            <TimerOffIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t('expired')}
          </p>
        ) : (
          <div className="grid gap-3 text-sm">
            <p>{t('confirm')}</p>
            {reveal.error && !(reveal.error instanceof ApiError && reveal.error.status === 410) && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                {errorText(reveal.error)}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {tc('close')}
          </Button>
          {!shown && !expired && (
            <Button
              type="button"
              loading={reveal.isPending}
              onClick={() =>
                reveal.mutate(undefined, {
                  onError: (err) => {
                    if (err instanceof ApiError && err.status === 410) setGone(true);
                  },
                })
              }
            >
              <EyeIcon /> {t('show')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
