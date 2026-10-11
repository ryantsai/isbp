'use client';

import type { Group } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { IconTile } from '@isbp/ui/icon-tile';
import { FadeIn } from '@isbp/ui/motion';
import { BackLink } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { useQueryClient } from '@tanstack/react-query';
import { LockIcon, PencilIcon, Trash2Icon, UsersRoundIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CustomFieldsCard } from '@/components/fields/entity-fields';
import { SourceBadge } from '@/components/status-badge';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { GroupFormDialog } from './group-form';
import { GroupMembersPanel } from './group-members';
import { ActivityFeed } from '@/components/audit/activity-feed';
import { GroupRolesPanel } from './group-panels';
import { SystemBadge } from './groups-view';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Heading, Text } from '@astryxdesign/core/Text';

type GroupTab = 'members' | 'roles' | 'activity';

export function GroupDetailView({ id }: { id: string }) {
  const t = useTranslations('groups');
  const panelId = useId();
  const { data: group, isLoading, error } = useApiQuery<Group>(`/groups/${id}`);
  const canManage = useCan('core.groups.manage', { recordType: 'group', recordId: id });
  const canRoles = useCan('core.roles.read');
  const canAudit = useCan('core.audit.read');
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  const [tab, setTab] = useState<GroupTab>('members');

  const back = <BackLink href="/admin/groups" label={t('title')} highlight={id} />;

  if (isLoading) {
    return (
      <div className="space-y-5">
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
      <div className="space-y-5">
        {back}
        <EmptyState
          icon={<UsersRoundIcon />}
          title={t('detail.notFound')}
          description={t('detail.notFoundDescription')}
        />
      </div>
    );
  }

  const shownTab: GroupTab =
    (tab === 'roles' && !canRoles) || (tab === 'activity' && !canAudit) ? 'members' : tab;

  return (
    <div className="space-y-5">
      {back}

      <FadeIn y={4} className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <IconTile size="lg" aria-hidden>
          <UsersRoundIcon />
        </IconTile>
        <div className="min-w-0 flex-1">
          <VStack gap={1.5}>
            <HStack gap={2} wrap="wrap" vAlign="center">
              <Heading level={1}>{group.name}</Heading>
              <SourceBadge source={group.source} />
              {group.isSystem && <SystemBadge />}
            </HStack>
            <HStack gap={3} wrap="wrap" vAlign="center">
              <Code>{group.key}</Code>
              <Text type="supporting">
                {t('detail.summary', { members: group.memberCount, roles: group.roleCount })}
              </Text>
            </HStack>
            <Text type="supporting">{group.description || t('detail.noDescription')}</Text>
          </VStack>
        </div>
        {canManage && (
          <HStack gap={2}>
            <Button
              label={t('detail.edit')}
              variant="secondary"
              icon={<Icon icon={PencilIcon} />}
              onClick={() => setDialog('edit')}
            />
            <MoreMenu
              label={t('detail.more')}
              variant="secondary"
              alignment="end"
              items={[
                group.isSystem
                  ? { label: t('detail.systemLocked'), icon: LockIcon, isDisabled: true }
                  : {
                      label: t('detail.delete'),
                      icon: Trash2Icon,
                      variant: 'destructive',
                      onClick: () => setDialog('delete'),
                    },
              ]}
            />
          </HStack>
        )}
      </FadeIn>

      <CustomFieldsCard entityType="core.group" attributes={group.attributes} />

      <VStack gap={3}>
        <TabList role="tablist" value={shownTab} onChange={(v) => setTab(v as GroupTab)} hasDivider>
          <Tab
            value="members"
            label={t('detail.tabs.members')}
            panelId={panelId}
            endContent={<Badge variant="neutral" label={group.memberCount.toLocaleString()} />}
          />
          {canRoles && (
            <Tab
              value="roles"
              label={t('detail.tabs.roles')}
              panelId={panelId}
              endContent={<Badge variant="neutral" label={group.roleCount} />}
            />
          )}
          {canAudit && <Tab value="activity" label={t('detail.tabs.activity')} panelId={panelId} />}
        </TabList>

        <div role="tabpanel" id={panelId} aria-label={t(`detail.tabs.${shownTab}`)}>
          {shownTab === 'members' && <GroupMembersPanel group={group} canManage={canManage} />}
          {shownTab === 'roles' && <GroupRolesPanel groupId={group.id} />}
          {shownTab === 'activity' && (
            <ActivityFeed subject={{ type: 'group', id: group.id }} description={t('activity.description')} />
          )}
        </div>
      </VStack>

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
      onOpenChange={(next) => {
        if (!next) del.reset();
        onOpenChange(next);
      }}
      title={t('deleteTitle', { name: group.name })}
      description={t('deleteBody', { count: group.memberCount })}
      confirmLabel={t('delete')}
      destructive
      loading={del.isPending}
      onConfirm={() => del.mutate(undefined)}
      error={del.error}
    />
  );
}
