'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import type { Application, AppPermission, Role } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { IconTile } from '@isbp/ui/icon-tile';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import { PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon, UsersIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RequestBadges } from '@/components/roles/request-settings';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { AppGrantDialog } from './app-grant-dialog';
import { APP_INVALIDATE } from './app-parts';
import { PermissionChip } from './app-permission-picker';
import { AppRoleSheet } from './app-role-sheet';

const SHOWN = 6;

function RoleRow({
  role,
  catalog,
  canManage,
  onEdit,
  onGrant,
  onDelete,
  onHolders,
}: {
  role: Role;
  catalog: readonly AppPermission[];
  canManage: boolean;
  onEdit: () => void;
  onGrant: () => void;
  onDelete: () => void;
  onHolders: () => void;
}) {
  const t = useTranslations('applications.roles');
  const tc = useTranslations('common');
  const shown = role.permissions.slice(0, SHOWN);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="h-full">
        <CardContent className="flex h-full flex-col gap-3">
          <HStack gap={3} vAlign="start">
            <IconTile size="sm" aria-hidden>
              <ShieldCheckIcon />
            </IconTile>
            <StackItem size="fill">
              <VStack>
                <Heading level={3} weight="medium" maxLines={1}>
                  {role.name}
                </Heading>
                <Text type="code" color="secondary" maxLines={1}>
                  {role.key}
                </Text>
              </VStack>
            </StackItem>
            {canManage && (
              <HStack gap={1}>
                <IconButton
                  label={t('editLabel', { name: role.name })}
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={PencilIcon} />}
                  onClick={onEdit}
                />
                <MoreMenu
                  label={t('moreLabel', { name: role.name })}
                  size="sm"
                  placement="below"
                  alignment="end"
                  items={[
                    { label: t('grant'), icon: ShieldCheckIcon, onClick: onGrant },
                    { label: t('holders'), icon: UsersIcon, onClick: onHolders },
                    { type: 'divider' },
                    { label: tc('delete'), icon: Trash2Icon, variant: 'destructive', onClick: onDelete },
                  ]}
                />
              </HStack>
            )}
          </HStack>
          {role.description && (
            <Text color="secondary" maxLines={2}>
              {role.description}
            </Text>
          )}
          <HStack gap={1} wrap="wrap" role="group" aria-label={t('permissionsLabel')}>
            {shown.map((p) => (
              <PermissionChip key={p} value={p} catalog={catalog} />
            ))}
            {role.permissions.length > SHOWN && (
              <Text type="supporting">{t('more', { count: role.permissions.length - SHOWN })}</Text>
            )}
            {role.permissions.length === 0 && <Text type="supporting">{t('noPermissions')}</Text>}
          </HStack>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3">
            <Button
              label={t('grants', { count: role.assignmentCount })}
              variant="ghost"
              size="sm"
              icon={<Icon icon={UsersIcon} />}
              onClick={onHolders}
            />
            {role.requestable && role.owner && (
              <HStack gap={1.5} vAlign="center">
                <UserAvatar name={role.owner.displayName} className="size-5 text-[9px]" />
                <Text type="supporting" maxLines={1}>
                  {t('owner', { name: role.owner.displayName })}
                </Text>
              </HStack>
            )}
            <span className="flex flex-wrap items-center gap-1 sm:ml-auto">
              {role.requestable ? (
                <RequestBadges role={role} showDuration />
              ) : (
                <Text type="supporting">{t('notRequestable')}</Text>
              )}
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.li>
  );
}

/** Roles tab: the app's roles with permission chips and request badges; create, edit, grant, delete. */
export function AppRolesPanel({ app }: { app: Application }) {
  const t = useTranslations('applications.roles');
  const errorText = useErrorText();
  const tr = useTranslations('roles');
  const router = useRouter();
  const pathname = usePathname();
  const canManage = useCan('core.applications.manage', { recordType: 'application', recordId: app.id });
  const roles = useApiQuery<{ items: Role[] }>(`/applications/${app.id}/roles`);
  const catalog = useApiQuery<{ items: AppPermission[] }>(`/applications/${app.id}/permissions`);
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [granting, setGranting] = useState<Role | null>(null);
  const [lastDeleting, setLastDeleting] = useState<Role | null>(null);
  if (deleting && deleting !== lastDeleting) setLastDeleting(deleting);
  const shownDeleting = deleting ?? lastDeleting;

  const remove = useApiMutation((api, role: Role) => api.delete(`/applications/${app.id}/roles/${role.id}`), {
    invalidate: APP_INVALIDATE,
    onSuccess: (_r, role) => {
      toast.success(t('deleted', { name: role.name }));
      setDeleting(null);
    },
    silent: true,
  });

  const items = roles.data?.items ?? [];
  const perms = catalog.data?.items ?? [];
  const showHolders = (role: Role) =>
    router.replace(`${pathname}?tab=access&roleId=${role.id}`, { scroll: false });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <Text color="secondary">{t('hint')}</Text>
        </div>
        {canManage && (
          <Button
            label={t('new')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => setCreating(true)}
            className="shrink-0"
          />
        )}
      </div>

      {roles.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={<ShieldCheckIcon />}
            title={t('empty.title')}
            description={t('empty.description')}
            action={
              canManage && (
                <Button
                  label={t('new')}
                  variant="secondary"
                  icon={<Icon icon={PlusIcon} />}
                  onClick={() => setCreating(true)}
                />
              )
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          <AnimatePresence initial={false}>
            {items.map((r) => (
              <RoleRow
                key={r.id}
                role={r}
                catalog={perms}
                canManage={canManage}
                onEdit={() => setEditing(r)}
                onGrant={() => setGranting(r)}
                onDelete={() => setDeleting(r)}
                onHolders={() => showHolders(r)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {canManage && (
        <>
          <AppRoleSheet
            app={app}
            catalog={perms}
            open={creating || editing !== null}
            onOpenChange={(o) => {
              if (!o) {
                setCreating(false);
                setEditing(null);
              }
            }}
            role={editing}
          />
          <AppGrantDialog
            app={app}
            open={granting !== null}
            onOpenChange={(o) => !o && setGranting(null)}
            roleId={granting?.id}
          />
          <ConfirmDialog
            open={deleting !== null}
            onOpenChange={(o) => !o && setDeleting(null)}
            title={t('deleteTitle', { name: shownDeleting?.name ?? '' })}
            description={t('deleteBody')}
            confirmLabel={t('deleteConfirm')}
            destructive
            loading={remove.isPending}
            onConfirm={() =>
              deleting && remove.mutate(deleting, { onError: (err) => toast.error(errorText(err)) })
            }
          >
            {(shownDeleting?.assignmentCount ?? 0) > 0 && (
              <Banner
                status="warning"
                title={t('deleteWarning', { count: shownDeleting?.assignmentCount ?? 0 })}
                collapsible={false}
              />
            )}
            {shownDeleting?.requestable && <Text color="secondary">{tr('detail.deleteRequested')}</Text>}
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}
