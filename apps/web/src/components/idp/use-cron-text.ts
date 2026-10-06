'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { parseCron } from './cron';

/** Describes common cron expressions in words ("Every 6 hours"); `null` for anything else. */
export function useCronText() {
  const t = useTranslations('idp.cron');
  return useCallback(
    (expr: string | null | undefined): string | null => {
      const c = parseCron(expr);
      if (!c) return null;
      switch (c.kind) {
        case 'everyMinutes':
          return t('everyMinutes', { count: c.n });
        case 'hourly':
          return t('everyHours', { count: 1 });
        case 'hourlyAt':
          return t('hourlyAt', { minute: c.minute });
        case 'everyHours':
          return t('everyHours', { count: c.n });
        case 'dailyAt':
          return t('dailyAt', { time: c.time });
      }
    },
    [t],
  );
}
