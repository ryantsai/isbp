'use client';

import { InfoIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * How to send the secret, and where the outside system's webhook settings are (for the connectors the
 * platform ships; others get the generic hint).
 */
export function WebhookHints({ type }: { type: string }) {
  const t = useTranslations('integrations.webhook');
  const specific = `hints.${type.replace(/[.-]/g, '_')}`;
  return (
    <div className="grid gap-1.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
      <p className="flex items-start gap-1.5">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>{t('hints.generic')}</span>
      </p>
      {t.has(specific) && <p className="pl-5">{t(specific)}</p>}
    </div>
  );
}
