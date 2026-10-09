'use client';

import { localize } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { defineStatusMap, MappedStatus } from '@isbp/ui/status';
import {
  ArchiveIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronsUpIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  EqualIcon,
  type LucideIcon,
  WrenchIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { CiClassRef, CiCriticality, CiEnvironment, CiStatus } from '../contracts';
import { ClassIcon } from './class-icon';

/** Lifecycle status, mapped once: tone + icon + label. "In use" is what most CIs are, so lists show it quietly. */
export const CI_STATUS = defineStatusMap<CiStatus>({
  planned: { tone: 'info', icon: CalendarClockIcon, labelKey: 'planned' },
  in_use: { tone: 'success', icon: CircleCheckIcon, labelKey: 'in_use', quiet: true },
  maintenance: { tone: 'warning', icon: WrenchIcon, labelKey: 'maintenance' },
  retired: { tone: 'muted', icon: ArchiveIcon, labelKey: 'retired' },
});

/**
 * Lifecycle status: icon + text, never colour alone. By default "In use" (what most CIs are) renders as muted text
 * and the exceptions as chips; headers pass `quiet={false}` for a chip, `animate` to cross-fade a change in place.
 */
export function CiStatusBadge({
  status,
  quiet,
  animate,
  className,
}: {
  status: CiStatus;
  quiet?: boolean;
  animate?: boolean;
  className?: string;
}) {
  const t = useTranslations('cmdb.status');
  return (
    <MappedStatus
      map={CI_STATUS}
      value={status}
      t={(k) => t(k as CiStatus)}
      quiet={quiet}
      animate={animate}
      className={className}
    />
  );
}

const CRITICALITY_ICON: Record<CiCriticality, LucideIcon> = {
  critical: ChevronsUpIcon,
  high: ChevronUpIcon,
  medium: EqualIcon,
  low: ChevronDownIcon,
};

/**
 * Criticality is an attribute, not a status: icon + text in the normal text colour (status colours stay reserved
 * for status). `chip` draws a neutral outline, for headers.
 */
export function CriticalityBadge({
  criticality,
  chip,
  className,
}: {
  criticality: CiCriticality;
  chip?: boolean;
  className?: string;
}) {
  const t = useTranslations('cmdb.criticality');
  const Icon = CRITICALITY_ICON[criticality];
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 text-sm whitespace-nowrap',
        chip && 'rounded-md border px-2 py-0.5 text-xs font-medium',
        criticality === 'critical' && 'font-medium',
        className,
      )}
    >
      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      {t(criticality)}
    </span>
  );
}

/** Environment as plain text ("—" when not set). `chip` draws a neutral outline, for headers. */
export function EnvironmentBadge({
  environment,
  chip,
}: {
  environment: CiEnvironment | null;
  chip?: boolean;
}) {
  const t = useTranslations('cmdb');
  if (!environment) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'whitespace-nowrap',
        chip ? 'inline-flex rounded-md border px-2 py-0.5 text-xs font-medium' : 'text-sm',
      )}
    >
      {t(`environment.${environment}`)}
    </span>
  );
}

/** The class's localized name, as text. */
export function ClassName({ cls }: { cls: CiClassRef }) {
  const locale = useLocale();
  return <span className="truncate">{localize(cls.name, locale)}</span>;
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
