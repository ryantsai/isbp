'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import {
  ArchiveIcon,
  BanIcon,
  BoxIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClockAlertIcon,
  FilePenLineIcon,
  HardDriveIcon,
  KeyboardIcon,
  LaptopIcon,
  type LucideIcon,
  MapPinOffIcon,
  MonitorIcon,
  NetworkIcon,
  PcCaseIcon,
  PrinterIcon,
  RecycleIcon,
  ServerIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  ShieldXIcon,
  SmartphoneIcon,
  TabletIcon,
  TrendingDownIcon,
  TruckIcon,
  WarehouseIcon,
  WrenchIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type {
  AssetCategory,
  AssetStatus,
  ComplianceState,
  ContractStatus,
  WarrantyState,
} from '../contracts';
import { useDay } from './lib';

export type Tone = 'info' | 'primary' | 'warning' | 'success' | 'muted' | 'destructive';

export const TONE: Record<Tone, string> = {
  info: 'border-transparent bg-info/12 text-info',
  primary: 'border-transparent bg-primary/10 text-primary',
  warning: 'border-transparent bg-warning/15 text-warning-foreground',
  success: 'border-transparent bg-success/12 text-success',
  muted: 'border-transparent bg-muted text-muted-foreground',
  destructive: 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20',
};

/* ───────────────────────────── categories ───────────────────────────── */

export const CATEGORY_ICON: Record<AssetCategory, LucideIcon> = {
  laptop: LaptopIcon,
  desktop: PcCaseIcon,
  monitor: MonitorIcon,
  phone: SmartphoneIcon,
  tablet: TabletIcon,
  server: ServerIcon,
  network: NetworkIcon,
  storage: HardDriveIcon,
  printer: PrinterIcon,
  peripheral: KeyboardIcon,
  other: BoxIcon,
};

/** The category's icon (decorative unless `label` is set). */
export function CategoryIcon({
  category,
  className,
  label,
}: {
  category: AssetCategory;
  className?: string;
  label?: boolean;
}) {
  const t = useTranslations('itam.category');
  const Icon = CATEGORY_ICON[category] ?? BoxIcon;
  return label ? (
    <Icon className={cn('size-4 shrink-0', className)} role="img" aria-label={t(category)} />
  ) : (
    <Icon className={cn('size-4 shrink-0', className)} aria-hidden />
  );
}

export function CategoryLabel({ category, className }: { category: AssetCategory; className?: string }) {
  const t = useTranslations('itam.category');
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <CategoryIcon category={category} className="text-muted-foreground" />
      <span className="truncate">{t(category)}</span>
    </span>
  );
}

/* ───────────────────────────── asset status ───────────────────────────── */

export const ASSET_STATUS: Record<AssetStatus, { tone: Tone; icon: LucideIcon }> = {
  ordered: { tone: 'muted', icon: TruckIcon },
  in_stock: { tone: 'info', icon: WarehouseIcon },
  deployed: { tone: 'success', icon: CircleCheckIcon },
  in_repair: { tone: 'warning', icon: WrenchIcon },
  retired: { tone: 'muted', icon: ArchiveIcon },
  disposed: { tone: 'muted', icon: RecycleIcon },
  lost: { tone: 'destructive', icon: MapPinOffIcon },
};

/** Lifecycle status: icon + text + tone (never colour alone). */
export function AssetStatusBadge({ status, className }: { status: AssetStatus; className?: string }) {
  const t = useTranslations('itam.status');
  const s = ASSET_STATUS[status] ?? ASSET_STATUS.ordered;
  const Icon = s.icon;
  return (
    <Badge variant="outline" className={cn(TONE[s.tone], className)}>
      <Icon aria-hidden />
      {t(status)}
    </Badge>
  );
}

/* ───────────────────────────── compliance ───────────────────────────── */

export const COMPLIANCE: Record<ComplianceState, { tone: Tone; icon: LucideIcon }> = {
  compliant: { tone: 'success', icon: ShieldCheckIcon },
  over_deployed: { tone: 'destructive', icon: ShieldAlertIcon },
  under_used: { tone: 'info', icon: TrendingDownIcon },
  expiring: { tone: 'warning', icon: ClockAlertIcon },
  expired: { tone: 'destructive', icon: ShieldXIcon },
};

export function ComplianceBadge({ state, className }: { state: ComplianceState; className?: string }) {
  const t = useTranslations('itam.compliance');
  const s = COMPLIANCE[state] ?? COMPLIANCE.compliant;
  const Icon = s.icon;
  return (
    <Badge variant="outline" className={cn(TONE[s.tone], className)}>
      <Icon aria-hidden />
      {t(state)}
    </Badge>
  );
}

/* ───────────────────────────── contracts ───────────────────────────── */

export const CONTRACT_STATUS: Record<ContractStatus, { tone: Tone; icon: LucideIcon }> = {
  draft: { tone: 'muted', icon: FilePenLineIcon },
  active: { tone: 'success', icon: CircleCheckIcon },
  expiring: { tone: 'warning', icon: ClockAlertIcon },
  expired: { tone: 'destructive', icon: CircleXIcon },
  cancelled: { tone: 'muted', icon: BanIcon },
};

export function ContractStatusBadge({ status, className }: { status: ContractStatus; className?: string }) {
  const t = useTranslations('itam.contractStatus');
  const s = CONTRACT_STATUS[status] ?? CONTRACT_STATUS.active;
  const Icon = s.icon;
  return (
    <Badge variant="outline" className={cn(TONE[s.tone], className)}>
      <Icon aria-hidden />
      {t(status)}
    </Badge>
  );
}

/* ───────────────────────────── warranty ───────────────────────────── */

/** Warranty end date; expiring and expired ones are flagged with an icon and text. */
export function WarrantyEnd({
  date,
  state,
  className,
}: {
  date: string | null;
  state: WarrantyState;
  className?: string;
}) {
  const t = useTranslations('itam.warranty');
  const day = useDay();
  if (!date) return <span className={cn('text-muted-foreground', className)}>—</span>;
  if (state === 'expired' || state === 'expiring') {
    const Icon = state === 'expired' ? ShieldOffIcon : ClockAlertIcon;
    return (
      <span
        className={cn(
          'inline-flex min-w-0 items-center gap-1.5 font-medium',
          state === 'expired' ? 'text-destructive' : 'text-warning-foreground',
          className,
        )}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          {day(date)} <span className="font-normal">· {t(state)}</span>
        </span>
      </span>
    );
  }
  return <span className={className}>{day(date)}</span>;
}
