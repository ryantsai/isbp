'use client';

import { useTranslations } from 'next-intl';
import type { Review } from '../contracts';

/** Progress as a bar and as text (never colour alone). */
export function ReviewProgress({ totals }: { totals: Review['totals'] }) {
  const t = useTranslations('dbaccess.reviews');
  const done = totals.items - totals.pending;
  const pct = totals.items ? Math.round((done / totals.items) * 100) : 100;
  return (
    <div className="grid min-w-0 gap-1">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t('progress')}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">
        {t('progressText', { done, items: totals.items, kept: totals.kept, revoked: totals.revoked })}
      </span>
    </div>
  );
}
