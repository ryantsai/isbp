'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, Layout, LayoutContent, LayoutFooter, StackItem, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { FormDialog } from '@isbp/ui/form-dialog';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { KeyRoundIcon, PlusIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { type FieldValues, useForm, type UseFormReturn, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  addDays,
  CONTRACT_BILLING,
  CONTRACT_KINDS,
  type ContractDetail,
  type CreateContractInput,
} from '../contracts';
import { CategoryIcon } from './badges';
import {
  attributesPayload,
  CustomFieldsSection,
  useApplyServerErrors,
  useAttributeDefaults,
  useAttributesResolver,
  useEntityFields,
} from './custom-fields';
import { INVALIDATE, useDay, useItamSettings } from './lib';
import {
  AssetPicker,
  LicensePicker,
  NONE,
  type PickedAsset,
  type PickedLicense,
  VendorSelect,
} from './pickers';

/** A date held as `YYYY-MM-DD` text (empty = none) as the Astryx date field wants it. */
const asDate = (value: string) => (value || undefined) as ISODateString | undefined;

/* ───────────────────────────── create / edit ───────────────────────────── */

export function ContractFormDialog({
  open,
  onOpenChange,
  contract,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract?: ContractDetail;
  onSaved?: (c: ContractDetail) => void;
}) {
  // Mounted per opening: the dialog takes its accessible name from the header it opens with.
  if (!open) return null;
  return (
    <ContractForm
      contract={contract}
      onCancel={() => onOpenChange(false)}
      onSaved={(c) => {
        onOpenChange(false);
        onSaved?.(c);
      }}
    />
  );
}

function ContractForm({
  contract,
  onCancel,
  onSaved,
}: {
  contract?: ContractDetail;
  onCancel: () => void;
  onSaved: (c: ContractDetail) => void;
}) {
  const t = useTranslations('itam');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const applyErrors = useApplyServerErrors();
  const settings = useItamSettings();
  const { fields, elements, ready } = useEntityFields('itam.contract');
  const [owner, setOwner] = useState<PersonOption | null>(
    contract?.owner
      ? {
          id: contract.owner.id,
          displayName: contract.owner.displayName,
          avatarUrl: contract.owner.avatarUrl,
        }
      : null,
  );
  const ids = { owner: useId() };

  const schema = useMemo(
    () =>
      z
        .object({
          title: z.string().trim().min(1, t('contractForm.titleRequired')).max(300),
          vendorId: z.string(),
          kind: z.enum(CONTRACT_KINDS),
          startDate: z.string(),
          endDate: z.string(),
          autoRenew: z.boolean(),
          noticeDays: z
            .string()
            .trim()
            .refine((v) => /^\d{1,3}$/.test(v) && Number(v) <= 730, t('contractForm.noticeInvalid')),
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
          billing: z.enum(CONTRACT_BILLING),
          notes: z.string().max(20_000),
          draft: z.boolean(),
          attributes: z.record(z.string(), z.unknown()),
        })
        .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
          path: ['endDate'],
          message: t('contractForm.endBeforeStart'),
        }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const resolver = useAttributesResolver<Values>(zodResolver(schema), fields);
  const form = useForm<Values>({
    resolver,
    defaultValues: {
      title: contract?.title ?? '',
      vendorId: contract?.vendor?.id ?? NONE,
      kind: contract?.kind ?? 'support',
      startDate: contract?.startDate ?? '',
      endDate: contract?.endDate ?? '',
      autoRenew: contract?.autoRenew ?? false,
      noticeDays: String(contract?.noticeDays ?? 60),
      cost: contract?.cost !== null && contract?.cost !== undefined ? String(contract.cost) : '',
      currency: contract?.currency ?? settings.currency,
      billing: contract?.billing ?? 'annual',
      notes: contract?.notes ?? '',
      draft: false,
      attributes: contract?.attributes ?? {},
    },
  });
  useAttributeDefaults(
    form as unknown as UseFormReturn<FieldValues>,
    fields,
    ready,
    true,
    contract?.attributes,
  );
  const list = useFieldList();
  const [cost, notes, autoRenew, draft] = useWatch({
    control: form.control,
    name: ['cost', 'notes', 'autoRenew', 'draft'],
  });
  const detailsFilled = countFilled(cost, notes, autoRenew, draft, owner);

  const save = useApiMutation(
    (api, body: CreateContractInput & { activate?: boolean }) =>
      contract
        ? api.patch<ContractDetail>(`/itam/contracts/${contract.id}`, body)
        : api.post<ContractDetail>('/itam/contracts', body),
    {
      invalidate: INVALIDATE,
      success: (c) =>
        contract ? t('contractForm.saved') : t('contractForm.created', { reference: c.reference }),
      onSuccess: onSaved,
      silent: true,
    },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    const body: CreateContractInput = {
      title: v.title.trim(),
      vendorId: v.vendorId === NONE ? null : v.vendorId,
      kind: v.kind,
      startDate: v.startDate || null,
      endDate: v.endDate || null,
      autoRenew: v.autoRenew,
      noticeDays: Number(v.noticeDays),
      cost: v.cost === '' ? null : Number(v.cost),
      currency: v.currency.toUpperCase(),
      billing: v.billing,
      ownerId: owner?.id ?? null,
      notes: v.notes.trim() || null,
      ...(contract ? {} : { draft: v.draft }),
      ...(fields.length ? { attributes: attributesPayload(fields, v.attributes) } : {}),
    };
    try {
      await save.mutateAsync(body);
    } catch (err) {
      if (applyErrors(err, form.setError as never)) return;
      form.setError('root', { message: errorText(err) });
    }
  });

  const date = (name: 'startDate' | 'endDate', label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <DateInput
          label={label}
          hasClear
          value={asDate(field.value)}
          onChange={(v) => field.onChange(v ?? '')}
          status={fieldStatus(fieldState)}
        />
      )}
    />
  );
  const select = <K extends 'kind' | 'billing'>(
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
          options={options.map((o) => ({ value: o, label: t(`${ns}.${o}` as 'contractKind.support') }))}
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
          contract
            ? t('contractForm.editTitle', { reference: contract.reference })
            : t('contractForm.createTitle')
        }
        subtitle={t('contractForm.hint')}
        onSubmit={onSubmit}
        submitLabel={contract ? tc('saveChanges') : tc('create')}
        cancelLabel={tc('cancel')}
        isSubmitting={save.isPending}
        defaultOptionality="optional"
      >
        <Grid columns={{ minWidth: 240 }} gap={4}>
          <GridSpan columns="full">
            <FormField
              control={form.control}
              name="title"
              render={({ field, fieldState }) => (
                <TextInput
                  label={t('fields.title')}
                  isRequired
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  status={fieldStatus(fieldState)}
                />
              )}
            />
          </GridSpan>
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
          {select('kind', t('fields.kind'), CONTRACT_KINDS, 'contractKind')}
          {date('startDate', t('fields.startDate'))}
          {date('endDate', t('fields.endDate'))}
        </Grid>
        <OptionalFields
          hint={list([t('fields.noticeDays'), t('fields.cost'), t('fields.owner'), t('fields.notes')])}
          filled={detailsFilled}
          contentClassName="pt-3"
        >
          <Grid columns={{ minWidth: 240 }} gap={4} align="end">
            <FormField
              control={form.control}
              name="noticeDays"
              render={({ field, fieldState }) => (
                <NumberInput
                  label={t('fields.noticeDays')}
                  description={t('contractForm.noticeHint')}
                  isIntegerOnly
                  min={0}
                  max={730}
                  value={Number(field.value)}
                  onChange={(n) => field.onChange(String(n))}
                  onBlur={field.onBlur}
                  status={fieldStatus(fieldState)}
                />
              )}
            />
            <FormField
              control={form.control}
              name="autoRenew"
              render={({ field }) => (
                <Switch label={t('fields.autoRenew')} value={field.value} onChange={field.onChange} />
              )}
            />
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
            {select('billing', t('fields.billing'), CONTRACT_BILLING, 'billing')}
            <GridSpan columns="full">
              <Field label={t('fields.owner')} inputID={ids.owner} description={t('contractForm.ownerHint')}>
                <PersonPicker
                  id={ids.owner}
                  aria-label={t('fields.owner')}
                  value={owner}
                  onChange={setOwner}
                  placeholder={t('contractForm.ownerPlaceholder')}
                />
              </Field>
            </GridSpan>
            <GridSpan columns="full">
              <FormField
                control={form.control}
                name="notes"
                render={({ field, fieldState }) => (
                  <TextArea
                    label={t('fields.notes')}
                    description={t('contractForm.notesHint')}
                    rows={5}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    status={fieldStatus(fieldState)}
                  />
                )}
              />
            </GridSpan>
            {!contract && (
              <GridSpan columns="full">
                <FormField
                  control={form.control}
                  name="draft"
                  render={({ field }) => (
                    <CheckboxInput
                      label={t('contractForm.draft')}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </GridSpan>
            )}
          </Grid>
        </OptionalFields>
        <CustomFieldsSection elements={elements} form={form as unknown as UseFormReturn<FieldValues>} />
        {form.formState.errors.root && (
          <Banner status="error" title={form.formState.errors.root.message ?? ''} collapsible={false} />
        )}
      </FormDialog>
    </Form>
  );
}

/* ───────────────────────────── renew ───────────────────────────── */

export function RenewDialog({
  contract,
  open,
  onOpenChange,
}: {
  contract: ContractDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('itam.renew');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const day = useDay();
  const defaultStart = contract.endDate ? addDays(contract.endDate, 1) : contract.today;
  const termDays =
    contract.startDate && contract.endDate
      ? Math.max(30, Math.round((Date.parse(contract.endDate) - Date.parse(contract.startDate)) / 86_400_000))
      : 364;
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(addDays(defaultStart, termDays));
  const [cost, setCost] = useState<number | null>(contract.cost);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const renew = useApiMutation(
    (api, body: { startDate: string; endDate: string; cost?: number | null; note: string | null }) =>
      api.post<ContractDetail>(`/itam/contracts/${contract.id}/renew`, body),
    {
      invalidate: INVALIDATE,
      success: (c) => t('done', { reference: c.reference, date: day(c.endDate) }),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!end || end <= start) return setError(t('endAfterStart'));
    if (cost !== null && !(cost >= 0)) return setError(t('costInvalid'));
    try {
      await renew.mutateAsync({
        startDate: start,
        endDate: end,
        cost,
        note: note.trim() || null,
      });
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <FormDialog
      isOpen={open}
      onOpenChange={onOpenChange}
      title={t('title', { reference: contract.reference })}
      subtitle={t('hint', { end: day(contract.endDate) })}
      onSubmit={submit}
      submitLabel={t('submit')}
      cancelLabel={tc('cancel')}
      isSubmitting={renew.isPending}
      defaultOptionality="optional"
    >
      <Grid columns={{ minWidth: 190 }} gap={4}>
        <DateInput label={t('start')} value={asDate(start)} onChange={(v) => setStart(v ?? '')} />
        <DateInput
          label={t('end')}
          value={asDate(end)}
          onChange={(v) => setEnd(v ?? '')}
          status={error ? { type: 'error' } : undefined}
        />
      </Grid>
      <NumberInput
        label={t('cost', { currency: contract.currency })}
        hasClear
        min={0}
        value={cost}
        onChange={setCost}
      />
      <TextArea label={t('note')} rows={2} value={note} onChange={setNote} maxLength={2000} />
      {error && <Banner status="error" title={error} collapsible={false} />}
    </FormDialog>
  );
}

/* ───────────────────────────── covered items ───────────────────────────── */

export function ItemsDialog({
  contract,
  open,
  onOpenChange,
}: {
  contract: ContractDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('itam.items');
  const tc = useTranslations('common');
  const initialAssets = contract.items.flatMap((i) => (i.asset ? [i.asset] : []));
  const initialLicenses = contract.items.flatMap((i) => (i.license ? [i.license] : []));
  const [assets, setAssets] = useState<PickedAsset[]>(initialAssets);
  const [licenses, setLicenses] = useState<PickedLicense[]>(initialLicenses);
  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [license, setLicense] = useState<PickedLicense | null>(null);
  const headingId = useId();
  const save = useApiMutation(
    (api, body: { assetIds: string[]; licenseIds: string[] }) =>
      api.put<ContractDetail>(`/itam/contracts/${contract.id}/items`, body),
    { invalidate: INVALIDATE, success: t('saved'), onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('title', { reference: contract.reference })}
            subtitle={t('hint')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={5}>
              <HStack gap={2} vAlign="end">
                <StackItem size="fill">
                  <AssetPicker
                    label={t('addAsset')}
                    value={asset}
                    onChange={setAsset}
                    excludeIds={assets.map((a) => a.id)}
                  />
                </StackItem>
                <Button
                  label={tc('add')}
                  variant="secondary"
                  icon={<Icon icon={PlusIcon} />}
                  isDisabled={!asset}
                  type="button"
                  onClick={() => {
                    if (asset) setAssets((list) => [...list, asset]);
                    setAsset(null);
                  }}
                />
              </HStack>
              <HStack gap={2} vAlign="end">
                <StackItem size="fill">
                  <LicensePicker
                    label={t('addLicense')}
                    value={license}
                    onChange={setLicense}
                    excludeIds={licenses.map((l) => l.id)}
                  />
                </StackItem>
                <Button
                  label={tc('add')}
                  variant="secondary"
                  icon={<Icon icon={PlusIcon} />}
                  isDisabled={!license}
                  type="button"
                  onClick={() => {
                    if (license) setLicenses((list) => [...list, license]);
                    setLicense(null);
                  }}
                />
              </HStack>
              <VStack as="section" gap={1} aria-labelledby={headingId}>
                <Heading level={3} id={headingId}>
                  {t('covered', { count: assets.length + licenses.length })}
                </Heading>
                {assets.length + licenses.length === 0 ? (
                  <Text color="secondary">{t('nothing')}</Text>
                ) : (
                  <List hasDividers density="compact">
                    {assets.map((a) => (
                      <ListItem
                        key={a.id}
                        startContent={<CategoryIcon category={a.category} color="secondary" label />}
                        label={a.name}
                        description={a.tag}
                        endContent={
                          <IconButton
                            label={t('remove', { name: a.tag })}
                            variant="ghost"
                            size="sm"
                            icon={<Icon icon={XIcon} />}
                            type="button"
                            onClick={() => setAssets((list) => list.filter((x) => x.id !== a.id))}
                          />
                        }
                      />
                    ))}
                    {licenses.map((l) => (
                      <ListItem
                        key={l.id}
                        startContent={<Icon icon={KeyRoundIcon} color="secondary" />}
                        label={l.product}
                        description={l.reference}
                        endContent={
                          <IconButton
                            label={t('remove', { name: l.reference })}
                            variant="ghost"
                            size="sm"
                            icon={<Icon icon={XIcon} />}
                            type="button"
                            onClick={() => setLicenses((list) => list.filter((x) => x.id !== l.id))}
                          />
                        }
                      />
                    ))}
                  </List>
                )}
              </VStack>
            </VStack>
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
                label={tc('saveChanges')}
                variant="primary"
                isLoading={save.isPending}
                onClick={() =>
                  save.mutate({ assetIds: assets.map((a) => a.id), licenseIds: licenses.map((l) => l.id) })
                }
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
