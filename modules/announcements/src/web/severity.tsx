'use client';

import { defineStatusMap, MappedStatus } from '@isbp/ui/status';
import {
  ArchiveIcon,
  CircleCheckIcon,
  ClockIcon,
  InfoIcon,
  PencilLineIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { PostStatus, Severity } from '../contracts';

/** Severity, mapped once: tone + icon + label (never colour alone). */
const SEVERITY = defineStatusMap<Severity>({
  info: { tone: 'info', icon: InfoIcon, labelKey: 'info' },
  maintenance: { tone: 'warning', icon: WrenchIcon, labelKey: 'maintenance' },
  incident: { tone: 'destructive', icon: TriangleAlertIcon, labelKey: 'incident' },
});

const BAR: Record<Severity, string> = {
  info: 'bg-info',
  maintenance: 'bg-warning',
  incident: 'bg-destructive',
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const t = useTranslations('announcements.severity');
  return <MappedStatus map={SEVERITY} value={severity} t={(k) => t(k as Severity)} className={className} />;
}

/** The coloured edge of a post card (decoration next to the severity badge, which carries the meaning). */
export function severityBar(severity: Severity) {
  return BAR[severity];
}

/** Where a post is in its life. Published is the normal state, so it only shows on the post page. */
const STATUS = defineStatusMap<PostStatus>({
  draft: { tone: 'muted', icon: PencilLineIcon, labelKey: 'draft' },
  pending: { tone: 'warning', icon: ClockIcon, labelKey: 'pending' },
  published: { tone: 'success', icon: CircleCheckIcon, labelKey: 'published' },
  archived: { tone: 'muted', icon: ArchiveIcon, labelKey: 'archived' },
});

export function PostStatusBadge({
  status,
  animate,
  className,
}: {
  status: PostStatus;
  animate?: boolean;
  className?: string;
}) {
  const t = useTranslations('announcements.status');
  return (
    <MappedStatus
      map={STATUS}
      value={status}
      t={(k) => t(k as PostStatus)}
      animate={animate}
      className={className}
    />
  );
}
