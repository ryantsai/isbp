'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createRoleSchema, type PermissionInfo, type Role, updateRoleSchema } from '@isbp/contracts';
import { Button } from '@isbp/ui/button';
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
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Textarea } from '@isbp/ui/textarea';
import { AlertTriangleIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { applyServerErrors, useApiMutation, useApiQuery } from '@/lib/api';
import { PermissionEditor } from './permission-editor';
import { isKeyConflict, normalizePermissions, slugify, useAccessErrorText } from './role-utils';

type Values = z.input<typeof createRoleSchema>;

export interface RoleTemplate {
  name: string;
  description: string | null;
  permissions: string[];
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 flex w-full items-center justify-between text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
        {aside}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Create a custom role (optionally from a `template`, e.g. "duplicate"), or edit an existing role's
 * name and description (`role`). Permissions of an existing role are edited on its detail page.
 */
export function RoleFormSheet({
  open,
  onOpenChange,
  role,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: Role;
  template?: RoleTemplate;
}) {
  const t = useTranslations('roles.form');
  const tc = useTranslations('common');
  const router = useRouter();
  const accessError = useAccessErrorText();
  const editing = Boolean(role);
  const catalog = useApiQuery<{ items: PermissionInfo[] }>(open && !editing ? '/permissions' : null);

  const form = useForm<Values>({
    resolver: zodResolver(
      editing ? (updateRoleSchema as unknown as typeof createRoleSchema) : createRoleSchema,
    ),
    defaultValues: { key: '', name: '', description: '', permissions: [] },
  });

  useEffect(() => {
    if (!open) return;
    if (role)
      form.reset({
        key: role.key,
        name: role.name,
        description: role.description ?? '',
        permissions: role.permissions,
      });
    else if (template)
      form.reset({
        key: '',
        name: template.name,
        description: template.description ?? '',
        permissions: template.permissions,
      });
    else form.reset({ key: '', name: '', description: '', permissions: [] });
  }, [open, role, template, form]);

  // Suggest a key from the name while creating, until the key is edited by hand.
  const name = useWatch({ control: form.control, name: 'name' });
  useEffect(() => {
    if (editing || form.getFieldState('key').isDirty) return;
    form.setValue('key', slugify(name ?? ''));
  }, [name, editing, form]);

  const permissions = useWatch({ control: form.control, name: 'permissions' }) ?? [];

  const create = useApiMutation((api, values: Values) => api.post<Role>('/roles', values), {
    invalidate: ['/roles', '/platform/dashboard', '/audit-logs'],
    success: (r) => t('created', { name: r.name }),
    onSuccess: (r) => {
      onOpenChange(false);
      router.push(`/admin/roles/${r.id}`);
    },
    silent: true,
  });
  const update = useApiMutation(
    (api, values: Values) =>
      api.patch<Role>(`/roles/${role!.id}`, { name: values.name, description: values.description || null }),
    {
      invalidate: ['/roles', '/audit-logs'],
      success: t('saved'),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const mutation = editing ? update : create;

  const onSubmit = form.handleSubmit(async (values) => {
    const body: Values = {
      ...values,
      description: values.description || null,
      permissions: normalizePermissions(values.permissions ?? []),
    };
    try {
      await mutation.mutateAsync(body);
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      if (isKeyConflict(err)) form.setError('key', { message: accessError(err) });
      else form.setError('root', { message: accessError(err) });
    }
  });

  const rootError = form.formState.errors.root?.message;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={editing ? 'sm:max-w-lg' : 'sm:max-w-2xl'} closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>
            {editing
              ? t('editTitle', { name: role!.name })
              : template
                ? t('duplicateTitle')
                : t('createTitle')}
          </SheetTitle>
          <SheetDescription>{editing ? t('editDescription') : t('createDescription')}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody className="space-y-7 py-2">
              <Section title={t('sections.details')}>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('name')}</FormLabel>
                      <FormControl>
                        <Input autoComplete="off" placeholder={t('namePlaceholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {!editing && (
                  <FormField
                    control={form.control}
                    name="key"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('key')}</FormLabel>
                        <FormControl>
                          <Input autoComplete="off" spellCheck={false} className="font-mono" {...field} />
                        </FormControl>
                        <FormDescription>{t('keyHint')}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('description')}{' '}
                        <span className="font-normal text-muted-foreground">({tc('optional')})</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          rows={2}
                          placeholder={t('descriptionPlaceholder')}
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </Section>

              {!editing && (
                <Section
                  title={t('sections.permissions')}
                  aside={
                    <span className="normal-case tracking-normal tabular-nums">
                      {t('selected', { count: permissions.length })}
                    </span>
                  }
                >
                  <p className="-mt-1 text-sm text-muted-foreground">{t('permissionsHint')}</p>
                  <PermissionEditor
                    catalog={catalog.data?.items ?? []}
                    loading={catalog.isLoading}
                    value={permissions}
                    onChange={(next) => form.setValue('permissions', next, { shouldDirty: true })}
                  />
                  {form.formState.errors.permissions && (
                    <p className="text-xs text-destructive">{t('permissionsInvalid')}</p>
                  )}
                </Section>
              )}

              {rootError && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  {rootError}
                </p>
              )}
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                {editing ? tc('saveChanges') : t('submit')}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
