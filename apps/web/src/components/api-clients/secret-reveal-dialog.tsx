'use client';

import type { CreatedSecret } from '@isbp/contracts';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Label } from '@isbp/ui/label';
import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { CopyButton } from '@/components/applications/app-parts';
import { ClientExamples } from './client-parts';

/**
 * One-time reveal of a new client secret. It can't be dismissed by accident (no outside click / Esc):
 * closing requires confirming the secret was stored.
 */
export function SecretRevealDialog({
  created,
  onDone,
  rotated,
}: {
  created: CreatedSecret | null;
  onDone: () => void;
  /** A new secret for an existing client (rotation) rather than a new client. */
  rotated?: boolean;
}) {
  const t = useTranslations('applications.clients.reveal');
  const id = useId();
  const [stored, setStored] = useState(false);
  const [last, setLast] = useState(created);
  if (created && created !== last) {
    setLast(created);
    setStored(false);
  }
  const shown = created ?? last;
  if (!shown) return null;
  const { client, secret } = shown;

  return (
    <Dialog open={created !== null}>
      <DialogContent
        showClose={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className="text-success"
            >
              <CircleCheckIcon className="size-5" aria-hidden />
            </motion.span>
            {rotated ? t('rotatedTitle') : t('title', { name: client.name })}
          </DialogTitle>
          <DialogDescription>{rotated ? t('rotatedDescription') : t('description')}</DialogDescription>
        </DialogHeader>

        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <span className="font-medium">{t('warningTitle')}</span> {t('warning')}
          </p>
        </div>

        <div className="grid min-w-0 gap-3">
          <div className="grid min-w-0 gap-1.5">
            <span className="text-xs font-medium text-muted-foreground" id={`${id}-secret`}>
              {t('secret')}
            </span>
            <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
              <code
                aria-labelledby={`${id}-secret`}
                className="min-w-0 flex-1 font-mono text-sm break-all select-all"
                data-testid="client-secret"
              >
                {secret}
              </code>
              <CopyButton value={secret} label={t('copySecret')} variant="outline" />
            </div>
          </div>
          <div className="grid min-w-0 gap-1.5">
            <span className="text-xs font-medium text-muted-foreground" id={`${id}-client`}>
              {t('clientId')}
            </span>
            <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
              <code
                aria-labelledby={`${id}-client`}
                className="min-w-0 flex-1 truncate font-mono text-sm"
                data-testid="client-id"
              >
                {client.clientId}
              </code>
              <CopyButton value={client.clientId} label={t('copyClientId')} />
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium">{t('tryIt')}</p>
          <ClientExamples client={client} secret={secret} />
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <div className="flex items-center gap-2 self-start sm:self-center">
            <Checkbox id={`${id}-stored`} checked={stored} onCheckedChange={(v) => setStored(v === true)} />
            <Label htmlFor={`${id}-stored`} className="font-normal">
              {t('stored')}
            </Label>
          </div>
          <Button onClick={onDone} disabled={!stored}>
            {t('done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
