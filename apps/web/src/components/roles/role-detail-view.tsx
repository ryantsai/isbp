'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card as SurfaceCard } from '@astryxdesign/core/Card';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import type { PermissionInfo, Role, RoleAssignment } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList, FadeIn } from '@isbp/ui/motion';
import { DetailHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BlocksIcon,
  CopyIcon,
  LockIcon,
  PencilIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
  ShieldXIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import { ActivityFeed } from '@/components/audit/activity-feed';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { ExpiryCell, PrincipalCell, RevokeAssignmentDialog, ScopeBadge } from './assignment-parts';
import { GrantRoleSheet } from './grant-role-sheet';
import { PermissionEditor } from './permission-editor';
import { RequestBadges } from './request-settings';
import { RoleFormSheet, type RoleTemplate } from './role-form';
import { RoleRequestSettingsCard } from './role-request-settings-card';
import {
  diffPermissions,
  normalizePermissions,
  useAccessErrorText,
  useGrantable,
  useRoleText,
} from './role-utils';

type Dialog = 'edit' | 'duplicate' | 'delete' | 'grant' | null;

export function RoleDetailView({ id }: { id: string }) {
  const t = useTranslations('roles');
  const tc = useTranslations('common');
  const router = useRouter();
  const roleText = useRoleText();
  const grantable = useGrantable();
  const accessError = useAccessErrorText();
  const canManage = useCan('core.roles.manage');
  const canAssign = useCan('core.roles.assign');
  const canAudit = useCan('core.audit.read');
  const tr = useTranslations();
  const panelId = useId();
  const [codes, setCodes] = useState(false);
  const [tab, setTab] = useState<'permissions' | 'activity'>('permissions');
  const { data: role, isLoading, error } = useApiQuery<Role>(`/roles/${id}`);
  const catalog = useApiQuery<{ items: PermissionInfo[] }>('/permissions');
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const original = useMemo(() => role?.permissions ?? [], [role]);
  // Stable so the open "duplicate" sheet isn't reset when this view re-renders.
  const template = useMemo<RoleTemplate | undefined>(
    () =>
      role
        ? {
            name: t('detail.copyOf', { name: roleText(role).name }),
            description: roleText(role).description,
            permissions: role.permissions,
          }
        : undefined,
    [role, roleText, t],
  );
  const current = draft ?? original;
  const { added, removed } = diffPermissions(original, current);
  const changes = added.length + removed.length;
  const dirty = changes > 0;
  const blocked = dirty ? normalizePermissions(current).filter((p) => !grantable(p)) : [];

  // Unsaved permission changes: warn before leaving the page.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const save = useApiMutation(
    (api, permissions: string[]) => api.patch<Role>(`/roles/${id}`, { permissions }),
    {
      invalidate: ['/roles', '/role-assignments', '/users', '/me', '/audit-logs'],
      success: t('detail.saved'),
      onSuccess: () => {
        setDraft(null);
        // Your own grants may have changed — refresh the session-backed UI gating.
        router.refresh();
      },
      silent: true,
    },
  );
  const client = useQueryClient();
  const remove = useApiMutation((api) => api.delete(`/roles/${id}`), {
    invalidate: ['/role-assignments', '/platform/dashboard', '/audit-logs'],
    success: t('detail.deleted', { name: role?.name ?? '' }),
    onSuccess: () => {
      setDialog(null);
      router.push('/admin/roles');
      // Refresh the list only — refetching this (deleted) role would 404 and flash "not found".
      void client.invalidateQueries({ queryKey: ['/roles'] });
    },
    silent: true,
  });

  if (isLoading) {
    return (
      <div className="space-y-5" aria-busy>
        <Skeleton className="h-8 w-32" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-80" />
          </div>
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }
  if (error || !role) {
    return (
      <EmptyState
        icon={<ShieldXIcon />}
        title={t('detail.notFound')}
        action={<Button label={t('title')} variant="secondary" href="/admin/roles" />}
      />
    );
  }

  const { name, description } = roleText(role);
  const editable = canManage && !role.isSystem;

  return (
    <div className="space-y-5">
      <DetailHeader
        className="pb-0"
        back={{ href: '/admin/roles', label: t('title'), highlight: role.id }}
        icon={role.isSystem ? <ShieldIcon /> : <ShieldCheckIcon />}
        title={name}
        badges={
          <>
            {role.isSystem ? (
              <Badge
                variant="neutral"
                label={t('badges.system')}
                icon={<Icon icon={LockIcon} size="xsm" />}
              />
            ) : (
              <Badge variant="info" label={t('badges.custom')} />
            )}
            {role.moduleId && (
              <Badge
                variant="neutral"
                label={t('badges.module', {
                  module:
                    role.moduleId === 'core'
                      ? t('list.platform')
                      : tr.has(`${role.moduleId}.meta.name`)
                        ? tr(`${role.moduleId}.meta.name`)
                        : role.moduleId,
                })}
                icon={<Icon icon={BlocksIcon} size="xsm" />}
              />
            )}
            <RequestBadges role={role} showDuration />
          </>
        }
        meta={
          <VStack gap={1.5}>
            <HStack gap={3} wrap="wrap" vAlign="center">
              {codes && <Text type="code">{role.key}</Text>}
              <HStack gap={1.5} vAlign="center">
                <Icon icon={UsersIcon} size="sm" color="secondary" />
                <Text type="supporting">{t('card.assignments', { count: role.assignmentCount })}</Text>
              </HStack>
            </HStack>
            {description && <Text>{description}</Text>}
          </VStack>
        }
        primaryAction={
          canAssign && (
            <Button
              label={t('grantRole')}
              variant="primary"
              icon={<Icon icon={ShieldCheckIcon} />}
              onClick={() => setDialog('grant')}
            />
          )
        }
        actions={[
          ...(editable
            ? [
                {
                  id: 'edit',
                  label: tc('edit'),
                  icon: <Icon icon={PencilIcon} />,
                  onSelect: () => setDialog('edit'),
                },
              ]
            : []),
          ...(canManage && !editable
            ? [
                {
                  id: 'duplicate',
                  label: t('detail.duplicate'),
                  icon: <Icon icon={CopyIcon} />,
                  onSelect: () => setDialog('duplicate'),
                },
              ]
            : []),
        ]}
        menu={
          canManage && editable
            ? [
                {
                  id: 'duplicate',
                  label: t('detail.duplicate'),
                  icon: <Icon icon={CopyIcon} />,
                  onSelect: () => setDialog('duplicate'),
                },
                {
                  id: 'delete',
                  label: tc('delete'),
                  icon: <Icon icon={Trash2Icon} />,
                  destructive: true,
                  onSelect: () => setDialog('delete'),
                },
              ]
            : []
        }
      />

      {role.isSystem && (
        <FadeIn delay={0.05}>
          <Banner
            status="info"
            title={t('detail.systemTitle')}
            description={t('detail.systemNotice')}
            icon={<Icon icon={LockIcon} />}
            collapsible={false}
          />
        </FadeIn>
      )}

      <VStack gap={4}>
        {canAudit && (
          <TabList
            role="tablist"
            aria-label={name}
            value={tab}
            onChange={(v) => setTab(v === 'activity' ? 'activity' : 'permissions')}
            hasDivider
          >
            <Tab value="permissions" label={t('detail.tabs.permissions')} panelId={panelId} />
            <Tab value="activity" label={t('detail.tabs.activity')} panelId={panelId} />
          </TabList>
        )}
        <div role={canAudit ? 'tabpanel' : undefined} id={panelId}>
          {!canAudit || tab === 'permissions' ? (
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
              <Card>
                <CardHeader>
                  <CardTitle>{t('detail.permissions')}</CardTitle>
                  <CardDescription>
                    {editable ? t('detail.permissionsHint') : t('detail.permissionsReadOnly')}
                  </CardDescription>
                  <CardAction className="flex flex-wrap items-center justify-end gap-2">
                    <Badge variant="neutral" label={t('card.permissions', { count: current.length })} />
                    <Button
                      label={codes ? t('detail.hideCodes') : t('detail.showCodes')}
                      variant="ghost"
                      size="sm"
                      aria-pressed={codes}
                      onClick={() => setCodes(!codes)}
                    />
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <PermissionEditor
                    catalog={catalog.data?.items ?? []}
                    loading={catalog.isLoading}
                    showCodes={codes}
                    value={current}
                    readOnly={!editable}
                    onChange={editable ? (next) => setDraft(next) : undefined}
                  />
                </CardContent>
              </Card>

              <div className="grid min-w-0 gap-4">
                <RoleAssignmentsCard role={role} onGrant={canAssign ? () => setDialog('grant') : undefined} />
                <RoleRequestSettingsCard role={role} />
              </div>
            </div>
          ) : (
            <ActivityFeed subject={{ type: 'role', id: role.id }} description={t('detail.activityHint')} />
          )}
        </div>
      </VStack>

      <AnimatePresence>
        {dirty && editable && (
          <motion.div
            role="region"
            aria-label={t('detail.unsavedRegion')}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="sticky bottom-4 z-20"
          >
            <SurfaceCard padding={3} elevation="high">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1" aria-live="polite">
                  <HStack gap={3} wrap="wrap" vAlign="center">
                    <Icon icon={AlertTriangleIcon} color="warning" />
                    <Text weight="medium">{t('detail.unsaved', { count: changes })}</Text>
                    {added.length > 0 && (
                      <Text color="secondary" hasTabularNumbers>
                        {t('detail.added', { count: added.length })}
                      </Text>
                    )}
                    {removed.length > 0 && (
                      <Text color="secondary" hasTabularNumbers>
                        {t('detail.removed', { count: removed.length })}
                      </Text>
                    )}
                  </HStack>
                  {blocked.length > 0 && (
                    <HStack gap={1.5} vAlign="start" paddingBlockStart={1}>
                      <Icon icon={AlertTriangleIcon} size="sm" color="error" />
                      <StackItem size="fill">
                        <Text type="supporting">
                          {t('detail.blocked', { permissions: blocked.slice(0, 5).join(', ') })}
                        </Text>
                      </StackItem>
                    </HStack>
                  )}
                </div>
                <HStack gap={2}>
                  <Button
                    label={t('detail.discard')}
                    variant="ghost"
                    isDisabled={save.isPending}
                    onClick={() => setDraft(null)}
                  />
                  <Button
                    label={tc('saveChanges')}
                    variant="primary"
                    isLoading={save.isPending}
                    isDisabled={blocked.length > 0}
                    onClick={() =>
                      save.mutate(normalizePermissions(current), {
                        onError: (err) => toast.error(accessError(err)),
                      })
                    }
                  />
                </HStack>
              </div>
            </SurfaceCard>
          </motion.div>
        )}
      </AnimatePresence>

      {editable && (
        <RoleFormSheet
          open={dialog === 'edit'}
          onOpenChange={(o) => setDialog(o ? 'edit' : null)}
          role={role}
        />
      )}
      {canManage && (
        <RoleFormSheet
          open={dialog === 'duplicate'}
          onOpenChange={(o) => setDialog(o ? 'duplicate' : null)}
          template={template}
        />
      )}
      {canAssign && (
        <GrantRoleSheet
          open={dialog === 'grant'}
          onOpenChange={(o) => setDialog(o ? 'grant' : null)}
          prefill={{ roleId: role.id }}
        />
      )}
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => setDialog(o ? 'delete' : null)}
        title={t('detail.deleteTitle', { name })}
        description={
          role.assignmentCount > 0
            ? t('detail.deleteBodyAssigned', { count: role.assignmentCount })
            : t('detail.deleteBody')
        }
        confirmLabel={t('detail.deleteConfirm')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onError: (err) => toast.error(accessError(err)) })}
      >
        {role.assignmentCount > 0 && (
          <Banner
            status="warning"
            title={t('detail.deleteWarning', { count: role.assignmentCount })}
            collapsible={false}
          />
        )}
        {role.requestable && <Text color="secondary">{t('detail.deleteRequested')}</Text>}
      </ConfirmDialog>
    </div>
  );
}

/* ───────────────────────── assignments of this role ───────────────────────── */

const PREVIEW = 8;

function RoleAssignmentsCard({ role, onGrant }: { role: Role; onGrant?: () => void }) {
  const t = useTranslations('roles');
  const roleText = useRoleText();
  const canAssign = useCan('core.roles.assign');
  const [revoking, setRevoking] = useState<RoleAssignment | null>(null);
  const { data, isLoading } = useApiQuery<Page<RoleAssignment>>('/role-assignments', {
    roleId: role.id,
    pageSize: PREVIEW,
    sort: '-grantedAt',
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{t('detail.assignments')}</CardTitle>
        <CardDescription>{t('detail.assignmentsHint')}</CardDescription>
        {onGrant && (
          <CardAction>
            <Button
              label={t('detail.grant')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={ShieldCheckIcon} />}
              onClick={onGrant}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<UsersIcon />} title={t('detail.noAssignments')} className="py-6" />
        ) : (
          <AnimatedList className="-mx-1 divide-y">
            {items.map((a) => (
              <AnimatedItem key={a.id}>
                <div className="flex items-center gap-2 px-1 py-2.5">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <PrincipalCell principal={a.principal} compact />
                    <div className="flex flex-wrap items-center gap-1.5 pl-10 text-xs">
                      {a.scopeType !== 'global' && <ScopeBadge assignment={a} />}
                      {a.expiresAt && <ExpiryCell expiresAt={a.expiresAt} expired={a.expired} />}
                    </div>
                  </div>
                  {canAssign && (
                    <Tooltip content={t('assignments.revoke')}>
                      <IconButton
                        label={t('assignments.revokeLabel', {
                          role: roleText(role).name,
                          name: a.principal.name,
                        })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={ShieldOffIcon} />}
                        onClick={() => setRevoking(a)}
                      />
                    </Tooltip>
                  )}
                </div>
              </AnimatedItem>
            ))}
          </AnimatedList>
        )}
        {total > 0 && (
          <div className="mt-2">
            <Button
              label={
                total > items.length ? t('detail.viewAll', { count: total }) : t('detail.manageAssignments')
              }
              variant="ghost"
              size="sm"
              endContent={<Icon icon={ArrowRightIcon} />}
              href={`/admin/roles?tab=assignments&roleId=${role.id}`}
            />
          </div>
        )}
      </CardContent>
      <RevokeAssignmentDialog assignment={revoking} onOpenChange={(o) => !o && setRevoking(null)} />
    </Card>
  );
}
