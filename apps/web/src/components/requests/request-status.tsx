'use client';

import type { MyRequest } from '@isbp/contracts';
import { Badge } from '@isbp/ui/badge';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '../workflows/status-badges';

const TONE = {
  neutral: 'muted',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
} as const;

export type Tone = keyof typeof TONE;

/** A status label from a module's catalog (e.g. `itsm.status.in_progress`) with its tone — never colour-only. */
export function ModuleStatus({ statusKey, tone }: { statusKey: string; tone: Tone | null }) {
  const root = useTranslations();
  return (
    <Badge variant={TONE[tone ?? 'neutral']}>
      {root.has(statusKey) ? root(statusKey) : statusKey.split('.').pop()}
    </Badge>
  );
}

/** The request being fulfilled by a module (e.g. its service-desk ticket), if any. */
export function fulfilmentOf(r: MyRequest) {
  return r.kind === 'form' && r.status === 'approved' ? r.fulfilment : null;
}

/** Module rows link to the module's page; access and form requests to the request page. */
export function requestHref(r: MyRequest): string {
  return r.kind === 'module' && r.href ? r.href : `/requests/${r.reference}`;
}

/** Status of a "My requests" row: the module's own status, the fulfilment's, or the request's. */
export function RequestStatus({ r }: { r: MyRequest }) {
  const fulfilling = fulfilmentOf(r);
  if (r.kind === 'module' && r.statusKey) return <ModuleStatus statusKey={r.statusKey} tone={r.tone} />;
  if (fulfilling) return <ModuleStatus statusKey={fulfilling.statusKey} tone={fulfilling.tone} />;
  return <StatusBadge status={r.status} />;
}
