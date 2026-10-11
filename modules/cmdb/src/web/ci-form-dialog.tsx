'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@isbp/sdk/web';
import { fieldStatus, Form, FormField } from '@isbp/ui/form';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { type FieldValues, useForm, type UseFormReturn, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  CI_CRITICALITIES,
  CI_ENVIRONMENTS,
  CI_STATUSES,
  type CiDetail,
  type CreateCiInput,
} from '../contracts';
import { CRITICALITY_ICON } from './badges';
import { ClassIcon } from './class-icon';
import {
  attributesPayload,
  CustomFieldsSection,
  useApplyServerErrors,
  useAttributeDefaults,
  useAttributesResolver,
  useCiFields,
} from './custom-fields';
import { INVALIDATE, useClasses, useLookup } from './data';
import { TagInput } from './tag-input';

const NONE = '__none__';
/** Lists longer than this get a search box in the dropdown. */
const SEARCH_FROM = 8;

/**
 * Create (no `ci`) or edit a configuration item: identity, lifecycle, ownership, description, tags and
 * the custom fields admins defined for CIs.
 */
export function CiFormDialog({
  open,
  onOpenChange,
  ci,
  defaultClass,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ci?: CiDetail;
  defaultClass?: string;
  onSaved?: (ci: CiDetail) => void;
}) {
  const t = useTranslations('cmdb');
  // The form (and its header) mounts after the dialog opens, so name the dialog here: Astryx reads the title at mount.
  return (
    <Dialog
      isOpen={open}
      onOpenChange={onOpenChange}
      width={672}
      purpose="form"
      aria-label={ci ? t('form.editTitle', { reference: ci.reference }) : t('form.createTitle')}
    >
      {/* Mounted per opening: the form starts from the CI as it is now. */}
      {open && (
        <CiForm
          ci={ci}
          defaultClass={defaultClass}
          onOpenChange={onOpenChange}
          onSaved={(saved) => {
            onOpenChange(false);
            onSaved?.(saved);
          }}
        />
      )}
    </Dialog>
  );
}

function CiForm({
  ci,
  defaultClass,
  onOpenChange,
  onSaved,
}: {
  ci?: CiDetail;
  defaultClass?: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (ci: CiDetail) => void;
}) {
  const t = useTranslations('cmdb');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const applyErrors = useApplyServerErrors();
  const { options: classOptions } = useClasses();
  const groups = useLookup('groups');
  const departments = useLookup('departments');
  const { fields, elements, ready } = useCiFields();
  const [owner, setOwner] = useState<PersonOption | null>(ci?.owner ? { ...ci.owner } : null);
  const ids = { owner: useId(), form: useId() };

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('form.nameRequired')).max(200),
        classKey: z.string().min(1, t('form.classPlaceholder')),
        status: z.enum(CI_STATUSES),
        environment: z.string(),
        criticality: z.enum(CI_CRITICALITIES),
        ownerId: z.string().nullable(),
        supportGroupId: z.string(),
        departmentId: z.string(),
        description: z.string().max(10_000),
        tags: z.array(z.string()).max(20),
        attributes: z.record(z.string(), z.unknown()),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const resolver = useAttributesResolver<Values>(zodResolver(schema), fields);
  const form = useForm<Values>({
    resolver,
    defaultValues: {
      name: ci?.name ?? '',
      classKey: ci?.class.key ?? defaultClass ?? '',
      status: ci?.status ?? 'in_use',
      environment: ci?.environment ?? NONE,
      criticality: ci?.criticality ?? 'medium',
      ownerId: ci?.owner?.id ?? null,
      supportGroupId: ci?.supportGroup?.id ?? NONE,
      departmentId: ci?.department?.id ?? NONE,
      description: ci?.description ?? '',
      tags: ci?.tags ?? [],
      attributes: ci?.attributes ?? {},
    },
  });
  useAttributeDefaults(form as unknown as UseFormReturn<FieldValues>, fields, ready, true, ci?.attributes);
  const list = useFieldList();
  const [environment, departmentId, description, tags] = useWatch({
    control: form.control,
    name: ['environment', 'departmentId', 'description', 'tags'],
  });
  const detailsFilled = countFilled(
    environment === NONE ? '' : environment,
    departmentId === NONE ? '' : departmentId,
    description,
    tags,
  );

  const save = useApiMutation(
    (api, body: CreateCiInput) =>
      ci ? api.patch<CiDetail>(`/cmdb/cis/${ci.id}`, body) : api.post<CiDetail>('/cmdb/cis', body),
    {
      invalidate: INVALIDATE,
      success: (saved) => (ci ? t('form.saved') : t('form.created', { reference: saved.reference })),
      onSuccess: onSaved,
      silent: true,
    },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    const body: CreateCiInput = {
      name: v.name.trim(),
      classKey: v.classKey,
      status: v.status,
      environment: v.environment === NONE ? null : (v.environment as CreateCiInput['environment']),
      criticality: v.criticality,
      ownerId: v.ownerId,
      supportGroupId: v.supportGroupId === NONE ? null : v.supportGroupId,
      departmentId: v.departmentId === NONE ? null : v.departmentId,
      description: v.description.trim() || null,
      tags: v.tags,
      ...(fields.length ? { attributes: attributesPayload(fields, v.attributes) } : {}),
    };
    try {
      await save.mutateAsync(body);
    } catch (err) {
      if (applyErrors(err, form.setError as never)) return;
      form.setError('root', {
        message: err instanceof ApiError ? errorText(err) : errorText(null),
      });
    }
  });

  const select = (
    name: 'supportGroupId' | 'departmentId',
    label: string,
    placeholder: string,
    items: { id: string; name: string }[],
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Selector
          label={label}
          value={field.value}
          hasSearch={items.length > SEARCH_FROM}
          onChange={field.onChange}
          status={fieldStatus(fieldState)}
          options={[
            { value: NONE, label: placeholder },
            ...items.map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
      )}
    />
  );

  return (
    <Layout
      header={
        <DialogHeader
          title={ci ? t('form.editTitle', { reference: ci.reference }) : t('form.createTitle')}
          subtitle={t('form.hint')}
          onOpenChange={onOpenChange}
        />
      }
      content={
        <LayoutContent padding={4}>
          <Form {...form}>
            <form id={ids.form} onSubmit={onSubmit} noValidate>
              <FormLayout defaultOptionality="optional">
                <Grid columns={{ minWidth: 240 }} gap={4}>
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('fields.name')}
                        isRequired
                        hasAutoFocus
                        placeholder={t('form.namePlaceholder')}
                        value={field.value}
                        onChange={(value) => field.onChange(value.slice(0, 200))}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="classKey"
                    render={({ field, fieldState }) => (
                      <Selector
                        label={t('fields.class')}
                        // A searchable Selector is a button: aria-required is not allowed on it.
                        isRequired={classOptions.length <= SEARCH_FROM}
                        value={field.value || undefined}
                        placeholder={t('form.classPlaceholder')}
                        hasSearch={classOptions.length > SEARCH_FROM}
                        onChange={field.onChange}
                        status={fieldStatus(fieldState)}
                        options={classOptions.map((c) => ({
                          value: c.value,
                          label: c.label,
                          icon: <ClassIcon name={c.icon} className="size-4 text-muted-foreground" />,
                        }))}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field, fieldState }) => (
                      <Selector
                        label={t('fields.status')}
                        value={field.value}
                        onChange={field.onChange}
                        status={fieldStatus(fieldState)}
                        options={CI_STATUSES.map((s) => ({
                          value: s,
                          label: t(`status.${s}`),
                        }))}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="criticality"
                    render={({ field, fieldState }) => (
                      <Selector
                        label={t('fields.criticality')}
                        value={field.value}
                        onChange={field.onChange}
                        status={fieldStatus(fieldState)}
                        options={CI_CRITICALITIES.map((c) => ({
                          value: c,
                          label: t(`criticality.${c}`),
                          icon: <Icon icon={CRITICALITY_ICON[c]} />,
                        }))}
                      />
                    )}
                  />
                  <Field
                    label={t('fields.owner')}
                    inputID={ids.owner}
                    status={fieldStatus({ error: form.formState.errors.ownerId })}
                  >
                    <PersonPicker
                      id={ids.owner}
                      value={owner}
                      placeholder={t('form.ownerPlaceholder')}
                      invalid={Boolean(form.formState.errors.ownerId)}
                      onChange={(p) => {
                        setOwner(p);
                        form.setValue('ownerId', p?.id ?? null, { shouldDirty: true });
                        form.clearErrors('ownerId');
                      }}
                    />
                  </Field>
                  {select(
                    'supportGroupId',
                    t('fields.supportGroup'),
                    t('form.groupPlaceholder'),
                    groups.items,
                  )}
                </Grid>

                <OptionalFields
                  hint={list([
                    t('fields.environment'),
                    t('fields.department'),
                    t('fields.description'),
                    t('fields.tags'),
                  ])}
                  filled={detailsFilled}
                >
                  <Grid columns={{ minWidth: 240 }} gap={4}>
                    <FormField
                      control={form.control}
                      name="environment"
                      render={({ field, fieldState }) => (
                        <Selector
                          label={t('fields.environment')}
                          value={field.value}
                          onChange={field.onChange}
                          status={fieldStatus(fieldState)}
                          options={[
                            { value: NONE, label: t('fields.notSet') },
                            ...CI_ENVIRONMENTS.map((e) => ({ value: e, label: t(`environment.${e}`) })),
                          ]}
                        />
                      )}
                    />
                    {select(
                      'departmentId',
                      t('fields.department'),
                      t('form.departmentPlaceholder'),
                      departments.items,
                    )}
                    <GridSpan columns="full">
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field, fieldState }) => (
                          <TextArea
                            label={t('fields.description')}
                            rows={3}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                    </GridSpan>
                    <GridSpan columns="full">
                      <FormField
                        control={form.control}
                        name="tags"
                        render={({ field, fieldState }) => (
                          <TagInput
                            label={t('fields.tags')}
                            value={field.value}
                            onChange={field.onChange}
                            placeholder={t('form.tagsPlaceholder')}
                            description={t('form.tagsHint')}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                    </GridSpan>
                  </Grid>
                </OptionalFields>

                <CustomFieldsSection
                  elements={elements}
                  form={form as unknown as UseFormReturn<FieldValues>}
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
          </Form>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider padding={3}>
          <HStack gap={2} hAlign="end">
            <Button label={tc('cancel')} variant="ghost" type="button" onClick={() => onOpenChange(false)} />
            <Button
              label={ci ? tc('saveChanges') : tc('create')}
              variant="primary"
              isLoading={save.isPending}
              type="submit"
              form={ids.form}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
