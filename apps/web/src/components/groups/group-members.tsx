'use client';

import type { Group, GroupMember } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { Card, CardContent } from '@isbp/ui/card';
import { DataTable, type DataTableColumn, type DataTableSelection } from '@isbp/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { EmptyState } from '@isbp/ui/empty-state';
import { Label } from '@isbp/ui/label';
import { easeOut } from '@isbp/ui/motion';
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
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { RelativeTime } from '@/components/relative-time';
import { SourceBadge, UserStatusBadge } from '@/components/status-badge';
import { useApiMutation, useApiQuery } from '@/lib/api';

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
    <div className="space-y-3">
      {SYNCED_SOURCES.has(group.source) && (
        <p className="flex items-start gap-2.5 rounded-lg border border-info/25 bg-info/8 px-3.5 py-2.5 text-sm text-foreground">
          <RefreshCwIcon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <span>{t('syncedNotice', { source: tc(`source_values.${group.source}`) })}</span>
        </p>
      )}
      <MembersTable group={group} canManage={canManage} />
    </div>
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
          <Link
            href={`/admin/users/${row.original.id}`}
            className="flex items-center gap-3 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <UserAvatar name={row.original.displayName} src={row.original.avatarUrl} />
            <span className="min-w-0">
              <span className="block truncate font-medium hover:underline">{row.original.displayName}</span>
              <span className="block truncate text-xs text-muted-foreground">{row.original.email}</span>
            </span>
          </Link>
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
                    className="flex items-center gap-2"
                  >
                    <span className="text-sm text-muted-foreground" aria-live="polite">
                      {tc('selectedCount', { count: selectedIds.length })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setToRemove(selectedIds);
                        setDialog('remove');
                      }}
                    >
                      <UserMinusIcon /> {t('removeSelected', { count: selectedIds.length })}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              {canManage && (
                <Button size="sm" onClick={() => setDialog('add')}>
                  <UserPlusIcon /> {t('add')}
                </Button>
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
                  <Button size="sm" variant="outline" onClick={() => setDialog('add')}>
                    <UserPlusIcon /> {t('add')}
                  </Button>
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
    <Dialog open={open} onOpenChange={close}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('addTitle', { group: group.name })}</DialogTitle>
          <DialogDescription>{t('addDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={pickerId}>{t('pickLabel')}</Label>
          <UserPicker
            id={pickerId}
            value={null}
            placeholder={t('pickPlaceholder')}
            excludeIds={people.map((p) => p.id)}
            onChange={(u) => {
              if (u) setPeople((prev) => (prev.some((p) => p.id === u.id) ? prev : [...prev, u]));
            }}
          />
        </div>
        <div className="rounded-lg border">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
            <span aria-live="polite">{t('picked', { count: people.length })}</span>
            {people.length > 1 && (
              <button
                type="button"
                onClick={() => setPeople([])}
                className="rounded-sm font-medium hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {t('clearList')}
              </button>
            )}
          </div>
          {people.length === 0 ? (
            <p className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <InfoIcon className="size-4" aria-hidden />
              {t('listEmpty')}
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto p-1">
              <AnimatePresence initial={false}>
                {people.map((p) => (
                  <motion.li
                    key={p.id}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, ease: easeOut }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                      <UserAvatar name={p.displayName} className="size-7 text-[10px]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.displayName}</div>
                        {p.email && <div className="truncate text-xs text-muted-foreground">{p.email}</div>}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('removeFromList', { name: p.displayName })}
                        onClick={() => setPeople((prev) => prev.filter((x) => x.id !== p.id))}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            disabled={people.length === 0}
            loading={add.isPending}
            onClick={() => add.mutate(people.map((p) => p.id))}
          >
            <UserPlusIcon /> {t('addConfirm', { count: people.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
