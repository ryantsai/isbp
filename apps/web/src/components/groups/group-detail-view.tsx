'use client';

import type { Group } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  UsersRoundIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CustomFieldsCard } from '@/components/fields/entity-fields';
import { SourceBadge } from '@/components/status-badge';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { GroupFormDialog } from './group-form';
import { GroupMembersPanel } from './group-members';
import { GroupActivityPanel, GroupRolesPanel } from './group-panels';
import { SystemBadge } from './groups-view';

export function GroupDetailView({ id }: { id: string }) {
  const t = useTranslations('groups');
  const { data: group, isLoading, error } = useApiQuery<Group>(`/groups/${id}`);
  const canManage = useCan('core.groups.manage', { recordType: 'group', recordId: id });
  const canRoles = useCan('core.roles.read');
  const canAudit = useCan('core.audit.read');
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);

  const back = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
      <Link href="/admin/groups">
        <ArrowLeftIcon /> {t('title')}
      </Link>
    </Button>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {back}
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }
  if (error || !group) {
    return (
      <div className="space-y-6">
        {back}
        <EmptyState
          icon={<UsersRoundIcon />}
          title={t('detail.notFound')}
          description={t('detail.notFoundDescription')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {back}

      <FadeIn y={4} className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span
          className="grid size-14 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
          aria-hidden
        >
          <UsersRoundIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{group.name}</h1>
            <SourceBadge source={group.source} />
            {group.isSystem && <SystemBadge />}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{group.key}</code>
            <span>{t('detail.summary', { members: group.memberCount, roles: group.roleCount })}</span>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {group.description || t('detail.noDescription')}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilIcon /> {t('detail.edit')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t('detail.more')}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {group.isSystem ? (
                  <DropdownMenuItem disabled>
                    <LockIcon /> {t('detail.systemLocked')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
                    <Trash2Icon /> {t('detail.delete')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </FadeIn>

      <CustomFieldsCard entityType="core.group" attributes={group.attributes} />

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">
            {t('detail.tabs.members')}
            <Badge variant="muted" className="px-1.5 tabular-nums">
              {group.memberCount.toLocaleString()}
            </Badge>
          </TabsTrigger>
          {canRoles && (
            <TabsTrigger value="roles">
              {t('detail.tabs.roles')}
              <Badge variant="muted" className="px-1.5 tabular-nums">
                {group.roleCount}
              </Badge>
            </TabsTrigger>
          )}
          {canAudit && <TabsTrigger value="activity">{t('detail.tabs.activity')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="members">
          <GroupMembersPanel group={group} canManage={canManage} />
        </TabsContent>
        {canRoles && (
          <TabsContent value="roles">
            <GroupRolesPanel groupId={group.id} />
          </TabsContent>
        )}
        {canAudit && (
          <TabsContent value="activity">
            <GroupActivityPanel groupId={group.id} />
          </TabsContent>
        )}
      </Tabs>

      {canManage && (
        <>
          <GroupFormDialog
            open={dialog === 'edit'}
            onOpenChange={(o) => setDialog(o ? 'edit' : null)}
            group={group}
          />
          {!group.isSystem && (
            <DeleteGroupDialog
              group={group}
              open={dialog === 'delete'}
              onOpenChange={(o) => setDialog(o ? 'delete' : null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function DeleteGroupDialog({
  group,
  open,
  onOpenChange,
}: {
  group: Group;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('groups.detail');
  const router = useRouter();
  const client = useQueryClient();
  const del = useApiMutation((api) => api.delete(`/groups/${group.id}`), {
    // Group queries are only marked stale (not refetched) so this page never flashes "not found" before leaving.
    invalidate: ['/users', '/role-assignments', '/audit-logs', '/platform/dashboard'],
    success: t('deleted', { name: group.name }),
    onSuccess: () => {
      onOpenChange(false);
      router.push('/admin/groups');
      void client.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/groups'),
        refetchType: 'none',
      });
    },
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('deleteTitle', { name: group.name })}
      description={t('deleteBody', { count: group.memberCount })}
      confirmLabel={t('delete')}
      destructive
      loading={del.isPending}
      onConfirm={() => del.mutate(undefined)}
    />
  );
}
