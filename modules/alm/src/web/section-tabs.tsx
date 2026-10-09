'use client';

import { SectionTabs } from '@isbp/ui/section-tabs';
import { useTranslations } from 'next-intl';

/** Applications | Release calendar, under the area's header. */
export function AlmTabs() {
  const t = useTranslations('alm.nav');
  return (
    <SectionTabs
      label={t('sections')}
      items={[
        { href: '/alm', label: t('applications'), match: 'exact' },
        { href: '/alm/releases', label: t('releases') },
      ]}
    />
  );
}
