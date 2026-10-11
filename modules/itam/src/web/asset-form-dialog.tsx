'use client';

import { DateInput } from '@astryxdesign/core/DateInput';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { Banner } from '@astryxdesign/core/Banner';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { Collapse } from '@isbp/ui/motion';
import { countFilled, OptionalFields } from '@isbp/ui/optional-fields';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
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
import { Button } from '@astryxdesign/core/Button';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import { type FieldValues, useForm, type UseFormReturn, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ASSET_CATEGORIES, type AssetDetail, type CiRef, type CreateAssetInput } from '../contracts';
import { CategoryIcon } from './badges';
import {
  attributesPayload,
  CustomFieldsSection,
  useApplyServerErrors,
  useAttributeDefaults,
  useAttributesResolver,
  useEntityFields,
} from './custom-fields';
import { addMonths } from '../model';
import { INVALIDATE, useDay, useItamSettings } from './lib';
import { CiPicker, DepartmentSelect, ModelSelect, NONE, VendorSelect } from './pickers';

const orNull = (v: string) => (v === NONE || v === '' ? null : v);

/** Categories that are usually a configuration item in the CMDB (the CI field shows only for them). */
const CI_CATEGORIES = new Set(['server', 'network', 'storage', 'printer']);

/** A new asset (optionally handed to someone right away), or edit one. A sheet: it has more than four fields. */
export function AssetFormDialog({
  open,
  onOpenChange,
  asset,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: AssetDetail;
  onSaved?: (asset: AssetDetail) => void;
}) {
  const t = useTranslations('itam.assetForm');
  const [dirty, setDirty] = useState(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" dirty={dirty}>
        <SheetHeader>
          <SheetTitle>{asset ? t('editTitle', { tag: asset.tag }) : t('createTitle')}</SheetTitle>
          <SheetDescription>{asset ? t('editHint') : t('hint')}</SheetDescription>
        </SheetHeader>
        {open && (
          <AssetForm
            asset={asset}
            onDirty={setDirty}
            onCancel={() => onOpenChange(false)}
            onSaved={(saved) => {
              onOpenChange(false);
              onSaved?.(saved);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function AssetForm({
  asset,
  onCancel,
  onSaved,
  onDirty,
}: {
  asset?: AssetDetail;
  onCancel: () => void;
  onSaved: (asset: AssetDetail) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const t = useTranslations('itam');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const applyErrors = useApplyServerErrors();
  const settings = useItamSettings();
  const day = useDay();
  const { fields, elements, ready } = useEntityFields('itam.asset');
  const [assignee, setAssignee] = useState<PersonOption | null>(null);
  const [ci, setCi] = useState<Pick<CiRef, 'id' | 'reference' | 'name'> | null>(asset?.ci ?? null);
  const ids = { assignee: useId(), identity: useId(), placement: useId() };

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('assetForm.nameRequired')).max(200),
        category: z.enum(ASSET_CATEGORIES),
        modelId: z.string(),
        serialNumber: z.string().trim().max(100),
        status: z.enum(['in_stock', 'ordered']),
        location: z.string().trim().max(200),
        departmentId: z.string(),
        vendorId: z.string(),
        purchaseDate: z.string(),
        purchaseCost: z
          .string()
          .trim()
          .refine(
            (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0),
            t('assetForm.costInvalid'),
          ),
        currency: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{3}$/, t('assetForm.currencyInvalid')),
        invoiceNumber: z.string().trim().max(64),
        warrantyEnd: z.string(),
        retireOn: z.string(),
        notes: z.string().max(10_000),
        attributes: z.record(z.string(), z.unknown()),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const resolver = useAttributesResolver<Values>(zodResolver(schema), fields);
  const form = useForm<Values>({
    resolver,
    defaultValues: {
      name: asset?.name ?? '',
      category: asset?.category ?? 'laptop',
      modelId: asset?.model?.id ?? NONE,
      serialNumber: asset?.serialNumber ?? '',
      status: 'in_stock',
      location: asset?.location ?? '',
      departmentId: asset?.department?.id ?? NONE,
      vendorId: asset?.vendor?.id ?? NONE,
      purchaseDate: asset?.purchaseDate ?? '',
      purchaseCost:
        asset?.purchaseCost !== null && asset?.purchaseCost !== undefined ? String(asset.purchaseCost) : '',
      currency: asset?.currency ?? settings.currency,
      invoiceNumber: asset?.invoiceNumber ?? '',
      warrantyEnd: asset?.warrantyEnd ?? '',
      retireOn: asset?.retireOn ?? '',
      notes: asset?.notes ?? '',
      attributes: asset?.attributes ?? {},
    },
  });
  useAttributeDefaults(form as unknown as UseFormReturn<FieldValues>, fields, ready, true, asset?.attributes);
  const [category, purchaseDate] = useWatch({ control: form.control, name: ['category', 'purchaseDate'] });
  const [lifespan, setLifespan] = useState<number | null>(null);
  const dirty = form.formState.isDirty || Boolean(assignee);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const showCi = CI_CATEGORIES.has(category) || Boolean(ci);
  const purchase = useWatch({
    control: form.control,
    name: ['vendorId', 'invoiceNumber', 'purchaseDate', 'purchaseCost', 'warrantyEnd'],
  });
  const purchaseFilled = countFilled(...purchase.map((v) => (v === NONE ? '' : v)));

  const save = useApiMutation(
    (api, body: CreateAssetInput) =>
      asset
        ? api.patch<AssetDetail>(`/itam/assets/${asset.id}`, body)
        : api.post<AssetDetail>('/itam/assets', body),
    {
      invalidate: INVALIDATE,
      success: (saved) => (asset ? t('assetForm.saved') : t('assetForm.created', { tag: saved.tag })),
      onSuccess: onSaved,
      silent: true,
    },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    const body: CreateAssetInput = {
      name: v.name.trim(),
      category: v.category,
      modelId: orNull(v.modelId),
      serialNumber: v.serialNumber.trim() || null,
      location: v.location.trim() || null,
      departmentId: orNull(v.departmentId),
      ciId: showCi ? (ci?.id ?? null) : null,
      vendorId: orNull(v.vendorId),
      purchaseDate: v.purchaseDate || null,
      purchaseCost: v.purchaseCost === '' ? null : Number(v.purchaseCost),
      currency: v.currency.toUpperCase(),
      invoiceNumber: v.invoiceNumber.trim() || null,
      warrantyEnd: v.warrantyEnd || null,
      notes: v.notes.trim() || null,
      ...(asset ? { retireOn: v.retireOn || null } : { status: v.status, assigneeId: assignee?.id ?? null }),
      ...(fields.length ? { attributes: attributesPayload(fields, v.attributes) } : {}),
    };
    try {
      await save.mutateAsync(body);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('serialNumber', { message: t('assetForm.serialTaken') });
        return;
      }
      if (applyErrors(err, form.setError as never)) return;
      form.setError('root', { message: errorText(err) });
    }
  });

  const text = (
    name: 'name' | 'serialNumber' | 'invoiceNumber',
    label: string,
    options: { placeholder?: string; isRequired?: boolean } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <TextInput
          label={label}
          placeholder={options.placeholder}
          isRequired={options.isRequired}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          ref={field.ref}
          status={fieldStatus(fieldState)}
        />
      )}
    />
  );
  const date = (name: 'purchaseDate' | 'warrantyEnd' | 'retireOn', label: string, hint?: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <DateInput
          label={label}
          description={hint}
          hasClear
          value={(field.value || undefined) as ISODateString | undefined}
          onChange={(v) => field.onChange(v ?? '')}
          status={fieldStatus(fieldState)}
        />
      )}
    />
  );
  const lifespanHint =
    !asset && lifespan !== null
      ? purchaseDate
        ? t('assetForm.retiresOn', { date: day(addMonths(purchaseDate, lifespan)) })
        : t('assetForm.lifespan', { months: lifespan })
      : undefined;

  return (
    <Form {...form}>
      <SheetForm onSubmit={onSubmit} noValidate>
        <SheetBody>
          <FormLayout defaultOptionality="optional">
            <VStack gap={5}>
              <VStack gap={3} role="group" aria-labelledby={ids.identity}>
                <Text type="label" color="secondary" id={ids.identity}>
                  {t('assetForm.identity')}
                </Text>
                <Grid columns={{ minWidth: 240 }} gap={4} align="end">
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field, fieldState }) => (
                      <Selector
                        label={t('fields.category')}
                        isRequired
                        value={field.value}
                        onChange={(v) => {
                          field.onChange(v);
                          form.setValue('modelId', NONE);
                          setLifespan(null);
                        }}
                        status={fieldStatus(fieldState)}
                        options={ASSET_CATEGORIES.map((c) => ({
                          value: c,
                          label: t(`category.${c}`),
                          icon: <CategoryIcon category={c} color="secondary" />,
                        }))}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="modelId"
                    render={({ field, fieldState }) => (
                      <ModelSelect
                        label={t('fields.model')}
                        value={field.value}
                        category={category}
                        description={lifespanHint}
                        status={fieldStatus(fieldState)}
                        onChange={(id, model) => {
                          field.onChange(id);
                          setLifespan(model?.lifespanMonths ?? null);
                        }}
                      />
                    )}
                  />
                  {text('name', t('fields.name'), {
                    placeholder: t('assetForm.namePlaceholder'),
                    isRequired: true,
                  })}
                  {text('serialNumber', t('fields.serialNumber'), {
                    placeholder: t('assetForm.serialPlaceholder'),
                  })}
                  {!asset && (
                    <GridSpan columns="full">
                      <Field label={t('assetForm.assignTo')} inputID={ids.assignee}>
                        <PersonPicker
                          id={ids.assignee}
                          aria-label={t('assetForm.assignTo')}
                          value={assignee}
                          onChange={setAssignee}
                          placeholder={t('assetForm.assignToPlaceholder')}
                        />
                      </Field>
                    </GridSpan>
                  )}
                  {!asset &&
                    (assignee ? (
                      <GridSpan columns="full">
                        <Text as="p" aria-live="polite">
                          {t('assetForm.willDeploy', { name: assignee.displayName })}
                        </Text>
                      </GridSpan>
                    ) : (
                      <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                          <Selector
                            label={t('fields.status')}
                            description={t('assetForm.statusHint')}
                            value={field.value}
                            onChange={field.onChange}
                            options={[
                              { value: 'in_stock', label: t('status.in_stock') },
                              { value: 'ordered', label: t('status.ordered') },
                            ]}
                          />
                        )}
                      />
                    ))}
                </Grid>
              </VStack>

              <VStack gap={3} role="group" aria-labelledby={ids.placement}>
                <Text type="label" color="secondary" id={ids.placement}>
                  {t('assetForm.placement')}
                </Text>
                <Grid columns={{ minWidth: 240 }} gap={4}>
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('fields.location')}
                        placeholder={t('assetForm.locationPlaceholder')}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="departmentId"
                    render={({ field, fieldState }) => (
                      <DepartmentSelect
                        label={t('fields.department')}
                        value={field.value}
                        onChange={field.onChange}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <GridSpan columns="full">
                    <Collapse open={showCi}>
                      <CiPicker
                        label={t('fields.ci')}
                        description={t('assetForm.ciHint')}
                        value={ci}
                        onChange={setCi}
                      />
                    </Collapse>
                  </GridSpan>
                </Grid>
              </VStack>

              <OptionalFields
                label={t('assetForm.purchase')}
                filled={purchaseFilled}
                contentClassName="grid gap-4 pt-3 sm:grid-cols-2"
              >
                <FormField
                  control={form.control}
                  name="vendorId"
                  render={({ field, fieldState }) => (
                    <VendorSelect
                      label={t('fields.vendor')}
                      value={field.value}
                      onChange={field.onChange}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                {text('invoiceNumber', t('fields.invoiceNumber'))}
                {date('purchaseDate', t('fields.purchaseDate'))}
                <Grid columns={{ minWidth: 100 }} gap={2}>
                  <FormField
                    control={form.control}
                    name="purchaseCost"
                    render={({ field, fieldState }) => (
                      <NumberInput
                        label={t('fields.purchaseCost')}
                        hasClear
                        min={0}
                        value={field.value === '' ? null : Number(field.value)}
                        onChange={(n) => field.onChange(n === null ? '' : String(n))}
                        onBlur={field.onBlur}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="currency"
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('fields.currency')}
                        value={field.value}
                        onChange={(v) => field.onChange(v.toUpperCase().slice(0, 3))}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                </Grid>
                {date('warrantyEnd', t('fields.warrantyEnd'))}
                {asset && date('retireOn', t('fields.retireOn'), t('assetForm.retireOnHint'))}
              </OptionalFields>

              <FormField
                control={form.control}
                name="notes"
                render={({ field, fieldState }) => (
                  <TextArea
                    label={t('fields.notes')}
                    rows={3}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    status={fieldStatus(fieldState)}
                  />
                )}
              />

              <CustomFieldsSection elements={elements} form={form as unknown as UseFormReturn<FieldValues>} />

              {form.formState.errors.root && (
                <Banner status="error" title={form.formState.errors.root.message ?? ''} collapsible={false} />
              )}
            </VStack>
          </FormLayout>
        </SheetBody>
        <SheetFooter>
          <Button label={tc('cancel')} variant="secondary" type="button" onClick={onCancel} />
          <Button
            label={asset ? tc('saveChanges') : tc('save')}
            variant="primary"
            isLoading={save.isPending}
            type="submit"
          />
        </SheetFooter>
      </SheetForm>
    </Form>
  );
}
