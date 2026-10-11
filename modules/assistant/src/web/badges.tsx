'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { StatusBadge as SharedStatusBadge, type StatusTone } from '@isbp/ui/status';
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

export type Tone = Extract<StatusTone, 'info' | 'primary' | 'warning' | 'success' | 'muted' | 'destructive'>;

/** Astryx icon colour for each tone (status is always icon + text, never colour alone). */
const ICON_COLOR = {
  info: 'accent',
  primary: 'accent',
  warning: 'warning',
  success: 'success',
  muted: 'secondary',
  destructive: 'error',
} as const satisfies Record<Tone, string>;

export interface Meta {
  icon: LucideIcon;
  tone: Tone;
}

/** Icon + text + tone, never colour alone. */
export function ToneBadge({ meta, label, className }: { meta: Meta; label: string; className?: string }) {
  return <SharedStatusBadge tone={meta.tone} icon={meta.icon} label={label} className={className} />;
}

/**
 * Compact status for dense rows: the icon carries the status colour, the text stays readable. Truncates to one line
 * unless `wrap` is set.
 */
export function ToneText({ meta, label, wrap }: { meta: Meta; label: string; wrap?: boolean }) {
  return (
    <HStack gap={1} vAlign={wrap ? 'start' : 'center'}>
      <AstryxIcon icon={meta.icon} size="xsm" color={ICON_COLOR[meta.tone]} />
      <Text type="label" color={meta.tone === 'muted' ? 'secondary' : 'primary'} maxLines={wrap ? 0 : 1}>
        {label}
      </Text>
    </HStack>
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
    <HStack gap={1.5} wrap="wrap" vAlign="center">
      <ToneBadge meta={OP[op]} label={t(`ops.${op}`)} />
      {DESTRUCTIVE_OPS.includes(op) && (
        <ToneText meta={{ icon: TriangleAlertIcon, tone: 'destructive' }} label={t('ops.destructive')} />
      )}
    </HStack>
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
    <Tooltip content={builtin ? t('builtinHint') : t('llmHint')} focusTrigger="always">
      <Badge
        variant={builtin ? 'neutral' : 'info'}
        icon={<AstryxIcon icon={builtin ? CpuIcon : SparklesIcon} size="xsm" />}
        label={builtin ? t('builtin') : model ? t('llm', { model }) : t('llmUnknown')}
        className="max-w-full min-w-0 shrink cursor-default"
        tabIndex={0}
      />
    </Tooltip>
  );
}
