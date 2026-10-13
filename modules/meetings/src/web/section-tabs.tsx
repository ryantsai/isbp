'use client';

import { SectionTabs } from '@isbp/ui/section-tabs';
import { useTranslations } from 'next-intl';

/** Meetings | My action items, under the header. */
export function MeetingsTabs() {
  const t = useTranslations('meetings.nav');
  return (
    <SectionTabs
      label={t('sections')}
      items={[
        { href: '/meetings', label: t('meetings'), match: 'exact' },
        { href: '/meetings/action-items', label: t('actionItems') },
      ]}
    />
  );
}
