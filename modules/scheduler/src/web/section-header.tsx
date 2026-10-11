'use client';

import { useCan } from '@isbp/sdk/web';
import { PageHeader } from '@isbp/ui/page-header';
import { SectionTabs } from '@isbp/ui/section-tabs';
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

/**
 * The area's header: "Scheduled jobs", what this section shows, "New job", and the sections (Overview | Jobs |
 * Runs) as link tabs.
 */
export function SchedulerHeader({ description, actions }: { description: string; actions?: ReactNode }) {
  const t = useTranslations('scheduler');
  const canCreate = useCan('scheduler.jobs.create');
  return (
    <>
      <PageHeader
        title={t('overview.title')}
        description={description}
        actions={
          (actions || canCreate) && (
            <>
              {actions}
              {canCreate && (
                <Button
                  label={t('jobs.new')}
                  variant="primary"
                  icon={<Icon icon={PlusIcon} />}
                  href="/scheduler/jobs/new"
                />
              )}
            </>
          )
        }
      />
      <SectionTabs
        label={t('nav.sections')}
        items={[
          { href: '/scheduler', label: t('nav.overview'), match: 'exact' },
          { href: '/scheduler/jobs', label: t('nav.jobs') },
          { href: '/scheduler/runs', label: t('nav.runs') },
        ]}
      />
    </>
  );
}
