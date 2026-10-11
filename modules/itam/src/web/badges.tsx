'use client';

import { HStack } from '@astryxdesign/core/Layout';
import { Icon, type IconColor } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { StatusBadge } from '@isbp/ui/status';
import {
  ArchiveIcon,
  BanIcon,
  CalendarClockIcon,
  CircleHelpIcon,
  BoxIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClockAlertIcon,
  EraserIcon,
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
  ApprovalStatus,
  AssetCategory,
  AssetStatus,
  ComplianceState,
  ContractStatus,
  InstallApproval,
  WarrantyState,
  WipeState,
} from '../contracts';
import { useDay } from './lib';

export type Tone = 'info' | 'primary' | 'warning' | 'success' | 'muted' | 'destructive';

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

/**
 * The category's icon (decorative unless `label` is set). `color` is the Astryx icon colour (`secondary` next to a
 * name); `className` is kept for callers that still size or tint it from outside.
 */
export function CategoryIcon({
  category,
  className,
  color,
  label,
}: {
  category: AssetCategory;
  className?: string;
  color?: IconColor;
  label?: boolean;
}) {
  const t = useTranslations('itam.category');
  return (
    <Icon
      icon={CATEGORY_ICON[category] ?? BoxIcon}
      size="sm"
      color={color}
      label={label ? t(category) : undefined}
      className={className}
    />
  );
}

export function CategoryLabel({ category, className }: { category: AssetCategory; className?: string }) {
  const t = useTranslations('itam.category');
  return (
    <HStack as="span" gap={1.5} vAlign="center" className={className}>
      <CategoryIcon category={category} color="secondary" />
      <Text maxLines={1}>{t(category)}</Text>
    </HStack>
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
export function AssetStatusBadge({
  status,
  className,
  animate,
}: {
  status: AssetStatus;
  className?: string;
  /** Cross-fade when the status changes in place (the asset page header). */
  animate?: boolean;
}) {
  const t = useTranslations('itam.status');
  const s = ASSET_STATUS[status] ?? ASSET_STATUS.ordered;
  return (
    <StatusBadge
      tone={s.tone}
      icon={s.icon}
      label={t(status)}
      changeKey={animate ? status : undefined}
      className={className}
    />
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
  return <StatusBadge tone={s.tone} icon={s.icon} label={t(state)} className={className} />;
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
  return <StatusBadge tone={s.tone} icon={s.icon} label={t(status)} className={className} />;
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
  if (!date) {
    return (
      <Text color="secondary" className={className}>
        —
      </Text>
    );
  }
  if (state === 'expired' || state === 'expiring') {
    return (
      <StatusBadge
        tone={state === 'expired' ? 'destructive' : 'warning'}
        icon={state === 'expired' ? ShieldOffIcon : ClockAlertIcon}
        label={`${day(date)} · ${t(state)}`}
        className={className}
      />
    );
  }
  return <Text className={className}>{day(date)}</Text>;
}

/* ───────────────────────────── approved software ───────────────────────────── */

export const APPROVAL: Record<InstallApproval, { tone: Tone; icon: LucideIcon }> = {
  allowed: { tone: 'success', icon: CircleCheckIcon },
  unapproved: { tone: 'warning', icon: CircleHelpIcon },
  blocked: { tone: 'destructive', icon: BanIcon },
};

/** An install against the approved-software list: "Approved", "Not on the approved list", "Blocked". */
export function ApprovalBadge({ approval, className }: { approval: InstallApproval; className?: string }) {
  const t = useTranslations('itam.approval');
  const s = APPROVAL[approval] ?? APPROVAL.allowed;
  return <StatusBadge tone={s.tone} icon={s.icon} label={t(approval)} className={className} />;
}

/** An entry of the list: "Allowed" or "Blocked". */
export function ApprovalStatusBadge({ status, className }: { status: ApprovalStatus; className?: string }) {
  const t = useTranslations('itam.approvalStatus');
  return (
    <StatusBadge
      tone={status === 'blocked' ? 'destructive' : 'success'}
      icon={status === 'blocked' ? BanIcon : ShieldCheckIcon}
      label={t(status)}
      className={className}
    />
  );
}

/* ───────────────────────────── data wipes ───────────────────────────── */

const WIPE: Record<Exclude<WipeState, 'none'>, { tone: Tone; icon: LucideIcon }> = {
  scheduled: { tone: 'info', icon: CalendarClockIcon },
  due: { tone: 'warning', icon: ClockAlertIcon },
  overdue: { tone: 'destructive', icon: EraserIcon },
};

/** A pending data wipe: "Wipe by 1 Dec", "Wipe due 1 Dec", "Wipe overdue since 1 Dec" (icon + text). */
export function WipeBadge({
  state,
  date,
  className,
}: {
  state: WipeState;
  date: string | null;
  className?: string;
}) {
  const t = useTranslations('itam.wipe.badge');
  const day = useDay();
  if (state === 'none' || !date) return null;
  const s = WIPE[state];
  return (
    <StatusBadge tone={s.tone} icon={s.icon} label={t(state, { date: day(date) })} className={className} />
  );
}
