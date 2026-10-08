'use client';

import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Hint } from '@isbp/ui/tooltip';
import {
  ArchiveIcon,
  BanIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  CpuIcon,
  FilePenLineIcon,
  HourglassIcon,
  type LucideIcon,
  PencilIcon,
  PlusIcon,
  ShieldAlertIcon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ChangeSetStatus, DESTRUCTIVE_OPS, type ItemOp } from '../contracts';
import type { CheckState } from './lib';

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

export const TEXT_TONE: Record<Tone, string> = {
  info: 'text-info',
  primary: 'text-primary',
  warning: 'text-warning-foreground',
  success: 'text-success',
  muted: 'text-muted-foreground',
  destructive: 'text-destructive',
};

export interface Meta {
  icon: LucideIcon;
  tone: Tone;
}

/** Icon + text + tone, never colour alone. */
export function ToneBadge({ meta, label, className }: { meta: Meta; label: string; className?: string }) {
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn(TONE[meta.tone], className)}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

/** Compact status for dense rows: icon and text in the status colour. */
export function ToneText({ meta, label, className }: { meta: Meta; label: string; className?: string }) {
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1 text-xs font-medium',
        TEXT_TONE[meta.tone],
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

export const STATUS: Record<ChangeSetStatus, Meta> = {
  draft: { icon: FilePenLineIcon, tone: 'muted' },
  in_review: { icon: HourglassIcon, tone: 'info' },
  applied: { icon: CircleCheckIcon, tone: 'success' },
  rolled_back: { icon: Undo2Icon, tone: 'warning' },
  discarded: { icon: BanIcon, tone: 'muted' },
};

export function StatusBadge({ status, className }: { status: ChangeSetStatus; className?: string }) {
  const t = useTranslations('assistant.status');
  return <ToneBadge meta={STATUS[status]} label={t(status)} className={className} />;
}

export const OP: Record<ItemOp, Meta> = {
  create: { icon: PlusIcon, tone: 'info' },
  update: { icon: PencilIcon, tone: 'primary' },
  archive: { icon: ArchiveIcon, tone: 'warning' },
  delete: { icon: Trash2Icon, tone: 'destructive' },
};

/** Create / Update / Archive / Delete; archives and deletes also say they are destructive (icon + text). */
export function OpBadge({ op }: { op: ItemOp }) {
  const t = useTranslations('assistant');
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <ToneBadge meta={OP[op]} label={t(`ops.${op}`)} />
      {DESTRUCTIVE_OPS.includes(op) && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
          <TriangleAlertIcon className="size-3.5" aria-hidden />
          {t('ops.destructive')}
        </span>
      )}
    </span>
  );
}

export const CHECK: Record<CheckState, Meta> = {
  unchecked: { icon: CircleDashedIcon, tone: 'muted' },
  ok: { icon: CircleCheckIcon, tone: 'success' },
  needsApprover: { icon: ShieldAlertIcon, tone: 'info' },
  failing: { icon: CircleXIcon, tone: 'destructive' },
};

/** Honest label of how the assistant works right now: the model's name, or guided templates. */
export function ModeBadge({ mode, model }: { mode: 'llm' | 'builtin'; model: string | null }) {
  const t = useTranslations('assistant.mode');
  const builtin = mode === 'builtin';
  return (
    <Hint label={builtin ? t('builtinHint') : t('llmHint')}>
      <Badge
        variant="outline"
        className={cn('max-w-full min-w-0 shrink cursor-default gap-1', builtin ? TONE.muted : TONE.info)}
        tabIndex={0}
      >
        {builtin ? <CpuIcon aria-hidden /> : <SparklesIcon aria-hidden />}
        <span className="truncate">
          {builtin ? t('builtin') : model ? t('llm', { model }) : t('llmUnknown')}
        </span>
      </Badge>
    </Hint>
  );
}
