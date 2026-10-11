'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { cn } from '@isbp/ui';
import { StatusBadge, type StatusTone } from '@isbp/ui/status';
import {
  ArchiveIcon,
  BanIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ClockIcon,
  DatabaseIcon,
  LoaderCircleIcon,
  type LucideIcon,
  PencilLineIcon,
  TriangleAlertIcon,
  UnplugIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ConnectionRef, EndpointStatus, RunStatus, VersionStatus } from '../contracts';

export type Tone = Exclude<StatusTone, 'neutral'>;

/** A spinning loader for work in flight (honours reduced motion). */
function SpinnerIcon({ className }: { className?: string }) {
  return <LoaderCircleIcon aria-hidden className={cn(className, 'motion-safe:animate-spin')} />;
}

/** Icon + text + tone: status is never shown by colour alone. */
export function ToneBadge({
  tone,
  icon,
  label,
  className,
  spin,
}: {
  tone: Tone;
  icon: LucideIcon;
  label: string;
  className?: string;
  spin?: boolean;
}) {
  return <StatusBadge tone={tone} icon={spin ? SpinnerIcon : icon} label={label} className={className} />;
}

const ENDPOINT_META: Record<EndpointStatus, { tone: Tone; icon: LucideIcon }> = {
  draft: { tone: 'muted', icon: PencilLineIcon },
  published: { tone: 'success', icon: CircleCheckIcon },
  deprecated: { tone: 'warning', icon: TriangleAlertIcon },
  retired: { tone: 'muted', icon: ArchiveIcon },
};

export function EndpointStatusBadge({ status }: { status: EndpointStatus }) {
  const t = useTranslations('etl.endpointStatus');
  const m = ENDPOINT_META[status];
  return <ToneBadge tone={m.tone} icon={m.icon} label={t(status)} />;
}

const VERSION_META: Record<VersionStatus, { tone: Tone; icon: LucideIcon }> = {
  published: { tone: 'success', icon: CircleCheckIcon },
  deprecated: { tone: 'warning', icon: TriangleAlertIcon },
  retired: { tone: 'muted', icon: ArchiveIcon },
};

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  const t = useTranslations('etl.versionStatus');
  const m = VERSION_META[status];
  return <ToneBadge tone={m.tone} icon={m.icon} label={t(status)} />;
}

export const RUN_META: Record<RunStatus, { tone: Tone; icon: LucideIcon }> = {
  queued: { tone: 'muted', icon: ClockIcon },
  running: { tone: 'info', icon: LoaderCircleIcon },
  succeeded: { tone: 'success', icon: CircleCheckIcon },
  failed: { tone: 'destructive', icon: CircleXIcon },
  cancelled: { tone: 'warning', icon: BanIcon },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const t = useTranslations('etl.runStatus');
  const m = RUN_META[status];
  return <ToneBadge tone={m.tone} icon={m.icon} label={t(status)} spin={status === 'running'} />;
}

/** `GET` / `POST`: a category chip, not a status. */
export function MethodBadge({ method }: { method: 'GET' | 'POST' }) {
  return (
    <span className="inline-flex shrink-0">
      <Badge variant={method === 'GET' ? 'blue' : 'purple'} label={method} />
    </span>
  );
}

/** An HTTP status of the execution log: icon + code (+ error code). */
export function HttpStatus({ status, code }: { status: number; code?: string | null }) {
  const t = useTranslations('etl.logs');
  const ok = status < 400;
  return (
    <StatusBadge
      tone={ok ? 'success' : 'destructive'}
      icon={ok ? CircleCheckIcon : CircleXIcon}
      label={
        <>
          <span className="sr-only">{ok ? t('outcomeOk') : t('outcomeError')}</span>
          {status}
          {code && !ok && <> · {code}</>}
        </>
      }
    />
  );
}

/** A connection's name with its engine; deleted connections say so. */
export function ConnectionLabel({
  connection,
  className,
}: {
  connection: ConnectionRef | null;
  className?: string;
}) {
  const t = useTranslations('etl');
  if (!connection) return <Text color="secondary">—</Text>;
  if (connection.status === 'missing')
    return (
      <StatusBadge
        tone="destructive"
        icon={UnplugIcon}
        label={t('connection.missing')}
        className={className}
      />
    );
  return (
    <HStack gap={1.5} vAlign="start" className={cn('max-w-full min-w-0', className)}>
      <Icon icon={DatabaseIcon} color="secondary" />
      <VStack gap={0} className="min-w-0">
        <Text maxLines={1}>{connection.name}</Text>
        {(connection.engine || connection.status === 'error') && (
          <HStack gap={1} wrap="wrap" vAlign="center">
            {connection.engine && (
              <Text type="supporting" color="secondary">
                {t(`engine.${connection.engine}`)}
              </Text>
            )}
            {connection.status === 'error' && (
              <StatusBadge tone="destructive" icon={CircleXIcon} label={t('connection.unreachable')} />
            )}
          </HStack>
        )}
      </VStack>
    </HStack>
  );
}

export function DraftBadge() {
  const t = useTranslations('etl.endpoint');
  return <ToneBadge tone="info" icon={CircleDashedIcon} label={t('unpublishedChanges')} />;
}
