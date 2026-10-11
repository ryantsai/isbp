'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Layout';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { useCan } from '@isbp/sdk/web';
import { PageHeader } from '@isbp/ui/page-header';
import { PlusIcon, ShieldCheckIcon, ShieldIcon, UsersIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { AssignmentsTable } from './assignments-table';
import { type GrantPrefill, GrantRoleSheet } from './grant-role-sheet';
import { RoleFormSheet } from './role-form';
import { RoleGrid } from './role-grid';

const BASE = '/admin/roles';

/**
 * Roles & access. Tabs (`?tab=assignments`), the "new role" sheet (`?create=1`) and the grant sheet
 * (`?assign=1[&userId=…|&groupId=…][&roleId=…]`) all live in the URL so they can be deep-linked.
 */
export function RolesView() {
  const t = useTranslations('roles');
  const router = useRouter();
  const sp = useSearchParams();
  const canManage = useCan('core.roles.manage');
  const canAssign = useCan('core.roles.assign');
  const tab = sp.get('tab') === 'assignments' ? 'assignments' : 'roles';
  const panelId = useId();

  const patch = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(next.size ? `${BASE}?${next}` : BASE, { scroll: false });
  };

  const createOpen = canManage && sp.get('create') === '1';
  const assignOpen = canAssign && sp.get('assign') === '1';
  const userId = sp.get('userId');
  const groupId = sp.get('groupId');
  const roleId = sp.get('roleId');
  const prefill = useMemo<GrantPrefill>(() => ({ userId, groupId, roleId }), [userId, groupId, roleId]);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            {canManage && (
              <Button
                label={t('newRole')}
                variant="secondary"
                icon={<Icon icon={PlusIcon} />}
                onClick={() => patch({ create: '1' })}
              />
            )}
            {canAssign && (
              <Button
                label={t('grantRole')}
                variant="primary"
                icon={<Icon icon={ShieldCheckIcon} />}
                onClick={() => patch({ assign: '1' })}
              />
            )}
          </>
        }
      />
      <VStack gap={4}>
        <TabList
          role="tablist"
          aria-label={t('title')}
          value={tab}
          onChange={(v) =>
            // Each tab has its own search and filters.
            patch({
              tab: v === 'assignments' ? 'assignments' : null,
              page: null,
              q: null,
              type: null,
              requestable: null,
              roleId: null,
              includeExpired: null,
            })
          }
          hasDivider
        >
          <Tab value="roles" label={t('tabs.roles')} icon={<Icon icon={ShieldIcon} />} panelId={panelId} />
          <Tab
            value="assignments"
            label={t('tabs.assignments')}
            icon={<Icon icon={UsersIcon} />}
            panelId={panelId}
          />
        </TabList>
        <div role="tabpanel" id={panelId} aria-label={t(`tabs.${tab}`)}>
          {tab === 'roles' ? (
            <RoleGrid onCreate={canManage ? () => patch({ create: '1' }) : undefined} />
          ) : (
            <AssignmentsTable />
          )}
        </div>
      </VStack>
      {canManage && (
        <RoleFormSheet open={createOpen} onOpenChange={(o) => patch({ create: o ? '1' : null })} />
      )}
      {canAssign && (
        <GrantRoleSheet
          open={assignOpen}
          onOpenChange={(o) => patch(o ? { assign: '1' } : { assign: null, userId: null, groupId: null })}
          prefill={prefill}
        />
      )}
    </>
  );
}
