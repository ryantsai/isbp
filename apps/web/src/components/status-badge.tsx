'use client';

import { Badge } from '@isbp/ui/badge';
import { useTranslations } from 'next-intl';

const STATUS_VARIANT = {
  active: 'success',
  pending: 'warning',
  suspended: 'destructive',
  offboarded: 'muted',
} as const;

/** People lifecycle status — colour plus a dot and text label (never colour alone). */
export function UserStatusBadge({ status }: { status: string }) {
  const t = useTranslations('common.status_values');
  const variant = STATUS_VARIANT[status as keyof typeof STATUS_VARIANT] ?? 'muted';
  return (
    <Badge variant={variant}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t.has(status) ? t(status) : status}
    </Badge>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const t = useTranslations('common.source_values');
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      {t.has(source) ? t(source) : source}
    </Badge>
  );
}
