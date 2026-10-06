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
import { toast } from '@isbp/ui/sonner';
import { CheckIcon, CopyIcon, KeyRoundIcon, TriangleAlertIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

const SNIPPET = `// Node.js — verify before trusting the payload
const header = req.headers['x-isbp-signature']; // "t=…,v1=…"
const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
const expected = crypto
  .createHmac('sha256', SIGNING_SECRET)
  .update(\`\${t}.\${rawBody}\`)
  .digest('hex');
const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
const valid = fresh && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));`;

export function CopyButton({ value, label }: { value: string; label: string }) {
  const tc = useTranslations('common');
  const t = useTranslations('notifications.admin');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const h = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(h);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(tc('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? 'done' : 'copy'}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="grid place-items-center"
        >
          {copied ? <CheckIcon className="size-4 text-success" /> : <CopyIcon className="size-4" />}
        </motion.span>
      </AnimatePresence>
      {label}
    </Button>
  );
}

/** Shown once after creating a generic webhook: the signing secret and how receivers verify it. */
export function SigningSecretDialog({
  open,
  onOpenChange,
  name,
  secret,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  secret: string;
}) {
  const t = useTranslations('notifications.admin.secret');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={tc('close')}
        className="grid-cols-[minmax(0,1fr)] sm:max-w-xl"
        // Losing the secret by a stray click would mean re-creating the channel.
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 leading-snug">
            <KeyRoundIcon className="size-5 text-primary" aria-hidden />
            {t('title', { name })}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-2.5 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 font-mono text-sm break-all select-all">{secret}</code>
            <CopyButton value={secret} label={tc('copy')} />
          </div>
          <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            {t('once')}
          </p>
        </div>
        <section className="space-y-2" aria-labelledby="verify-heading">
          <h3 id="verify-heading" className="text-sm font-medium">
            {t('verifyTitle')}
          </h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              {t.rich('step1', {
                code: (chunks) => <code className="font-mono text-xs text-foreground">{chunks}</code>,
              })}
            </li>
            <li>
              {t.rich('step2', {
                code: (chunks) => <code className="font-mono text-xs text-foreground">{chunks}</code>,
              })}
            </li>
            <li>{t('step3')}</li>
          </ol>
          <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
            <code>{SNIPPET}</code>
          </pre>
        </section>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
