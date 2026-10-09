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
import { useListState } from '@isbp/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
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
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import { EllipsisIcon, FolderTreeIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { Category, CreateCategoryInput, UpdateCategoryInput } from '../../contracts';
import { CategoryIcon, KnowledgeSections } from '../parts';

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

/** New and edit form in a side sheet (`?create=1`, `?edit=<id>`), asking before closing with unsaved changes. */
function CategorySheet({
  open,
  onClose,
  category,
  all,
}: {
  open: boolean;
  onClose: () => void;
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
      onSuccess: () => onClose(),
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
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="sm:max-w-xl" dirty={form.formState.isDirty && !save.isPending}>
        <SheetHeader>
          <SheetTitle>{category ? t('editTitle') : t('createTitle')}</SheetTitle>
          <SheetDescription>{t('dialogHint')}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <SheetForm onSubmit={submit} noValidate>
            <SheetBody className="grid content-start gap-4">
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
                      <FormDescription>{t('sortOrderHint')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={save.isPending}>
                {category ? tc('saveChanges') : tc('create')}
              </Button>
            </SheetFooter>
          </SheetForm>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

/** Category admin: names in three languages, icons, order and nesting. */
export default function CategoriesPage() {
  const t = useTranslations('knowledge.categoriesAdmin');
  const tc = useTranslations('common');
  const locale = useLocale();
  const canManage = useCan('knowledge.categories.manage');
  const { data, isLoading, error, refetch } = useApiQuery<{ items: Category[] }>('/knowledge/categories');
  const [state, set] = useListState();
  const [deleting, setDeleting] = useState<Category | null>(null);
  const items = data?.items ?? [];
  const byId = new Map(items.map((c) => [c.id, c]));
  const editing = state.edit ? (byId.get(String(state.edit)) ?? null) : null;
  const sheetOpen = state.create === '1' || Boolean(editing);
  const closeSheet = () => set({ create: undefined, edit: undefined });
  const nameOf = (c: Category) => localize(c.name, locale) || c.key;
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
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={() => set({ create: '1', edit: undefined })}>
            <PlusIcon /> {t('add')}
          </Button>
        }
      />
      <KnowledgeSections />
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {isLoading ? (
          <div className="grid gap-px">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-none" />
            ))}
          </div>
        ) : error && !data ? (
          <ErrorState error={error} onRetry={() => refetch()} kind="list" />
        ) : items.length ? (
          <Table aria-label={t('title')}>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('name')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('key')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('parent')}</TableHead>
                <TableHead className="text-right">{t('articles')}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{tc('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => {
                const parent = c.parentId ? byId.get(c.parentId) : null;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-0 w-full">
                      {/* The name opens the category, like a row link elsewhere. */}
                      <button
                        type="button"
                        onClick={() => set({ edit: c.id, create: undefined })}
                        className="group flex w-full min-w-0 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
                          <CategoryIcon name={c.icon} />
                        </span>
                        <span className="grid min-w-0">
                          <span className="truncate font-medium group-hover:underline">{nameOf(c)}</span>
                          {c.description && (
                            <span className="truncate text-xs text-muted-foreground">
                              {localize(c.description, locale)}
                            </span>
                          )}
                          {parent && (
                            <span className="truncate text-xs text-muted-foreground sm:hidden">
                              {t('under', { parent: nameOf(parent) })}
                            </span>
                          )}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                      {c.key}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {parent ? nameOf(parent) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.articleCount}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('rowActions', { name: nameOf(c) })}
                          >
                            <EllipsisIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-40">
                          <DropdownMenuItem onSelect={() => set({ edit: c.id, create: undefined })}>
                            <PencilIcon /> {tc('edit')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                            <Trash2Icon /> {tc('delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={<FolderTreeIcon />}
            title={t('empty')}
            action={
              <Button size="sm" onClick={() => set({ create: '1', edit: undefined })}>
                <PlusIcon /> {t('add')}
              </Button>
            }
          />
        )}
      </div>

      <CategorySheet open={sheetOpen} onClose={closeSheet} category={editing} all={items} />
      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', { name: deleting ? nameOf(deleting) : '' })}
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
    </>
  );
}
