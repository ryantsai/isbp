'use client';

import type { RoleAssignment } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { IconTile } from '@isbp/ui/icon-tile';
import { Stagger, StaggerItem } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { ClockIcon, ShieldCheckIcon, ShieldPlusIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { RelativeTime } from '@/components/relative-time';
import { useRoleText } from '@/components/roles/role-utils';
import { useApiQuery } from '@/lib/api';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { Icon } from '@astryxdesign/core/Icon';
import { Item } from '@astryxdesign/core/Item';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';

/** Role assignments granted to the group (all members inherit them). */
export function GroupRolesPanel({ groupId }: { groupId: string }) {
  const t = useTranslations('groups.roles');
  const tc = useTranslations('common');
  const roleText = useRoleText();
  const format = useFormatter();
  const canAssign = useCan('core.roles.assign');
  const { data, isLoading } = useApiQuery<Page<RoleAssignment>>('/role-assignments', {
    groupId,
    pageSize: 100,
  });
  const items = data?.items ?? [];

  const roleName = (a: RoleAssignment) => roleText(a.role).name;
  const scopeLabel = (a: RoleAssignment) => {
    if (a.scopeType === 'department')
      return t('scope', { type: tc('scope_values.department'), label: a.scope.departmentName ?? '—' });
    if (a.scopeType === 'record')
      return t('scope', {
        type: tc('scope_values.record'),
        label: `${a.scope.recordType ?? ''}/${a.scope.recordId ?? ''}`,
      });
    return tc('scope_values.global');
  };

  const grant = canAssign && (
    <Button
      label={t('grant')}
      variant="secondary"
      size="sm"
      icon={<Icon icon={ShieldPlusIcon} />}
      href={`/admin/roles?assign=1&groupId=${groupId}`}
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        {items.length > 0 && grant && <CardAction>{grant}</CardAction>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ShieldCheckIcon />}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={grant}
            className="py-10"
          />
        ) : (
          <Stagger className="space-y-2.5">
            {items.map((a) => (
              <StaggerItem key={a.id} className="rounded-lg border">
                <Item
                  align="start"
                  startContent={
                    <IconTile aria-hidden>
                      <ShieldCheckIcon />
                    </IconTile>
                  }
                  label={
                    <HStack gap={2} wrap="wrap" vAlign="center">
                      <Text weight="medium">{roleName(a)}</Text>
                      <Code color="secondary">{a.role.key}</Code>
                    </HStack>
                  }
                  description={
                    <VStack gap={1.5}>
                      <Text type="supporting">
                        {a.grantedBy
                          ? t('grantedBy', { name: a.grantedBy.displayName })
                          : t('grantedAutomatically')}{' '}
                        · <RelativeTime date={a.grantedAt} />
                        {a.reason && <> · {t('reason', { reason: a.reason })}</>}
                      </Text>
                      <HStack gap={1.5} wrap="wrap">
                        <Badge
                          variant={a.scopeType === 'global' ? 'neutral' : 'info'}
                          label={scopeLabel(a)}
                        />
                        {a.expiresAt && (
                          <Badge
                            variant="warning"
                            label={t('expires', {
                              date: format.dateTime(new Date(a.expiresAt), { dateStyle: 'medium' }),
                            })}
                            icon={<Icon icon={ClockIcon} size="xsm" />}
                          />
                        )}
                      </HStack>
                    </VStack>
                  }
                />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </CardContent>
    </Card>
  );
}
