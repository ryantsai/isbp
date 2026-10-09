'use client';

import type { Application, AppPermission, Role } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { Card, CardContent } from '@isbp/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import {
  AlertTriangleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react';
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
      <Card className="h-full gap-0 py-0 transition-shadow hover:shadow-md">
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-start gap-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
              aria-hidden
            >
              <ShieldCheckIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-medium">{role.name}</h3>
              <code className="block truncate font-mono text-xs text-muted-foreground">{role.key}</code>
            </div>
            {canManage && (
              <div className="-mt-1 -mr-1 flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onEdit}
                  aria-label={t('editLabel', { name: role.name })}
                >
                  <PencilIcon />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={t('moreLabel', { name: role.name })}>
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={onGrant}>
                      <ShieldCheckIcon /> {t('grant')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onHolders}>
                      <UsersIcon /> {t('holders')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                      <Trash2Icon /> {tc('delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
          {role.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{role.description}</p>
          )}
          <div className="flex flex-wrap gap-1" aria-label={t('permissionsLabel')}>
            {shown.map((p) => (
              <PermissionChip key={p} value={p} catalog={catalog} />
            ))}
            {role.permissions.length > SHOWN && (
              <span className="px-1 py-0.5 text-[11px] text-muted-foreground">
                {t('more', { count: role.permissions.length - SHOWN })}
              </span>
            )}
            {role.permissions.length === 0 && (
              <span className="text-xs text-muted-foreground">{t('noPermissions')}</span>
            )}
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={onHolders}
              className="inline-flex items-center gap-1.5 rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <UsersIcon className="size-3.5" aria-hidden />
              {t('grants', { count: role.assignmentCount })}
            </button>
            {role.requestable && role.owner && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <UserAvatar name={role.owner.displayName} className="size-5 text-[9px]" />
                <span className="truncate">{t('owner', { name: role.owner.displayName })}</span>
              </span>
            )}
            <span className="flex flex-wrap items-center gap-1 sm:ml-auto">
              {role.requestable ? (
                <RequestBadges role={role} showDuration />
              ) : (
                <span className="text-muted-foreground">{t('notRequestable')}</span>
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
        <p className="max-w-2xl text-sm text-muted-foreground">{t('hint')}</p>
        {canManage && (
          <Button onClick={() => setCreating(true)} className="shrink-0">
            <PlusIcon /> {t('new')}
          </Button>
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
                <Button variant="outline" onClick={() => setCreating(true)}>
                  <PlusIcon /> {t('new')}
                </Button>
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
              <p className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t('deleteWarning', { count: shownDeleting?.assignmentCount ?? 0 })}
              </p>
            )}
            {shownDeleting?.requestable && (
              <p className="text-sm text-muted-foreground">{tr('detail.deleteRequested')}</p>
            )}
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}
