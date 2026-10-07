'use client';

import type { LocalizedText } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { useApiMutation } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { FolderTreeIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import type { z } from 'zod';
import type { Category, TicketType, upsertCategorySchema } from '../../contracts';
import { TYPE_ICON } from '../components/badges';
import { CategorySelect, GroupSelect } from '../components/pickers';
import { INVALIDATE, useCategories } from '../lib';
import { DeleteButton, TypeChecks } from './shared';

type CategoryInput = z.input<typeof upsertCategorySchema>;

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

function CategorySheet({
  category,
  open,
  onOpenChange,
}: {
  category: Category | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('itsm.settingsPage.categories');
  const tc = useTranslations('common');
  const id = useId();
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [name, setName] = useState<LocalizedText>({});
  const [parentId, setParentId] = useState<string | null>(null);
  const [types, setTypes] = useState<TicketType[]>(['incident']);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setKey(category?.key ?? '');
    setKeyTouched(Boolean(category));
    setName(category?.name ?? {});
    setParentId(category?.parentId ?? null);
    setTypes(category?.ticketTypes ?? ['incident', 'service_request']);
    setGroupId(category?.defaultGroup?.id ?? null);
    setActive(category?.active ?? true);
    setSortOrder(category?.sortOrder ?? 0);
    setTouched(false);
  }, [open, category]);

  const save = useApiMutation(
    (api, body: CategoryInput) =>
      category
        ? api.patch<Category>(`/itsm/categories/${category.id}`, body)
        : api.post<Category>('/itsm/categories', body),
    { invalidate: INVALIDATE, success: tc('saved'), onSuccess: () => onOpenChange(false) },
  );
  const remove = useApiMutation((api) => api.delete(`/itsm/categories/${category!.id}`), {
    invalidate: INVALIDATE,
    success: tc('deleted'),
    onSuccess: () => onOpenChange(false),
  });
  const nameMissing = !Object.values(name).some((v) => v?.trim());
  const keyInvalid = !KEY_RE.test(key);
  const typesMissing = !types.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <form
          noValidate
          className="flex h-full flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (nameMissing || keyInvalid || typesMissing) return;
            save.mutate({
              key,
              name,
              parentId,
              ticketTypes: types,
              defaultGroupId: groupId,
              active,
              sortOrder,
            });
          }}
        >
          <SheetHeader>
            <SheetTitle>{category ? t('editTitle') : t('createTitle')}</SheetTitle>
            <SheetDescription>{t('sheetHint')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-5">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-name`}>{t('name')}</Label>
              <LocalizedInput
                id={`${id}-name`}
                value={name}
                onChange={(v) => {
                  setName(v);
                  if (!keyTouched) setKey(slug(v.en ?? ''));
                }}
                invalid={touched && nameMissing}
                aria-describedby={touched && nameMissing ? `${id}-name-error` : undefined}
              />
              {touched && nameMissing && (
                <p id={`${id}-name-error`} className="text-sm text-destructive">
                  {t('nameRequired')}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-key`}>{t('key')}</Label>
              <Input
                id={`${id}-key`}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value.toLowerCase());
                  setKeyTouched(true);
                }}
                className="font-mono"
                aria-invalid={touched && keyInvalid ? true : undefined}
                aria-describedby={`${id}-key-hint`}
              />
              <p
                id={`${id}-key-hint`}
                className={cn(
                  'text-xs',
                  touched && keyInvalid ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {t('keyHint')}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-parent`}>{t('parent')}</Label>
              <CategorySelect
                id={`${id}-parent`}
                value={parentId}
                onChange={setParentId}
                includeInactive
                excludeId={category?.id}
                noneLabel={t('topLevel')}
              />
            </div>
            <TypeChecks
              label={t('types')}
              value={types}
              onChange={setTypes}
              invalid={touched && typesMissing}
              describedBy={touched && typesMissing ? `${id}-types-error` : undefined}
            />
            {touched && typesMissing && (
              <p id={`${id}-types-error`} className="-mt-3 text-sm text-destructive">
                {t('typesRequired')}
              </p>
            )}
            <div className="grid gap-2">
              <Label htmlFor={`${id}-group`}>{t('defaultGroup')}</Label>
              <GroupSelect
                id={`${id}-group`}
                value={groupId}
                onChange={setGroupId}
                aria-describedby={`${id}-group-hint`}
              />
              <p id={`${id}-group-hint`} className="text-xs text-muted-foreground">
                {t('defaultGroupHint')}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`${id}-order`}>{t('sortOrder')}</Label>
                <Input
                  id={`${id}-order`}
                  type="number"
                  inputMode="numeric"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                />
              </div>
              <div className="flex items-center justify-between gap-3 self-end rounded-lg border px-3 py-2">
                <Label htmlFor={`${id}-active`}>{t('active')}</Label>
                <Switch id={`${id}-active`} checked={active} onCheckedChange={setActive} />
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            {category && (
              <DeleteButton
                title={t('deleteTitle')}
                description={t('deleteBody')}
                onConfirm={() => remove.mutate(undefined)}
                pending={remove.isPending}
              />
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {tc('save')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Ticket categories as a tree, with a create/edit sheet. */
export function CategoriesTab() {
  const t = useTranslations('itsm.settingsPage.categories');
  const tt = useTranslations('itsm');
  const tc = useTranslations('common');
  const { tree, isLoading } = useCategories(undefined, true);
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const edit = (c: Category | null) => {
    setEditing(c);
    setOpen(true);
  };

  return (
    <section className="grid gap-4" aria-labelledby="itsm-categories-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="itsm-categories-title" className="text-lg font-semibold">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button onClick={() => edit(null)}>
          <PlusIcon />
          {t('new')}
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !tree.length ? (
        <EmptyState
          icon={<FolderTreeIcon />}
          title={t('empty')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" aria-label={t('title')}>
          {tree.map((n, i) => (
            <motion.li
              key={n.category.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: Math.min(i, 15) * 0.02 }}
              className={cn(
                'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5',
                !n.category.active && 'bg-muted/30',
              )}
            >
              <div
                className="flex min-w-0 flex-1 items-center gap-2"
                style={{ paddingInlineStart: `${n.depth * 1.25}rem` }}
              >
                {n.depth > 0 && (
                  <span className="text-muted-foreground" aria-hidden>
                    └
                  </span>
                )}
                <span className={cn('truncate font-medium', !n.category.active && 'text-muted-foreground')}>
                  {n.name}
                </span>
                <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
                  {n.category.key}
                </span>
                {!n.category.active && <Badge variant="muted">{t('inactive')}</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {n.category.ticketTypes.map((ty) => {
                    const Icon = TYPE_ICON[ty];
                    return <Icon key={ty} className="size-3.5" aria-hidden />;
                  })}
                  <span className="sr-only">
                    {n.category.ticketTypes.map((ty) => tt(`types.${ty}`)).join(', ')}
                  </span>
                </span>
                {n.category.defaultGroup && (
                  <span className="hidden md:inline">{n.category.defaultGroup.name}</span>
                )}
                <span className="tabular-nums">{t('tickets', { count: n.category.ticketCount })}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => edit(n.category)}
                  aria-label={`${tc('edit')} ${n.path}`}
                >
                  <PencilIcon />
                </Button>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
      <CategorySheet category={editing} open={open} onOpenChange={setOpen} />
    </section>
  );
}
