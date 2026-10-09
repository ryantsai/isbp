'use client';

import { Button } from '@isbp/ui/button';
import { SuccessMark } from '@isbp/ui/motion';
import { toast } from '@isbp/ui/sonner';
import { CopyIcon, ExternalLinkIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

/**
 * "Version 2 is live": shown under the builder's header right after publishing, with the form's address, a copy
 * button and a link to the portal — the next thing people do after publishing is share it.
 */
export function PublishSuccess({
  open,
  version,
  audience,
  href,
  live,
  onClose,
}: {
  open: boolean;
  version: number;
  /** "Everyone", "2 groups". */
  audience: string;
  href: string;
  /** Turned off forms are published but nobody sees them. */
  live: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('forms.builder.success');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div
            role="status"
            className="flex flex-col gap-3 rounded-xl border border-success/30 bg-success/8 p-3 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <SuccessMark className="size-8" />
              <div className="min-w-0">
                <p className="font-medium">
                  {live ? t('title', { version, audience }) : t('titleOff', { version })}
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">{href}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void copy()}>
                <CopyIcon /> {t('copy')}
              </Button>
              {live && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={href}>
                    <ExternalLinkIcon /> {t('open')}
                  </Link>
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" aria-label={t('dismiss')} onClick={onClose}>
                <XIcon />
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
