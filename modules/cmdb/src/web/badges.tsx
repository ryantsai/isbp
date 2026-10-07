'use client';

import { localize } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { ChevronsUpIcon, ChevronUpIcon, EqualIcon, ChevronDownIcon, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { CiClassRef, CiCriticality, CiEnvironment, CiStatus } from '../contracts';
import { ClassIcon } from './class-icon';

const STATUS_VARIANT: Record<CiStatus, 'info' | 'success' | 'warning' | 'muted'> = {
  planned: 'info',
  in_use: 'success',
  maintenance: 'warning',
  retired: 'muted',
};

/** Lifecycle status: tone plus a dot and the label (never colour alone). */
export function CiStatusBadge({ status, className }: { status: CiStatus; className?: string }) {
  const t = useTranslations('cmdb.status');
  return (
    <Badge variant={STATUS_VARIANT[status]} className={className}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t(status)}
    </Badge>
  );
}

const CRITICALITY: Record<CiCriticality, { icon: LucideIcon; className: string }> = {
  critical: { icon: ChevronsUpIcon, className: 'bg-destructive/10 text-destructive dark:bg-destructive/20' },
  high: { icon: ChevronUpIcon, className: 'bg-warning/15 text-warning-foreground' },
  medium: { icon: EqualIcon, className: 'bg-info/12 text-info' },
  low: { icon: ChevronDownIcon, className: 'bg-muted text-muted-foreground' },
};

export function CriticalityBadge({
  criticality,
  className,
}: {
  criticality: CiCriticality;
  className?: string;
}) {
  const t = useTranslations('cmdb.criticality');
  const { icon: Icon, className: tone } = CRITICALITY[criticality];
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tone,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(criticality)}
    </span>
  );
}

export function EnvironmentBadge({ environment }: { environment: CiEnvironment | null }) {
  const t = useTranslations('cmdb');
  if (!environment) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className="font-normal">
      {t(`environment.${environment}`)}
    </Badge>
  );
}

/** Class icon tile + localized name. */
export function ClassLabel({
  cls,
  className,
  iconOnlyTile,
}: {
  cls: CiClassRef;
  className?: string;
  iconOnlyTile?: boolean;
}) {
  const locale = useLocale();
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-md bg-primary/10 text-primary',
          iconOnlyTile ? 'size-8' : 'size-6',
        )}
      >
        <ClassIcon name={cls.icon} className={iconOnlyTile ? 'size-4' : 'size-3.5'} />
      </span>
      <span className="truncate">{localize(cls.name, locale)}</span>
    </span>
  );
}
