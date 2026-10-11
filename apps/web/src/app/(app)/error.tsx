'use client';

import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@isbp/ui/empty-state';
import { TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  useEffect(() => console.error(error), [error]);
  return (
    <EmptyState
      icon={<TriangleAlertIcon />}
      title={t('shell.errorTitle')}
      description={`${t('shell.errorBody')}${error.digest ? ` (${error.digest})` : ''}`}
      action={<Button label={t('common.retry')} variant="primary" onClick={reset} />}
    />
  );
}
