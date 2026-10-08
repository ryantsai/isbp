'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
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
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Textarea } from '@isbp/ui/textarea';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { type FieldValues, useForm, type UseFormReturn, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { type Asset, type AssetClass, CIA_LEVELS, type CreateAssetInput, type Guidance } from '../contracts';
import { assetValue } from '../model';
import { ValueBadge } from './badges';
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
  value: number;
  onChange: (v: number) => void;
  guidance: Guidance['c'] | undefined;
  error?: string;
}) {
  const localized = useLocalized();
  const t = useTranslations('isms.assetForm');
  const name = useId();
  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={`${name}-hint`}>
      <legend className="text-sm font-medium">{label}</legend>
      <p id={`${name}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
      <div className="grid grid-cols-1 gap-2">
        {[...CIA_LEVELS].reverse().map((level) => {
          const text = guidance ? localized(guidance[String(level) as '1']) : '';
          const id = `${name}-${level}`;
          return (
            <label
              key={level}
              htmlFor={id}
              className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={level}
                checked={value === level}
                onChange={() => onChange(level)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="min-w-0">
                <span className="font-medium tabular-nums">{t('level', { level })}</span>
                <span className="block text-xs text-muted-foreground wrap-anywhere">
                  {text || t('noGuidance')}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
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
  const ids = { manager: useId(), users: useId() };

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
        confidentiality: z.number().int().min(1).max(4),
        integrity: z.number().int().min(1).max(4),
        availability: z.number().int().min(1).max(4),
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
      confidentiality: asset?.confidentiality ?? 1,
      integrity: asset?.integrity ?? 1,
      availability: asset?.availability ?? 1,
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
  const klass: AssetClass | undefined = taxonomy?.classes.find((x) => x.id === classId);
  const value = assetValue(c, i, a);

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
      confidentiality: v.confidentiality,
      integrity: v.integrity,
      availability: v.availability,
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

  const text = (name: 'name' | 'location' | 'brand' | 'model' | 'version', label: string, hint?: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...field} />
          </FormControl>
          {hint && <FormDescription>{hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
  const select = (
    name: 'classId' | 'subclassId' | 'siteId' | 'managerGroupId' | 'classificationId',
    label: string,
    options: { value: string; label: string }[],
    opts: { none?: string; onChange?: (v: string) => void; hint?: string } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>{label}</FormLabel>
          <Select
            value={field.value || undefined}
            onValueChange={(v) => {
              field.onChange(v);
              opts.onChange?.(v);
            }}
          >
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('assetForm.choose')} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {opts.none && <SelectItem value={NONE}>{opts.none}</SelectItem>}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {opts.hint && <FormDescription>{opts.hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
        <SheetBody className="space-y-6">
          <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('assetForm.identity')}
            </legend>
            <div className="sm:col-span-2">{text('name', t('fields.name'), t('assetForm.nameHint'))}</div>
            {select(
              'classId',
              t('fields.class'),
              (taxonomy?.classes ?? []).map((x) => ({
                value: x.id,
                label: `${x.code} · ${localized(x.name)}`,
              })),
              { onChange: () => form.setValue('subclassId', NONE) },
            )}
            {select(
              'subclassId',
              t('fields.subclass'),
              (klass?.subclasses ?? []).map((x) => ({ value: x.id, label: localized(x.name) })),
              { none: t('assetForm.noSubclass') },
            )}
            {select(
              'siteId',
              t('fields.site'),
              sites.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` })),
              { hint: asset ? t('assetForm.numberKept') : t('assetForm.numberHint') },
            )}
            {select(
              'classificationId',
              t('fields.classification'),
              (taxonomy?.labels ?? []).map((x) => ({ value: x.id, label: localized(x.name) })),
              { none: t('assetForm.noClassification') },
            )}
          </fieldset>

          <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('assetForm.responsibility')}
            </legend>
            <FormField
              control={form.control}
              name="managerId"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <Label htmlFor={ids.manager}>{t('fields.manager')}</Label>
                  <PersonField
                    id={ids.manager}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder={t('assetForm.managerPlaceholder')}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            {select(
              'managerGroupId',
              t('fields.managerGroup'),
              (groups?.items ?? []).map((g) => ({ value: g.id, label: g.name })),
              { none: t('assetForm.noGroup') },
            )}
            <FormField
              control={form.control}
              name="userIds"
              render={({ field }) => (
                <FormItem className="min-w-0 sm:col-span-2">
                  <Label htmlFor={ids.users}>{t('fields.users')}</Label>
                  <PeoplePicker
                    id={ids.users}
                    value={field.value}
                    onChange={field.onChange}
                    addLabel={t('assetForm.addUser')}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="usersText"
              render={({ field }) => (
                <FormItem className="min-w-0 sm:col-span-2">
                  <FormLabel>{t('fields.usersText')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('assetForm.usersTextPlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="sm:col-span-2">{text('location', t('fields.location'))}</div>
          </fieldset>

          <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('assetForm.details')}
            </legend>
            {text('brand', t('fields.brand'))}
            {text('model', t('fields.model'))}
            {text('version', t('fields.version'))}
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.quantity')}</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </fieldset>

          <section aria-labelledby="isms-cia-heading" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3
                id="isms-cia-heading"
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                {t('assetForm.cia')}
              </h3>
              <p className="flex items-center gap-2 text-sm" aria-live="polite">
                {t('fields.value')} <ValueBadge value={value} />
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {klass ? t('assetForm.ciaHint') : t('assetForm.ciaPickClass')}
            </p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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
            </div>
          </section>

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
        <SheetFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {asset ? tc('saveChanges') : t('assetForm.register')}
          </Button>
        </SheetFooter>
      </form>
    </Form>
  );
}
