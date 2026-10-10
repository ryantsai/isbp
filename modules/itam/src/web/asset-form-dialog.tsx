'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Collapse } from '@isbp/ui/motion';
import { countFilled, OptionalFields } from '@isbp/ui/optional-fields';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
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
import { Textarea } from '@isbp/ui/textarea';
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
  const { data: locations } = useApiQuery<{ items: string[] }>('/itam/lookups/locations');
  const [assignee, setAssignee] = useState<PersonOption | null>(null);
  const [ci, setCi] = useState<Pick<CiRef, 'id' | 'reference' | 'name'> | null>(asset?.ci ?? null);
  const ids = {
    assignee: useId(),
    ci: useId(),
    locations: useId(),
    model: useId(),
    department: useId(),
    vendor: useId(),
  };

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

  const text = (name: 'name' | 'serialNumber' | 'invoiceNumber', label: string, placeholder?: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input placeholder={placeholder} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  const date = (name: 'purchaseDate' | 'warrantyEnd' | 'retireOn', label: string, hint?: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type="date" {...field} />
          </FormControl>
          {hint && <FormDescription>{hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <SheetForm onSubmit={onSubmit} noValidate>
        <SheetBody className="space-y-5">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-xs font-semibold text-muted-foreground">
              {t('assetForm.identity')}
            </legend>
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.category')}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      form.setValue('modelId', NONE);
                      setLifespan(null);
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ASSET_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          <CategoryIcon category={c} className="text-muted-foreground" />
                          {t(`category.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="modelId"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel htmlFor={ids.model}>{t('fields.model')}</FormLabel>
                  <ModelSelect
                    id={ids.model}
                    value={field.value}
                    category={category}
                    onChange={(id, model) => {
                      field.onChange(id);
                      setLifespan(model?.lifespanMonths ?? null);
                    }}
                  />
                  {!asset && lifespan !== null && (
                    <FormDescription>
                      {purchaseDate
                        ? t('assetForm.retiresOn', { date: day(addMonths(purchaseDate, lifespan)) })
                        : t('assetForm.lifespan', { months: lifespan })}
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            {text('name', t('fields.name'), t('assetForm.namePlaceholder'))}
            {text('serialNumber', t('fields.serialNumber'), t('assetForm.serialPlaceholder'))}
            {!asset && (
              <div className="grid min-w-0 gap-2 sm:col-span-2">
                <Label htmlFor={ids.assignee}>{t('assetForm.assignTo')}</Label>
                <PersonPicker
                  id={ids.assignee}
                  value={assignee}
                  onChange={setAssignee}
                  placeholder={t('assetForm.assignToPlaceholder')}
                />
              </div>
            )}
            {!asset &&
              (assignee ? (
                <p className="text-sm sm:col-span-2" aria-live="polite">
                  {t('assetForm.willDeploy', { name: assignee.displayName })}
                </p>
              ) : (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{t('fields.status')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="in_stock">{t('status.in_stock')}</SelectItem>
                          <SelectItem value="ordered">{t('status.ordered')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>{t('assetForm.statusHint')}</FormDescription>
                    </FormItem>
                  )}
                />
              ))}
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-xs font-semibold text-muted-foreground">
              {t('assetForm.placement')}
            </legend>
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.location')}</FormLabel>
                  <FormControl>
                    <Input list={ids.locations} placeholder={t('assetForm.locationPlaceholder')} {...field} />
                  </FormControl>
                  <datalist id={ids.locations}>
                    {(locations?.items ?? []).map((l) => (
                      <option key={l} value={l} />
                    ))}
                  </datalist>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="departmentId"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel htmlFor={ids.department}>{t('fields.department')}</FormLabel>
                  <DepartmentSelect id={ids.department} value={field.value} onChange={field.onChange} />
                  <FormMessage />
                </FormItem>
              )}
            />
            <Collapse open={showCi} className="sm:col-span-2">
              <div className="grid min-w-0 gap-2">
                <Label htmlFor={ids.ci}>{t('fields.ci')}</Label>
                <CiPicker id={ids.ci} value={ci} onChange={setCi} />
                <p className="text-xs text-muted-foreground">{t('assetForm.ciHint')}</p>
              </div>
            </Collapse>
          </fieldset>

          <OptionalFields
            label={t('assetForm.purchase')}
            filled={purchaseFilled}
            contentClassName="grid gap-4 pt-3 sm:grid-cols-2"
          >
            <FormField
              control={form.control}
              name="vendorId"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel htmlFor={ids.vendor}>{t('fields.vendor')}</FormLabel>
                  <VendorSelect id={ids.vendor} value={field.value} onChange={field.onChange} />
                  <FormMessage />
                </FormItem>
              )}
            />
            {text('invoiceNumber', t('fields.invoiceNumber'))}
            {date('purchaseDate', t('fields.purchaseDate'))}
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
              <FormField
                control={form.control}
                name="purchaseCost"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{t('fields.purchaseCost')}</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{t('fields.currency')}</FormLabel>
                    <FormControl>
                      <Input maxLength={3} className="uppercase" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {date('warrantyEnd', t('fields.warrantyEnd'))}
            {asset && date('retireOn', t('fields.retireOn'), t('assetForm.retireOnHint'))}
          </OptionalFields>

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.notes')}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <CustomFieldsSection elements={elements} form={form as unknown as UseFormReturn<FieldValues>} />

          {form.formState.errors.root && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {asset ? tc('saveChanges') : tc('save')}
          </Button>
        </SheetFooter>
      </SheetForm>
    </Form>
  );
}
