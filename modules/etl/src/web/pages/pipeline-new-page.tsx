'use client';
import { PageHeader } from '@isbp/ui/page-header';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { pipelineHref } from '../lib';
import { PipelineEditor } from '../pipeline/editor';

/** New pipeline: the full editor (the target is validated against its catalog on save). */
export default function PipelineNewPage() {
  const t = useTranslations('etl');
  const router = useRouter();
  return (
    <>
      <PageHeader
        back={{ href: '/etl/pipelines', label: t('pipelines.title') }}
        title={t('pipelines.newTitle')}
        description={t('pipelines.newHint')}
      />
      <PipelineEditor onSaved={(p) => router.push(pipelineHref(p.id))} />
    </>
  );
}
