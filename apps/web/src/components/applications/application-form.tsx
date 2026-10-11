'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Application, CreateApplicationInput } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { LockIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { UserPicker } from '@/components/pickers/user-picker';
import { slugify } from '@/components/roles/role-utils';
import { applyServerErrors, useApiMutation, useErrorText } from '@/lib/api';
import { APP_INVALIDATE } from './app-parts';

const KEY_RE = /^[a-z0-9][a-z0-9-_]*$/;

/** Register an application (no `app`) or edit one (`app`; the key is immutable). */
export function ApplicationFormDialog({
  open,
  onOpenChange,
  app,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app?: Application;
}) {
  const t = useTranslations('applications.form');
  const tc = useTranslations('common');
  const router = useRouter();
  const errorText = useErrorText();
  const editing = Boolean(app);
  const list = useFieldList();
  const formId = useId();
  const ownerId = useId();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('validation.name')).max(200, t('validation.nameLong')),
        key: z
          .string()
          .trim()
          .min(2, t('validation.key'))
          .max(64, t('validation.key'))
          .regex(KEY_RE, t('validation.key'))
          .refine((k) => k !== 'isbp', t('validation.keyReserved')),
        description: z.string().trim().max(2000, t('validation.descriptionLong')),
        homepageUrl: z
          .string()
          .trim()
          .max(500, t('validation.url'))
          .refine(
            (v) => v === '' || z.url({ protocol: /^https?$/ }).safeParse(v).success,
            t('validation.url'),
          ),
        owner: z.object({ id: z.string(), displayName: z.string() }).nullable(),
      }),
    [t],
  );
  type Values = z.input<typeof schema>;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', key: '', description: '', homepageUrl: '', owner: null },
  });

  // Reset only when the dialog opens so background refetches never clobber what's being typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    form.reset(
      app
        ? {
            name: app.name,
            key: app.key,
            description: app.description ?? '',
            homepageUrl: app.homepageUrl ?? '',
            owner: app.owner ? { id: app.owner.id, displayName: app.owner.displayName } : null,
          }
        : { name: '', key: '', description: '', homepageUrl: '', owner: null },
    );
  }, [open, app, form]);

  // Suggest a key from the name until the key is edited by hand.
  const name = useWatch({ control: form.control, name: 'name' });
  useEffect(() => {
    if (editing || form.getFieldState('key').isDirty) return;
    form.setValue('key', slugify(name ?? ''), { shouldValidate: form.formState.isSubmitted });
  }, [name, editing, form]);

  const create = useApiMutation(
    (api, body: CreateApplicationInput) => api.post<Application>('/applications', body),
    {
      invalidate: APP_INVALIDATE,
      success: (a) => t('created', { name: a.name }),
      onSuccess: (a) => {
        onOpenChange(false);
        router.push(`/admin/applications/${a.id}`);
      },
      silent: true,
    },
  );
  const update = useApiMutation(
    (api, body: CreateApplicationInput) => {
      const { key: _key, ...rest } = body;
      return api.patch<Application>(`/applications/${app!.id}`, rest);
    },
    {
      invalidate: APP_INVALIDATE,
      success: t('saved'),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const mutation = editing ? update : create;

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    const body: CreateApplicationInput = {
      key: v.key.trim(),
      name: v.name.trim(),
      description: v.description.trim() || null,
      homepageUrl: v.homepageUrl.trim() || null,
      ownerId: v.owner?.id ?? null,
    };
    try {
      await mutation.mutateAsync(body);
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      if (!editing && err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('key', { message: t('validation.keyTaken') }, { shouldFocus: true });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  const owner = useWatch({ control: form.control, name: 'owner' });
  const [description, homepageUrl] = useWatch({
    control: form.control,
    name: ['description', 'homepageUrl'],
  });
  const rootError = form.formState.errors.root?.message;

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form">
      <Form {...form}>
        <Layout
          header={
            <DialogHeader
              title={editing ? t('editTitle', { name: app!.name }) : t('createTitle')}
              subtitle={editing ? t('editDescription') : t('createDescription')}
              onOpenChange={onOpenChange}
            />
          }
          content={
            <LayoutContent padding={4}>
              <form id={formId} onSubmit={onSubmit} noValidate>
                <FormLayout defaultOptionality="optional">
                  <Grid columns={{ minWidth: 220 }} gap={4}>
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field, fieldState }) => (
                        <TextInput
                          label={t('name')}
                          isRequired
                          autoComplete="off"
                          placeholder={t('namePlaceholder')}
                          hasAutoFocus
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
                          isRequired
                          autoComplete="off"
                          isReadOnly={editing}
                          startIcon={editing ? LockIcon : undefined}
                          placeholder="finance-erp"
                          value={field.value ?? ''}
                          onChange={(v) => field.onChange(v.toLowerCase())}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
                  </Grid>
                  <Text type="supporting">{editing ? t('keyLocked') : t('keyHint')}</Text>
                  <Field label={t('owner')} inputID={ownerId} description={t('ownerHint')}>
                    <UserPicker
                      id={ownerId}
                      value={owner}
                      onChange={(u) =>
                        form.setValue('owner', u ? { id: u.id, displayName: u.displayName } : null)
                      }
                      placeholder={t('ownerPlaceholder')}
                    />
                  </Field>
                  <OptionalFields
                    hint={list([t('description'), t('homepageUrl')])}
                    filled={countFilled(description, homepageUrl)}
                  >
                    <FormLayout defaultOptionality="optional">
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field, fieldState }) => (
                          <TextArea
                            label={t('description')}
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
                      <FormField
                        control={form.control}
                        name="homepageUrl"
                        render={({ field, fieldState }) => (
                          <TextInput
                            label={t('homepageUrl')}
                            autoComplete="url"
                            placeholder="https://erp.example.com"
                            description={t('homepageHint')}
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                    </FormLayout>
                  </OptionalFields>
                  {rootError && <Banner status="error" title={rootError} collapsible={false} />}
                </FormLayout>
              </form>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider padding={3}>
              <HStack gap={2} hAlign="end">
                <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
                <Button
                  label={editing ? tc('saveChanges') : t('submit')}
                  variant="primary"
                  isLoading={mutation.isPending}
                  type="submit"
                  form={formId}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Form>
    </Dialog>
  );
}
