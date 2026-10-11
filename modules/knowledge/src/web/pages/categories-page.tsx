'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { localize, localizedTextSchema } from '@isbp/sdk';
import { ApiError, useCan } from '@isbp/sdk/web';
import { useListState } from '@isbp/ui/data-table';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { fieldStatus, Form, FormField } from '@isbp/ui/form';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { PageHeader } from '@isbp/ui/page-header';
import { applyServerErrors, useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
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
import { toast } from '@isbp/ui/toast';
import { FolderTreeIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { Category, CreateCategoryInput, UpdateCategoryInput } from '../../contracts';
import { CategoryIcon, KnowledgeSections } from '../parts';

const NONE = '__none';
const CATEGORIES_HREF = '/knowledge/categories';

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
  const descriptionValue = useWatch({ control: form.control, name: 'description' });
  const list = useFieldList();
  const id = useId();
  const hasDescription = Object.values(descriptionValue).some((x) => Boolean(x?.trim()));

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
            <SheetBody>
              <FormLayout defaultOptionality="optional">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <Field
                      label={t('name')}
                      inputID={`${id}-name`}
                      isRequired
                      status={fieldState.error ? { type: 'error', message: t('errors.name') } : undefined}
                    >
                      <LocalizedInput
                        id={`${id}-name`}
                        value={field.value}
                        onChange={field.onChange}
                        invalid={Boolean(fieldState.error)}
                      />
                    </Field>
                  )}
                />
                <FormField
                  control={form.control}
                  name="key"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('key')}
                      isRequired
                      description={t('keyHint')}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      isDisabled={Boolean(category)}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name="parentId"
                  render={({ field, fieldState }) => (
                    <Selector
                      label={t('parent')}
                      hasSearch={parents.length > 8}
                      value={field.value}
                      onChange={field.onChange}
                      status={fieldStatus(fieldState)}
                      options={[
                        { value: NONE, label: t('noParent') },
                        ...parents.map((c) => ({ value: c.id, label: localize(c.name, locale) || c.key })),
                      ]}
                    />
                  )}
                />
                <OptionalFields
                  hint={list([t('descriptionLabel'), t('icon'), t('sortOrder')])}
                  filled={countFilled(hasDescription, icon === 'book-open' ? '' : icon)}
                >
                  <FormLayout defaultOptionality="optional">
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <Field label={t('descriptionLabel')} inputID={`${id}-description`} isOptional>
                          <LocalizedInput
                            id={`${id}-description`}
                            multiline
                            value={field.value}
                            onChange={field.onChange}
                          />
                        </Field>
                      )}
                    />
                    <Grid columns={{ minWidth: 200 }} gap={4}>
                      <FormField
                        control={form.control}
                        name="icon"
                        render={({ field, fieldState }) => (
                          <TextInput
                            label={t('icon')}
                            description={t('iconHint')}
                            startIcon={<CategoryIcon name={icon} />}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="sortOrder"
                        render={({ field, fieldState }) => (
                          <NumberInput
                            label={t('sortOrder')}
                            description={t('sortOrderHint')}
                            min={0}
                            max={10000}
                            value={Number.isFinite(field.value) ? field.value : null}
                            onChange={(v) => field.onChange(v ?? Number.NaN)}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                    </Grid>
                  </FormLayout>
                </OptionalFields>
              </FormLayout>
            </SheetBody>
            <SheetFooter>
              <Button label={tc('cancel')} variant="secondary" type="button" onClick={onClose} />
              <Button
                label={category ? tc('saveChanges') : tc('create')}
                variant="primary"
                isLoading={save.isPending}
                type="submit"
              />
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
          <Button
            label={t('add')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => set({ create: '1', edit: undefined })}
          />
        }
      />
      <KnowledgeSections />
      <div className="overflow-hidden rounded-xl border bg-card">
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
            <TableHeader>
              <TableRow isHeaderRow>
                <TableHeaderCell>{t('name')}</TableHeaderCell>
                <TableHeaderCell className="hidden max-w-none whitespace-nowrap md:table-cell">
                  {t('key')}
                </TableHeaderCell>
                <TableHeaderCell className="hidden max-w-none whitespace-nowrap sm:table-cell">
                  {t('parent')}
                </TableHeaderCell>
                <TableHeaderCell className="max-w-none text-right whitespace-nowrap">
                  {t('articles')}
                </TableHeaderCell>
                <TableHeaderCell className="w-12 max-w-none">
                  <span className="sr-only">{tc('actions')}</span>
                </TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => {
                const parent = c.parentId ? byId.get(c.parentId) : null;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="w-full max-w-0 whitespace-normal">
                      <HStack gap={3} vAlign="center">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
                          <CategoryIcon name={c.icon} />
                        </span>
                        <VStack gap={0} className="min-w-0">
                          {/* The name opens the category, like a row link elsewhere. */}
                          <Link
                            href={`${CATEGORIES_HREF}?edit=${encodeURIComponent(c.id)}`}
                            weight="medium"
                            color="primary"
                            maxLines={1}
                          >
                            {nameOf(c)}
                          </Link>
                          {c.description && (
                            <Text type="supporting" maxLines={1}>
                              {localize(c.description, locale)}
                            </Text>
                          )}
                          {parent && (
                            <span className="sm:hidden">
                              <Text type="supporting" maxLines={1}>
                                {t('under', { parent: nameOf(parent) })}
                              </Text>
                            </span>
                          )}
                        </VStack>
                      </HStack>
                    </TableCell>
                    <TableCell className="hidden max-w-none whitespace-nowrap md:table-cell">
                      <Text type="code" color="secondary" textWrap="nowrap">
                        {c.key}
                      </Text>
                    </TableCell>
                    <TableCell className="hidden max-w-none whitespace-nowrap sm:table-cell">
                      <Text color="secondary" textWrap="nowrap">
                        {parent ? nameOf(parent) : '—'}
                      </Text>
                    </TableCell>
                    <TableCell className="max-w-none text-right tabular-nums">{c.articleCount}</TableCell>
                    <TableCell className="max-w-none">
                      <MoreMenu
                        label={t('rowActions', { name: nameOf(c) })}
                        size="sm"
                        alignment="end"
                        items={[
                          {
                            label: tc('edit'),
                            icon: PencilIcon,
                            onClick: () => set({ edit: c.id, create: undefined }),
                          },
                          { type: 'divider' },
                          {
                            label: tc('delete'),
                            icon: Trash2Icon,
                            variant: 'destructive',
                            onClick: () => setDeleting(c),
                          },
                        ]}
                      />
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
              <Button
                label={t('add')}
                variant="primary"
                size="sm"
                icon={<Icon icon={PlusIcon} />}
                onClick={() => set({ create: '1', edit: undefined })}
              />
            }
          />
        )}
      </div>

      <CategorySheet open={sheetOpen} onClose={closeSheet} category={editing} all={items} />
      <AlertDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('deleteTitle')}
        description={t('deleteDescription', { name: deleting ? nameOf(deleting) : '' })}
        actionLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        isActionLoading={remove.isPending}
        onAction={() => deleting && remove.mutate(deleting, { onSettled: () => setDeleting(null) })}
      />
    </>
  );
}
