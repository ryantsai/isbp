'use client';

import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { toast } from '@isbp/ui/sonner';
import { CopyIcon, KeyRoundIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useOrigin, webhookPath } from '../lib';
import { WebhookHints } from './webhook-hints';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations('integrations.common');
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast.success(t('copied'));
        } catch {
          toast.error(t('copyFailed'));
        }
      }}
    >
      <CopyIcon />
    </Button>
  );
}

/** The webhook secret, once: only its hash is stored, so this is the only time anyone sees it. */
export function SecretDialog({
  open,
  onOpenChange,
  secret,
  connectionId,
  connectorType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secret: string | null;
  connectionId: string;
  connectorType: string;
}) {
  const t = useTranslations('integrations.webhook');
  const tc = useTranslations('common');
  const id = useId();
  const origin = useOrigin();
  const url = `${origin}${webhookPath(connectionId)}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-primary" aria-hidden />
            {t('secretTitle')}
          </DialogTitle>
          <DialogDescription>{t('secretDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-url`}>{t('url')}</Label>
            <div className="flex min-w-0 gap-2">
              <Input id={`${id}-url`} readOnly value={url} className="min-w-0 font-mono text-xs" />
              <CopyButton value={url} label={t('copyUrl')} />
            </div>
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-secret`}>{t('secret')}</Label>
            <div className="flex min-w-0 gap-2">
              <Input
                id={`${id}-secret`}
                readOnly
                value={secret ?? ''}
                className="min-w-0 font-mono text-xs"
                aria-describedby={`${id}-once`}
              />
              <CopyButton value={secret ?? ''} label={t('copySecret')} />
            </div>
            <p id={`${id}-once`} className="flex items-start gap-1.5 text-xs text-warning-foreground">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {t('once')}
            </p>
          </div>
          <WebhookHints type={connectorType} />
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('saved')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
