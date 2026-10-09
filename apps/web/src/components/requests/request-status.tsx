'use client';

import type { MyRequest } from '@isbp/contracts';
import { Badge } from '@isbp/ui/badge';
import { defineStatusMap, MappedStatus } from '@isbp/ui/status';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleCheckIcon,
  ClockIcon,
  LoaderCircleIcon,
  SendIcon,
  UndoIcon,
  XCircleIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

const TONE = {
  neutral: 'muted',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
} as const;

export type Tone = keyof typeof TONE;

/**
 * One requester-facing status for every request (access, form, and the fulfilment behind an approved form): what is
 * happening, in the words a requester uses. Icon + text, never colour alone.
 */
export const REQUESTER_STATUS = defineStatusMap({
  received: { tone: 'info', icon: SendIcon, labelKey: 'requests.status.received' },
  waiting: { tone: 'warning', icon: ClockIcon, labelKey: 'requests.status.waiting' },
  inProgress: { tone: 'info', icon: LoaderCircleIcon, labelKey: 'requests.status.inProgress' },
  approved: { tone: 'success', icon: CheckCircle2Icon, labelKey: 'requests.status.approved' },
  done: { tone: 'success', icon: CircleCheckIcon, labelKey: 'requests.status.done' },
  rejected: { tone: 'destructive', icon: XCircleIcon, labelKey: 'requests.status.rejected' },
  withdrawn: { tone: 'muted', icon: UndoIcon, labelKey: 'requests.status.withdrawn' },
  failed: { tone: 'destructive', icon: AlertTriangleIcon, labelKey: 'requests.status.failed' },
});

export type RequesterStatus = keyof typeof REQUESTER_STATUS;

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

/** What a requester sees for an access or form request: waiting, in progress, approved, done, rejected… */
export function requesterStatusOf(r: {
  status: string;
  fulfilment?: MyRequest['fulfilment'];
  workflow?: { status: string } | null;
}): RequesterStatus {
  if (r.status === 'rejected') return 'rejected';
  if (r.status === 'cancelled') return 'withdrawn';
  if (r.status === 'failed') return 'failed';
  if (r.status === 'approved') {
    if (r.fulfilment?.state === 'open') return 'inProgress';
    if (r.fulfilment?.state === 'done') return 'done';
    return 'approved';
  }
  return r.workflow?.status === 'running' ? 'waiting' : 'received';
}

/** Status of a "My requests" row: a module's own status, or the requester's status for access and form requests. */
export function RequestStatus({ r }: { r: MyRequest }) {
  const t = useTranslations();
  if (r.kind === 'module' && r.statusKey) return <ModuleStatus statusKey={r.statusKey} tone={r.tone} />;
  return <MappedStatus map={REQUESTER_STATUS} value={requesterStatusOf(r)} t={t} />;
}
