'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ApiError } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { applyServerErrors, useApiMutation, useErrorText } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  type CreateEndpointInput,
  type EndpointDetail,
  ENDPOINT_KINDS,
  ENDPOINT_METHODS,
  SLUG_RE,
} from '../../contracts';
import { INVALIDATE, useConnections } from '../lib';

/** `Customers by region` → `customers-by-region`. */
export function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

/** New Data API: name, URL slug, method, data connection and kind; the SQL comes next, in the editor. */
export function CreateEndpointDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (e: EndpointDetail) => void;
}) {
  const t = useTranslations('etl.create');
  return (
    // The form mounts when the dialog opens, after the Dialog looked for its title: name it explicitly.
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={512} purpose="form" aria-label={t('title')}>
      {open && <CreateForm onOpenChange={onOpenChange} onCreated={onCreated} />}
    </Dialog>
  );
}

function CreateForm({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: (e: EndpointDetail) => void;
}) {
  const t = useTranslations('etl');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const formId = useId();
  const connections = useConnections('endpoints');
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('create.nameRequired')).max(120),
        slug: z.string().trim().min(2).max(64).regex(SLUG_RE, t('create.slugInvalid')),
        description: z.string().max(2_000),
        method: z.enum(ENDPOINT_METHODS),
        connectionId: z.string().min(1, t('create.connectionRequired')),
        kind: z.enum(ENDPOINT_KINDS),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', slug: '', description: '', method: 'GET', connectionId: '', kind: 'query' },
  });
  const create = useApiMutation(
    (api, body: CreateEndpointInput) => api.post<EndpointDetail>('/etl/endpoints', body),
    {
      invalidate: INVALIDATE,
      success: (e) => t('create.created', { name: e.name }),
      onSuccess: onCreated,
      silent: true,
    },
  );
  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    try {
      await create.mutateAsync({ ...v, description: v.description.trim() || null });
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      form.setError('root', { message: err instanceof ApiError ? errorText(err) : errorText(null) });
    }
  });

  return (
    <Form {...form}>
      <Layout
        header={
          <DialogHeader title={t('create.title')} subtitle={t('create.hint')} onOpenChange={onOpenChange} />
        }
        content={
          <LayoutContent padding={4}>
            <form id={formId} onSubmit={onSubmit} noValidate>
              <FormLayout defaultOptionality="optional">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('fields.name')}
                      isRequired
                      hasAutoFocus
                      placeholder={t('create.namePlaceholder')}
                      value={field.value}
                      onChange={(value) => {
                        field.onChange(value);
                        if (!form.getFieldState('slug').isDirty)
                          form.setValue('slug', slugify(value), { shouldValidate: false });
                      }}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('fields.slug')}
                      isRequired
                      placeholder="customers-by-region"
                      description={t('create.slugHint', { slug: field.value || 'slug' })}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                <Grid columns={{ minWidth: 200 }} gap={4}>
                  <FormField
                    control={form.control}
                    name="method"
                    render={({ field, fieldState }) => (
                      <Selector
                        label={t('fields.method')}
                        isRequired
                        options={ENDPOINT_METHODS.map((m) => ({ value: m, label: m }))}
                        value={field.value}
                        onChange={field.onChange}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="kind"
                    render={({ field, fieldState }) => (
                      <Selector
                        label={t('fields.kind')}
                        isRequired
                        options={ENDPOINT_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
                        value={field.value}
                        onChange={field.onChange}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                </Grid>
                <FormField
                  control={form.control}
                  name="connectionId"
                  render={({ field, fieldState }) => (
                    <Selector
                      label={t('fields.connection')}
                      isRequired
                      placeholder={t('create.pickConnection')}
                      description={t('create.connectionHint')}
                      options={connections.items.map((c) => ({
                        value: c.id,
                        label: `${c.name} · ${t(`engine.${c.engine}`)}${c.readOnly ? ` · ${t('connection.readOnly')}` : ''}`,
                      }))}
                      value={field.value}
                      onChange={field.onChange}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field, fieldState }) => (
                    <TextArea
                      label={t('fields.description')}
                      isOptional
                      rows={3}
                      maxLength={2_000}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                {form.formState.errors.root && (
                  <Banner
                    status="error"
                    title={form.formState.errors.root.message ?? ''}
                    collapsible={false}
                  />
                )}
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button
                label={tc('cancel')}
                variant="ghost"
                type="button"
                onClick={() => onOpenChange(false)}
              />
              <Button
                label={tc('create')}
                variant="primary"
                type="submit"
                form={formId}
                isLoading={create.isPending}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Form>
  );
}
