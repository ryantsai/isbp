'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
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

export type Tone = 'info' | 'primary' | 'warning' | 'success' | 'muted' | 'destructive';

/** Tone classes tuned for AA on their own tints (the platform's status tokens). */
export const TONE: Record<Tone, string> = {
  info: 'border-transparent bg-info/12 text-info',
  primary: 'border-transparent bg-primary/10 text-primary',
  warning: 'border-transparent bg-warning/15 text-warning-foreground',
  success: 'border-transparent bg-success/12 text-success',
  muted: 'border-transparent bg-muted text-muted-foreground',
  destructive: 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20',
};

/** Icon + text + tone: status is never shown by colour alone. */
export function ToneBadge({
  tone,
  icon: Icon,
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
  return (
    <Badge variant="outline" className={cn(TONE[tone], className)}>
      <Icon aria-hidden className={cn(spin && 'motion-safe:animate-spin')} />
      {label}
    </Badge>
  );
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

/** `GET` / `POST` in a monospace chip. */
export function MethodBadge({ method }: { method: 'GET' | 'POST' }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold',
        method === 'GET' ? TONE.info : TONE.primary,
      )}
    >
      {method}
    </span>
  );
}

/** An HTTP status of the execution log: icon + code (+ error code). */
export function HttpStatus({ status, code }: { status: number; code?: string | null }) {
  const t = useTranslations('etl.logs');
  const ok = status < 400;
  const Icon = ok ? CircleCheckIcon : CircleXIcon;
  return (
    <span
      className={cn(
        'inline-flex w-fit flex-wrap items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
        ok ? TONE.success : TONE.destructive,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{ok ? t('outcomeOk') : t('outcomeError')}</span>
      {status}
      {code && !ok && <span className="font-normal">· {code}</span>}
    </span>
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
  if (!connection) return <span className="text-muted-foreground">—</span>;
  if (connection.status === 'missing')
    return (
      <span
        className={cn(
          'inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
          TONE.destructive,
          className,
        )}
      >
        <UnplugIcon className="size-3.5" aria-hidden />
        {t('connection.missing')}
      </span>
    );
  return (
    <span className={cn('flex min-w-0 max-w-full items-start gap-1.5', className)}>
      <DatabaseIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate">{connection.name}</span>
        {(connection.engine || connection.status === 'error') && (
          <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {connection.engine && <span>{t(`engine.${connection.engine}`)}</span>}
            {connection.status === 'error' && (
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[11px]',
                  TONE.destructive,
                )}
              >
                <CircleXIcon className="size-3" aria-hidden />
                {t('connection.unreachable')}
              </span>
            )}
          </span>
        )}
      </span>
    </span>
  );
}

export function DraftBadge() {
  const t = useTranslations('etl.endpoint');
  return <ToneBadge tone="info" icon={CircleDashedIcon} label={t('unpublishedChanges')} />;
}
