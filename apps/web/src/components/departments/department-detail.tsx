'use client';

import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent, CardHeader } from '@isbp/ui/card';
import { StatTile } from '@isbp/ui/stat-tile';
import { ArrowRightIcon, ChevronRightIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { DepartmentNode } from '@/components/pickers/use-departments';
import { CustomFieldsCard } from '@/components/fields/entity-fields';
import { DateTime } from '@/components/relative-time';
import { ancestorIds } from './department-tree';
import { Badge } from '@astryxdesign/core/Badge';
import { BreadcrumbItem, Breadcrumbs } from '@astryxdesign/core/Breadcrumbs';
import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Heading, Text } from '@astryxdesign/core/Text';

function totalMembers(node: DepartmentNode): number {
  return node.children.reduce((sum, c) => sum + totalMembers(c), node.memberCount);
}

/** Everything about one department, plus its actions (gated per department by the caller). */
export function DepartmentDetail({
  node,
  byId,
  canManage,
  onSelect,
  onEdit,
  onAddChild,
  onDelete,
}: {
  node: DepartmentNode;
  byId: Map<string, DepartmentNode>;
  canManage: boolean;
  onSelect: (id: string) => void;
  onEdit: () => void;
  onAddChild: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('departments.detail');
  const tt = useTranslations('departments.tree');
  const canReadPeople = useCan('core.users.read');
  const titleId = useId();
  const subId = useId();
  const ancestors = ancestorIds(node)
    .map((id) => byId.get(id))
    .filter((d): d is DepartmentNode => Boolean(d));
  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  const hasChildren = node.children.length > 0;
  const total = totalMembers(node);
  const viewPeople = (
    <HStack gap={1} vAlign="center">
      {t('viewPeople')}
      <Icon icon={ArrowRightIcon} size="xsm" />
    </HStack>
  );

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="gap-3">
        {ancestors.length > 0 && (
          <Breadcrumbs label={t('breadcrumb')} variant="supporting">
            {ancestors.map((a) => (
              <BreadcrumbItem key={a.id} isCurrent={false} onClick={() => onSelect(a.id)}>
                {a.name}
              </BreadcrumbItem>
            ))}
          </Breadcrumbs>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <VStack gap={1.5} align="start">
            <Heading level={2} id={titleId}>
              {node.name}
            </Heading>
            <Code>{node.code}</Code>
          </VStack>
          {canManage && (
            <HStack gap={2}>
              <Button
                label={t('edit')}
                variant="secondary"
                size="sm"
                icon={<Icon icon={PencilIcon} />}
                onClick={onEdit}
              />
              <MoreMenu
                label={t('more')}
                variant="secondary"
                size="sm"
                alignment="end"
                items={[
                  { label: t('addSub'), icon: PlusIcon, onClick: onAddChild },
                  { type: 'divider' },
                  {
                    label: t('delete'),
                    description: hasChildren ? t('deleteBlocked') : undefined,
                    icon: Trash2Icon,
                    variant: 'destructive',
                    isDisabled: hasChildren,
                    onClick: onDelete,
                  },
                ]}
              />
            </HStack>
          )}
        </div>
        <Text color="secondary">{node.description || t('noDescription')}</Text>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label={t('peopleDirect')}
            value={node.memberCount}
            hint={canReadPeople ? viewPeople : undefined}
            href={canReadPeople ? `/admin/users?departmentId=${node.id}` : undefined}
          />
          <StatTile
            label={t('peopleTotal')}
            value={total}
            hint={canReadPeople && hasChildren ? viewPeople : undefined}
            href={
              canReadPeople && hasChildren ? `/admin/users?departmentId=${node.id}&subtree=true` : undefined
            }
          />
        </div>

        <MetadataList>
          <MetadataListItem label={t('manager')}>
            {node.manager ? (
              <HStack gap={2} vAlign="center">
                <UserAvatar name={node.manager.displayName} className="size-6 text-[10px]" />
                {canReadPeople ? (
                  <Link href={`/admin/users/${node.manager.id}`}>{node.manager.displayName}</Link>
                ) : (
                  <Text>{node.manager.displayName}</Text>
                )}
              </HStack>
            ) : (
              <Text color="secondary">{t('noManager')}</Text>
            )}
          </MetadataListItem>
          <MetadataListItem label={t('parent')}>
            {parent ? (
              <Link onClick={() => onSelect(parent.id)}>{parent.name}</Link>
            ) : (
              <Text color="secondary">{t('topLevel')}</Text>
            )}
          </MetadataListItem>
          <MetadataListItem label={t('created')}>
            <DateTime date={node.createdAt} />
          </MetadataListItem>
        </MetadataList>

        <CustomFieldsCard variant="section" entityType="core.department" attributes={node.attributes} />

        <VStack as="section" gap={2} aria-labelledby={subId}>
          <HStack gap={2} hAlign="between" vAlign="center">
            <HStack gap={2} vAlign="center">
              <Heading level={3} id={subId}>
                {t('subDepartments')}
              </Heading>
              <Badge variant="neutral" label={node.children.length} />
            </HStack>
            {canManage && (
              <Button
                label={t('addSub')}
                variant="ghost"
                size="sm"
                icon={<Icon icon={PlusIcon} />}
                onClick={onAddChild}
              />
            )}
          </HStack>
          {hasChildren ? (
            <List hasDividers>
              {node.children.map((c) => (
                <ListItem
                  key={c.id}
                  label={c.name}
                  description={
                    <Text type="code" size="xsm" color="secondary">
                      {c.code}
                    </Text>
                  }
                  endContent={
                    <HStack gap={2} vAlign="center">
                      <Text type="supporting">{tt('people', { count: c.memberCount })}</Text>
                      <Icon icon={ChevronRightIcon} size="sm" />
                    </HStack>
                  }
                  onClick={() => onSelect(c.id)}
                />
              ))}
            </List>
          ) : (
            <Text color="secondary">{t('noSubDepartments')}</Text>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}
