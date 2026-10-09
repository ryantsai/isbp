'use client';

import { SectionTabs } from '@isbp/ui/section-tabs';
import { useTranslations } from 'next-intl';

/** Data APIs | Call log: the two pages of Data APIs, as link tabs under the header. */
export function DataApiTabs() {
  const t = useTranslations('etl.nav');
  return (
    <SectionTabs
      label={t('apiSections')}
      items={[
        { href: '/etl', label: t('endpoints'), match: 'exact' },
        { href: '/etl/logs', label: t('logs') },
      ]}
    />
  );
}
