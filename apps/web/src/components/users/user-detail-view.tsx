'use client';

import type { EffectivePermissions, UserDetail, UserOverviewSlotProps } from '@isbp/contracts';
import { localeLabels, isLocale } from '@isbp/i18n';
import { Slot, useCan, usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Checkbox } from '@isbp/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { AnimatedItem, AnimatedList, Collapse, FadeIn } from '@isbp/ui/motion';
import { BackLink } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Textarea } from '@isbp/ui/textarea';
import { Hint } from '@isbp/ui/tooltip';
import {
  ArrowRightLeftIcon,
  BanIcon,
  CheckIcon,
  KeyRoundIcon,
  LaptopIcon,
  LockIcon,
  LogOutIcon,
  MailIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UserMinusIcon,
  UserXIcon,
  UsersRoundIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { ActivityFeed } from '@/components/audit/activity-feed';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CustomFieldsCard } from '@/components/fields/entity-fields';
import { GroupMultiSelect } from '@/components/pickers/group-multi-select';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { DateTime, RelativeTime } from '@/components/relative-time';
import { useRoleText } from '@/components/roles/role-utils';
import { SourceBadge, UserStatusBadge } from '@/components/status-badge';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { TransferSheet } from './transfer-sheet';
import { UserFormSheet } from './user-form';

function Field({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === '' || children === false;
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">{empty ? '—' : children}</dd>
    </div>
  );
}

type Dialog = 'edit' | 'transfer' | 'suspend' | 'offboard' | 'revoke' | 'password' | null;
const TABS = ['overview', 'access', 'groups', 'activity'] as const;
type Tab = (typeof TABS)[number];
const invalidate = ['/users', '/platform/dashboard', '/audit-logs', '/groups'];

export function UserDetailView({ id }: { id: string }) {
  const t = useTranslations('users');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { user: me } = usePlatform();
  const { data: user, isLoading, error, refetch } = useApiQuery<UserDetail>(`/users/${id}`);
  const canUpdate = useCan('core.users.update');
  const canLifecycle = useCan('core.users.lifecycle');
  const canCredentials = useCan('core.users.credentials');
  const canRoles = useCan('core.roles.read');
  const canAudit = useCan('core.audit.read');
  const canGroups = useCan('core.groups.manage');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [addingGroups, setAddingGroups] = useState(false);

  const patchQuery = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };
  const requested = sp.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'overview';

  if (isLoading) {
    return (
      <div className="space-y-5" aria-busy>
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
  if (error || !user)
    return (
      <ErrorState error={error} onRetry={() => void refetch()} kind="page" title={t('detail.notFound')} />
    );

  const self = me.id === user.id;
  const name = user.displayName;
  const lifecycleActions = canLifecycle && !self;
  const welcome = sp.get('new') === '1';
  const showAccess = canRoles || self;
  const shownTab: Tab =
    (tab === 'access' && !showAccess) || (tab === 'activity' && !canAudit) ? 'overview' : tab;
  const movable = canUpdate && user.status !== 'offboarded';

  return (
    <div className="space-y-5">
      <BackLink href="/admin/users" label={t('title')} highlight={user.id} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <UserAvatar name={name} src={user.avatarUrl} className="size-16 text-lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight wrap-break-word">{name}</h1>
            <UserStatusBadge status={user.status} />
            <SourceBadge source={user.authSource} />
          </div>
          <p className="text-sm text-muted-foreground wrap-break-word">
            {[user.jobTitle, user.department?.name].filter(Boolean).join(' · ') || user.email}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {lifecycleActions && user.status === 'pending' && <OnboardButton user={user} />}
          {canUpdate && (
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilIcon /> {t('actions.edit')}
            </Button>
          )}
          {(lifecycleActions || canCredentials || movable) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t('actions.more')}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {movable && (
                  <DropdownMenuItem onSelect={() => setDialog('transfer')}>
                    <ArrowRightLeftIcon /> {t('actions.transfer')}
                  </DropdownMenuItem>
                )}
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
      </div>

      {welcome && (
        <NextSteps
          user={user}
          onAddGroups={() => {
            patchQuery({ tab: 'groups' });
            setAddingGroups(true);
          }}
          onDismiss={() => patchQuery({ new: null })}
        />
      )}

      <Tabs value={shownTab} onValueChange={(v) => patchQuery({ tab: v === 'overview' ? null : v })}>
        <TabsList>
          <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
          {showAccess && <TabsTrigger value="access">{t('detail.tabs.access')}</TabsTrigger>}
          <TabsTrigger value="groups">
            {t('detail.tabs.groups')}
            <Badge variant="muted" className="px-1.5 tabular-nums">
              {user.groups.length}
            </Badge>
          </TabsTrigger>
          {canAudit && <TabsTrigger value="activity">{t('detail.tabs.activity')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="grid items-start gap-4 lg:grid-cols-2">
          <OverviewPanel user={user} />
        </TabsContent>

        {showAccess && (
          <TabsContent value="access">
            <AccessPanel userId={user.id} self={self} />
          </TabsContent>
        )}

        <TabsContent value="groups">
          <GroupsPanel
            user={user}
            canManage={canGroups && user.status !== 'offboarded'}
            adding={addingGroups}
            onAddingChange={setAddingGroups}
          />
        </TabsContent>

        {canAudit && (
          <TabsContent value="activity">
            <ActivityFeed subject={{ type: 'user', id: user.id }} description={t('detail.activityHint')} />
          </TabsContent>
        )}
      </Tabs>

      <UserFormSheet
        open={dialog === 'edit'}
        onOpenChange={(o) => setDialog(o ? 'edit' : null)}
        user={user}
      />
      {movable && (
        <TransferSheet
          user={user}
          open={dialog === 'transfer'}
          onOpenChange={(o) => setDialog(o ? 'transfer' : null)}
        />
      )}
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

/* ───────────────────────── next steps (after "Add person") ───────────────────────── */

/** Shown once, right after the person was added: what usually follows, as links to the pages that do it. */
function NextSteps({
  user,
  onAddGroups,
  onDismiss,
}: {
  user: UserDetail;
  onAddGroups: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('users.nextSteps');
  const { enabledModules } = usePlatform();
  const canAssign = useCan('core.roles.assign');
  const canGroups = useCan('core.groups.manage');
  const canDevices = useCan('itam.hardware.manage') && enabledModules.includes('itam');
  const canLifecycle = useCan('core.users.lifecycle');
  const steps: { id: string; icon: ReactNode; title: string; hint: string; action: ReactNode }[] = [];
  if (canGroups && user.groups.length === 0)
    steps.push({
      id: 'groups',
      icon: <UsersRoundIcon />,
      title: t('groups'),
      hint: t('groupsHint'),
      action: (
        <Button size="sm" variant="outline" onClick={onAddGroups}>
          {t('groupsAction')}
        </Button>
      ),
    });
  if (canAssign)
    steps.push({
      id: 'role',
      icon: <ShieldCheckIcon />,
      title: t('role'),
      hint: t('roleHint'),
      action: (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/admin/roles?assign=1&userId=${user.id}`}>{t('roleAction')}</Link>
        </Button>
      ),
    });
  if (canDevices)
    steps.push({
      id: 'device',
      icon: <LaptopIcon />,
      title: t('device'),
      hint: t('deviceHint', { name: user.displayName }),
      action: (
        <Button size="sm" variant="outline" asChild>
          <Link href="/itam/hardware?view=in_stock">{t('deviceAction')}</Link>
        </Button>
      ),
    });
  if (canLifecycle && user.status === 'pending')
    steps.push({
      id: 'onboard',
      icon: <UserCheckIcon />,
      title: t('onboard'),
      hint: t('onboardHint'),
      action: null,
    });
  if (!steps.length) return null;
  return (
    <FadeIn>
      <Card className="border-primary/25 bg-primary/[0.03]" role="region" aria-labelledby="next-steps-title">
        <CardHeader>
          <CardTitle id="next-steps-title" className="flex items-center gap-2">
            <CheckIcon className="size-4 text-success" aria-hidden />
            {t('title', { name: user.displayName })}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
          <CardAction>
            <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label={t('dismiss')}>
              <XIcon />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ol className="divide-y">
            {steps.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                <span className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    aria-hidden
                    className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary [&_svg]:size-4"
                  >
                    {s.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{s.title}</span>
                    <span className="block text-xs text-muted-foreground">{s.hint}</span>
                  </span>
                </span>
                {s.action && <span className="shrink-0 pl-11 sm:pl-0">{s.action}</span>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </FadeIn>
  );
}

/* ───────────────────────── overview ───────────────────────── */

function OverviewPanel({ user }: { user: UserDetail }) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const format = useFormatter();
  return (
    <>
      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>{t('detail.profile')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Field label={tc('email')}>
                <a href={`mailto:${user.email}`} className="inline-flex items-center gap-1.5 hover:underline">
                  <MailIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 wrap-anywhere">{user.email}</span>
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
                    <PhoneIcon className="size-3.5 text-muted-foreground" aria-hidden />
                    {user.phone}
                  </span>
                )}
              </Field>
              <Field label={t('form.locale')}>
                {isLocale(user.locale) ? localeLabels[user.locale] : user.locale}
              </Field>
              <Field label={t('form.timezone')}>{user.timezone}</Field>
            </dl>
          </CardContent>
        </Card>
        <CustomFieldsCard entityType="core.user" attributes={user.attributes} />
      </div>
      <div className="min-w-0 space-y-5">
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
              <Field label={t('detail.directReports')}>{format.number(user.directReports)}</Field>
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
                {user.lastLoginAt ? <RelativeTime date={user.lastLoginAt} /> : t('detail.never')}
              </Field>
              <Field label={t('detail.activeSessions')}>{format.number(user.activeSessions)}</Field>
              <Field label={t('detail.created')}>
                <DateTime date={user.createdAt} />
              </Field>
              <Field label={t('detail.onboarded')}>
                {user.onboardedAt ? <DateTime date={user.onboardedAt} /> : null}
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
                    <LockIcon className="size-4" aria-hidden />
                    {t('detail.locked', {
                      time: format.dateTime(new Date(user.lockedUntil), { timeStyle: 'short' }),
                    })}
                  </p>
                )}
                {user.mustChangePassword && (
                  <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                    <KeyRoundIcon className="size-4" aria-hidden />
                    {t('detail.mustChangePassword')}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {/* Modules' cards about this person (e.g. assigned assets and software). */}
      <div className="grid min-w-0 gap-4 lg:col-span-2 lg:grid-cols-2 [&:empty]:hidden">
        <Slot<UserOverviewSlotProps>
          name="core.user.overview"
          props={{
            user: { id: user.id, displayName: user.displayName, managerId: user.manager?.id ?? null },
          }}
        />
      </div>
    </>
  );
}

/* ───────────────────────── access ───────────────────────── */

/** Roles and why the person has them; permission codes only behind "Show permissions". */
function AccessPanel({ userId, self }: { userId: string; self: boolean }) {
  const t = useTranslations('users.detail');
  const tc = useTranslations('common');
  const format = useFormatter();
  const roleText = useRoleText();
  const [codes, setCodes] = useState(false);
  const { data, isLoading, error, refetch } = useApiQuery<EffectivePermissions>(
    self ? '/me/permissions' : `/users/${userId}/permissions`,
  );
  const canAssign = useCan('core.roles.assign');
  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} kind="section" />;

  // Group sources by role + path so each role shows once with its permissions.
  const groups = new Map<
    string,
    {
      roleId: string;
      role: string;
      description: string | null;
      via: string;
      scope: string | null;
      expiresAt: string | null;
      permissions: string[];
    }
  >();
  for (const s of data.sources) {
    const key = `${s.role.id}|${s.via}|${s.group?.id ?? ''}|${s.scopeType}|${s.scopeLabel ?? ''}`;
    const via = s.via === 'group' ? t('via.group', { group: s.group?.name ?? '' }) : t(`via.${s.via}`);
    const text = roleText(s.role);
    const entry = groups.get(key) ?? {
      roleId: s.role.id,
      role: text.name,
      description: text.description,
      via,
      scope: s.scopeType === 'global' ? null : `${tc(`scope_values.${s.scopeType}`)}: ${s.scopeLabel}`,
      expiresAt: s.expiresAt ? String(s.expiresAt) : null,
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
        {groups.size > 0 && (
          <CardAction>
            <Button variant="ghost" size="sm" aria-pressed={codes} onClick={() => setCodes(!codes)}>
              {codes ? t('hidePermissions') : t('showPermissions')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.size === 0 && <p className="text-sm text-muted-foreground">{t('noAccess')}</p>}
        <ul className="divide-y rounded-lg border">
          {[...groups.entries()].map(([key, g]) => (
            <li key={key} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheckIcon className="size-4 shrink-0 text-primary" aria-hidden />
                <span className="font-medium">{g.role}</span>
                <Badge variant="secondary" className="font-normal">
                  {g.via}
                </Badge>
                {g.scope && (
                  <Badge variant="info" className="font-normal">
                    {g.scope}
                  </Badge>
                )}
                {g.expiresAt && (
                  <Badge variant="warning" className="font-normal">
                    {t('expires', { time: format.dateTime(new Date(g.expiresAt), { dateStyle: 'medium' }) })}
                  </Badge>
                )}
              </div>
              {g.description && <p className="mt-1 pl-6 text-xs text-muted-foreground">{g.description}</p>}
              <Collapse open={codes}>
                <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                  {g.permissions.map((p) => (
                    <code
                      key={p}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] break-all text-muted-foreground"
                    >
                      {p}
                    </code>
                  ))}
                </div>
              </Collapse>
            </li>
          ))}
        </ul>
        {canAssign && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/roles?assign=1&userId=${userId}`}>{t('manageAccess')}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── groups ───────────────────────── */

/**
 * The groups the person is in: add several at once, take them out of one (with Undo). Memberships a directory
 * sync keeps are marked and can't be removed here.
 */
function GroupsPanel({
  user,
  canManage,
  adding,
  onAddingChange,
}: {
  user: UserDetail;
  canManage: boolean;
  adding: boolean;
  onAddingChange: (open: boolean) => void;
}) {
  const t = useTranslations('users.groups');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const change = useApiMutation(
    (api, body: { add?: string[]; remove?: string[] }) =>
      api.post<{ added: number; removed: number }>(`/users/${user.id}/groups`, body),
    { invalidate, silent: true },
  );
  const remove = (g: UserDetail['groups'][number]) =>
    change.mutate(
      { remove: [g.id] },
      {
        onSuccess: () =>
          toast.success(t('removed', { group: g.name }), {
            action: {
              label: t('undo'),
              onClick: () =>
                change.mutate({ add: [g.id] }, { onError: (err) => toast.error(errorText(err)) }),
            },
          }),
        onError: (err) => toast.error(errorText(err)),
      },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        {canManage && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => onAddingChange(true)}>
              <PlusIcon /> {t('add')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {user.groups.length === 0 ? (
          <EmptyState
            icon={<UsersRoundIcon />}
            title={t('none')}
            description={canManage ? t('noneHint') : undefined}
            className="py-6"
          />
        ) : (
          <AnimatedList className="-mx-1 divide-y">
            {user.groups.map((g) => {
              const synced = g.source !== 'manual' || g.groupSource !== 'local';
              return (
                <AnimatedItem key={g.id}>
                  <div className="flex items-center gap-3 px-1 py-2.5 text-sm">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"
                    >
                      <UsersRoundIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/admin/groups/${g.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {g.name}
                      </Link>
                      {synced && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <RefreshCwIcon className="size-3" aria-hidden />
                          {t('synced', {
                            source: tc(
                              `source_values.${g.groupSource === 'local' ? 'system' : g.groupSource}`,
                            ),
                          })}
                        </span>
                      )}
                    </span>
                    {canManage && !synced && (
                      <Hint label={t('remove')}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={t('removeLabel', { group: g.name })}
                          disabled={change.isPending}
                          onClick={() => remove(g)}
                        >
                          <UserMinusIcon />
                        </Button>
                      </Hint>
                    )}
                  </div>
                </AnimatedItem>
              );
            })}
          </AnimatedList>
        )}
      </CardContent>
      {canManage && (
        <AddToGroupsDialog
          user={user}
          open={adding}
          onOpenChange={onAddingChange}
          onAdd={(ids, done) =>
            change.mutate(
              { add: ids },
              {
                onSuccess: (r) => {
                  toast.success(t('added', { count: r.added }));
                  done();
                },
                onError: (err) => toast.error(errorText(err)),
              },
            )
          }
          pending={change.isPending}
        />
      )}
    </Card>
  );
}

function AddToGroupsDialog({
  user,
  open,
  onOpenChange,
  onAdd,
  pending,
}: {
  user: UserDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (ids: string[], done: () => void) => void;
  pending: boolean;
}) {
  const t = useTranslations('users.groups');
  const tc = useTranslations('common');
  const [ids, setIds] = useState<string[]>([]);
  const close = () => {
    setIds([]);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addTitle', { name: user.displayName })}</DialogTitle>
          <DialogDescription>{t('addDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label id="add-groups-label">{t('choose')}</Label>
          <GroupMultiSelect
            labelledBy="add-groups-label"
            value={ids}
            onChange={setIds}
            exclude={user.groups.map((g) => g.id)}
            addLabel={t('pick')}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {tc('cancel')}
          </Button>
          <Button disabled={ids.length === 0} loading={pending} onClick={() => onAdd(ids, close)}>
            {t('addConfirm', { count: ids.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── lifecycle actions ───────────────────────── */

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
