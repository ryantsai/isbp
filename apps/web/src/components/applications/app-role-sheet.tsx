'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Application, AppPermission, CreateAppRoleInput, Role } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
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
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangleIcon, LockIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
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

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <div className="space-y-0.5">
        <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</legend>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </fieldset>
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
  const permissionsError = form.formState.errors.permissions?.message;

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
            <SheetBody className="space-y-8 py-2">
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
                <FormField
                  control={form.control}
                  name="key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('key')}</FormLabel>
                      <div className="relative">
                        <FormControl>
                          <Input
                            autoComplete="off"
                            spellCheck={false}
                            readOnly={editing}
                            className="font-mono text-sm read-only:bg-muted/50 read-only:text-muted-foreground"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value.toLowerCase())}
                          />
                        </FormControl>
                        {editing && (
                          <LockIcon
                            className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground"
                            aria-hidden
                          />
                        )}
                      </div>
                      <FormDescription>{editing ? t('keyLocked') : t('keyHint')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                        <Textarea rows={2} placeholder={t('descriptionPlaceholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </Section>

              <Section title={t('sections.permissions')} hint={t('permissionsHint')}>
                <FormField
                  control={form.control}
                  name="permissions"
                  render={({ field }) => (
                    <div className="grid gap-2">
                      <AppPermissionPicker
                        catalog={catalog}
                        value={field.value}
                        onChange={(next) => field.onChange(next)}
                        describedBy={permissionsError ? 'app-role-permissions-error' : undefined}
                      />
                      {permissionsError && (
                        <p id="app-role-permissions-error" className="text-xs text-destructive">
                          {permissionsError}
                        </p>
                      )}
                    </div>
                  )}
                />
              </Section>

              <Section title={t('sections.requests')}>
                <RequestSettingsFields value={settings} onChange={setSettings} showErrors={settingsTouched} />
              </Section>

              {rootError && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {rootError}
                </p>
              )}
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                {role ? tc('saveChanges') : t('submit')}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
