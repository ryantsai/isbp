import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@isbp/ui/empty-state';
import { CompassIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('shell');
  return (
    <EmptyState
      icon={<CompassIcon />}
      title={t('notFoundTitle')}
      description={t('notFoundBody')}
      action={<Button label={t('goHome')} variant="secondary" href="/" />}
    />
  );
}
