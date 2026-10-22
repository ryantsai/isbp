'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Field } from '@astryxdesign/core/Field';
import { Grid } from '@astryxdesign/core/Grid';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateFormInput, FormDetail } from '@isbp/contracts';
import { type LocalizedText, localizedTextSchema } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { FormDialog } from '@isbp/ui/form-dialog';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useMemo, useRef } from 'react';
import { type UseFormReturn, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { suggestKey } from '@/components/groups/group-form';
import { applyServerErrors, useApiMutation, useErrorText } from '@/lib/api';
import { CategoryInput, IconPicker } from './form-inputs';

interface Values {
  name: LocalizedText;
  key: string;
  description: LocalizedText;
  icon: string;
  category: string;
}

const EMPTY: Values = { name: {}, key: '', description: {}, icon: 'file-text', category: '' };

/** The optional fields with how many are filled in: only this re-renders as they change, not the whole dialog. */
function OptionalFormFields({
  form,
  hint,
  children,
}: {
  form: UseFormReturn<Values>;
  hint: string;
  children: ReactNode;
}) {
  const [description, category] = useWatch({ control: form.control, name: ['description', 'category'] });
  return (
    <OptionalFields
      hint={hint}
      filled={countFilled(
        Object.values(description ?? {}).some((x) => x?.trim()),
        category,
      )}
    >
      {children}
    </OptionalFields>
  );
}

/** New form: name, key (from the English name until edited), description, icon and category. */
export function CreateFormDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: readonly string[];
}) {
  const t = useTranslations('forms.create');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrorText();
  const list = useFieldList();
  const formId = useId();

  const schema = useMemo(
    () =>
      z.object({
        name: z.custom<LocalizedText>((v) => localizedTextSchema.safeParse(v).success, t('nameRequired')),
        key: z
          .string()
          .trim()
          .min(2, t('keyInvalid'))
          .max(64, t('keyInvalid'))
          .regex(/^[a-z0-9][a-z0-9-_]*$/, t('keyInvalid')),
        description: z.custom<LocalizedText>(),
        icon: z.string(),
        category: z.string().trim().max(64),
      }),
    [t],
  );
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (opening) form.reset(EMPTY);
  }, [open, form]);

  // The key follows the English name (or any latin name) until it is edited by hand. It listens to the name rather than
  // watching it, which re-rendered the whole dialog (and the icon list) on every keystroke.
  useEffect(() => {
    const follow = () => {
      if (form.getFieldState('key').isDirty) return;
      const name = form.getValues('name');
      form.setValue('key', suggestKey(name?.en || name?.[locale as keyof LocalizedText] || ''), {
        shouldValidate: form.formState.isSubmitted,
      });
    };
    follow();
    return form.subscribe({ name: 'name', formState: { values: true }, callback: follow });
  }, [locale, form]);

  const create = useApiMutation((api, body: CreateFormInput) => api.post<FormDetail>('/forms', body), {
    invalidate: ['/forms', '/audit-logs'],
    success: t('created'),
    onSuccess: (f) => router.push(`/admin/forms/${f.id}`),
    silent: true,
  });

  const onSubmit = form.handleSubmit(async (v) => {
    const description = Object.values(v.description ?? {}).some((x) => x?.trim()) ? v.description : null;
    try {
      await create.mutateAsync({
        key: v.key.trim(),
        name: v.name,
        description,
        icon: v.icon,
        category: v.category.trim() || null,
      });
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('key', { message: t('keyTaken') }, { shouldFocus: true });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  return (
    <Form {...form}>
      <FormDialog
        isOpen={open}
        onOpenChange={onOpenChange}
        title={t('title')}
        subtitle={t('description')}
        size="lg"
        onSubmit={onSubmit}
        submitLabel={t('submit')}
        cancelLabel={tc('cancel')}
        isSubmitting={create.isPending}
        defaultOptionality="optional"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field label={t('name')} inputID={`${formId}-name`} isRequired status={fieldStatus(fieldState)}>
              <LocalizedInput
                id={`${formId}-name`}
                value={field.value}
                onChange={field.onChange}
                invalid={Boolean(fieldState.error)}
                placeholder={t('namePlaceholder')}
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
              autoComplete="off"
              description={t('keyHint')}
              value={field.value}
              onChange={(v) => field.onChange(v.toLowerCase())}
              onBlur={field.onBlur}
              ref={field.ref}
              status={fieldStatus(fieldState)}
            />
          )}
        />
        <OptionalFormFields form={form} hint={list([t('descriptionLabel'), t('icon'), t('category')])}>
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <Field label={t('descriptionLabel')} inputID={`${formId}-description`}>
                <LocalizedInput
                  id={`${formId}-description`}
                  multiline
                  value={field.value}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          <Grid columns={{ minWidth: 220 }} gap={4}>
            <FormField
              control={form.control}
              name="icon"
              render={({ field }) => (
                <IconPicker label={t('icon')} value={field.value} onChange={field.onChange} />
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <CategoryInput
                  label={t('category')}
                  value={field.value}
                  onChange={field.onChange}
                  suggestions={categories}
                />
              )}
            />
          </Grid>
        </OptionalFormFields>
        {form.formState.errors.root && (
          <Banner status="error" title={form.formState.errors.root.message ?? ''} collapsible={false} />
        )}
      </FormDialog>
    </Form>
  );
}
