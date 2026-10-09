'use client';

import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { PageHeader } from '@isbp/ui/page-header';
import { SectionTabs } from '@isbp/ui/section-tabs';
import { PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

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
                <Button asChild>
                  <Link href="/scheduler/jobs/new">
                    <PlusIcon /> {t('jobs.new')}
                  </Link>
                </Button>
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
