'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { defineStatusMap, MappedStatus } from '@isbp/ui/status';
import { BanIcon, CircleCheckIcon, ClockIcon, UserXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** People lifecycle status: one map (tone, icon, label), rendered as icon + text. */
export const USER_STATUS = defineStatusMap({
  active: { tone: 'success', icon: CircleCheckIcon, labelKey: 'active', quiet: true },
  pending: { tone: 'warning', icon: ClockIcon, labelKey: 'pending' },
  suspended: { tone: 'destructive', icon: BanIcon, labelKey: 'suspended' },
  offboarded: { tone: 'muted', icon: UserXIcon, labelKey: 'offboarded' },
});

/** `quiet` (lists): "Active" as muted text, chips only for the exceptions. */
export function UserStatusBadge({ status, quiet = false }: { status: string; quiet?: boolean }) {
  const t = useTranslations('common.status_values');
  return (
    <MappedStatus
      map={USER_STATUS}
      value={status}
      t={(k) => (t.has(k) ? t(k) : k)}
      quiet={quiet ? undefined : false}
    />
  );
}

export function SourceBadge({ source }: { source: string }) {
  const t = useTranslations('common.source_values');
  return <Badge variant="neutral" label={t.has(source) ? t(source) : source} />;
}
