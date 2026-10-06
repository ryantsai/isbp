'use client';

import type { AuditLog } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { toast } from '@isbp/ui/sonner';
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

const CATEGORY = {
  data: { variant: 'secondary', icon: DatabaseIcon },
  security: { variant: 'info', icon: ShieldIcon },
  system: { variant: 'muted', icon: SettingsIcon },
} as const;

export function CategoryBadge({ category }: { category: string }) {
  const t = useTranslations('audit.category');
  const c = CATEGORY[category as keyof typeof CATEGORY];
  const Icon = c?.icon;
  return (
    <Badge variant={c?.variant ?? 'outline'} className="font-normal">
      {Icon && <Icon aria-hidden />}
      {t.has(category) ? t(category) : category}
    </Badge>
  );
}

const OUTCOME = {
  success: { variant: 'success', icon: CheckCircle2Icon },
  failure: { variant: 'destructive', icon: XCircleIcon },
  denied: { variant: 'warning', icon: BanIcon },
} as const;

/** Outcome with icon + text (never colour alone). */
export function OutcomeBadge({ outcome }: { outcome: string }) {
  const t = useTranslations('audit.outcome');
  const o = OUTCOME[outcome as keyof typeof OUTCOME];
  const Icon = o?.icon;
  return (
    <Badge variant={o?.variant ?? 'outline'}>
      {Icon && <Icon aria-hidden />}
      {t.has(outcome) ? t(outcome) : outcome}
    </Badge>
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
      {typeLabel !== name && (
        <Badge variant="outline" className="font-normal text-muted-foreground">
          {typeLabel}
        </Badge>
      )}
    </span>
  );
}

/** `entityLabel` (with the type underneath) or `entityType:entityId`. */
export function TargetCell({ log }: { log: Pick<AuditLog, 'entityType' | 'entityId' | 'entityLabel'> }) {
  if (log.entityLabel) {
    return (
      <span className="block min-w-0">
        <span className="block truncate">{log.entityLabel}</span>
        {log.entityType && (
          <span className="block truncate text-xs text-muted-foreground">{log.entityType}</span>
        )}
      </span>
    );
  }
  if (log.entityType || log.entityId) {
    return (
      <code
        className="block truncate font-mono text-xs text-muted-foreground"
        title={`${log.entityType ?? ''}:${log.entityId ?? ''}`}
      >
        {log.entityType ?? '?'}:{log.entityId ?? '?'}
      </code>
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
    <button
      type="button"
      onClick={() =>
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            toast.success(tc('copied'));
          })
          .catch(() => toast.error(t('copyFailed')))
      }
      aria-label={t('copyLabel', { label })}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
    >
      {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
    </button>
  );
}
