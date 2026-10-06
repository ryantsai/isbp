'use client';

import type { PermissionInfo, Role, RoleAssignment } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Hint } from '@isbp/ui/tooltip';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BlocksIcon,
  CopyIcon,
  LockIcon,
  MoreHorizontalIcon,
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
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { ExpiryCell, PrincipalCell, RevokeAssignmentDialog, ScopeBadge } from './assignment-parts';
import { GrantRoleSheet } from './grant-role-sheet';
import { PermissionEditor } from './permission-editor';
import { RoleFormSheet, type RoleTemplate } from './role-form';
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
      <div className="space-y-6" aria-busy>
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
        action={
          <Button variant="outline" asChild>
            <Link href="/admin/roles">{t('title')}</Link>
          </Button>
        }
      />
    );
  }

  const { name, description } = roleText(role);
  const editable = canManage && !role.isSystem;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href="/admin/roles">
          <ArrowLeftIcon /> {t('title')}
        </Link>
      </Button>

      <FadeIn y={4} className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span
          className={`grid size-12 shrink-0 place-items-center rounded-xl ${role.isSystem ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}
          aria-hidden
        >
          {role.isSystem ? <ShieldIcon className="size-6" /> : <ShieldCheckIcon className="size-6" />}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
            {role.isSystem ? (
              <Badge variant="muted">
                <LockIcon aria-hidden /> {t('badges.system')}
              </Badge>
            ) : (
              <Badge variant="info">{t('badges.custom')}</Badge>
            )}
            {role.moduleId && (
              <Badge variant="outline" className="font-normal">
                <BlocksIcon aria-hidden /> {t('badges.module', { module: role.moduleId })}
              </Badge>
            )}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <code className="font-mono text-xs">{role.key}</code>
            <span className="inline-flex items-center gap-1.5">
              <UsersIcon className="size-3.5" aria-hidden />
              {t('card.assignments', { count: role.assignmentCount })}
            </span>
          </p>
          {description && <p className="max-w-3xl text-sm">{description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canAssign && (
            <Button onClick={() => setDialog('grant')}>
              <ShieldCheckIcon /> {t('grantRole')}
            </Button>
          )}
          {editable && (
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilIcon /> {tc('edit')}
            </Button>
          )}
          {canManage &&
            (editable ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={t('detail.more')}>
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={() => setDialog('duplicate')}>
                    <CopyIcon /> {t('detail.duplicate')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
                    <Trash2Icon /> {tc('delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button variant="outline" onClick={() => setDialog('duplicate')}>
                <CopyIcon /> {t('detail.duplicate')}
              </Button>
            ))}
        </div>
      </FadeIn>

      {role.isSystem && (
        <FadeIn
          delay={0.05}
          className="flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm"
        >
          <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p>
            <span className="font-medium">{t('detail.systemTitle')}</span>{' '}
            <span className="text-muted-foreground">{t('detail.systemNotice')}</span>
          </p>
        </FadeIn>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader>
            <CardTitle>{t('detail.permissions')}</CardTitle>
            <CardDescription>
              {editable ? t('detail.permissionsHint') : t('detail.permissionsReadOnly')}
            </CardDescription>
            <CardAction>
              <Badge variant="muted" className="tabular-nums">
                {t('card.permissions', { count: current.length })}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <PermissionEditor
              catalog={catalog.data?.items ?? []}
              loading={catalog.isLoading}
              value={current}
              readOnly={!editable}
              onChange={editable ? (next) => setDraft(next) : undefined}
            />
          </CardContent>
        </Card>

        <RoleAssignmentsCard role={role} onGrant={canAssign ? () => setDialog('grant') : undefined} />
      </div>

      <AnimatePresence>
        {dirty && editable && (
          <motion.div
            role="region"
            aria-label={t('detail.unsavedRegion')}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:items-center"
          >
            <div
              className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-sm"
              aria-live="polite"
            >
              <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden />
              <span className="font-medium">{t('detail.unsaved', { count: changes })}</span>
              {added.length > 0 && (
                <span className="text-success tabular-nums">
                  {t('detail.added', { count: added.length })}
                </span>
              )}
              {removed.length > 0 && (
                <span className="text-destructive tabular-nums">
                  {t('detail.removed', { count: removed.length })}
                </span>
              )}
              {blocked.length > 0 && (
                <span className="flex basis-full items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {t('detail.blocked', { permissions: blocked.slice(0, 5).join(', ') })}
                </span>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={save.isPending}>
                {t('detail.discard')}
              </Button>
              <Button
                loading={save.isPending}
                disabled={blocked.length > 0}
                onClick={() =>
                  save.mutate(normalizePermissions(current), {
                    onError: (err) => toast.error(accessError(err)),
                  })
                }
              >
                {tc('saveChanges')}
              </Button>
            </div>
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
          <p className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('detail.deleteWarning', { count: role.assignmentCount })}
          </p>
        )}
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
            <Button size="sm" variant="outline" onClick={onGrant}>
              <ShieldCheckIcon /> {t('detail.grant')}
            </Button>
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
          <EmptyState icon={<UsersIcon />} title={t('detail.noAssignments')} className="py-8" />
        ) : (
          <ul className="-mx-1 divide-y">
            <AnimatePresence initial={false}>
              {items.map((a) => (
                <motion.li
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 px-1 py-2.5"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <PrincipalCell principal={a.principal} compact />
                    <div className="flex flex-wrap items-center gap-1.5 pl-10 text-xs">
                      {a.scopeType !== 'global' && <ScopeBadge assignment={a} />}
                      {a.expiresAt && <ExpiryCell expiresAt={a.expiresAt} expired={a.expired} />}
                    </div>
                  </div>
                  {canAssign && (
                    <Hint label={t('assignments.revoke')}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={t('assignments.revokeLabel', {
                          role: roleText(role).name,
                          name: a.principal.name,
                        })}
                        onClick={() => setRevoking(a)}
                      >
                        <ShieldOffIcon />
                      </Button>
                    </Hint>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {total > 0 && (
          <Button variant="link" size="sm" asChild className="mt-2 h-auto px-0">
            <Link href={`/admin/roles?tab=assignments&roleId=${role.id}`}>
              {total > items.length ? t('detail.viewAll', { count: total }) : t('detail.manageAssignments')}{' '}
              <ArrowRightIcon />
            </Link>
          </Button>
        )}
      </CardContent>
      <RevokeAssignmentDialog assignment={revoking} onOpenChange={(o) => !o && setRevoking(null)} />
    </Card>
  );
}
