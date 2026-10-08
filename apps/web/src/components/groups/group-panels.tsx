'use client';

import type { AuditLog, RoleAssignment } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { easeOut } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { ClockIcon, HistoryIcon, ShieldCheckIcon, ShieldPlusIcon } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { AuditIcon, useActionLabel } from '@/components/audit-action';
import { RelativeTime } from '@/components/relative-time';
import { useRoleText } from '@/components/roles/role-utils';
import { useApiQuery } from '@/lib/api';

/** Role assignments granted to the group (all members inherit them). */
export function GroupRolesPanel({ groupId }: { groupId: string }) {
  const t = useTranslations('groups.roles');
  const tc = useTranslations('common');
  const roleText = useRoleText();
  const format = useFormatter();
  const canAssign = useCan('core.roles.assign');
  const { data, isLoading } = useApiQuery<Page<RoleAssignment>>('/role-assignments', {
    groupId,
    pageSize: 100,
  });
  const items = data?.items ?? [];

  const roleName = (a: RoleAssignment) => roleText(a.role).name;
  const scopeLabel = (a: RoleAssignment) => {
    if (a.scopeType === 'department')
      return t('scope', { type: tc('scope_values.department'), label: a.scope.departmentName ?? '—' });
    if (a.scopeType === 'record')
      return t('scope', {
        type: tc('scope_values.record'),
        label: `${a.scope.recordType ?? ''}/${a.scope.recordId ?? ''}`,
      });
    return tc('scope_values.global');
  };

  const grant = canAssign && (
    <Button variant="outline" size="sm" asChild>
      <Link href={`/admin/roles?assign=1&groupId=${groupId}`}>
        <ShieldPlusIcon /> {t('grant')}
      </Link>
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        {items.length > 0 && grant && <CardAction>{grant}</CardAction>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ShieldCheckIcon />}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={grant}
            className="py-10"
          />
        ) : (
          <ul className="space-y-2.5">
            {items.map((a, i) => (
              <motion.li
                key={a.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: easeOut, delay: Math.min(i, 8) * 0.04 }}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-3"
              >
                <span
                  className="hidden size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary sm:grid"
                  aria-hidden
                >
                  <ShieldCheckIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{roleName(a)}</span>
                    <code className="font-mono text-xs text-muted-foreground">{a.role.key}</code>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {a.grantedBy
                      ? t('grantedBy', { name: a.grantedBy.displayName })
                      : t('grantedAutomatically')}{' '}
                    · <RelativeTime date={a.grantedAt} />
                    {a.reason && <> · {t('reason', { reason: a.reason })}</>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:justify-end">
                  <Badge variant={a.scopeType === 'global' ? 'secondary' : 'info'}>{scopeLabel(a)}</Badge>
                  {a.expiresAt && (
                    <Badge variant="warning">
                      <ClockIcon aria-hidden />
                      {t('expires', {
                        date: format.dateTime(new Date(a.expiresAt), { dateStyle: 'medium' }),
                      })}
                    </Badge>
                  )}
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Audit trail for the group: edits and membership changes. */
export function GroupActivityPanel({ groupId }: { groupId: string }) {
  const t = useTranslations('groups.activity');
  const actionLabel = useActionLabel();
  const { data, isLoading } = useApiQuery<Page<AuditLog>>('/audit-logs', {
    entityType: 'group',
    entityId: groupId,
    pageSize: 20,
  });
  const items = data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : items.length === 0 ? (
          <EmptyState icon={<HistoryIcon />} title={t('empty')} className="py-10" />
        ) : (
          <ol className="space-y-3">
            {items.map((log) => {
              const userIds = (log.metadata as { userIds?: unknown } | null)?.userIds;
              const people = Array.isArray(userIds) ? userIds.length : 0;
              const changed = log.changes ? Object.keys(log.changes) : [];
              return (
                <li key={log.seq} className="flex items-start gap-3 text-sm">
                  <AuditIcon log={log} />
                  <div className="min-w-0 flex-1 pt-1">
                    <span className="font-medium">{log.actorName ?? '—'}</span>{' '}
                    <span className="text-muted-foreground">{actionLabel(log.action)}</span>
                    {people > 0 && (
                      <span className="text-muted-foreground"> · {t('people', { count: people })}</span>
                    )}
                    {changed.length > 0 && (
                      <div className="mt-0.5 text-xs text-muted-foreground">{changed.join(', ')}</div>
                    )}
                  </div>
                  <RelativeTime
                    date={log.occurredAt}
                    className="shrink-0 pt-1 text-xs text-muted-foreground"
                  />
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
