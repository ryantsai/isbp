'use client';

import { Banner } from '@astryxdesign/core/Banner';
import type { WebPageProps } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { BackLink, PageHeader } from '@isbp/ui/page-header';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { FileQuestionIcon, LockIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { JobDetail } from '../../contracts';
import { JobForm, type JobFormInitial } from '../job-form/job-form';
import { jobHref, useTaskTypes } from '../lib';

function parseConfig(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function Loading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

/**
 * `/scheduler/jobs/new` (deep link: `?type=etl.pipeline&name=…&config=<URI-encoded JSON>` pre-fills it) and
 * `/scheduler/jobs/:id/edit`.
 */
export default function JobFormPage({ params }: WebPageProps) {
  const t = useTranslations('scheduler');
  const sp = useSearchParams();
  const id = params.id;
  const { items, sandbox, isLoading } = useTaskTypes();
  const {
    data: job,
    isLoading: jobLoading,
    error,
  } = useApiQuery<JobDetail>(id ? `/scheduler/jobs/${id}` : null);

  if (id) {
    if (jobLoading || isLoading) return <Loading />;
    if (error || !job) return <EmptyState icon={<FileQuestionIcon />} title={t('job.notFound')} />;
    if (!job.viewer.canEdit) return <EmptyState icon={<LockIcon />} title={t('form.noAccess')} />;
    return (
      <>
        <BackLink href={jobHref(job.id)} label={job.name} />
        <PageHeader title={t('form.editTitle', { name: job.name })} description={t('form.editHint')} />
        <JobForm key={job.id} job={job} types={items} sandbox={sandbox} />
      </>
    );
  }

  if (isLoading) return <Loading />;
  const initial: JobFormInitial = {
    type: sp.get('type') ?? undefined,
    name: sp.get('name') ?? undefined,
    config: parseConfig(sp.get('config')),
  };
  const unknownType = initial.type && !items.some((x) => x.type === initial.type);
  return (
    <>
      <BackLink href="/scheduler/jobs" label={t('jobs.title')} />
      <PageHeader title={t('form.newTitle')} description={t('form.newHint')} />
      {items.length === 0 ? (
        <EmptyState icon={<LockIcon />} title={t('form.noTypes')} />
      ) : (
        <>
          {unknownType && (
            <Banner
              role="status"
              status="warning"
              collapsible={false}
              title={t('form.typeNotAvailable', { type: initial.type ?? '' })}
            />
          )}
          <JobForm initial={initial} types={items} sandbox={sandbox} />
        </>
      )}
    </>
  );
}
