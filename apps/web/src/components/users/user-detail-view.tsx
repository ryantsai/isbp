'use client';

import type { EffectivePermissions, UserDetail, UserOverviewSlotProps } from '@isbp/contracts';
import { localeLabels, isLocale } from '@isbp/i18n';
import { Slot, useCan, usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { IconTile } from '@isbp/ui/icon-tile';
import { AnimatedItem, AnimatedList, Collapse, FadeIn } from '@isbp/ui/motion';
import { BackLink } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import {
  ArrowRightLeftIcon,
  BanIcon,
  CheckIcon,
  KeyRoundIcon,
  LaptopIcon,
  LogOutIcon,
  PencilIcon,
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
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
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
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Code } from '@astryxdesign/core/Code';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import type { DropdownMenuOption } from '@astryxdesign/core/DropdownMenu';
import { Field } from '@astryxdesign/core/Field';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Item } from '@astryxdesign/core/Item';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';

type DialogKind = 'edit' | 'transfer' | 'suspend' | 'offboard' | 'revoke' | 'password' | null;
const TABS = ['overview', 'access', 'groups', 'activity'] as const;
type Tab = (typeof TABS)[number];
const invalidate = ['/users', '/platform/dashboard', '/audit-logs', '/groups'];

/** An empty value reads "—". */
const orDash = (value: ReactNode) => (value === null || value === undefined || value === '' ? '—' : value);

export function UserDetailView({ id }: { id: string }) {
  const t = useTranslations('users');
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const panelId = useId();
  const { user: me } = usePlatform();
  const { data: user, isLoading, error, refetch } = useApiQuery<UserDetail>(`/users/${id}`);
  const canUpdate = useCan('core.users.update');
  const canLifecycle = useCan('core.users.lifecycle');
  const canCredentials = useCan('core.users.credentials');
  const canRoles = useCan('core.roles.read');
  const canAudit = useCan('core.audit.read');
  const canGroups = useCan('core.groups.manage');
  const [dialog, setDialog] = useState<DialogKind>(null);
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
  const tabLabel = t(`detail.tabs.${shownTab}`);

  return (
    <div className="space-y-5">
      <BackLink href="/admin/users" label={t('title')} highlight={user.id} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <UserAvatar name={name} src={user.avatarUrl} className="size-16 text-lg" />
        <div className="min-w-0 flex-1">
          <VStack gap={1}>
            <HStack gap={2} wrap="wrap" vAlign="center">
              <Heading level={1}>{name}</Heading>
              <UserStatusBadge status={user.status} />
              <SourceBadge source={user.authSource} />
            </HStack>
            <Text type="supporting" wordBreak="break-word">
              {[user.jobTitle, user.department?.name].filter(Boolean).join(' · ') || user.email}
            </Text>
          </VStack>
        </div>
        <HStack gap={2} wrap="wrap">
          {lifecycleActions && user.status === 'pending' && <OnboardButton user={user} />}
          {canUpdate && (
            <Button
              label={t('actions.edit')}
              variant="secondary"
              icon={<Icon icon={PencilIcon} />}
              onClick={() => setDialog('edit')}
            />
          )}
          {(lifecycleActions || canCredentials || movable) && (
            <UserMoreMenu
              user={user}
              movable={movable}
              canCredentials={canCredentials}
              lifecycleActions={lifecycleActions}
              onDialog={setDialog}
            />
          )}
        </HStack>
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

      <VStack gap={3}>
        <TabList
          role="tablist"
          value={shownTab}
          onChange={(v) => patchQuery({ tab: v === 'overview' ? null : v })}
          hasDivider
        >
          <Tab value="overview" label={t('detail.tabs.overview')} panelId={panelId} />
          {showAccess && <Tab value="access" label={t('detail.tabs.access')} panelId={panelId} />}
          <Tab
            value="groups"
            label={t('detail.tabs.groups')}
            panelId={panelId}
            endContent={<Badge variant="neutral" label={user.groups.length} />}
          />
          {canAudit && <Tab value="activity" label={t('detail.tabs.activity')} panelId={panelId} />}
        </TabList>

        <div
          role="tabpanel"
          id={panelId}
          aria-label={tabLabel}
          className={shownTab === 'overview' ? 'grid items-start gap-4 lg:grid-cols-2' : undefined}
        >
          {shownTab === 'overview' && <OverviewPanel user={user} />}
          {shownTab === 'access' && <AccessPanel userId={user.id} self={self} />}
          {shownTab === 'groups' && (
            <GroupsPanel
              user={user}
              canManage={canGroups && user.status !== 'offboarded'}
              adding={addingGroups}
              onAddingChange={setAddingGroups}
            />
          )}
          {shownTab === 'activity' && (
            <ActivityFeed subject={{ type: 'user', id: user.id }} description={t('detail.activityHint')} />
          )}
        </div>
      </VStack>

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
      action: <Button label={t('groupsAction')} variant="secondary" size="sm" onClick={onAddGroups} />,
    });
  if (canAssign)
    steps.push({
      id: 'role',
      icon: <ShieldCheckIcon />,
      title: t('role'),
      hint: t('roleHint'),
      action: (
        <Button
          label={t('roleAction')}
          variant="secondary"
          size="sm"
          href={`/admin/roles?assign=1&userId=${user.id}`}
        />
      ),
    });
  if (canDevices)
    steps.push({
      id: 'device',
      icon: <LaptopIcon />,
      title: t('device'),
      hint: t('deviceHint', { name: user.displayName }),
      action: (
        <Button label={t('deviceAction')} variant="secondary" size="sm" href="/itam/hardware?view=in_stock" />
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
      <Card role="region" aria-labelledby="next-steps-title">
        <CardHeader>
          <CardTitle id="next-steps-title">
            <HStack gap={2} vAlign="center">
              <Icon icon={CheckIcon} color="success" />
              {t('title', { name: user.displayName })}
            </HStack>
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
          <CardAction>
            <IconButton
              label={t('dismiss')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={XIcon} />}
              onClick={onDismiss}
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <List hasDividers>
            {steps.map((s) => (
              <ListItem
                key={s.id}
                label={s.title}
                description={s.hint}
                startContent={
                  <IconTile size="sm" aria-hidden>
                    {s.icon}
                  </IconTile>
                }
                endContent={s.action}
              />
            ))}
          </List>
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
            <MetadataList>
              <MetadataListItem label={tc('email')}>
                <Link href={`mailto:${user.email}`}>{user.email}</Link>
              </MetadataListItem>
              <MetadataListItem label={t('form.username')}>
                <Code>{user.username}</Code>
              </MetadataListItem>
              <MetadataListItem label={t('form.givenName')}>{orDash(user.givenName)}</MetadataListItem>
              <MetadataListItem label={t('form.familyName')}>{orDash(user.familyName)}</MetadataListItem>
              <MetadataListItem label={t('form.phone')}>{orDash(user.phone)}</MetadataListItem>
              <MetadataListItem label={t('form.locale')}>
                {orDash(isLocale(user.locale) ? localeLabels[user.locale] : user.locale)}
              </MetadataListItem>
              <MetadataListItem label={t('form.timezone')}>{orDash(user.timezone)}</MetadataListItem>
            </MetadataList>
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
            <MetadataList>
              <MetadataListItem label={tc('department')}>{orDash(user.department?.name)}</MetadataListItem>
              <MetadataListItem label={tc('manager')}>
                {user.manager ? (
                  <HStack gap={2} vAlign="center">
                    <UserAvatar name={user.manager.displayName} className="size-5 text-[9px]" />
                    <Link href={`/admin/users/${user.manager.id}`}>{user.manager.displayName}</Link>
                  </HStack>
                ) : (
                  '—'
                )}
              </MetadataListItem>
              <MetadataListItem label={t('form.jobTitle')}>{orDash(user.jobTitle)}</MetadataListItem>
              <MetadataListItem label={t('form.employeeId')}>{orDash(user.employeeId)}</MetadataListItem>
              <MetadataListItem label={t('detail.directReports')}>
                {format.number(user.directReports)}
              </MetadataListItem>
            </MetadataList>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('detail.account')}</CardTitle>
          </CardHeader>
          <CardContent>
            <VStack gap={3}>
              <MetadataList>
                <MetadataListItem label={t('detail.lastLogin')}>
                  {user.lastLoginAt ? <RelativeTime date={user.lastLoginAt} /> : t('detail.never')}
                </MetadataListItem>
                <MetadataListItem label={t('detail.activeSessions')}>
                  {format.number(user.activeSessions)}
                </MetadataListItem>
                <MetadataListItem label={t('detail.created')}>
                  <DateTime date={user.createdAt} />
                </MetadataListItem>
                <MetadataListItem label={t('detail.onboarded')}>
                  {user.onboardedAt ? <DateTime date={user.onboardedAt} /> : '—'}
                </MetadataListItem>
                {user.offboardedAt && (
                  <MetadataListItem label={t('detail.offboarded')}>
                    <DateTime date={user.offboardedAt} />
                  </MetadataListItem>
                )}
              </MetadataList>
              {user.lockedUntil && (
                <Banner
                  status="warning"
                  title={t('detail.locked', {
                    time: format.dateTime(new Date(user.lockedUntil), { timeStyle: 'short' }),
                  })}
                  collapsible={false}
                />
              )}
              {user.mustChangePassword && (
                <Banner status="info" title={t('detail.mustChangePassword')} collapsible={false} />
              )}
            </VStack>
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
            <ToggleButton
              label={codes ? t('hidePermissions') : t('showPermissions')}
              size="sm"
              isPressed={codes}
              onPressedChange={setCodes}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.size === 0 && <Text color="secondary">{t('noAccess')}</Text>}
        <ul className="divide-y rounded-lg border">
          {[...groups.entries()].map(([key, g]) => (
            <li key={key} className="px-3 py-2.5">
              <VStack gap={1}>
                <HStack gap={2} wrap="wrap" vAlign="center">
                  <Icon icon={ShieldCheckIcon} color="accent" />
                  <Text weight="medium">{g.role}</Text>
                  <Badge variant="neutral" label={g.via} />
                  {g.scope && <Badge variant="info" label={g.scope} />}
                  {g.expiresAt && (
                    <Badge
                      variant="warning"
                      label={t('expires', {
                        time: format.dateTime(new Date(g.expiresAt), { dateStyle: 'medium' }),
                      })}
                    />
                  )}
                </HStack>
                {g.description && <Text type="supporting">{g.description}</Text>}
                <Collapse open={codes}>
                  <HStack gap={1.5} wrap="wrap" paddingBlockStart={1}>
                    {g.permissions.map((p) => (
                      <Code key={p}>{p}</Code>
                    ))}
                  </HStack>
                </Collapse>
              </VStack>
            </li>
          ))}
        </ul>
        {canAssign && (
          <Button
            label={t('manageAccess')}
            variant="secondary"
            size="sm"
            href={`/admin/roles?assign=1&userId=${userId}`}
          />
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
            <Button
              label={t('add')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => onAddingChange(true)}
            />
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
          <AnimatedList className="divide-y">
            {user.groups.map((g) => {
              const synced = g.source !== 'manual' || g.groupSource !== 'local';
              return (
                <AnimatedItem key={g.id}>
                  <Item
                    startContent={
                      <IconTile size="sm" aria-hidden>
                        <UsersRoundIcon />
                      </IconTile>
                    }
                    label={
                      <Link href={`/admin/groups/${g.id}`} color="primary" weight="medium" maxLines={1}>
                        {g.name}
                      </Link>
                    }
                    description={
                      synced ? (
                        <HStack gap={1} vAlign="center">
                          <Icon icon={RefreshCwIcon} size="xsm" />
                          {t('synced', {
                            source: tc(
                              `source_values.${g.groupSource === 'local' ? 'system' : g.groupSource}`,
                            ),
                          })}
                        </HStack>
                      ) : undefined
                    }
                    endContent={
                      canManage && !synced ? (
                        <IconButton
                          label={t('removeLabel', { group: g.name })}
                          variant="ghost"
                          size="sm"
                          icon={<Icon icon={UserMinusIcon} />}
                          isDisabled={change.isPending}
                          onClick={() => remove(g)}
                        />
                      ) : undefined
                    }
                  />
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
  const fieldId = useId();
  const [ids, setIds] = useState<string[]>([]);
  const close = () => {
    setIds([]);
    onOpenChange(false);
  };
  return (
    <Dialog isOpen={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())} width={480} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('addTitle', { name: user.displayName })}
            subtitle={t('addDescription')}
            onOpenChange={(o) => (o ? onOpenChange(true) : close())}
          />
        }
        content={
          <LayoutContent padding={4}>
            <Field
              label={t('choose')}
              isGroupLabel
              labelID={`${fieldId}-label`}
              inputID={`${fieldId}-picker`}
            >
              <GroupMultiSelect
                labelledBy={`${fieldId}-label`}
                value={ids}
                onChange={setIds}
                exclude={user.groups.map((g) => g.id)}
                addLabel={t('pick')}
              />
            </Field>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={close} />
              <Button
                label={t('addConfirm', { count: ids.length })}
                variant="primary"
                isLoading={pending}
                isDisabled={ids.length === 0}
                onClick={() => onAdd(ids, close)}
              />
            </HStack>
          </LayoutFooter>
        }
      />
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
    <Button
      label={t('actions.onboard')}
      variant="primary"
      icon={<Icon icon={UserCheckIcon} />}
      isLoading={m.isPending}
      onClick={() => m.mutate(undefined)}
    />
  );
}

/** The "More actions" menu: move, reset password, sign out, then the status changes (offboard last). */
function UserMoreMenu({
  user,
  movable,
  canCredentials,
  lifecycleActions,
  onDialog,
}: {
  user: UserDetail;
  movable: boolean;
  canCredentials: boolean;
  lifecycleActions: boolean;
  onDialog: (dialog: DialogKind) => void;
}) {
  const t = useTranslations('users');
  const onboard = useApiMutation((api) => api.post(`/users/${user.id}/onboard`), {
    invalidate,
    success: t('lifecycle.onboarded', { name: user.displayName }),
  });
  const reactivate = useApiMutation((api) => api.post(`/users/${user.id}/status`, { status: 'active' }), {
    invalidate,
    success: t('lifecycle.reactivated', { name: user.displayName }),
  });
  const items: DropdownMenuOption[] = [];
  if (movable)
    items.push({
      label: t('actions.transfer'),
      icon: ArrowRightLeftIcon,
      onClick: () => onDialog('transfer'),
    });
  if (canCredentials && user.authSource === 'local')
    items.push({
      label: t('actions.resetPassword'),
      icon: KeyRoundIcon,
      onClick: () => onDialog('password'),
    });
  if (lifecycleActions) {
    items.push(
      {
        label: t('actions.revokeSessions'),
        icon: LogOutIcon,
        isDisabled: user.activeSessions === 0,
        onClick: () => onDialog('revoke'),
      },
      { type: 'divider' },
    );
    if (user.status === 'offboarded')
      items.push({
        label: t('actions.onboard'),
        icon: UserCheckIcon,
        onClick: () => onboard.mutate(undefined),
      });
    if (user.status === 'suspended')
      items.push({
        label: t('actions.reactivate'),
        icon: RotateCcwIcon,
        onClick: () => reactivate.mutate(undefined),
      });
    if (user.status === 'active')
      items.push({ label: t('actions.suspend'), icon: BanIcon, onClick: () => onDialog('suspend') });
    if (user.status !== 'offboarded')
      items.push({
        label: t('actions.offboard'),
        icon: UserXIcon,
        variant: 'destructive',
        onClick: () => onDialog('offboard'),
      });
  }
  return <MoreMenu label={t('actions.more')} variant="secondary" alignment="end" items={items} />;
}

interface DialogProps {
  user: UserDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SuspendDialog({ user, open, onOpenChange }: DialogProps) {
  const t = useTranslations('users.lifecycle');
  const ta = useTranslations('users.actions');
  const tc = useTranslations('common');
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
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('suspendTitle', { name: user.displayName })}
            subtitle={t('suspendBody')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <TextArea
              label={t('reason')}
              placeholder={t('reasonPlaceholder')}
              value={reason}
              onChange={setReason}
            />
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button
                label={tc('cancel')}
                variant="ghost"
                isDisabled={m.isPending}
                onClick={() => onOpenChange(false)}
              />
              <Button
                label={ta('suspend')}
                variant="destructive"
                isLoading={m.isPending}
                onClick={() => m.mutate(undefined)}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

function OffboardDialog({ user, open, onOpenChange }: DialogProps) {
  const t = useTranslations('users.lifecycle');
  const tc = useTranslations('common');
  const transferId = useId();
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
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('offboardTitle', { name: user.displayName })}
            subtitle={t('offboardBody')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <TextInput
                label={t('reason')}
                placeholder={t('reasonPlaceholder')}
                value={reason}
                onChange={setReason}
              />
              <CheckboxInput label={t('removeGroups')} value={removeGroups} onChange={setRemoveGroups} />
              <CheckboxInput label={t('removeRoles')} value={removeRoles} onChange={setRemoveRoles} />
              {user.directReports > 0 && (
                <Field label={t('transferReports')} inputID={transferId}>
                  <UserPicker
                    id={transferId}
                    value={transferTo}
                    onChange={setTransferTo}
                    excludeIds={[user.id]}
                  />
                </Field>
              )}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button
                label={tc('cancel')}
                variant="ghost"
                isDisabled={m.isPending}
                onClick={() => onOpenChange(false)}
              />
              <Button
                label={t('offboardConfirm')}
                variant="destructive"
                isLoading={m.isPending}
                onClick={() => m.mutate(undefined)}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
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
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('passwordTitle', { name: user.displayName })}
            subtitle={t('passwordBody')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <TextInput
                label={t('newPassword')}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
              />
              <CheckboxInput label={t('requireChange')} value={requireChange} onChange={setRequireChange} />
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button
                label={tc('cancel')}
                variant="ghost"
                isDisabled={m.isPending}
                onClick={() => onOpenChange(false)}
              />
              <Button
                label={tc('save')}
                variant="primary"
                isLoading={m.isPending}
                onClick={() => m.mutate(undefined)}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
