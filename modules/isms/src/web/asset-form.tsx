'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
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
import { StatusBadge } from '@isbp/ui/status';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import { type FieldValues, useForm, type UseFormReturn, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  ASSET_STATUSES,
  type Asset,
  type AssetClass,
  CIA_LEVELS,
  type CreateAssetInput,
  type Guidance,
  type UpdateAssetInput,
} from '../contracts';
import { assetValue } from '../model';
import {
  attributesPayload,
  CustomFieldsSection,
  useApplyServerErrors,
  useAttributeDefaults,
  useAttributesResolver,
  useEntityFields,
} from './custom-fields';
import { INVALIDATE, useGroups, useLocalized, useTaxonomy } from './lib';
import { PeoplePicker, PersonField } from './people';

const NONE = '__none__';
const orNull = (v: string) => (v === NONE || v === '' ? null : v);
const DIMENSIONS = [
  ['confidentiality', 'c'],
  ['integrity', 'i'],
  ['availability', 'a'],
] as const;

/** Register an information asset, or edit one. */
export function AssetFormSheet({
  open,
  onOpenChange,
  asset,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: Asset;
  onSaved?: (asset: Asset) => void;
}) {
  const t = useTranslations('isms.assetForm');
  const tc = useTranslations('common');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{asset ? t('editTitle', { number: asset.number }) : t('createTitle')}</SheetTitle>
          <SheetDescription>{t('hint')}</SheetDescription>
        </SheetHeader>
        {open && (
          <AssetForm
            asset={asset}
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

/** One of C, I and A: the scores 1–4 as radio buttons, each with the class's guidance for it. */
function CiaChooser({
  label,
  hint,
  value,
  onChange,
  guidance,
  error,
}: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (v: number) => void;
  guidance: Guidance['c'] | undefined;
  error?: string;
}) {
  const localized = useLocalized();
  const t = useTranslations('isms.assetForm');
  return (
    <RadioList
      label={label}
      description={hint}
      isRequired
      value={value === null ? '' : String(value)}
      onChange={(v) => onChange(Number(v))}
      status={error ? { type: 'error', message: error } : undefined}
    >
      {[...CIA_LEVELS].reverse().map((level) => {
        const text = guidance ? localized(guidance[String(level) as '1']) : '';
        return (
          <RadioListItem
            key={level}
            value={String(level)}
            label={t('level', { level })}
            description={text || t('noGuidance')}
          />
        );
      })}
    </RadioList>
  );
}

function AssetForm({
  asset,
  onCancel,
  onSaved,
}: {
  asset?: Asset;
  onCancel: () => void;
  onSaved: (asset: Asset) => void;
}) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const applyErrors = useApplyServerErrors();
  const localized = useLocalized();
  const { data: taxonomy } = useTaxonomy();
  const { data: groups } = useGroups();
  const { fields, elements, ready } = useEntityFields('isms.asset');
  const ids = {
    manager: useId(),
    users: useId(),
    identity: useId(),
    responsibility: useId(),
    place: useId(),
  };
  const list = useFieldList();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('assetForm.nameRequired')).max(200),
        classId: z.string().min(1, t('assetForm.classRequired')),
        subclassId: z.string(),
        siteId: z.string().min(1, t('assetForm.siteRequired')),
        managerId: z.string().nullable(),
        managerGroupId: z.string(),
        userIds: z.array(z.string()),
        usersText: z.string().max(500),
        location: z.string().max(200),
        brand: z.string().max(100),
        model: z.string().max(100),
        version: z.string().max(100),
        quantity: z.coerce
          .number<string>()
          .int(t('assetForm.quantityInvalid'))
          .min(0, t('assetForm.quantityInvalid')),
        // No default score: the value drives risk and stocktakes, so each of C, I and A is chosen on purpose.
        confidentiality: z
          .number()
          .int()
          .min(1)
          .max(4)
          .nullable()
          .refine((v) => v !== null, t('assetForm.scoreRequired')),
        integrity: z
          .number()
          .int()
          .min(1)
          .max(4)
          .nullable()
          .refine((v) => v !== null, t('assetForm.scoreRequired')),
        availability: z
          .number()
          .int()
          .min(1)
          .max(4)
          .nullable()
          .refine((v) => v !== null, t('assetForm.scoreRequired')),
        classificationId: z.string(),
        notes: z.string().max(5000),
        attributes: z.record(z.string(), z.unknown()),
      }),
    [t],
  );
  type Values = z.input<typeof schema>;
  const resolver = useAttributesResolver<Values>(zodResolver(schema) as never, fields);
  const sites = taxonomy?.sites ?? [];
  const form = useForm<Values>({
    resolver,
    defaultValues: {
      name: asset?.name ?? '',
      classId: asset?.class.id ?? '',
      subclassId: asset?.subclass?.id ?? NONE,
      siteId: asset?.site.id ?? (sites.length === 1 ? sites[0]!.id : ''),
      managerId: asset?.manager?.id ?? null,
      managerGroupId: asset?.managerGroup?.id ?? NONE,
      userIds: asset?.users.map((u) => u.id) ?? [],
      usersText: asset?.usersText ?? '',
      location: asset?.location ?? '',
      brand: asset?.brand ?? '',
      model: asset?.model ?? '',
      version: asset?.version ?? '',
      quantity: String(asset?.quantity ?? 1),
      confidentiality: asset?.confidentiality ?? null,
      integrity: asset?.integrity ?? null,
      availability: asset?.availability ?? null,
      classificationId: asset?.classification?.id ?? NONE,
      notes: asset?.notes ?? '',
      attributes: asset?.attributes ?? {},
    },
  });
  useAttributeDefaults(form as unknown as UseFormReturn<FieldValues>, fields, ready, true, asset?.attributes);
  const [classId, c, i, a] = useWatch({
    control: form.control,
    name: ['classId', 'confidentiality', 'integrity', 'availability'],
  });
  const [usersText, brand, model, version, quantity, notes] = useWatch({
    control: form.control,
    name: ['usersText', 'brand', 'model', 'version', 'quantity', 'notes'],
  });
  // The quantity defaults to 1: that is not something a person entered.
  const detailsFilled = countFilled(
    usersText,
    brand,
    model,
    version,
    quantity === '1' ? '' : quantity,
    notes,
  );
  const klass: AssetClass | undefined = taxonomy?.classes.find((x) => x.id === classId);
  const scored = c !== null && i !== null && a !== null;
  const value = scored ? assetValue(c, i, a) : null;
  // Which score sets the value, in words ("because integrity is 3").
  const because = scored
    ? DIMENSIONS.filter(
        ([name]) => ({ confidentiality: c, integrity: i, availability: a })[name] === value,
      ).map(([name]) => t(`fields.${name}`))
    : [];
  const labels = useMemo(
    () => [...(taxonomy?.labels ?? [])].filter((l) => !l.archived).sort((x, y) => x.rank - y.rank),
    [taxonomy],
  );
  // The classification scale is the confidentiality scale (C4 = the most restricted label): suggest it from C,
  // until the person picks a classification themselves.
  const [classificationTouched, setClassificationTouched] = useState(Boolean(asset?.classification));
  const suggested =
    c !== null && labels.length
      ? labels[Math.min(labels.length - 1, Math.max(0, Math.round(((4 - c) * (labels.length - 1)) / 3)))]
      : undefined;
  useEffect(() => {
    if (!classificationTouched && suggested) form.setValue('classificationId', suggested.id);
  }, [classificationTouched, suggested, form]);
  const detailsOpenByDefault = !asset && (klass?.code === 'HW' || klass?.code === 'SW');

  const save = useApiMutation(
    (api, body: CreateAssetInput) =>
      asset ? api.patch<Asset>(`/isms/assets/${asset.id}`, body) : api.post<Asset>('/isms/assets', body),
    {
      invalidate: INVALIDATE,
      success: (saved) => (asset ? t('assetForm.saved') : t('assetForm.created', { number: saved.number })),
      onSuccess: onSaved,
      silent: true,
    },
  );

  const onSubmit = form.handleSubmit(async (raw) => {
    const v = raw as unknown as z.output<typeof schema>;
    form.clearErrors('root');
    const body: CreateAssetInput = {
      name: v.name.trim(),
      classId: v.classId,
      subclassId: orNull(v.subclassId),
      siteId: v.siteId,
      managerId: v.managerId,
      managerGroupId: orNull(v.managerGroupId),
      userIds: v.userIds,
      usersText: v.usersText.trim() || null,
      location: v.location.trim() || null,
      brand: v.brand.trim() || null,
      model: v.model.trim() || null,
      version: v.version.trim() || null,
      quantity: v.quantity,
      confidentiality: v.confidentiality!,
      integrity: v.integrity!,
      availability: v.availability!,
      classificationId: orNull(v.classificationId),
      notes: v.notes.trim() || null,
      ...(fields.length ? { attributes: attributesPayload(fields, v.attributes) } : {}),
    };
    try {
      await save.mutateAsync(body);
    } catch (err) {
      if (applyErrors(err, form.setError as never)) return;
      form.setError('root', { message: err instanceof ApiError ? errorText(err) : errorText(err) });
    }
  });

  const text = (
    name: 'name' | 'location' | 'brand' | 'model' | 'version' | 'usersText',
    label: string,
    opts: { hint?: string; required?: boolean; placeholder?: string } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <TextInput
          label={label}
          description={opts.hint}
          placeholder={opts.placeholder}
          isRequired={opts.required}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          ref={field.ref}
          status={fieldStatus(fieldState)}
        />
      )}
    />
  );
  const select = (
    name: 'classId' | 'subclassId' | 'siteId' | 'managerGroupId' | 'classificationId',
    label: string,
    options: { value: string; label: string }[],
    opts: {
      none?: string;
      onChange?: (v: string) => void;
      hint?: string;
      required?: boolean;
      hasSearch?: boolean;
    } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Selector
          label={label}
          description={opts.hint}
          // A searchable Selector is a button: aria-required is not allowed on it.
          isRequired={opts.required && !opts.hasSearch}
          hasSearch={opts.hasSearch}
          placeholder={t('assetForm.choose')}
          value={field.value || undefined}
          onChange={(v) => {
            field.onChange(v);
            opts.onChange?.(v);
          }}
          status={fieldStatus(fieldState)}
          options={opts.none ? [{ value: NONE, label: opts.none }, ...options] : options}
        />
      )}
    />
  );

  return (
    <Form {...form}>
      <SheetForm onSubmit={onSubmit} noValidate>
        <SheetBody className="py-2">
          <VStack gap={5}>
            <VStack gap={3} role="group" aria-labelledby={ids.identity}>
              <Text type="label" color="secondary" id={ids.identity}>
                {t('assetForm.identity')}
              </Text>
              <FormLayout defaultOptionality="optional">
                {text('name', t('fields.name'), { hint: t('assetForm.nameHint'), required: true })}
                <Grid columns={{ minWidth: 240 }} gap={4}>
                  {select(
                    'classId',
                    t('fields.class'),
                    (taxonomy?.classes ?? []).map((x) => ({
                      value: x.id,
                      label: `${x.code} · ${localized(x.name)}`,
                    })),
                    { required: true, onChange: () => form.setValue('subclassId', NONE) },
                  )}
                  {select(
                    'subclassId',
                    t('fields.subclass'),
                    (klass?.subclasses ?? []).map((x) => ({ value: x.id, label: localized(x.name) })),
                    { none: t('assetForm.noSubclass') },
                  )}
                  <GridSpan columns="full">
                    {select(
                      'siteId',
                      t('fields.site'),
                      sites.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` })),
                      {
                        required: true,
                        hint: asset ? t('assetForm.numberKept') : t('assetForm.numberHint'),
                      },
                    )}
                  </GridSpan>
                </Grid>
              </FormLayout>
            </VStack>

            <VStack gap={3} role="group" aria-labelledby={ids.responsibility}>
              <Text type="label" color="secondary" id={ids.responsibility}>
                {t('assetForm.responsibility')}
              </Text>
              <FormLayout defaultOptionality="optional">
                <Grid columns={{ minWidth: 240 }} gap={4}>
                  <FormField
                    control={form.control}
                    name="managerId"
                    render={({ field, fieldState }) => (
                      <Field
                        label={t('fields.manager')}
                        inputID={ids.manager}
                        status={fieldStatus(fieldState)}
                      >
                        <PersonField
                          id={ids.manager}
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t('assetForm.managerPlaceholder')}
                        />
                      </Field>
                    )}
                  />
                  {select(
                    'managerGroupId',
                    t('fields.managerGroup'),
                    (groups?.items ?? []).map((g) => ({ value: g.id, label: g.name })),
                    { none: t('assetForm.noGroup'), hasSearch: true },
                  )}
                </Grid>
              </FormLayout>
            </VStack>

            <VStack gap={3} role="group" aria-labelledby="isms-cia-heading">
              <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
                <Text type="label" color="secondary" id="isms-cia-heading">
                  {t('assetForm.cia')}
                </Text>
                <HStack gap={2} vAlign="center" wrap="wrap" aria-live="polite">
                  <Text>{t('fields.value')}</Text>
                  <StatusBadge
                    tone={value === null ? 'muted' : value >= 4 ? 'warning' : 'neutral'}
                    label={value === null ? t('assetForm.notScored') : t('value.badge', { value })}
                    changeKey={String(value)}
                  />
                  {value !== null && (
                    <Text type="supporting">
                      {t('assetForm.because', { dimensions: because.join(', '), value })}
                    </Text>
                  )}
                </HStack>
              </HStack>
              <Text as="p" type="supporting">
                {klass ? t('assetForm.ciaHint') : t('assetForm.ciaPickClass')}
              </Text>
              <Grid columns={{ minWidth: 200 }} gap={4}>
                {DIMENSIONS.map(([name, dim]) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field, fieldState }) => (
                      <CiaChooser
                        label={t(`fields.${name}`)}
                        hint={t(`assetForm.${name}Hint`)}
                        value={field.value}
                        onChange={field.onChange}
                        guidance={klass?.guidance[dim]}
                        error={fieldState.error?.message}
                      />
                    )}
                  />
                ))}
              </Grid>
              <FormLayout defaultOptionality="optional">
                {select(
                  'classificationId',
                  t('fields.classification'),
                  labels.map((x) => ({ value: x.id, label: localized(x.name) })),
                  {
                    none: t('assetForm.noClassification'),
                    onChange: () => setClassificationTouched(true),
                    hint:
                      !classificationTouched && suggested
                        ? t('assetForm.classificationSuggested')
                        : t('assetForm.classificationHint'),
                  },
                )}
              </FormLayout>
            </VStack>

            <VStack gap={3} role="group" aria-labelledby={ids.place}>
              <Text type="label" color="secondary" id={ids.place}>
                {t('assetForm.usersAndPlace')}
              </Text>
              <FormLayout defaultOptionality="optional">
                <FormField
                  control={form.control}
                  name="userIds"
                  render={({ field, fieldState }) => (
                    <Field label={t('fields.users')} inputID={ids.users} status={fieldStatus(fieldState)}>
                      <PeoplePicker
                        id={ids.users}
                        value={field.value}
                        onChange={field.onChange}
                        addLabel={t('assetForm.addUser')}
                      />
                    </Field>
                  )}
                />
                {text('location', t('fields.location'))}
              </FormLayout>
            </VStack>

            <OptionalFields
              key={detailsOpenByDefault ? 'open' : 'closed'}
              defaultOpen={detailsOpenByDefault}
              hint={list([
                t('fields.usersText'),
                t('fields.brand'),
                t('fields.model'),
                t('fields.version'),
                t('fields.quantity'),
                t('fields.notes'),
              ])}
              filled={detailsFilled}
            >
              <FormLayout defaultOptionality="optional">
                {text('usersText', t('fields.usersText'), {
                  hint: t('assetForm.usersTextHint'),
                  placeholder: t('assetForm.usersTextPlaceholder'),
                })}
                <Grid columns={{ minWidth: 200 }} gap={4}>
                  {text('brand', t('fields.brand'))}
                  {text('model', t('fields.model'))}
                  {text('version', t('fields.version'))}
                  <FormField
                    control={form.control}
                    name="quantity"
                    render={({ field, fieldState }) => (
                      <NumberInput
                        label={t('fields.quantity')}
                        isIntegerOnly
                        min={0}
                        value={field.value === '' ? null : Number(field.value)}
                        onChange={(n) => field.onChange(String(n))}
                        onBlur={field.onBlur}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                </Grid>
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
              </FormLayout>
            </OptionalFields>

            <CustomFieldsSection elements={elements} form={form as unknown as UseFormReturn<FieldValues>} />
            {form.formState.errors.root && (
              <Banner status="error" title={form.formState.errors.root.message ?? ''} collapsible={false} />
            )}
          </VStack>
        </SheetBody>
        <SheetFooter>
          <Button label={tc('cancel')} variant="secondary" type="button" onClick={onCancel} />
          <Button
            label={asset ? tc('saveChanges') : t('assetForm.register')}
            variant="primary"
            isLoading={save.isPending}
            type="submit"
          />
        </SheetFooter>
      </SheetForm>
    </Form>
  );
}

/**
 * Mark an asset missing or disposed of (or back in use) outside a stocktake, with a note for its history. Deleting
 * would lose that history.
 */
export function ChangeStatusDialog({
  asset,
  onOpenChange,
}: {
  asset: Asset;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('isms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const [status, setStatus] = useState<(typeof ASSET_STATUSES)[number]>(
    asset.status === 'active' ? 'missing' : 'active',
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api, body: UpdateAssetInput) => api.patch<Asset>(`/isms/assets/${asset.id}`, body),
    { invalidate: INVALIDATE, success: t('asset.statusChanged'), silent: true },
  );
  const needsNote = status !== 'active';
  return (
    <Dialog isOpen onOpenChange={onOpenChange} width={448} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('asset.changeStatusTitle', { number: asset.number })}
            subtitle={asset.name}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <RadioList
                label={t('fields.status')}
                value={status}
                onChange={(v) => setStatus(v as (typeof ASSET_STATUSES)[number])}
              >
                {ASSET_STATUSES.map((s) => (
                  <RadioListItem
                    key={s}
                    value={s}
                    label={t(`assetStatus.${s}`)}
                    description={t(`asset.statusHints.${s}`)}
                    isDisabled={s === asset.status}
                  />
                ))}
              </RadioList>
              <TextArea
                label={needsNote ? t('asset.statusNoteRequired') : t('asset.statusNote')}
                rows={2}
                value={note}
                onChange={setNote}
              />
              {error && <Banner status="error" title={error} collapsible={false} />}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              <Button
                label={t('asset.changeStatusSubmit')}
                variant="primary"
                isLoading={save.isPending}
                isDisabled={status === asset.status}
                onClick={async () => {
                  setError(null);
                  if (needsNote && !note.trim()) return setError(t('asset.statusNoteMissing'));
                  try {
                    await save.mutateAsync({ status, statusNote: note.trim() || null });
                    onOpenChange(false);
                  } catch (err) {
                    setError(errorText(err));
                  }
                }}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
