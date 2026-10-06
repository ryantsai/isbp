'use client';

import type { AuditLog } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import {
  ActivityIcon,
  BlocksIcon,
  KeyRoundIcon,
  LogInIcon,
  LogOutIcon,
  NetworkIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UserMinusIcon,
  UserPenIcon,
  UserPlusIcon,
  UsersRoundIcon,
  UserXIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Human label for an audit action, raw key as fallback:
 *   core actions → `audit.actions.core_user_created`;
 *   module actions → the module's own catalog, `<moduleId>.audit.<rest_of_action>`
 *   (e.g. `announcements.post.published` → `announcements.audit.post_published`).
 */
export function useActionLabel() {
  const t = useTranslations('audit.actions');
  const root = useTranslations();
  return (action: string) => {
    const key = action.replaceAll('.', '_');
    if (t.has(key)) return t(key);
    const [moduleId, ...rest] = action.split('.');
    const moduleKey = `${moduleId}.audit.${rest.join('_')}`;
    return root.has(moduleKey) ? root(moduleKey) : action;
  };
}

/** Icon element for an audit action (returned as an element, so no component is chosen at render time). */
function iconFor(log: Pick<AuditLog, 'action' | 'outcome'>, className: string) {
  const a = log.action;
  if (log.outcome === 'denied' || log.outcome === 'failure') return <ShieldAlertIcon className={className} />;
  if (a.endsWith('auth.login')) return <LogInIcon className={className} />;
  if (a.endsWith('auth.logout')) return <LogOutIcon className={className} />;
  if (a.includes('offboarded') || a.includes('suspended')) return <UserXIcon className={className} />;
  if (a.includes('onboarded') || a.includes('reactivated')) return <UserCheckIcon className={className} />;
  if (a.endsWith('user.created')) return <UserPlusIcon className={className} />;
  if (a.includes('.user.')) return <UserPenIcon className={className} />;
  if (a.includes('members_removed')) return <UserMinusIcon className={className} />;
  if (a.includes('.group.')) return <UsersRoundIcon className={className} />;
  if (a.includes('.department.')) return <NetworkIcon className={className} />;
  if (a.includes('role')) return <ShieldCheckIcon className={className} />;
  if (a.includes('.module.')) return <BlocksIcon className={className} />;
  if (a.includes('idp') || a.includes('directory')) return <KeyRoundIcon className={className} />;
  return <ActivityIcon className={className} />;
}

export function AuditIcon({
  log,
  className,
}: {
  log: Pick<AuditLog, 'action' | 'outcome' | 'category'>;
  className?: string;
}) {
  const tone =
    log.outcome !== 'success'
      ? 'bg-destructive/10 text-destructive'
      : log.category === 'security'
        ? 'bg-info/10 text-info'
        : 'bg-primary/10 text-primary';
  return (
    <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', tone, className)}>
      {iconFor(log, 'size-4')}
    </span>
  );
}
