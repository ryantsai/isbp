'use client';

import type { RoleAssignment } from '@isbp/contracts';
import { UserAvatar } from '@isbp/ui/avatar';
import { toast } from '@isbp/ui/toast';
import { ClockAlertIcon, ClockIcon, FileKeyIcon, GlobeIcon, NetworkIcon } from 'lucide-react';
import Link from 'next/link';
import { useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RelativeTime } from '@/components/relative-time';
import { useApiMutation } from '@/lib/api';
import { GroupGlyph } from './group-picker';
import { useAccessErrorText, useRoleText } from './role-utils';
import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { Tooltip } from '@astryxdesign/core/Tooltip';

const DAY = 86_400_000;

/** Global / Department: name / Record: type:id — icon + text, never colour alone. */
export function ScopeBadge({ assignment }: { assignment: Pick<RoleAssignment, 'scopeType' | 'scope'> }) {
  const t = useTranslations('roles.scope');
  const { scopeType, scope } = assignment;
  if (scopeType === 'department') {
    return (
      <Badge
        variant="info"
        label={t('department', { name: scope.departmentName ?? '?' })}
        icon={<Icon icon={NetworkIcon} size="xsm" />}
      />
    );
  }
  if (scopeType === 'record') {
    const full = `${scope.recordType ?? '?'}:${scope.recordId ?? '?'}`;
    const short = `${scope.recordType ?? '?'}:${(scope.recordId ?? '?').slice(0, 8)}${(scope.recordId?.length ?? 0) > 8 ? '…' : ''}`;
    return (
      <Tooltip content={full}>
        <Badge
          variant="neutral"
          label={
            <>
              {t('record', { record: short })}
              <span className="sr-only">{full}</span>
            </>
          }
          icon={<Icon icon={FileKeyIcon} size="xsm" />}
        />
      </Tooltip>
    );
  }
  return <Badge variant="neutral" label={t('global')} icon={<Icon icon={GlobeIcon} size="xsm" />} />;
}

/** Relative expiry with an "Expired" or "Expires soon" (≤ 7 days) badge. */
export function ExpiryCell({ expiresAt, expired }: { expiresAt: string | null; expired: boolean }) {
  const t = useTranslations('roles.expiry');
  const now = useNow({ updateInterval: 60_000 });
  if (!expiresAt) return <span className="text-muted-foreground">{t('never')}</span>;
  const soon = !expired && new Date(expiresAt).getTime() - now.getTime() <= 7 * DAY;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {expired ? (
        <Badge variant="neutral" label={t('expired')} icon={<Icon icon={ClockIcon} size="xsm" />} />
      ) : soon ? (
        <Badge variant="warning" label={t('soon')} icon={<Icon icon={ClockAlertIcon} size="xsm" />} />
      ) : null}
      <RelativeTime
        date={expiresAt}
        className={expired ? 'text-muted-foreground line-through decoration-muted-foreground/50' : undefined}
      />
    </span>
  );
}

/** Person (avatar) or group (icon) with a secondary line; links to their admin page. */
export function PrincipalCell({
  principal,
  compact,
}: {
  principal: RoleAssignment['principal'];
  compact?: boolean;
}) {
  const t = useTranslations('roles.principal');
  const href = principal.type === 'user' ? `/admin/users/${principal.id}` : `/admin/groups/${principal.id}`;
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="group/p flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {principal.type === 'user' ? (
        <UserAvatar name={principal.name} className={compact ? 'size-7 text-[10px]' : undefined} />
      ) : (
        <GroupGlyph className={compact ? 'size-7' : undefined} />
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium group-hover/p:underline">
          {principal.name}
          <span className="sr-only"> ({principal.type === 'user' ? t('user') : t('group')})</span>
        </span>
        {principal.detail && (
          <span
            className={`block truncate text-xs text-muted-foreground ${principal.type === 'group' ? 'font-mono' : ''}`}
          >
            {principal.type === 'group' && <span className="font-sans">{t('group')} · </span>}
            {principal.detail}
          </span>
        )}
      </span>
    </Link>
  );
}

export const ACCESS_INVALIDATE = [
  '/role-assignments',
  '/roles',
  '/users',
  '/groups',
  '/me',
  '/platform/dashboard',
  '/audit-logs',
];

/** Confirm + `DELETE /role-assignments/:id`. */
export function RevokeAssignmentDialog({
  assignment,
  onOpenChange,
}: {
  assignment: RoleAssignment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('roles.revoke');
  const roleText = useRoleText();
  const accessError = useAccessErrorText();
  // Keep the last assignment so the copy doesn't blank out during the close animation.
  const [last, setLast] = useState(assignment);
  if (assignment && assignment !== last) setLast(assignment);
  const shown = assignment ?? last;
  const role = shown ? roleText(shown.role).name : '';
  const name = shown?.principal.name ?? '';
  const m = useApiMutation((api, id: string) => api.delete(`/role-assignments/${id}`), {
    invalidate: ACCESS_INVALIDATE,
    success: t('done', { role, name }),
    onSuccess: () => onOpenChange(false),
    silent: true,
  });
  return (
    <ConfirmDialog
      open={assignment !== null}
      onOpenChange={onOpenChange}
      title={t('title', { role, name })}
      description={
        shown?.principal.type === 'group' ? t('bodyGroup', { role, name }) : t('body', { role, name })
      }
      confirmLabel={t('confirm')}
      destructive
      loading={m.isPending}
      onConfirm={() =>
        assignment && m.mutate(assignment.id, { onError: (err) => toast.error(accessError(err)) })
      }
    >
      {shown && shown.scopeType !== 'global' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {t('scope')} <ScopeBadge assignment={shown} />
        </div>
      )}
    </ConfirmDialog>
  );
}
