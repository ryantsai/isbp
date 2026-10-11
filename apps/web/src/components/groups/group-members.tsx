'use client';

import type { Group, GroupMember } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent } from '@isbp/ui/card';
import { DataTable, type DataTableColumn, type DataTableSelection } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { AnimatedItem, AnimatedList, easeOut } from '@isbp/ui/motion';
import { SearchInput } from '@isbp/ui/search-input';
import {
  InfoIcon,
  RefreshCwIcon,
  SearchXIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersRoundIcon,
  XIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { RelativeTime } from '@/components/relative-time';
import { SourceBadge, UserStatusBadge } from '@/components/status-badge';
import { useApiMutation, useApiQuery } from '@/lib/api';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Divider } from '@astryxdesign/core/Divider';
import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Item } from '@astryxdesign/core/Item';
import { HStack, Layout, LayoutContent, LayoutFooter, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';

const SYNCED_SOURCES = new Set(['ldap', 'oidc', 'saml']);
const INVALIDATE = ['/groups', '/users', '/audit-logs', '/platform/dashboard'];

export const isEveryoneGroup = (g: Pick<Group, 'isSystem' | 'key'>) => g.isSystem && g.key === 'everyone';

/** Members tab: searchable, paged member list with bulk removal and an "add members" dialog. */
export function GroupMembersPanel({ group, canManage }: { group: Group; canManage: boolean }) {
  const t = useTranslations('groups.members');
  const tc = useTranslations('common');

  if (isEveryoneGroup(group)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={<UsersRoundIcon />}
            title={t('everyoneTitle')}
            description={t('everyoneBody', { count: group.memberCount })}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <VStack gap={3}>
      {SYNCED_SOURCES.has(group.source) && (
        <Banner
          status="info"
          title={t('syncedNotice', { source: tc(`source_values.${group.source}`) })}
          icon={<Icon icon={RefreshCwIcon} />}
          collapsible={false}
        />
      )}
      <MembersTable group={group} canManage={canManage} />
    </VStack>
  );
}

function MembersTable({ group, canManage }: { group: Group; canManage: boolean }) {
  const t = useTranslations('groups.members');
  const tg = useTranslations('groups');
  const tc = useTranslations('common');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<string | undefined>();
  const [selection, setSelection] = useState<DataTableSelection>({});
  const [dialog, setDialog] = useState<'add' | 'remove' | null>(null);
  // Snapshot of the ids being removed, so the dialog text stays stable while it closes.
  const [toRemove, setToRemove] = useState<string[]>([]);

  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<GroupMember>>(
    `/groups/${group.id}/members`,
    {
      page,
      pageSize,
      sort,
      q: q || undefined,
    },
  );
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);

  const remove = useApiMutation(
    (api, userIds: string[]) =>
      api.post<{ removed: number }>(`/groups/${group.id}/members/remove`, { userIds }),
    {
      invalidate: INVALIDATE,
      success: (r) => t('removed', { count: r.removed }),
      onSuccess: () => {
        setSelection({});
        setDialog(null);
      },
    },
  );

  const columns = useMemo<DataTableColumn<GroupMember>[]>(
    () => [
      {
        id: 'person',
        header: t('columns.person'),
        meta: { sortKey: 'displayName' },
        cell: ({ row }) => (
          <HStack gap={3} vAlign="center">
            <UserAvatar name={row.original.displayName} src={row.original.avatarUrl} />
            <StackItem size="fill">
              <VStack>
                <Link href={`/admin/users/${row.original.id}`} color="primary" weight="medium" maxLines={1}>
                  {row.original.displayName}
                </Link>
                <Text type="supporting" maxLines={1}>
                  {row.original.email}
                </Text>
              </VStack>
            </StackItem>
          </HStack>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        meta: { className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
        cell: ({ row }) => <UserStatusBadge status={row.original.status} quiet />,
      },
      {
        id: 'source',
        header: t('columns.source'),
        meta: { className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        cell: ({ row }) => <SourceBadge source={row.original.source} />,
      },
      {
        id: 'added',
        header: t('columns.added'),
        meta: {
          sortKey: 'addedAt',
          className: 'hidden text-muted-foreground lg:table-cell',
          headerClassName: 'hidden lg:table-cell',
        },
        cell: ({ row }) => <RelativeTime date={row.original.addedAt} />,
      },
    ],
    [t],
  );

  return (
    <>
      <DataTable
        label={tg('detail.tabs.members')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        sort={sort}
        loading={isLoading}
        fetching={isFetching}
        error={error}
        onRetry={() => refetch()}
        getRowId={(m) => m.id}
        selectable={canManage}
        selection={selection}
        onSelectionChange={setSelection}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        onSortChange={(s) => {
          setSort(s);
          setPage(1);
        }}
        toolbar={
          <>
            <SearchInput
              value={q}
              onChange={(v) => {
                setQ(v);
                setPage(1);
              }}
              placeholder={t('searchPlaceholder')}
              clearLabel={tg('clearSearch')}
            />
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <AnimatePresence initial={false}>
                {canManage && selectedIds.length > 0 && (
                  <motion.div
                    key="remove"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.15, ease: easeOut }}
                  >
                    <HStack gap={2} vAlign="center">
                      <Text type="supporting" aria-live="polite">
                        {tc('selectedCount', { count: selectedIds.length })}
                      </Text>
                      <Button
                        label={t('removeSelected', { count: selectedIds.length })}
                        variant="secondary"
                        size="sm"
                        icon={<Icon icon={UserMinusIcon} />}
                        onClick={() => {
                          setToRemove(selectedIds);
                          setDialog('remove');
                        }}
                      />
                    </HStack>
                  </motion.div>
                )}
              </AnimatePresence>
              {canManage && (
                <Button
                  label={t('add')}
                  variant="primary"
                  size="sm"
                  icon={<Icon icon={UserPlusIcon} />}
                  onClick={() => setDialog('add')}
                />
              )}
            </div>
          </>
        }
        empty={
          q ? (
            <EmptyState
              icon={<SearchXIcon />}
              title={t('empty.searchTitle')}
              description={t('empty.searchDescription')}
            />
          ) : (
            <EmptyState
              icon={<UsersRoundIcon />}
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                canManage && (
                  <Button
                    label={t('add')}
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={UserPlusIcon} />}
                    onClick={() => setDialog('add')}
                  />
                )
              }
            />
          )
        }
      />
      {canManage && (
        <>
          <AddMembersDialog
            group={group}
            open={dialog === 'add'}
            onOpenChange={(o) => setDialog(o ? 'add' : null)}
          />
          <ConfirmDialog
            open={dialog === 'remove'}
            onOpenChange={(o) => setDialog(o ? 'remove' : null)}
            title={t('removeTitle', { count: toRemove.length, group: group.name })}
            description={t('removeBody')}
            confirmLabel={t('removeSelected', { count: toRemove.length })}
            destructive
            loading={remove.isPending}
            onConfirm={() => remove.mutate(toRemove)}
          />
        </>
      )}
    </>
  );
}

/** Builds a list of people with the person picker, then adds them in one request. */
function AddMembersDialog({
  group,
  open,
  onOpenChange,
}: {
  group: Group;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('groups.members');
  const tc = useTranslations('common');
  const pickerId = useId();
  const [people, setPeople] = useState<PickedUser[]>([]);

  const close = (o: boolean) => {
    if (!o) setPeople([]);
    onOpenChange(o);
  };

  const add = useApiMutation(
    (api, userIds: string[]) => api.post<{ added: number }>(`/groups/${group.id}/members`, { userIds }),
    {
      invalidate: INVALIDATE,
      success: (r) => t('added', { count: r.added }),
      onSuccess: () => close(false),
    },
  );

  return (
    <Dialog isOpen={open} onOpenChange={close} width={512} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('addTitle', { group: group.name })}
            subtitle={t('addDescription')}
            onOpenChange={close}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <Field label={t('pickLabel')} inputID={pickerId}>
                <UserPicker
                  id={pickerId}
                  value={null}
                  placeholder={t('pickPlaceholder')}
                  excludeIds={people.map((p) => p.id)}
                  onChange={(u) => {
                    if (u) setPeople((prev) => (prev.some((p) => p.id === u.id) ? prev : [...prev, u]));
                  }}
                />
              </Field>
              <div className="rounded-lg border">
                <HStack gap={2} hAlign="between" vAlign="center" paddingInline={3} paddingBlock={1}>
                  <Text type="supporting" aria-live="polite">
                    {t('picked', { count: people.length })}
                  </Text>
                  {people.length > 1 && (
                    <Button label={t('clearList')} variant="ghost" size="sm" onClick={() => setPeople([])} />
                  )}
                </HStack>
                <Divider />
                {people.length === 0 ? (
                  <HStack gap={2} hAlign="center" vAlign="center" padding={4}>
                    <Icon icon={InfoIcon} />
                    <Text color="secondary">{t('listEmpty')}</Text>
                  </HStack>
                ) : (
                  <AnimatedList className="max-h-64 divide-y overflow-y-auto">
                    {people.map((p) => (
                      <AnimatedItem key={p.id}>
                        <Item
                          density="compact"
                          startContent={<UserAvatar name={p.displayName} className="size-7 text-[10px]" />}
                          label={p.displayName}
                          description={p.email}
                          endContent={
                            <IconButton
                              label={t('removeFromList', { name: p.displayName })}
                              variant="ghost"
                              size="sm"
                              icon={<Icon icon={XIcon} />}
                              onClick={() => setPeople((prev) => prev.filter((x) => x.id !== p.id))}
                            />
                          }
                        />
                      </AnimatedItem>
                    ))}
                  </AnimatedList>
                )}
              </div>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => close(false)} />
              <Button
                label={t('addConfirm', { count: people.length })}
                variant="primary"
                icon={<Icon icon={UserPlusIcon} />}
                isLoading={add.isPending}
                isDisabled={people.length === 0}
                onClick={() => add.mutate(people.map((p) => p.id))}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
