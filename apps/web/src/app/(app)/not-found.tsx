import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { CompassIcon } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('shell');
  return (
    <EmptyState
      icon={<CompassIcon />}
      title={t('notFoundTitle')}
      description={t('notFoundBody')}
      action={
        <Button asChild variant="outline">
          <Link href="/">{t('goHome')}</Link>
        </Button>
      }
    />
  );
}
