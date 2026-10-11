'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from '@astryxdesign/core/Table';
import { localize } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { LockIcon, PencilIcon, PlusIcon, ShapesIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { CiClass } from '../../contracts';
import { ClassSheet } from '../class-sheet';
import { ClassIcon } from '../class-icon';
import { ConfirmDialog } from '../confirm-dialog';
import { INVALIDATE, useClasses } from '../data';

/** Admin list of CI classes with create / edit (sheet) and delete for unused custom classes. */
export default function ClassesPage() {
  const t = useTranslations('cmdb.classes');
  const tc = useTranslations('common');
  const locale = useLocale();
  const canManage = useCan('cmdb.classes.manage');
  const { classes, isLoading, error, refetch } = useClasses();
  const [editing, setEditing] = useState<CiClass | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState<CiClass | null>(null);
  const remove = useApiMutation((api, key: string) => api.delete(`/cmdb/classes/${key}`), {
    invalidate: INVALIDATE,
    success: t('deleted'),
    onSuccess: () => setDeleting(null),
  });

  if (!canManage) return <EmptyState icon={<LockIcon />} title={tc('noResults')} />;

  const open = (cls: CiClass | null) => {
    setEditing(cls);
    setSheetOpen(true);
  };

  return (
    <div>
      <PageHeader
        back={{ href: '/cmdb', label: t('back') }}
        title={t('title')}
        description={t('description')}
        actions={
          <Button
            label={t('new')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => open(null)}
          />
        }
      />
      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : error && !classes.length ? (
        <ErrorState kind="list" error={error} onRetry={() => refetch()} className="rounded-xl border" />
      ) : !classes.length ? (
        <EmptyState
          icon={<ShapesIcon />}
          title={tc('noResults')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table aria-label={t('title')}>
            <TableHeader>
              <TableRow isHeaderRow>
                <TableHeaderCell className="whitespace-nowrap">{t('columns.class')}</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell max-w-none whitespace-nowrap">
                  {t('columns.type')}
                </TableHeaderCell>
                <TableHeaderCell className="text-right max-w-none whitespace-nowrap">
                  {t('columns.cis')}
                </TableHeaderCell>
                <TableHeaderCell className="max-w-none whitespace-nowrap">
                  <span className="sr-only">{tc('actions')}</span>
                </TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.map((c) => {
                const name = localize(c.name, locale);
                const locked = c.system || c.ciCount > 0;
                return (
                  <TableRow key={c.key}>
                    <TableCell className="max-w-80 whitespace-normal">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                          <ClassIcon name={c.icon} className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{name}</div>
                          {c.description && (
                            <div className="line-clamp-1 text-xs text-muted-foreground">
                              {localize(c.description, locale)}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-none whitespace-nowrap md:table-cell">
                      {c.system ? (
                        <Badge
                          variant="neutral"
                          label={t('system')}
                          icon={<Icon icon={LockIcon} size="xsm" />}
                        />
                      ) : (
                        <Badge variant="neutral" label={t('custom')} className="font-normal" />
                      )}
                    </TableCell>
                    <TableCell className="max-w-none whitespace-nowrap text-right text-muted-foreground tabular-nums">
                      <Link href={`/cmdb?class=${c.key}`} className="hover:text-foreground hover:underline">
                        {t('ciCount', { count: c.ciCount })}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-none whitespace-nowrap">
                      <div className="flex justify-end gap-1">
                        <IconButton
                          label={t('edit', { name })}
                          variant="ghost"
                          size="sm"
                          icon={<Icon icon={PencilIcon} />}
                          onClick={() => open(c)}
                        />
                        <IconButton
                          label={t('delete', { name })}
                          variant="ghost"
                          size="sm"
                          icon={<Icon icon={Trash2Icon} />}
                          isDisabled={locked}
                          tooltip={locked ? t('cantDelete') : undefined}
                          onClick={() => setDeleting(c)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ClassSheet open={sheetOpen} onOpenChange={setSheetOpen} cls={editing} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('deleteTitle', { name: deleting ? localize(deleting.name, locale) : '' })}
        description={t('deleteBody')}
        confirmLabel={tc('delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.key)}
      />
    </div>
  );
}
