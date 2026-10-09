'use client';

import { SectionTabs } from '@isbp/ui/section-tabs';
import { useTranslations } from 'next-intl';

/** Projects | My tasks, under the header. */
export function ProjectsTabs() {
  const t = useTranslations('projects.nav');
  return (
    <SectionTabs
      label={t('sections')}
      items={[
        { href: '/projects', label: t('portfolio'), match: 'exact' },
        { href: '/projects/my-tasks', label: t('myTasks') },
      ]}
    />
  );
}
