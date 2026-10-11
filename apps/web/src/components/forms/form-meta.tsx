'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import type { SubmissionStatus } from '@isbp/contracts';
import { IconTile } from '@isbp/ui/icon-tile';
import { defineStatusMap, MappedStatus, StatusBadge } from '@isbp/ui/status';
import {
  AppWindowIcon,
  ArchiveIcon,
  BriefcaseIcon,
  BuildingIcon,
  CalendarClockIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CirclePauseIcon,
  CircleXIcon,
  ClockIcon,
  CreditCardIcon,
  FileTextIcon,
  GraduationCapIcon,
  HeadphonesIcon,
  InboxIcon,
  KeyRoundIcon,
  LaptopIcon,
  type LucideIcon,
  MegaphoneIcon,
  MonitorIcon,
  PackageIcon,
  PencilLineIcon,
  PlaneIcon,
  ReceiptIcon,
  SendIcon,
  ShieldAlertIcon,
  SmartphoneIcon,
  UsersIcon,
  WrenchIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { navIcon } from '@/components/nav-icon';

/** Curated icons admins can pick for a form (lucide names, as stored on the form). */
export const FORM_ICONS: Record<string, LucideIcon> = {
  'file-text': FileTextIcon,
  laptop: LaptopIcon,
  monitor: MonitorIcon,
  smartphone: SmartphoneIcon,
  headphones: HeadphonesIcon,
  'app-window': AppWindowIcon,
  'key-round': KeyRoundIcon,
  'shield-alert': ShieldAlertIcon,
  wrench: WrenchIcon,
  package: PackageIcon,
  briefcase: BriefcaseIcon,
  users: UsersIcon,
  building: BuildingIcon,
  plane: PlaneIcon,
  'credit-card': CreditCardIcon,
  receipt: ReceiptIcon,
  'calendar-clock': CalendarClockIcon,
  'graduation-cap': GraduationCapIcon,
  megaphone: MegaphoneIcon,
  inbox: InboxIcon,
};

/** The icon component of a stored form icon: the curated set first, then any lucide name (process packs). */
export const formIconOf = (name: string) => FORM_ICONS[name] ?? navIcon(name);

export function FormIcon({ name }: { name: string }) {
  return <Icon icon={formIconOf(name)} />;
}

/** The form's icon on a tinted tile. */
export function FormIconTile({
  name,
  size = 'sm',
  muted,
}: {
  name: string;
  size?: 'xs' | 'sm' | 'default' | 'lg';
  /** A quiet tile for forms that are out of use (archived). */
  muted?: boolean;
}) {
  return (
    <IconTile aria-hidden size={size} variant={muted ? 'outline' : 'soft'}>
      <FormIcon name={name} />
    </IconTile>
  );
}

interface StatusInput {
  publishedVersion: number | null;
  hasUnpublishedChanges: boolean;
  active: boolean;
  archived: boolean;
}

/** Lifecycle badges of a form: icon + text, never colour alone. */
export function FormStatusBadges({ form }: { form: StatusInput }) {
  const t = useTranslations('forms.status');
  return (
    <HStack gap={1.5} wrap="wrap" vAlign="center">
      {form.archived ? (
        <StatusBadge tone="muted" icon={ArchiveIcon} label={t('archived')} />
      ) : form.publishedVersion === null ? (
        <StatusBadge tone="muted" icon={PencilLineIcon} label={t('draft')} />
      ) : (
        <StatusBadge
          tone="success"
          icon={CircleCheckIcon}
          label={t('published', { version: form.publishedVersion })}
        />
      )}
      {!form.archived && form.publishedVersion !== null && form.hasUnpublishedChanges && (
        <StatusBadge tone="warning" icon={CircleDotIcon} label={t('unpublishedChanges')} />
      )}
      {!form.archived && !form.active && (
        <StatusBadge tone="muted" icon={CirclePauseIcon} label={t('paused')} />
      )}
    </HStack>
  );
}

const SUBMISSION = defineStatusMap<SubmissionStatus>({
  submitted: { tone: 'info', icon: SendIcon, labelKey: 'submitted' },
  pending: { tone: 'warning', icon: ClockIcon, labelKey: 'pending' },
  approved: { tone: 'success', icon: CheckIcon, labelKey: 'approved' },
  rejected: { tone: 'destructive', icon: CircleXIcon, labelKey: 'rejected' },
  cancelled: { tone: 'muted', icon: CircleDashedIcon, labelKey: 'cancelled' },
});

export const SUBMISSION_STATUSES = Object.keys(SUBMISSION) as SubmissionStatus[];

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const t = useTranslations('forms.submissionStatus');
  return <MappedStatus map={SUBMISSION} value={status} t={(key) => t(key as SubmissionStatus)} />;
}
