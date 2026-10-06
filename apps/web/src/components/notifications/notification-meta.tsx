'use client';

import type { NotificationPreferences } from '@isbp/contracts';
import { type Locale, localeLabels, locales } from '@isbp/i18n';
import { matchPermission } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import {
  AlarmClockIcon,
  BellIcon,
  BellRingIcon,
  CircleArrowUpIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  ClipboardCheckIcon,
  FileCheckIcon,
  FileXIcon,
  ForwardIcon,
  HashIcon,
  HourglassIcon,
  KeyRoundIcon,
  type LucideIcon,
  MailIcon,
  MegaphoneIcon,
  MessagesSquareIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  WebhookIcon,
  WorkflowIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useApiQuery } from '@/lib/api';

export const CHANNELS_PATH = '/notification-channels';
export const PREFS_PATH = '/me/notification-preferences';

/** Every notification type the platform knows (from the preferences catalog), in catalog order. */
export function useKnownTypes() {
  const { data } = useApiQuery<NotificationPreferences>(PREFS_PATH);
  return data?.items ?? [];
}

/* ───────────────────────── notification types ───────────────────────── */

/**
 * Catalog key of a notification type's label, by convention: `core.approval.assigned` →
 * `core.notifications.approval_assigned.label`, `announcements.post.approved` →
 * `announcements.notifications.post_approved.label`.
 */
export function typeLabelKey(type: string): string | null {
  const dot = type.indexOf('.');
  if (dot <= 0 || dot === type.length - 1) return null;
  return `${type.slice(0, dot)}.notifications.${type.slice(dot + 1).replace(/[.-]/g, '_')}.label`;
}

/** Translated label of a notification type, or the raw type when the catalog has none. */
export function useTypeLabel() {
  const t = useTranslations();
  return useCallback(
    (type: string) => {
      const key = typeLabelKey(type);
      return key && t.has(key) ? t(key) : type;
    },
    [t],
  );
}

/** Translated module name (`<moduleId>.meta.name`), or the id. */
export function useModuleName() {
  const t = useTranslations();
  return useCallback(
    (moduleId: string) => {
      const key = `${moduleId}.meta.name`;
      return t.has(key) ? t(key) : moduleId;
    },
    [t],
  );
}

/** Known types a channel pattern covers (`*`, `core.*`, `core.access-request.*` or an exact type). */
export function typesMatching(pattern: string, known: readonly string[]): string[] {
  return known.filter((type) => matchPermission(pattern, type));
}

/**
 * Human label for a subscription pattern: "All notifications" for `*`, "All <module> notifications"
 * for `<module>.*`, the type label for an exact known type, otherwise `null` (show the raw pattern).
 */
export function usePatternLabel() {
  const t = useTranslations('notifications.patterns');
  const typeLabel = useTypeLabel();
  const moduleName = useModuleName();
  return useCallback(
    (pattern: string): string | null => {
      if (pattern === '*') return t('all');
      const m = /^([a-z][a-z0-9-]*)\.\*$/.exec(pattern);
      if (m) return t('module', { module: moduleName(m[1]!) });
      const label = typeLabel(pattern);
      return label === pattern ? null : label;
    },
    [t, typeLabel, moduleName],
  );
}

type Tone = 'primary' | 'success' | 'danger' | 'warning' | 'info' | 'muted';

const TONES: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/12 text-success',
  danger: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  warning: 'bg-warning/15 text-warning-foreground',
  info: 'bg-info/12 text-info',
  muted: 'bg-muted text-muted-foreground',
};

/** Icon + tone per notification type (decorative — the title always says what happened). */
function typeVisual(type: string): { icon: LucideIcon; tone: Tone } {
  if (type.startsWith('announcements.')) return { icon: MegaphoneIcon, tone: 'info' };
  switch (type) {
    case 'core.approval.assigned':
      return { icon: ClipboardCheckIcon, tone: 'primary' };
    case 'core.approval.reminder':
      return { icon: BellRingIcon, tone: 'warning' };
    case 'core.approval.escalated':
      return { icon: CircleArrowUpIcon, tone: 'warning' };
    case 'core.approval.overdue':
      return { icon: AlarmClockIcon, tone: 'danger' };
    case 'core.approval.delegated':
      return { icon: ForwardIcon, tone: 'primary' };
    case 'core.workflow.fyi':
      return { icon: WorkflowIcon, tone: 'info' };
    case 'core.access-request.approved':
      return { icon: ShieldCheckIcon, tone: 'success' };
    case 'core.access-request.rejected':
      return { icon: ShieldXIcon, tone: 'danger' };
    case 'core.access-request.failed':
      return { icon: ShieldAlertIcon, tone: 'danger' };
    case 'core.access.expiring':
      return { icon: HourglassIcon, tone: 'warning' };
    case 'core.access.granted':
      return { icon: KeyRoundIcon, tone: 'success' };
    case 'core.form-submission.approved':
      return { icon: FileCheckIcon, tone: 'success' };
    case 'core.form-submission.rejected':
      return { icon: FileXIcon, tone: 'danger' };
    default:
      return { icon: BellIcon, tone: 'muted' };
  }
}

export function TypeIcon({ type, className }: { type: string; className?: string }) {
  const { icon: Icon, tone } = typeVisual(type);
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4',
        TONES[tone],
        className,
      )}
    >
      <Icon />
    </span>
  );
}

/* ───────────────────────── channels ───────────────────────── */

export type ChannelKind = 'email' | 'teams' | 'slack' | 'webhook';
export const CHANNEL_TYPES = ['teams', 'slack', 'webhook'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

const CHANNEL: Record<ChannelKind, { icon: LucideIcon; tone: Tone }> = {
  email: { icon: MailIcon, tone: 'info' },
  teams: { icon: MessagesSquareIcon, tone: 'primary' },
  slack: { icon: HashIcon, tone: 'success' },
  webhook: { icon: WebhookIcon, tone: 'warning' },
};

/** Coloured icon tile per channel kind (always paired with a text label). */
export function ChannelTile({ kind, className }: { kind: string; className?: string }) {
  const c = CHANNEL[kind as ChannelKind] ?? { icon: BellIcon, tone: 'muted' as Tone };
  const Icon = c.icon;
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-lg [&_svg]:size-5',
        TONES[c.tone],
        className,
      )}
    >
      <Icon />
    </span>
  );
}

export function useChannelLabel() {
  const t = useTranslations('notifications.channelTypes');
  return useCallback((kind: string) => (t.has(kind) ? t(kind) : kind), [t]);
}

/** Small icon + label, e.g. in the delivery log. */
export function ChannelLabel({ kind }: { kind: string }) {
  const label = useChannelLabel();
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <ChannelTile kind={kind} className="size-7 rounded-md [&_svg]:size-3.5" />
      <span className="truncate">{label(kind)}</span>
    </span>
  );
}

/* ───────────────────────── delivery status ───────────────────────── */

export const DELIVERY_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;

const STATUS = {
  pending: { variant: 'info', icon: CircleDashedIcon },
  sent: { variant: 'success', icon: CircleCheckIcon },
  failed: { variant: 'destructive', icon: CircleXIcon },
  skipped: { variant: 'muted', icon: CircleMinusIcon },
} as const;

/** Delivery outcome with icon + text (never colour alone). */
export function DeliveryStatusBadge({ status }: { status: string }) {
  const t = useTranslations('notifications.admin.log.status');
  const s = STATUS[status as keyof typeof STATUS];
  const Icon = s?.icon;
  return (
    <Badge variant={s?.variant ?? 'outline'}>
      {Icon && <Icon aria-hidden />}
      {t.has(status) ? t(status) : status}
    </Badge>
  );
}

/* ───────────────────────── locales ───────────────────────── */

export const MESSAGE_LOCALES = locales;

export function localeLabel(locale: string) {
  return localeLabels[locale as Locale] ?? locale;
}
