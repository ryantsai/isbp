'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Text } from '@astryxdesign/core/Text';
import { useTranslations } from 'next-intl';

/**
 * How to send the secret, and where the outside system's webhook settings are (for the connectors the
 * platform ships; others get the generic hint).
 */
export function WebhookHints({ type }: { type: string }) {
  const t = useTranslations('integrations.webhook');
  const specific = `hints.${type.replace(/[.-]/g, '_')}`;
  return (
    <Banner
      status="info"
      title={t('hints.generic')}
      collapsible={false}
      description={t.has(specific) ? <Text color="secondary">{t(specific)}</Text> : undefined}
    />
  );
}
