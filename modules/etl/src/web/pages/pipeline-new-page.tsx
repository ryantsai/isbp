'use client';

import { Button } from '@isbp/ui/button';
import { PageHeader } from '@isbp/ui/page-header';
import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { pipelineHref } from '../lib';
import { PipelineEditor } from '../pipeline/editor';

/** New pipeline: the full editor (the target is validated against its catalog on save). */
export default function PipelineNewPage() {
  const t = useTranslations('etl');
  const router = useRouter();
  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/etl/pipelines">
          <ArrowLeftIcon /> {t('pipelines.title')}
        </Link>
      </Button>
      <PageHeader title={t('pipelines.newTitle')} description={t('pipelines.newHint')} />
      <PipelineEditor onSaved={(p) => router.push(pipelineHref(p.id))} />
    </div>
  );
}
