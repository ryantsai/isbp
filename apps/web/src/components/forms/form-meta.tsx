'use client';

import type { SubmissionStatus } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
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
import { NavIcon } from '@/components/nav-icon';

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

export function FormIcon({ name, className }: { name: string; className?: string }) {
  const Icon = FORM_ICONS[name];
  if (Icon) return <Icon className={className} aria-hidden />;
  return <NavIcon name={name} className={className} />;
}

/** The form's icon on a tinted tile. */
export function FormIconTile({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary',
        className,
      )}
    >
      <FormIcon name={name} className="size-[45%] min-h-4 min-w-4" />
    </span>
  );
}

interface StatusInput {
  publishedVersion: number | null;
  hasUnpublishedChanges: boolean;
  active: boolean;
  archived: boolean;
}

/** Lifecycle badges of a form: icon + text, never colour alone. */
export function FormStatusBadges({ form, className }: { form: StatusInput; className?: string }) {
  const t = useTranslations('forms.status');
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      {form.archived ? (
        <Badge variant="muted">
          <ArchiveIcon aria-hidden /> {t('archived')}
        </Badge>
      ) : form.publishedVersion === null ? (
        <Badge variant="secondary">
          <PencilLineIcon aria-hidden /> {t('draft')}
        </Badge>
      ) : (
        <Badge variant="success">
          <CircleCheckIcon aria-hidden /> {t('published', { version: form.publishedVersion })}
        </Badge>
      )}
      {!form.archived && form.publishedVersion !== null && form.hasUnpublishedChanges && (
        <Badge variant="warning">
          <CircleDotIcon aria-hidden /> {t('unpublishedChanges')}
        </Badge>
      )}
      {!form.archived && !form.active && (
        <Badge variant="outline" className="text-muted-foreground">
          <CirclePauseIcon aria-hidden /> {t('paused')}
        </Badge>
      )}
    </span>
  );
}

const SUBMISSION: Record<
  SubmissionStatus,
  { variant: 'info' | 'warning' | 'success' | 'destructive' | 'muted'; icon: LucideIcon }
> = {
  submitted: { variant: 'info', icon: SendIcon },
  pending: { variant: 'warning', icon: ClockIcon },
  approved: { variant: 'success', icon: CheckIcon },
  rejected: { variant: 'destructive', icon: CircleXIcon },
  cancelled: { variant: 'muted', icon: CircleDashedIcon },
};

export const SUBMISSION_STATUSES = Object.keys(SUBMISSION) as SubmissionStatus[];

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const t = useTranslations('forms.submissionStatus');
  const s = SUBMISSION[status] ?? SUBMISSION.submitted;
  const Icon = s.icon;
  return (
    <Badge variant={s.variant}>
      <Icon aria-hidden /> {t(status)}
    </Badge>
  );
}
