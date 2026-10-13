'use client';

import { useCan } from '@isbp/sdk/web';
import { SectionTabs } from '@isbp/ui/section-tabs';
import { useTranslations } from 'next-intl';
import { PERMISSIONS } from '../contracts';

/** Projects | My tasks | Status report | Status updates (the PMO and portfolio readers), under the header. */
export function ProjectsTabs() {
  const t = useTranslations('projects.nav');
  const reporting = useCan(PERMISSIONS.reporting);
  const portfolio = useCan(PERMISSIONS.portfolio);
  return (
    <SectionTabs
      label={t('sections')}
      items={[
        { href: '/projects', label: t('portfolio'), match: 'exact' },
        { href: '/projects/my-tasks', label: t('myTasks') },
        { href: '/projects/status-report', label: t('statusReport') },
        ...(reporting || portfolio ? [{ href: '/projects/status-updates', label: t('statusUpdates') }] : []),
      ]}
    />
  );
}
