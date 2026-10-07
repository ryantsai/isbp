'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { localize, localizedTextSchema } from '@isbp/sdk';
import { ApiError, useCan } from '@isbp/sdk/web';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { EmptyState } from '@isbp/ui/empty-state';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { PageHeader } from '@isbp/ui/page-header';
import { applyServerErrors, useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import { ArrowLeftIcon, FolderTreeIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { Category, CreateCategoryInput, UpdateCategoryInput } from '../../contracts';
import { CategoryIcon } from '../parts';

const NONE = '__none';

function useSchema() {
  const t = useTranslations('knowledge.categoriesAdmin.errors');
  return useMemo(
    () =>
      z.object({
        key: z
          .string()
          .trim()
          .min(2, t('key'))
          .max(64, t('key'))
          .regex(/^[a-z0-9][a-z0-9-]*$/, t('key')),
        name: localizedTextSchema,
        description: z.object({
          en: z.string().optional(),
          'zh-TW': z.string().optional(),
          'ja-JP': z.string().optional(),
        }),
        icon: z
          .string()
          .trim()
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, t('icon')),
        parentId: z.string(),
        sortOrder: z.number().int().min(0).max(10_000),
      }),
    [t],
  );
}
type Values = z.infer<ReturnType<typeof useSchema>>;

function CategoryDialog({
  open,
  onOpenChange,
  category,
  all,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: Category | null;
  all: Category[];
}) {
  const t = useTranslations('knowledge.categoriesAdmin');
  const tc = useTranslations('common');
  const locale = useLocale();
  const errorText = useErrorText();
  const schema = useSchema();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { key: '', name: {}, description: {}, icon: 'book-open', parentId: NONE, sortOrder: 0 },
  });
  useEffect(() => {
    if (!open) return;
    form.reset({
      key: category?.key ?? '',
      name: category?.name ?? {},
      description: category?.description ?? {},
      icon: category?.icon ?? 'book-open',
      parentId: category?.parentId ?? NONE,
      sortOrder: category?.sortOrder ?? (all.length + 1) * 10,
    });
  }, [open, category, all.length, form]);
  const icon = useWatch({ control: form.control, name: 'icon' });

  const save = useApiMutation(
    (api, v: Values) => {
      const description = Object.values(v.description).some((x) => x?.trim()) ? v.description : null;
      const parentId = v.parentId === NONE ? null : v.parentId;
      if (category) {
        const patch: UpdateCategoryInput = {
          name: v.name,
          description,
          icon: v.icon,
          parentId,
          sortOrder: v.sortOrder,
        };
        return api.patch<Category>(`/knowledge/categories/${category.id}`, patch);
      }
      const body: CreateCategoryInput = { ...v, description, parentId };
      return api.post<Category>('/knowledge/categories', body);
    },
    {
      invalidate: ['/knowledge/'],
      silent: true,
      success: category ? t('saved') : t('created'),
      onSuccess: () => onOpenChange(false),
    },
  );
  const submit = form.handleSubmit((v) =>
    save.mutate(v, {
      onError: (err) => {
        if (applyServerErrors(err, form.setError)) return;
        if (err instanceof ApiError && err.code === 'CONFLICT')
          form.setError('key', { message: t('errors.keyTaken') });
        else if (err instanceof ApiError && err.code === 'INVALID_PARENT')
          form.setError('parentId', { message: t('errors.parent') });
        else toast.error(errorText(err));
      },
    }),
  );
  // A category can't move under itself or one of its own subcategories.
  const parents = all.filter((c) => c.id !== category?.id && c.parentId !== category?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{category ? t('editTitle') : t('createTitle')}</DialogTitle>
          <DialogDescription>{t('dialogHint')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t('name')}</FormLabel>
                  <FormControl>
                    <LocalizedInput
                      value={field.value}
                      onChange={field.onChange}
                      invalid={Boolean(fieldState.error)}
                    />
                  </FormControl>
                  <FormMessage>{fieldState.error ? t('errors.name') : null}</FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="key"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('key')}</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={Boolean(category)} className="font-mono" />
                  </FormControl>
                  <FormDescription>{t('keyHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('descriptionLabel')}</FormLabel>
                  <FormControl>
                    <LocalizedInput multiline value={field.value} onChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="icon"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('icon')}</FormLabel>
                    <div className="flex items-center gap-2">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
                        <CategoryIcon name={icon} />
                      </span>
                      <FormControl>
                        <Input {...field} className="font-mono" />
                      </FormControl>
                    </div>
                    <FormDescription>{t('iconHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sortOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('sortOrder')}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={10000}
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="parentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('parent')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('noParent')}</SelectItem>
                      {parents.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {localize(c.name, locale) || c.key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={save.isPending}>
                {category ? tc('saveChanges') : tc('create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Category admin: names in three languages, icons, order and nesting. */
export default function CategoriesPage() {
  const t = useTranslations('knowledge.categoriesAdmin');
  const tc = useTranslations('common');
  const tk = useTranslations('knowledge');
  const locale = useLocale();
  const canManage = useCan('knowledge.categories.manage');
  const { data, isLoading } = useApiQuery<{ items: Category[] }>('/knowledge/categories');
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const items = data?.items ?? [];
  const byId = new Map(items.map((c) => [c.id, c]));
  const remove = useApiMutation((api, c: Category) => api.delete(`/knowledge/categories/${c.id}`), {
    invalidate: ['/knowledge/'],
    success: t('deleted'),
  });

  if (!canManage)
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState icon={<LockIcon />} title={t('noAccess')} />
      </>
    );

  return (
    <div className="mx-auto max-w-5xl">
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
        <Link href="/knowledge/manage">
          <ArrowLeftIcon /> {tk('nav.manage')}
        </Link>
      </Button>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <PlusIcon /> {t('add')}
          </Button>
        }
      />
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {isLoading ? (
          <div className="grid gap-px">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-none" />
            ))}
          </div>
        ) : items.length ? (
          <Table aria-label={t('title')}>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('name')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('key')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('parent')}</TableHead>
                <TableHead className="text-right">{t('articles')}</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">{tc('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="max-w-0 w-full">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
                        <CategoryIcon name={c.icon} />
                      </span>
                      <span className="grid min-w-0">
                        <span className="truncate font-medium">{localize(c.name, locale) || c.key}</span>
                        {c.description && (
                          <span className="truncate text-xs text-muted-foreground">
                            {localize(c.description, locale)}
                          </span>
                        )}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {c.key}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    {c.parentId ? localize(byId.get(c.parentId)?.name, locale) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.articleCount}</TableCell>
                  <TableCell>
                    <span className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('editLabel', { name: localize(c.name, locale) || c.key })}
                        onClick={() => {
                          setEditing(c);
                          setOpen(true);
                        }}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        aria-label={t('deleteLabel', { name: localize(c.name, locale) || c.key })}
                        onClick={() => setDeleting(c)}
                      >
                        <Trash2Icon />
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={<FolderTreeIcon />} title={t('empty')} />
        )}
      </div>

      <CategoryDialog open={open} onOpenChange={setOpen} category={editing} all={items} />
      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', {
                name: deleting ? localize(deleting.name, locale) || deleting.key : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && remove.mutate(deleting)}
            >
              {tc('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
