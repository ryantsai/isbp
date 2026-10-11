'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { cn } from '@isbp/ui';
import { StatusBadge, type StatusTone } from '@isbp/ui/status';
import {
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowUpFromLineIcon,
  BanIcon,
  CalendarClockIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CirclePauseIcon,
  CircleXIcon,
  ClockIcon,
  GitCompareArrowsIcon,
  HandIcon,
  HourglassIcon,
  InfoIcon,
  LinkIcon,
  LoaderCircleIcon,
  type LucideIcon,
  LockOpenIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UnlinkIcon,
  WebhookIcon,
  ZapIcon,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { useTranslations } from 'next-intl';
import type {
  ConflictStatus,
  Direction,
  Health,
  LinkState,
  LogLevel,
  RunKind,
  RunStatus,
  RunTrigger,
} from '../contracts';

export type Tone = Exclude<StatusTone, 'neutral'>;

interface Meta {
  icon: LucideIcon;
  tone: Tone;
  spin?: boolean;
}

/** A spinning loader for work in flight (honours reduced motion). */
function SpinnerIcon({ className }: { className?: string }) {
  return <LoaderCircleIcon aria-hidden className={cn(className, 'motion-safe:animate-spin')} />;
}

/** Icon + text + tone, never colour alone. */
export function ToneBadge({ meta, label, className }: { meta: Meta; label: string; className?: string }) {
  return (
    <StatusBadge
      tone={meta.tone}
      icon={meta.spin ? SpinnerIcon : meta.icon}
      label={label}
      className={className}
    />
  );
}

const ICON_COLOR = {
  info: 'accent',
  primary: 'accent',
  warning: 'warning',
  success: 'success',
  muted: 'secondary',
  destructive: 'error',
} as const;

/** Compact status for dense rows: a coloured icon and the label as plain text. */
export function ToneText({ meta, label, className }: { meta: Meta; label: string; className?: string }) {
  return (
    <HStack gap={1} vAlign="center" className={cn('min-w-0', className)}>
      {meta.spin ? <Spinner size="sm" /> : <Icon icon={meta.icon} color={ICON_COLOR[meta.tone]} />}
      <Text type="supporting" weight="medium" color="primary" maxLines={1}>
        {label}
      </Text>
    </HStack>
  );
}

export const HEALTH: Record<Health, Meta> = {
  ok: { icon: CircleCheckIcon, tone: 'success' },
  failing: { icon: CircleXIcon, tone: 'destructive' },
  unknown: { icon: CircleHelpIcon, tone: 'muted' },
};

/**
 * The connection's health, honest about problems: a working connection with open conflicts or failed records reads
 * "Working · needs attention" in the warning tone.
 */
export function HealthBadge({
  health,
  enabled = true,
  attention = false,
}: {
  health: Health;
  enabled?: boolean;
  attention?: boolean;
}) {
  const t = useTranslations('integrations');
  if (!enabled)
    return <ToneBadge meta={{ icon: CirclePauseIcon, tone: 'muted' }} label={t('common.disabled')} />;
  if (health === 'ok' && attention)
    return <ToneBadge meta={{ icon: TriangleAlertIcon, tone: 'warning' }} label={t('health.attention')} />;
  return <ToneBadge meta={HEALTH[health]} label={t(`health.${health}`)} />;
}

/** "Not encrypted": the connection allows plain HTTP. */
export function InsecureBadge({ className }: { className?: string }) {
  const t = useTranslations('integrations.security');
  return (
    <ToneBadge meta={{ icon: LockOpenIcon, tone: 'warning' }} label={t('badge')} className={className} />
  );
}

export const RUN_STATUS: Record<RunStatus, Meta> = {
  queued: { icon: ClockIcon, tone: 'muted' },
  running: { icon: LoaderCircleIcon, tone: 'info', spin: true },
  waiting: { icon: HourglassIcon, tone: 'warning' },
  succeeded: { icon: CircleCheckIcon, tone: 'success' },
  partial: { icon: TriangleAlertIcon, tone: 'warning' },
  failed: { icon: CircleXIcon, tone: 'destructive' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const t = useTranslations('integrations.runStatus');
  return <ToneBadge meta={RUN_STATUS[status]} label={t(status)} />;
}

export function RunStatusText({ status }: { status: RunStatus }) {
  const t = useTranslations('integrations.runStatus');
  return <ToneText meta={RUN_STATUS[status]} label={t(status)} />;
}

const TRIGGER_ICON: Record<RunTrigger, LucideIcon> = {
  schedule: CalendarClockIcon,
  manual: HandIcon,
  webhook: WebhookIcon,
  event: ZapIcon,
};

const KIND_ICON: Record<RunKind, LucideIcon> = {
  pull: ArrowDownToLineIcon,
  push: ArrowUpFromLineIcon,
  webhook: WebhookIcon,
  resync: RefreshCwIcon,
  export: ArrowUpFromLineIcon,
};

export function TriggerLabel({ trigger, className }: { trigger: RunTrigger; className?: string }) {
  const t = useTranslations('integrations.runTrigger');
  const TriggerIcon = TRIGGER_ICON[trigger];
  return (
    <HStack gap={1.5} vAlign="center" className={className}>
      <Icon icon={TriggerIcon} color="secondary" />
      {t(trigger)}
    </HStack>
  );
}

export function KindLabel({ kind, className }: { kind: RunKind; className?: string }) {
  const t = useTranslations('integrations.runKind');
  const KindIcon = KIND_ICON[kind];
  return (
    <HStack gap={1.5} vAlign="center" className={className}>
      <Icon icon={KindIcon} color="secondary" />
      {t(kind)}
    </HStack>
  );
}

export const LINK_STATE: Record<LinkState, Meta> = {
  ok: { icon: LinkIcon, tone: 'success' },
  conflict: { icon: GitCompareArrowsIcon, tone: 'warning' },
  error: { icon: CircleAlertIcon, tone: 'destructive' },
  orphaned: { icon: UnlinkIcon, tone: 'muted' },
};

export function LinkStateBadge({ state }: { state: LinkState }) {
  const t = useTranslations('integrations.linkState');
  return <ToneBadge meta={LINK_STATE[state]} label={t(state)} />;
}

export const CONFLICT_STATUS: Record<ConflictStatus, Meta> = {
  open: { icon: GitCompareArrowsIcon, tone: 'warning' },
  resolved: { icon: CircleCheckIcon, tone: 'success' },
  dismissed: { icon: BanIcon, tone: 'muted' },
};

export function ConflictStatusBadge({ status }: { status: ConflictStatus }) {
  const t = useTranslations('integrations.conflictStatus');
  return <ToneBadge meta={CONFLICT_STATUS[status]} label={t(status)} />;
}

export const DIRECTION_ICON: Record<Direction, LucideIcon> = {
  pull: ArrowDownToLineIcon,
  push: ArrowUpFromLineIcon,
  both: ArrowLeftRightIcon,
};

export const LOG_LEVEL: Record<LogLevel, Meta> = {
  info: { icon: InfoIcon, tone: 'info' },
  warn: { icon: TriangleAlertIcon, tone: 'warning' },
  error: { icon: CircleXIcon, tone: 'destructive' },
};

export const PENDING: Meta = { icon: CircleDashedIcon, tone: 'muted' };

/** A connector's or entity's lucide icon (from its manifest), with a generic fallback. */
export function ModuleIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  if (!name) return <ArrowLeftRightIcon aria-hidden className={className} />;
  return (
    <DynamicIcon
      name={name as IconName}
      aria-hidden
      className={className}
      fallback={() => <ArrowLeftRightIcon aria-hidden className={className} />}
    />
  );
}
