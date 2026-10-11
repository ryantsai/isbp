'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createGroupSchema, type Group, updateGroupSchema } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { LockIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef } from 'react';
import { type FieldValues, type Resolver, type UseFormReturn, useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import {
  attributesPayload,
  CustomFieldsSection,
  useApplyEntityErrors,
  useAttributeDefaults,
  useAttributesResolver,
  useEntityFields,
} from '@/components/fields/entity-fields';
import { useApiMutation, useErrorText } from '@/lib/api';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';

type Values = z.input<typeof createGroupSchema>;

/** "Finance & Procurement" → "finance-procurement" (empty for names without latin letters/digits). */
export function suggestKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

const INVALIDATE = ['/groups', '/platform/dashboard', '/audit-logs'];

/** Create (no `group`) or edit (`group`: name + description; the key is immutable). */
export function GroupFormDialog({
  open,
  onOpenChange,
  group,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: Group;
}) {
  const t = useTranslations('groups.form');
  const tc = useTranslations('common');
  const router = useRouter();
  const errorText = useErrorText();
  const editing = Boolean(group);
  const formId = useId();

  const custom = useEntityFields('core.group', open);
  const applyErrors = useApplyEntityErrors();
  const resolver = useAttributesResolver(
    zodResolver(
      editing ? (updateGroupSchema as unknown as typeof createGroupSchema) : createGroupSchema,
    ) as Resolver<Values>,
    custom.fields,
  );

  const form = useForm<Values>({
    resolver,
    defaultValues: { key: '', name: '', description: '' },
  });

  // Reset only when the dialog opens, so background refetches never clobber what's being typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    form.reset(
      group
        ? { key: group.key, name: group.name, description: group.description ?? '' }
        : { key: '', name: '', description: '' },
    );
  }, [open, group, form]);
  useAttributeDefaults(
    form as unknown as UseFormReturn<FieldValues>,
    custom.fields,
    custom.ready,
    open,
    group?.attributes,
  );

  // Suggest a key from the name until the key is edited by hand.
  const name = useWatch({ control: form.control, name: 'name' });
  useEffect(() => {
    if (editing || form.getFieldState('key').isDirty) return;
    form.setValue('key', suggestKey(name ?? ''), { shouldValidate: form.formState.isSubmitted });
  }, [name, editing, form]);

  const create = useApiMutation((api, values: Values) => api.post<Group>('/groups', values), {
    invalidate: INVALIDATE,
    success: (g) => t('created', { name: g.name }),
    onSuccess: (g) => {
      onOpenChange(false);
      router.push(`/admin/groups/${g.id}`);
    },
    silent: true,
  });
  const update = useApiMutation((api, values: Values) => api.patch<Group>(`/groups/${group!.id}`, values), {
    invalidate: INVALIDATE,
    success: t('saved'),
    onSuccess: () => onOpenChange(false),
    silent: true,
  });
  const mutation = editing ? update : create;

  const onSubmit = form.handleSubmit(async (values) => {
    const description = values.description?.trim() ? values.description.trim() : null;
    // Custom-field values only once their definitions are loaded (never wipe them by accident).
    const customValues = custom.ready
      ? { attributes: attributesPayload(custom.fields, values.attributes) }
      : {};
    try {
      await mutation.mutateAsync(
        editing
          ? ({ name: values.name, description, ...customValues } as Values)
          : { ...values, description, attributes: undefined, ...customValues },
      );
    } catch (err) {
      if (applyErrors(err, form.setError as never)) return;
      if (!editing && err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('key', { message: t('keyTaken') }, { shouldFocus: true });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={512} purpose="form">
      <Form {...form}>
        <Layout
          header={
            <DialogHeader
              title={editing ? t('editTitle', { name: group!.name }) : t('createTitle')}
              subtitle={editing ? t('editDescription') : t('createDescription')}
              onOpenChange={onOpenChange}
            />
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
                        label={t('name')}
                        autoComplete="off"
                        placeholder={t('namePlaceholder')}
                        hasAutoFocus
                        isRequired
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
                        isRequired
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
                        rows={3}
                        placeholder={t('descriptionPlaceholder')}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <CustomFieldsSection
                    elements={custom.elements}
                    form={form as unknown as UseFormReturn<FieldValues>}
                    className="pt-1"
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
                <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
                <Button
                  label={editing ? tc('saveChanges') : tc('create')}
                  variant="primary"
                  type="submit"
                  form={formId}
                  isLoading={mutation.isPending}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Form>
    </Dialog>
  );
}
