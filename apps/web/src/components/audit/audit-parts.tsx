'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import type { AuditLog } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { toast } from '@isbp/ui/toast';
import {
  BanIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  CpuIcon,
  DatabaseIcon,
  PlugIcon,
  SettingsIcon,
  ShieldIcon,
  XCircleIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useAuditText } from './audit-text';

/** The kind of event is an attribute, not a status: a neutral chip, told apart by its icon and text. */
const CATEGORY = {
  data: DatabaseIcon,
  security: ShieldIcon,
  system: SettingsIcon,
} as const;

export function CategoryBadge({ category }: { category: string }) {
  const t = useTranslations('audit.category');
  const icon = CATEGORY[category as keyof typeof CATEGORY];
  return (
    <Badge
      variant="neutral"
      label={t.has(category) ? t(category) : category}
      icon={icon ? <AstryxIcon icon={icon} size="xsm" /> : undefined}
    />
  );
}

const OUTCOME = {
  success: { variant: 'success', icon: CheckCircle2Icon },
  failure: { variant: 'error', icon: XCircleIcon },
  denied: { variant: 'warning', icon: BanIcon },
} as const;

/** Outcome with icon + text (never colour alone). */
export function OutcomeBadge({ outcome }: { outcome: string }) {
  const t = useTranslations('audit.outcome');
  const o = OUTCOME[outcome as keyof typeof OUTCOME];
  return (
    <Badge
      variant={o?.variant ?? 'neutral'}
      label={t.has(outcome) ? t(outcome) : outcome}
      icon={o ? <AstryxIcon icon={o.icon} size="xsm" /> : undefined}
    />
  );
}

const ACTOR_ICON = { system: CpuIcon, service: PlugIcon, ai_agent: BotIcon } as const;

/** Person (avatar + name, linked) or a non-human actor (icon + name + type badge). */
export function ActorCell({
  log,
  className,
}: {
  log: Pick<AuditLog, 'actorType' | 'actorId' | 'actorName'>;
  className?: string;
}) {
  const t = useTranslations('audit');
  const typeLabel = t.has(`actorType.${log.actorType}`) ? t(`actorType.${log.actorType}`) : log.actorType;
  if (log.actorType === 'user') {
    const name = log.actorName ?? t('unknownActor');
    const body = (
      <>
        <UserAvatar name={name} className="size-7 text-[10px]" />
        <span className="truncate">{name}</span>
      </>
    );
    return log.actorId ? (
      <Link
        href={`/admin/users/${log.actorId}`}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'flex min-w-0 items-center gap-2 rounded-md outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className,
        )}
      >
        {body}
      </Link>
    ) : (
      <span className={cn('flex min-w-0 items-center gap-2 text-muted-foreground', className)}>{body}</span>
    );
  }
  const Icon = ACTOR_ICON[log.actorType as keyof typeof ACTOR_ICON] ?? CpuIcon;
  const name = log.actorName ?? t('systemActor');
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <span
        className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
      <span className="truncate">{name}</span>
      {typeLabel !== name && <Badge variant="neutral" label={typeLabel} />}
    </span>
  );
}

/** The target's name (its label, or the current name of the id) with what kind of thing it is underneath. */
export function TargetCell({
  log,
}: {
  log: Pick<AuditLog, 'entityType' | 'entityId' | 'entityLabel' | 'refs'>;
}) {
  const text = useAuditText();
  const name = text.targetName(log);
  const type = text.typeName(log.entityType);
  if (name) {
    return (
      <span className="block min-w-0">
        <span className="block truncate">{name}</span>
        {type && <span className="block truncate text-xs text-muted-foreground">{type}</span>}
      </span>
    );
  }
  if (log.entityType || log.entityId) {
    return (
      <span className="block min-w-0">
        {type && <span className="block truncate">{type}</span>}
        <code
          className="block truncate font-mono text-xs text-muted-foreground"
          title={`${log.entityType ?? ''}:${log.entityId ?? ''}`}
        >
          {type ? log.entityId : `${log.entityType ?? '?'}:${log.entityId ?? '?'}`}
        </code>
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

/** Icon button that copies `value`; flips to a check mark briefly. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const t = useTranslations('audit.detail');
  const tc = useTranslations('common');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const h = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(h);
  }, [copied]);
  return (
    <IconButton
      label={t('copyLabel', { label })}
      variant="ghost"
      size="sm"
      className={className}
      icon={<AstryxIcon icon={copied ? CheckIcon : CopyIcon} color={copied ? 'success' : 'inherit'} />}
      onClick={() =>
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            toast.success(tc('copied'));
          })
          .catch(() => toast.error(t('copyFailed')))
      }
    />
  );
}
