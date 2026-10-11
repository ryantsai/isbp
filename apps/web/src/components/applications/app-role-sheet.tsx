'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Application, AppPermission, CreateAppRoleInput, Role } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
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
import { useQueryClient } from '@tanstack/react-query';
import { LockIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  draftEquals,
  draftFromRole,
  draftToBody,
  EMPTY_REQUEST_SETTINGS,
  isDraftValid,
  type RequestSettingsDraft,
  RequestSettingsFields,
} from '@/components/roles/request-settings';
import { slugify } from '@/components/roles/role-utils';
import { applyServerErrors, invalidatePaths, useApiMutation, useErrorText } from '@/lib/api';
import { APP_INVALIDATE } from './app-parts';
import { AppPermissionPicker, isAppPattern } from './app-permission-picker';

const KEY_RE = /^[a-z0-9][a-z0-9-_]*$/;

/** The role was saved but its request settings were not. */
class SettingsSaveError extends Error {
  constructor(override readonly cause: unknown) {
    super('Request settings were not saved');
  }
}

/** A named group of fields: a caption over a stack of fields. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <VStack gap={4} role="group" aria-labelledby={id}>
      <Text type="label" id={id}>
        {title}
      </Text>
      {children}
    </VStack>
  );
}

/**
 * Create (no `role`) or edit an application role: details, permissions from the app's catalog (or
 * wildcard patterns) and its self-service request settings — saved with two calls when both change.
 */
export function AppRoleSheet({
  app,
  catalog,
  open,
  onOpenChange,
  role: roleProp,
}: {
  app: Application;
  catalog: readonly AppPermission[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: Role | null;
}) {
  const t = useTranslations('applications.roleForm');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const client = useQueryClient();
  // A role created in this sheet whose request settings then failed: keep editing it.
  const [created, setCreated] = useState<Role | null>(null);
  const role = roleProp ?? created;
  const editing = Boolean(role);

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('validation.name')).max(200, t('validation.nameLong')),
        key: z
          .string()
          .trim()
          .min(2, t('validation.key'))
          .max(64, t('validation.key'))
          .regex(KEY_RE, t('validation.key')),
        description: z.string().trim().max(2000, t('validation.descriptionLong')),
        permissions: z
          .array(z.string())
          .max(500)
          .refine((ps) => ps.every(isAppPattern), t('validation.permissions')),
      }),
    [t],
  );
  type Values = z.input<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', key: '', description: '', permissions: [] },
  });
  const [settings, setSettings] = useState<RequestSettingsDraft>(EMPTY_REQUEST_SETTINGS);
  const [settingsTouched, setSettingsTouched] = useState(false);

  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setCreated(null);
    setSettingsTouched(false);
    form.reset(
      roleProp
        ? {
            name: roleProp.name,
            key: roleProp.key,
            description: roleProp.description ?? '',
            permissions: roleProp.permissions,
          }
        : { name: '', key: '', description: '', permissions: [] },
    );
    setSettings(roleProp ? draftFromRole(roleProp) : EMPTY_REQUEST_SETTINGS);
  }, [open, roleProp, form]);

  const name = useWatch({ control: form.control, name: 'name' });
  useEffect(() => {
    if (editing || form.getFieldState('key').isDirty) return;
    form.setValue('key', slugify(name ?? ''), { shouldValidate: form.formState.isSubmitted });
  }, [name, editing, form]);

  const base = `/applications/${app.id}/roles`;
  const mutation = useApiMutation(
    async (api, v: { body: CreateAppRoleInput; detailsChanged: boolean; settings: RequestSettingsDraft }) => {
      let saved = role;
      if (!saved) saved = await api.post<Role>(base, v.body);
      else if (v.detailsChanged) saved = await api.put<Role>(`${base}/${saved.id}`, v.body);
      const before = draftFromRole(saved);
      if (!draftEquals(before, v.settings)) {
        try {
          saved = await api.put<Role>(`${base}/${saved.id}/request-settings`, draftToBody(v.settings));
        } catch (err) {
          if (!role) setCreated(saved);
          throw new SettingsSaveError(err);
        }
      }
      return saved;
    },
    {
      invalidate: APP_INVALIDATE,
      success: (r) => (editing ? t('saved') : t('created', { name: r.name })),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    setSettingsTouched(true);
    if (!isDraftValid(settings)) return;
    const body: CreateAppRoleInput = {
      key: v.key.trim(),
      name: v.name.trim(),
      description: v.description.trim() || null,
      permissions: [...new Set(v.permissions)].sort(),
    };
    const detailsChanged =
      !role ||
      role.name !== body.name ||
      (role.description ?? null) !== body.description ||
      [...role.permissions].sort().join('\n') !== body.permissions!.join('\n');
    try {
      await mutation.mutateAsync({ body, detailsChanged, settings });
    } catch (err) {
      if (err instanceof SettingsSaveError) {
        // The role itself was saved — refresh the lists even though its settings weren't.
        void invalidatePaths(client, APP_INVALIDATE);
        form.setError('root', { message: t('settingsFailed', { error: errorText(err.cause) }) });
        return;
      }
      if (applyServerErrors(err, form.setError as never)) return;
      if (!role && err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('key', { message: t('validation.keyTaken') }, { shouldFocus: true });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  const rootError = form.formState.errors.root?.message;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{role ? t('editTitle', { name: role.name }) : t('createTitle')}</SheetTitle>
          <SheetDescription>
            {role ? t('editDescription') : t('createDescription', { app: app.name })}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody>
              <VStack gap={5}>
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
                    <FormField
                      control={form.control}
                      name="key"
                      render={({ field, fieldState }) => (
                        <TextInput
                          label={t('key')}
                          autoComplete="off"
                          isReadOnly={editing}
                          startIcon={editing ? LockIcon : undefined}
                          description={editing ? t('keyLocked') : t('keyHint')}
                          value={field.value ?? ''}
                          onChange={(v) => field.onChange(v.toLowerCase())}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
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

                <FormField
                  control={form.control}
                  name="permissions"
                  render={({ field, fieldState }) => (
                    <AppPermissionPicker
                      label={t('sections.permissions')}
                      description={t('permissionsHint')}
                      catalog={catalog}
                      value={field.value}
                      onChange={(next) => field.onChange(next)}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />

                <Section title={t('sections.requests')}>
                  <RequestSettingsFields
                    value={settings}
                    onChange={setSettings}
                    showErrors={settingsTouched}
                  />
                </Section>

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
                label={role ? tc('saveChanges') : t('submit')}
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
