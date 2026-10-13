'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { useApiQuery } from '@isbp/ui/query';
import { defineStatusMap, MappedStatus } from '@isbp/ui/status';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleSlashIcon,
  LockIcon,
  SendIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ItemStatus, MeetingDetail, MeetingStatus, Visibility } from '../contracts';

/**
 * Cache prefixes every Meetings mutation invalidates: its own, the record links panel (links to projects and to the
 * tasks items became) and Projects (sending minutes creates tasks there).
 */
export const INVALIDATE = ['/meetings/', '/records/', '/projects/'];

export const meetingApi = (ref: string) => `/meetings/meetings/${encodeURIComponent(ref)}`;
export const meetingHref = (ref: string) => `/meetings/${ref}`;

export function useMeeting(ref: string | null) {
  return useApiQuery<MeetingDetail>(ref ? meetingApi(ref) : null);
}

/** `2026-10-13T10:00` in the browser's zone (what a date-time input shows) ⇄ ISO instant. */
export function toLocalInput(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

/** A `YYYY-MM-DD` date as a local Date at noon (safe for formatting in any zone). */
export const dateValue = (day: string) => new Date(`${day}T12:00:00`);

const MEETING_STATUS = defineStatusMap<MeetingStatus>({
  draft: { tone: 'muted', icon: CircleDashedIcon, labelKey: 'draft' },
  published: { tone: 'success', icon: SendIcon, labelKey: 'published' },
});

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  const t = useTranslations('meetings.status');
  return <MappedStatus map={MEETING_STATUS} value={status} t={(k) => t(k as MeetingStatus)} />;
}

const ITEM_STATUS = defineStatusMap<ItemStatus>({
  open: { tone: 'info', icon: CircleDotIcon, labelKey: 'open' },
  done: { tone: 'success', icon: CircleCheckIcon, labelKey: 'done' },
  cancelled: { tone: 'muted', icon: CircleSlashIcon, labelKey: 'cancelled' },
});

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  const t = useTranslations('meetings.itemStatus');
  return <MappedStatus map={ITEM_STATUS} value={status} t={(k) => t(k as ItemStatus)} />;
}

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const t = useTranslations('meetings.visibility');
  if (visibility === 'internal') return null;
  return <Badge variant="neutral" label={t(visibility)} icon={<Icon icon={LockIcon} size="xsm" />} />;
}
