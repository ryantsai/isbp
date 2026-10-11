'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { type LocalizedText, localizedTextSchema } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { fieldStatus, Form, FormField } from '@isbp/ui/form';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
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
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { CLASS_KEY_RE, type CiClass, type CreateClassInput } from '../contracts';
import { CLASS_ICONS } from './class-icon';
import { INVALIDATE } from './data';

/** Create (no `cls`) or edit a CI class: key, name and description per language, icon and order. */
export function ClassSheet({
  open,
  onOpenChange,
  cls,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cls: CiClass | null;
}) {
  const t = useTranslations('cmdb.classes');
  const tc = useTranslations('common');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{cls ? t('editTitle') : t('createTitle')}</SheetTitle>
          <SheetDescription>{t('formHint')}</SheetDescription>
        </SheetHeader>
        {/* Mounted per opening, so it always starts from the class as it is now. */}
        <ClassForm cls={cls} onDone={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

function ClassForm({ cls, onDone }: { cls: CiClass | null; onDone: () => void }) {
  const t = useTranslations('cmdb.classes');
  const ti = useTranslations('cmdb.icons');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const ids = { name: useId(), description: useId() };
  const schema = useMemo(
    () =>
      z.object({
        key: z.string().trim().regex(CLASS_KEY_RE, t('keyInvalid')),
        name: z.custom<LocalizedText>((v) => localizedTextSchema.safeParse(v).success, t('nameRequired')),
        description: z.custom<LocalizedText>(),
        icon: z.string().min(1),
        sortOrder: z.coerce.number<string | number>().int().min(0).max(10_000),
      }),
    [t],
  );
  type Values = z.input<typeof schema>;
  const form = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      key: cls?.key ?? '',
      name: cls?.name ?? {},
      description: cls?.description ?? {},
      icon: cls?.icon ?? 'box',
      sortOrder: cls?.sortOrder ?? 100,
    },
  });

  const list = useFieldList();
  const watchedDescription = useWatch({ control: form.control, name: 'description' });
  const detailsFilled = countFilled(Object.values(watchedDescription).some((v) => v?.trim()));

  const save = useApiMutation(
    (api, v: z.output<typeof schema>) => {
      const description = Object.values(v.description ?? {}).some(Boolean) ? v.description : null;
      const body = { name: v.name, description, icon: v.icon, sortOrder: v.sortOrder };
      return cls
        ? api.patch<CiClass>(`/cmdb/classes/${cls.key}`, body)
        : api.post<CiClass>('/cmdb/classes', { ...body, key: v.key } satisfies CreateClassInput);
    },
    { invalidate: INVALIDATE, success: cls ? t('saved') : t('created'), onSuccess: onDone, silent: true },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    try {
      await save.mutateAsync(v);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('key', { message: t('keyTaken') }, { shouldFocus: true });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  return (
    <Form {...form}>
      <SheetForm onSubmit={onSubmit} noValidate>
        <SheetBody className="py-2">
          <FormLayout defaultOptionality="optional">
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
                  isDisabled={Boolean(cls)}
                  hasAutoFocus={!cls}
                  status={fieldStatus(fieldState)}
                />
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field label={t('name')} inputID={ids.name} isRequired status={fieldStatus(fieldState)}>
                  <LocalizedInput
                    id={ids.name}
                    value={field.value}
                    onChange={field.onChange}
                    invalid={Boolean(fieldState.error)}
                  />
                </Field>
              )}
            />
            <OptionalFields
              hint={list([t('classDescription'), t('icon'), t('sortOrder')])}
              filled={detailsFilled}
            >
              <FormLayout defaultOptionality="optional">
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <Field label={t('classDescription')} inputID={ids.description} isOptional>
                      <LocalizedInput
                        id={ids.description}
                        multiline
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </Field>
                  )}
                />
                <FormField
                  control={form.control}
                  name="icon"
                  render={({ field }) => (
                    <Selector
                      label={t('icon')}
                      value={field.value}
                      hasSearch
                      onChange={field.onChange}
                      options={Object.entries(CLASS_ICONS).map(([name, glyph]) => ({
                        value: name,
                        label: ti.has(name) ? ti(name) : name,
                        icon: <Icon icon={glyph} />,
                      }))}
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
                      isIntegerOnly
                      width={160}
                      value={field.value === '' || field.value == null ? null : Number(field.value)}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
              </FormLayout>
            </OptionalFields>
            {form.formState.errors.root && (
              <Banner status="error" title={form.formState.errors.root.message ?? ''} collapsible={false} />
            )}
          </FormLayout>
        </SheetBody>
        <SheetFooter>
          <Button label={tc('cancel')} variant="secondary" type="button" onClick={onDone} />
          <Button
            label={cls ? tc('saveChanges') : tc('create')}
            variant="primary"
            isLoading={save.isPending}
            type="submit"
          />
        </SheetFooter>
      </SheetForm>
    </Form>
  );
}
