'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { createRoleSchema, type PermissionInfo, type Role, updateRoleSchema } from '@isbp/contracts';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId } from 'react';
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

/** A named group of fields: a caption (with an optional note at the end) over a stack of fields. */
function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <VStack gap={4} role="group" aria-labelledby={id}>
      <HStack gap={2} vAlign="center">
        <StackItem size="fill">
          <Text type="label" id={id}>
            {title}
          </Text>
        </StackItem>
        {aside}
      </HStack>
      {children}
    </VStack>
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
            <SheetBody>
              <VStack gap={6}>
                <Section title={t('sections.details')}>
                  <FormLayout defaultOptionality="required">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field, fieldState }) => (
                        <TextInput
                          label={t('name')}
                          autoComplete="off"
                          placeholder={t('namePlaceholder')}
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
                    {!editing && (
                      <FormField
                        control={form.control}
                        name="key"
                        render={({ field, fieldState }) => (
                          <TextInput
                            label={t('key')}
                            autoComplete="off"
                            description={t('keyHint')}
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                    )}
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field, fieldState }) => (
                        <TextArea
                          label={t('description')}
                          isOptional
                          rows={2}
                          placeholder={t('descriptionPlaceholder')}
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
                  </FormLayout>
                </Section>

                {!editing && (
                  <Section
                    title={t('sections.permissions')}
                    aside={
                      <Text type="supporting" hasTabularNumbers>
                        {t('selected', { count: permissions.length })}
                      </Text>
                    }
                  >
                    <Text color="secondary">{t('permissionsHint')}</Text>
                    <PermissionEditor
                      catalog={catalog.data?.items ?? []}
                      loading={catalog.isLoading}
                      value={permissions}
                      onChange={(next) => form.setValue('permissions', next, { shouldDirty: true })}
                    />
                    {form.formState.errors.permissions && (
                      <Banner status="error" title={t('permissionsInvalid')} collapsible={false} />
                    )}
                  </Section>
                )}

                {rootError && <Banner status="error" title={rootError} collapsible={false} />}
              </VStack>
            </SheetBody>
            <SheetFooter>
              <Button
                label={tc('cancel')}
                variant="secondary"
                type="button"
                onClick={() => onOpenChange(false)}
              />
              <Button
                label={editing ? tc('saveChanges') : t('submit')}
                variant="primary"
                isLoading={mutation.isPending}
                type="submit"
              />
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
