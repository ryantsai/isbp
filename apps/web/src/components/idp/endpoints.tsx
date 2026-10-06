'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { toast } from '@isbp/ui/sonner';
import { Hint } from '@isbp/ui/tooltip';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const tc = useTranslations('common');
  const t = useTranslations('idp.endpoints');
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
    <Hint label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        aria-label={label}
        className="shrink-0 overflow-hidden"
      >
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
      </Button>
    </Hint>
  );
}

/**
 * Values the identity provider's admin needs to register this platform (OIDC redirect URI, SAML
 * ACS / metadata / entity ID), each with a copy button.
 */
export function EndpointList({
  endpoints,
  className,
  title = true,
}: {
  endpoints: Record<string, string>;
  className?: string;
  title?: boolean;
}) {
  const t = useTranslations('idp.endpoints');
  const entries = Object.entries(endpoints);
  if (!entries.length) return null;
  return (
    <div className={cn('space-y-2', className)}>
      {title && <p className="text-xs font-medium text-muted-foreground">{t('title')}</p>}
      <ul className="space-y-1.5">
        {entries.map(([key, value]) => {
          const label = t.has(`labels.${key}`) ? t(`labels.${key}`) : key;
          return (
            <li key={key} className="flex items-center gap-2 rounded-md border bg-muted/40 py-1 pr-1 pl-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="truncate font-mono text-xs" title={value}>
                  {value}
                </div>
              </div>
              <CopyButton value={value} label={t('copy', { label })} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
