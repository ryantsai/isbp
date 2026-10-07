'use client';

import type { AuditLog, EffectivePermissions, UserDetail, UserOverviewSlotProps } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { Slot, useCan, usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Checkbox } from '@isbp/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { FadeIn } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Textarea } from '@isbp/ui/textarea';
import {
  ArrowLeftIcon,
  BanIcon,
  KeyRoundIcon,
  LockIcon,
  LogOutIcon,
  MailIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PhoneIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UserXIcon,
  UsersRoundIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { AuditIcon, useActionLabel } from '@/components/audit-action';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CustomFieldsCard } from '@/components/fields/entity-fields';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { DateTime, RelativeTime } from '@/components/relative-time';
import { SourceBadge, UserStatusBadge } from '@/components/status-badge';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { UserFormSheet } from './user-form';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">{children ?? '—'}</dd>
    </div>
  );
}

type Dialog = 'edit' | 'suspend' | 'offboard' | 'revoke' | 'password' | null;

export function UserDetailView({ id }: { id: string }) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const { user: me } = usePlatform();
  const { data: user, isLoading, error } = useApiQuery<UserDetail>(`/users/${id}`);
  const canUpdate = useCan('core.users.update');
  const canLifecycle = useCan('core.users.lifecycle');
  const canCredentials = useCan('core.users.credentials');
  const canRoles = useCan('core.roles.read');
  const canAudit = useCan('core.audit.read');
  const [dialog, setDialog] = useState<Dialog>(null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (error || !user) return <EmptyState icon={<UserXIcon />} title={tc('noResults')} />;

  const self = me.id === user.id;
  const name = user.displayName;
  const lifecycleActions = canLifecycle && !self;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/admin/users">
          <ArrowLeftIcon /> {t('title')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <UserAvatar name={name} src={user.avatarUrl} className="size-16 text-lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
            <UserStatusBadge status={user.status} />
            <SourceBadge source={user.authSource} />
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {[user.jobTitle, user.department?.name].filter(Boolean).join(' · ') || user.email}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {lifecycleActions && user.status === 'pending' && <OnboardButton user={user} />}
          {canUpdate && (
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilIcon /> {t('actions.edit')}
            </Button>
          )}
          {(lifecycleActions || canCredentials) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t('actions.more')}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canCredentials && user.authSource === 'local' && (
                  <DropdownMenuItem onSelect={() => setDialog('password')}>
                    <KeyRoundIcon /> {t('actions.resetPassword')}
                  </DropdownMenuItem>
                )}
                {lifecycleActions && (
                  <>
                    <DropdownMenuItem
                      onSelect={() => setDialog('revoke')}
                      disabled={user.activeSessions === 0}
                    >
                      <LogOutIcon /> {t('actions.revokeSessions')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {user.status === 'offboarded' && <OnboardMenuItem user={user} />}
                    {user.status === 'suspended' && <ReactivateMenuItem user={user} />}
                    {user.status === 'active' && (
                      <DropdownMenuItem onSelect={() => setDialog('suspend')}>
                        <BanIcon /> {t('actions.suspend')}
                      </DropdownMenuItem>
                    )}
                    {user.status !== 'offboarded' && (
                      <DropdownMenuItem variant="destructive" onSelect={() => setDialog('offboard')}>
                        <UserXIcon /> {t('actions.offboard')}
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </FadeIn>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
          {(canRoles || self) && <TabsTrigger value="access">{t('detail.tabs.access')}</TabsTrigger>}
          <TabsTrigger value="groups">
            {t('detail.tabs.groups')}
            <Badge variant="muted" className="px-1.5">
              {user.groups.length}
            </Badge>
          </TabsTrigger>
          {canAudit && <TabsTrigger value="activity">{t('detail.tabs.activity')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="grid items-start gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.profile')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Field label={tc('email')}>
                    <a
                      href={`mailto:${user.email}`}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <MailIcon className="size-3.5 text-muted-foreground" />
                      {user.email}
                    </a>
                  </Field>
                  <Field label={t('form.username')}>
                    <code className="font-mono text-xs">{user.username}</code>
                  </Field>
                  <Field label={t('form.givenName')}>{user.givenName}</Field>
                  <Field label={t('form.familyName')}>{user.familyName}</Field>
                  <Field label={t('form.phone')}>
                    {user.phone && (
                      <span className="inline-flex items-center gap-1.5">
                        <PhoneIcon className="size-3.5 text-muted-foreground" />
                        {user.phone}
                      </span>
                    )}
                  </Field>
                  <Field label={t('form.locale')}>{user.locale}</Field>
                  <Field label={t('form.timezone')}>{user.timezone}</Field>
                </dl>
              </CardContent>
            </Card>
            <CustomFieldsCard entityType="core.user" attributes={user.attributes} />
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.organisation')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Field label={tc('department')}>{user.department?.name}</Field>
                  <Field label={tc('manager')}>
                    {user.manager && (
                      <Link
                        href={`/admin/users/${user.manager.id}`}
                        className="inline-flex items-center gap-2 hover:underline"
                      >
                        <UserAvatar name={user.manager.displayName} className="size-5 text-[9px]" />
                        {user.manager.displayName}
                      </Link>
                    )}
                  </Field>
                  <Field label={t('form.jobTitle')}>{user.jobTitle}</Field>
                  <Field label={t('form.employeeId')}>{user.employeeId}</Field>
                  <Field label={t('detail.directReports')}>{user.directReports}</Field>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.account')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Field label={t('detail.lastLogin')}>
                    <RelativeTime date={user.lastLoginAt} />
                  </Field>
                  <Field label={t('detail.activeSessions')}>{user.activeSessions}</Field>
                  <Field label={t('detail.created')}>
                    <DateTime date={user.createdAt} />
                  </Field>
                  <Field label={t('detail.onboarded')}>
                    <DateTime date={user.onboardedAt} />
                  </Field>
                  {user.offboardedAt && (
                    <Field label={t('detail.offboarded')}>
                      <DateTime date={user.offboardedAt} />
                    </Field>
                  )}
                </dl>
                {(user.lockedUntil || user.mustChangePassword) && (
                  <div className="mt-3 space-y-2">
                    {user.lockedUntil && (
                      <p className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                        <LockIcon className="size-4" />
                        {t('detail.locked', { time: new Date(user.lockedUntil).toLocaleTimeString() })}
                      </p>
                    )}
                    {user.mustChangePassword && (
                      <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                        <KeyRoundIcon className="size-4" />
                        {t('detail.mustChangePassword')}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          {/* Modules' cards about this person (e.g. assigned assets and software). */}
          <div className="grid min-w-0 gap-6 lg:col-span-2 lg:grid-cols-2 [&:empty]:hidden">
            <Slot<UserOverviewSlotProps>
              name="core.user.overview"
              props={{ user: { id: user.id, displayName: user.displayName } }}
            />
          </div>
        </TabsContent>

        <TabsContent value="access">
          <AccessPanel userId={user.id} self={self} />
        </TabsContent>

        <TabsContent value="groups">
          <Card>
            <CardContent>
              {user.groups.length === 0 ? (
                <EmptyState icon={<UsersRoundIcon />} title={t('detail.noGroups')} />
              ) : (
                <ul className="divide-y">
                  {user.groups.map((g) => (
                    <li key={g.id}>
                      <Link
                        href={`/admin/groups/${g.id}`}
                        className="flex items-center gap-3 py-2.5 text-sm hover:underline"
                      >
                        <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
                          <UsersRoundIcon className="size-4" />
                        </span>
                        <span className="font-medium">{g.name}</span>
                        <code className="ml-auto font-mono text-xs text-muted-foreground">{g.key}</code>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <ActivityPanel userId={user.id} />
        </TabsContent>
      </Tabs>

      <UserFormSheet
        open={dialog === 'edit'}
        onOpenChange={(o) => setDialog(o ? 'edit' : null)}
        user={user}
      />
      <SuspendDialog
        user={user}
        open={dialog === 'suspend'}
        onOpenChange={(o) => setDialog(o ? 'suspend' : null)}
      />
      <OffboardDialog
        user={user}
        open={dialog === 'offboard'}
        onOpenChange={(o) => setDialog(o ? 'offboard' : null)}
      />
      <RevokeDialog
        user={user}
        open={dialog === 'revoke'}
        onOpenChange={(o) => setDialog(o ? 'revoke' : null)}
      />
      <PasswordDialog
        user={user}
        open={dialog === 'password'}
        onOpenChange={(o) => setDialog(o ? 'password' : null)}
      />
    </div>
  );
}

/* ───────────────────────── panels ───────────────────────── */

function AccessPanel({ userId, self }: { userId: string; self: boolean }) {
  const t = useTranslations('users.detail');
  const tc = useTranslations('common');
  const tr = useTranslations('core.systemRoles');
  const { data, isLoading } = useApiQuery<EffectivePermissions>(
    self ? '/me/permissions' : `/users/${userId}/permissions`,
  );
  const canAssign = useCan('core.roles.assign');
  if (isLoading || !data) return <Skeleton className="h-48 w-full rounded-xl" />;

  // Group sources by role + path so each role shows once with its permissions.
  const groups = new Map<
    string,
    {
      role: string;
      roleKey: string;
      via: string;
      scope: string | null;
      expiresAt: string | null;
      permissions: string[];
    }
  >();
  for (const s of data.sources) {
    const key = `${s.role.id}|${s.via}|${s.group?.id ?? ''}|${s.scopeType}|${s.scopeLabel ?? ''}`;
    const via = s.via === 'group' ? t('via.group', { group: s.group?.name ?? '' }) : t(`via.${s.via}`);
    const entry = groups.get(key) ?? {
      role: tr.has(`${s.role.key}.name`) ? tr(`${s.role.key}.name`) : s.role.name,
      roleKey: s.role.key,
      via,
      scope: s.scopeType === 'global' ? null : `${tc(`scope_values.${s.scopeType}`)}: ${s.scopeLabel}`,
      expiresAt: s.expiresAt,
      permissions: [],
    };
    entry.permissions.push(s.permission);
    groups.set(key, entry);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('effective')}</CardTitle>
        <CardDescription>{t('effectiveHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.size === 0 && <p className="text-sm text-muted-foreground">{t('noAccess')}</p>}
        {[...groups.values()].map((g, i) => (
          <FadeIn key={i} delay={i * 0.04} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheckIcon className="size-4 text-primary" />
              <span className="font-medium">{g.role}</span>
              <Badge variant="secondary">{g.via}</Badge>
              {g.scope && <Badge variant="info">{g.scope}</Badge>}
              {g.expiresAt && (
                <Badge variant="warning">
                  {t('expires', { time: new Date(g.expiresAt).toLocaleDateString() })}
                </Badge>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {g.permissions.map((p) => (
                <code
                  key={p}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {p}
                </code>
              ))}
            </div>
          </FadeIn>
        ))}
        {canAssign && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/roles?assign=1&userId=${userId}`}>{t('manageAccess')}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityPanel({ userId }: { userId: string }) {
  const t = useTranslations('users.detail');
  const actionLabel = useActionLabel();
  const { data, isLoading } = useApiQuery<Page<AuditLog>>('/audit-logs', {
    entityType: 'user',
    entityId: userId,
    pageSize: 20,
  });
  return (
    <Card>
      <CardHeader>
        <CardDescription>{t('activityHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ol className="space-y-3">
            {(data?.items ?? []).map((log) => (
              <li key={log.seq} className="flex items-start gap-3 text-sm">
                <AuditIcon log={log} />
                <div className="min-w-0 flex-1 pt-1">
                  <span className="font-medium">{log.actorName ?? '—'}</span>{' '}
                  <span className="text-muted-foreground">{actionLabel(log.action)}</span>
                  {log.changes && Object.keys(log.changes).length > 0 && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {Object.keys(log.changes).join(', ')}
                    </div>
                  )}
                </div>
                <RelativeTime date={log.occurredAt} className="shrink-0 pt-1 text-xs text-muted-foreground" />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── lifecycle actions ───────────────────────── */

const invalidate = ['/users', '/platform/dashboard', '/audit-logs', '/groups'];

function OnboardButton({ user }: { user: UserDetail }) {
  const t = useTranslations('users');
  const m = useApiMutation((api) => api.post(`/users/${user.id}/onboard`), {
    invalidate,
    success: t('lifecycle.onboarded', { name: user.displayName }),
  });
  return (
    <Button onClick={() => m.mutate(undefined)} loading={m.isPending}>
      <UserCheckIcon /> {t('actions.onboard')}
    </Button>
  );
}

function OnboardMenuItem({ user }: { user: UserDetail }) {
  const t = useTranslations('users');
  const m = useApiMutation((api) => api.post(`/users/${user.id}/onboard`), {
    invalidate,
    success: t('lifecycle.onboarded', { name: user.displayName }),
  });
  return (
    <DropdownMenuItem onSelect={() => m.mutate(undefined)}>
      <UserCheckIcon /> {t('actions.onboard')}
    </DropdownMenuItem>
  );
}

function ReactivateMenuItem({ user }: { user: UserDetail }) {
  const t = useTranslations('users');
  const m = useApiMutation((api) => api.post(`/users/${user.id}/status`, { status: 'active' }), {
    invalidate,
    success: t('lifecycle.reactivated', { name: user.displayName }),
  });
  return (
    <DropdownMenuItem onSelect={() => m.mutate(undefined)}>
      <RotateCcwIcon /> {t('actions.reactivate')}
    </DropdownMenuItem>
  );
}

interface DialogProps {
  user: UserDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SuspendDialog({ user, open, onOpenChange }: DialogProps) {
  const t = useTranslations('users.lifecycle');
  const ta = useTranslations('users.actions');
  const [reason, setReason] = useState('');
  const m = useApiMutation(
    (api) => api.post(`/users/${user.id}/status`, { status: 'suspended', reason: reason || undefined }),
    {
      invalidate,
      success: t('suspended', { name: user.displayName }),
      onSuccess: () => onOpenChange(false),
    },
  );
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('suspendTitle', { name: user.displayName })}
      description={t('suspendBody')}
      confirmLabel={ta('suspend')}
      destructive
      loading={m.isPending}
      onConfirm={() => m.mutate(undefined)}
    >
      <div className="grid gap-2">
        <Label htmlFor="suspend-reason">{t('reason')}</Label>
        <Textarea
          id="suspend-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('reasonPlaceholder')}
        />
      </div>
    </ConfirmDialog>
  );
}

function OffboardDialog({ user, open, onOpenChange }: DialogProps) {
  const t = useTranslations('users.lifecycle');
  const [reason, setReason] = useState('');
  const [removeGroups, setRemoveGroups] = useState(true);
  const [removeRoles, setRemoveRoles] = useState(true);
  const [transferTo, setTransferTo] = useState<PickedUser | null>(null);
  const m = useApiMutation(
    (api) =>
      api.post(`/users/${user.id}/offboard`, {
        reason: reason || undefined,
        removeGroupMemberships: removeGroups,
        removeRoleAssignments: removeRoles,
        transferReportsTo: transferTo?.id ?? null,
      }),
    {
      invalidate,
      success: t('offboarded', { name: user.displayName }),
      onSuccess: () => onOpenChange(false),
    },
  );
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('offboardTitle', { name: user.displayName })}
      description={t('offboardBody')}
      confirmLabel={t('offboardConfirm')}
      destructive
      loading={m.isPending}
      onConfirm={() => m.mutate(undefined)}
    >
      <div className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="offboard-reason">{t('reason')}</Label>
          <Input
            id="offboard-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('reasonPlaceholder')}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={removeGroups} onCheckedChange={(v) => setRemoveGroups(v === true)} />{' '}
          {t('removeGroups')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={removeRoles} onCheckedChange={(v) => setRemoveRoles(v === true)} />{' '}
          {t('removeRoles')}
        </label>
        {user.directReports > 0 && (
          <div className="grid gap-2">
            <Label>{t('transferReports')}</Label>
            <UserPicker value={transferTo} onChange={setTransferTo} excludeIds={[user.id]} />
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}

function RevokeDialog({ user, open, onOpenChange }: DialogProps) {
  const t = useTranslations('users.lifecycle');
  const m = useApiMutation((api) => api.delete<{ revoked: number }>(`/users/${user.id}/sessions`), {
    invalidate,
    success: (r) => t('revoked', { count: r.revoked }),
    onSuccess: () => onOpenChange(false),
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('revokeTitle', { name: user.displayName })}
      description={t('revokeBody')}
      destructive
      loading={m.isPending}
      onConfirm={() => m.mutate(undefined)}
    />
  );
}

function PasswordDialog({ user, open, onOpenChange }: DialogProps) {
  const t = useTranslations('users.lifecycle');
  const tc = useTranslations('common');
  const [password, setPassword] = useState('');
  const [requireChange, setRequireChange] = useState(true);
  const m = useApiMutation(
    (api) => api.post(`/users/${user.id}/password`, { password, mustChangePassword: requireChange }),
    {
      invalidate,
      success: t('passwordSet'),
      onSuccess: () => {
        setPassword('');
        onOpenChange(false);
      },
    },
  );
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('passwordTitle', { name: user.displayName })}
      description={t('passwordBody')}
      confirmLabel={tc('save')}
      loading={m.isPending}
      onConfirm={() => m.mutate(undefined)}
    >
      <div className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="new-password">{t('newPassword')}</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={requireChange} onCheckedChange={(v) => setRequireChange(v === true)} />{' '}
          {t('requireChange')}
        </label>
      </div>
    </ConfirmDialog>
  );
}
