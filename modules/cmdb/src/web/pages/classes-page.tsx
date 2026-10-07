'use client';

import { localize } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import { Hint } from '@isbp/ui/tooltip';
import { ArrowLeftIcon, LockIcon, PencilIcon, PlusIcon, ShapesIcon, Trash2Icon } from 'lucide-react';
import { motion } from 'motion/react';
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
  const { classes, isLoading } = useClasses();
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
    <div className="mx-auto max-w-5xl">
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2 text-muted-foreground">
        <Link href="/cmdb">
          <ArrowLeftIcon /> {t('back')}
        </Link>
      </Button>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={() => open(null)}>
            <PlusIcon /> {t('new')}
          </Button>
        }
      />
      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : !classes.length ? (
        <EmptyState
          icon={<ShapesIcon />}
          title={tc('noResults')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <Table aria-label={t('title')}>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('columns.class')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('columns.key')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('columns.type')}</TableHead>
                <TableHead className="text-right">{t('columns.cis')}</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">{tc('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.map((c, i) => {
                const name = localize(c.name, locale);
                const locked = c.system || c.ciCount > 0;
                return (
                  <motion.tr
                    key={c.key}
                    data-slot="table-row"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: Math.min(i, 12) * 0.02 }}
                    className="border-b transition-colors hover:bg-muted/50"
                  >
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
                    <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                      {c.key}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {c.system ? (
                        <Badge variant="muted">
                          <LockIcon aria-hidden /> {t('system')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="font-normal">
                          {t('custom')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      <Link href={`/cmdb?class=${c.key}`} className="hover:text-foreground hover:underline">
                        {t('ciCount', { count: c.ciCount })}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => open(c)}
                          aria-label={t('edit', { name })}
                        >
                          <PencilIcon />
                        </Button>
                        {locked ? (
                          <Hint label={t('cantDelete')}>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-disabled
                              aria-label={t('delete', { name })}
                              className="cursor-not-allowed text-muted-foreground/50 hover:bg-transparent hover:text-muted-foreground/50"
                              onClick={(e) => e.preventDefault()}
                            >
                              <Trash2Icon />
                            </Button>
                          </Hint>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleting(c)}
                            aria-label={t('delete', { name })}
                          >
                            <Trash2Icon />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </motion.tr>
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
