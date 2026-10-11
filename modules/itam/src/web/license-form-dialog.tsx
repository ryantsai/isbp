'use client';

import type { ISODateString } from '@astryxdesign/core/Calendar';
import { Banner } from '@astryxdesign/core/Banner';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { FormDialog } from '@isbp/ui/form-dialog';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { applyServerErrors, useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  type ContractListItem,
  type CreateLicenseInput,
  LICENSE_BILLING,
  LICENSE_TYPES,
  type LicenseDetail,
} from '../contracts';
import { INVALIDATE, useItamSettings } from './lib';
import { NONE, VendorSelect } from './pickers';

/** Add a licence or edit one. The key is write-only: leave it blank to keep the stored one. */
export function LicenseFormDialog({
  open,
  onOpenChange,
  license,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  license?: LicenseDetail;
  onSaved?: (license: LicenseDetail) => void;
}) {
  // Mounted per opening: the dialog takes its accessible name from the header it opens with.
  if (!open) return null;
  return (
    <LicenseForm
      license={license}
      onCancel={() => onOpenChange(false)}
      onSaved={(l) => {
        onOpenChange(false);
        onSaved?.(l);
      }}
    />
  );
}

function LicenseForm({
  license,
  onCancel,
  onSaved,
}: {
  license?: LicenseDetail;
  onCancel: () => void;
  onSaved: (l: LicenseDetail) => void;
}) {
  const t = useTranslations('itam');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const settings = useItamSettings();
  const canContracts = useCan('itam.contracts.read');
  const { data: contracts } = useApiQuery<Page<ContractListItem>>(canContracts ? '/itam/contracts' : null, {
    pageSize: 200,
    sort: 'title',
  });
  const [removeKey, setRemoveKey] = useState(false);

  const schema = useMemo(
    () =>
      z.object({
        product: z.string().trim().min(1, t('licenseForm.productRequired')).max(200),
        publisher: z.string().trim().max(200),
        vendorId: z.string(),
        licenseType: z.enum(LICENSE_TYPES),
        quantity: z
          .string()
          .trim()
          .refine(
            (v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 10_000_000),
            t('licenseForm.quantityInvalid'),
          ),
        cost: z
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
        billing: z.enum(LICENSE_BILLING),
        startDate: z.string(),
        endDate: z.string(),
        contractId: z.string(),
        licenseKey: z.string().max(4000),
        notes: z.string().max(10_000),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      product: license?.product ?? '',
      publisher: license?.publisher ?? '',
      vendorId: license?.vendor?.id ?? NONE,
      licenseType: license?.licenseType ?? 'per_user',
      quantity: license?.quantity !== null && license?.quantity !== undefined ? String(license.quantity) : '',
      cost: license?.cost !== null && license?.cost !== undefined ? String(license.cost) : '',
      currency: license?.currency ?? settings.currency,
      billing: license?.billing ?? 'annual',
      startDate: license?.startDate ?? '',
      endDate: license?.endDate ?? '',
      contractId: license?.contract?.id ?? NONE,
      licenseKey: '',
      notes: license?.notes ?? '',
    },
  });

  const list = useFieldList();
  const [publisher, cost, contractId, notes, licenseKey] = useWatch({
    control: form.control,
    name: ['publisher', 'cost', 'contractId', 'notes', 'licenseKey'],
  });
  const detailsFilled = countFilled(
    publisher,
    cost,
    canContracts && contractId !== NONE ? contractId : '',
    notes,
    licenseKey || (license?.hasKey && !removeKey),
  );

  const save = useApiMutation(
    (api, body: CreateLicenseInput) =>
      license
        ? api.patch<LicenseDetail>(`/itam/licenses/${license.id}`, body)
        : api.post<LicenseDetail>('/itam/licenses', body),
    {
      invalidate: INVALIDATE,
      success: (l) =>
        license ? t('licenseForm.saved') : t('licenseForm.created', { reference: l.reference }),
      onSuccess: onSaved,
      silent: true,
    },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    const key = v.licenseKey.trim();
    const body: CreateLicenseInput = {
      product: v.product.trim(),
      publisher: v.publisher.trim() || null,
      vendorId: v.vendorId === NONE ? null : v.vendorId,
      licenseType: v.licenseType,
      quantity: v.quantity === '' ? null : Number(v.quantity),
      cost: v.cost === '' ? null : Number(v.cost),
      currency: v.currency.toUpperCase(),
      billing: v.billing,
      startDate: v.startDate || null,
      endDate: v.endDate || null,
      ...(canContracts ? { contractId: v.contractId === NONE ? null : v.contractId } : {}),
      ...(key ? { licenseKey: key } : removeKey ? { licenseKey: null } : {}),
      notes: v.notes.trim() || null,
    };
    try {
      await save.mutateAsync(body);
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      form.setError('root', { message: errorText(err) });
    }
  });

  const select = <K extends 'licenseType' | 'billing'>(
    name: K,
    label: string,
    options: readonly string[],
    ns: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Selector
          label={label}
          value={field.value}
          onChange={field.onChange}
          status={fieldStatus(fieldState)}
          options={options.map((o) => ({ value: o, label: t(`${ns}.${o}` as 'licenseType.per_user') }))}
        />
      )}
    />
  );
  const date = (name: 'startDate' | 'endDate', label: string, hint?: string) => (
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

  return (
    <Form {...form}>
      <FormDialog
        isOpen
        onOpenChange={(o) => !o && onCancel()}
        size="xl"
        title={
          license
            ? t('licenseForm.editTitle', { reference: license.reference })
            : t('licenseForm.createTitle')
        }
        subtitle={t('licenseForm.hint')}
        onSubmit={onSubmit}
        submitLabel={license ? tc('saveChanges') : tc('create')}
        cancelLabel={tc('cancel')}
        isSubmitting={save.isPending}
        defaultOptionality="optional"
      >
        <Grid columns={{ minWidth: 240 }} gap={4} align="end">
          <FormField
            control={form.control}
            name="product"
            render={({ field, fieldState }) => (
              <TextInput
                label={t('fields.product')}
                description={t('licenseForm.productHint')}
                placeholder="Microsoft 365 E3"
                isRequired
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                status={fieldStatus(fieldState)}
              />
            )}
          />
          {select('licenseType', t('fields.licenseType'), LICENSE_TYPES, 'licenseType')}
          <FormField
            control={form.control}
            name="quantity"
            render={({ field, fieldState }) => (
              <NumberInput
                label={t('fields.quantity')}
                description={t('licenseForm.quantityHint')}
                hasClear
                isIntegerOnly
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
          {date('startDate', t('fields.startDate'))}
          {date('endDate', t('fields.endDate'), t('licenseForm.endHint'))}
        </Grid>
        <OptionalFields
          hint={list([t('fields.publisher'), t('fields.cost'), t('fields.licenseKey'), t('fields.notes')])}
          filled={detailsFilled}
          contentClassName="pt-3"
        >
          <Grid columns={{ minWidth: 240 }} gap={4}>
            <FormField
              control={form.control}
              name="publisher"
              render={({ field, fieldState }) => (
                <TextInput
                  label={t('fields.publisher')}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  status={fieldStatus(fieldState)}
                />
              )}
            />
            {canContracts && (
              <FormField
                control={form.control}
                name="contractId"
                render={({ field, fieldState }) => (
                  <Selector
                    label={t('fields.contract')}
                    hasSearch={(contracts?.items.length ?? 0) > 8}
                    value={field.value}
                    onChange={field.onChange}
                    status={fieldStatus(fieldState)}
                    options={[
                      { value: NONE, label: t('licenseForm.noContract') },
                      ...(contracts?.items ?? []).map((c) => ({
                        value: c.id,
                        label: `${c.reference} · ${c.title}`,
                      })),
                    ]}
                  />
                )}
              />
            )}
            <Grid columns={{ minWidth: 100 }} gap={2}>
              <FormField
                control={form.control}
                name="cost"
                render={({ field, fieldState }) => (
                  <NumberInput
                    label={t('fields.cost')}
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
            {select('billing', t('fields.billing'), LICENSE_BILLING, 'billing')}
            <GridSpan columns="full">
              <FormField
                control={form.control}
                name="licenseKey"
                render={({ field, fieldState }) => (
                  <TextInput
                    type="password"
                    autoComplete="off"
                    label={t('fields.licenseKey')}
                    description={license?.hasKey ? t('licenseForm.keyKeep') : t('licenseForm.keyHint')}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    status={fieldStatus(fieldState)}
                  />
                )}
              />
            </GridSpan>
            {license?.hasKey && (
              <GridSpan columns="full">
                <CheckboxInput label={t('licenseForm.removeKey')} value={removeKey} onChange={setRemoveKey} />
              </GridSpan>
            )}
            <GridSpan columns="full">
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
            </GridSpan>
          </Grid>
        </OptionalFields>
        {form.formState.errors.root && (
          <Banner status="error" title={form.formState.errors.root.message ?? ''} collapsible={false} />
        )}
      </FormDialog>
    </Form>
  );
}
