'use client';

import { useListState } from '@isbp/ui/data-table';
import { PageHeader } from '@isbp/ui/page-header';
import { useTranslations } from 'next-intl';
import { ConflictsTable } from '../conflicts';

/** Every connection's sync conflicts; `?conflict=<id>` opens one (notifications link here). */
export default function ConflictsPage() {
  const t = useTranslations('integrations.conflicts');
  const [state, set] = useListState({ pageSize: 25 });
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <ConflictsTable state={state} set={set} />
    </>
  );
}
