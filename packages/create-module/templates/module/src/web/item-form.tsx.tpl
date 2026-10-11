'use client';

import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { fieldStatus, Form, FormField } from '@isbp/ui/form';
import { FormDialog } from '@isbp/ui/form-dialog';
import { useApiMutation } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { type CreateItemInput, createItemSchema, type Item } from '../contracts';

const STATUSES = ['draft', 'active', 'archived'] as const;

/**
 * A record form of at most 4 fields lives in a `FormDialog` (more than that: a `Sheet`, see docs/ai/ui-guidelines.md).
 * Every Astryx input draws its own label, hint and error, so a field is one component inside `FormField`; the
 * `Form` provider wraps the dialog (React context crosses the dialog's portal).
 */
export function ItemFormDialog({ open, onOpenChange, item, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; item?: Item; onSaved?: (item: Item) => void }) {
  const t = useTranslations('__ID__');
  const tc = useTranslations('common');
  const form = useForm<CreateItemInput>({ resolver: zodResolver(createItemSchema), defaultValues: { title: '', description: '', status: 'draft' } });

  useEffect(() => {
    if (open) form.reset({ title: item?.title ?? '', description: item?.description ?? '', status: item?.status ?? 'draft' });
  }, [open, item, form]);

  const save = useApiMutation(
    (api, values: CreateItemInput) => (item ? api.patch<Item>(`/__ID__/items/${item.id}`, values) : api.post<Item>('/__ID__/items', values)),
    {
      invalidate: ['/__ID__/'],
      success: item ? t('saved') : t('created'),
      onSuccess: (saved) => {
        onOpenChange(false);
        onSaved?.(saved);
      },
    },
  );

  return (
    <Form {...form}>
      <FormDialog
        isOpen={open}
        onOpenChange={onOpenChange}
        title={item ? t('editTitle') : t('createTitle')}
        subtitle={t('formHint')}
        size="sm"
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
        submitLabel={item ? tc('saveChanges') : tc('create')}
        cancelLabel={tc('cancel')}
        isSubmitting={save.isPending}
        defaultOptionality="optional"
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field, fieldState }) => (
            <TextInput
              label={t('fields.title')}
              isRequired
              hasAutoFocus
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
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
              rows={5}
              value={field.value ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              status={fieldStatus(fieldState)}
            />
          )}
        />
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <Selector
              label={t('fields.status')}
              value={field.value}
              onChange={field.onChange}
              options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))}
            />
          )}
        />
      </FormDialog>
    </Form>
  );
}
