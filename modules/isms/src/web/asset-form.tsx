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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
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
import { Disclosure } from '@isbp/ui/motion';
import { StatusBadge } from '@isbp/ui/status';
import { Textarea } from '@isbp/ui/textarea';
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
  const name = useId();
  return (
    <fieldset
      className="min-w-0 space-y-2"
      aria-describedby={`${name}-hint`}
      aria-invalid={error ? true : undefined}
    >
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
    opts: { none?: string; onChange?: (v: string) => void; hint?: React.ReactNode } = {},
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
            <div className="sm:col-span-2">
              {select(
                'siteId',
                t('fields.site'),
                sites.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` })),
                { hint: asset ? t('assetForm.numberKept') : t('assetForm.numberHint') },
              )}
            </div>
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
          </fieldset>

          <section aria-labelledby="isms-cia-heading" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3
                id="isms-cia-heading"
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                {t('assetForm.cia')}
              </h3>
              <p className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
                {t('fields.value')}
                <StatusBadge
                  tone={value === null ? 'muted' : value >= 4 ? 'warning' : 'neutral'}
                  label={value === null ? t('assetForm.notScored') : t('value.badge', { value })}
                  changeKey={String(value)}
                />
                {value !== null && (
                  <span className="text-xs text-muted-foreground">
                    {t('assetForm.because', { dimensions: because.join(', '), value })}
                  </span>
                )}
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
          </section>

          <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('assetForm.usersAndPlace')}
            </legend>
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
                  <FormDescription>{t('assetForm.usersTextHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="sm:col-span-2">{text('location', t('fields.location'))}</div>
          </fieldset>

          <Disclosure
            key={detailsOpenByDefault ? 'open' : 'closed'}
            summary={t('assetForm.details')}
            defaultOpen={detailsOpenByDefault || Boolean(asset?.brand || asset?.model || asset?.version)}
            triggerClassName="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            <div className="grid grid-cols-1 gap-4 pt-3 sm:grid-cols-2">
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
            </div>
          </Disclosure>

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
  const name = useId();
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
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('asset.changeStatusTitle', { number: asset.number })}</DialogTitle>
          <DialogDescription>{asset.name}</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('fields.status')}</legend>
          {ASSET_STATUSES.map((s) => (
            <label
              key={s}
              htmlFor={`${name}-${s}`}
              className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
            >
              <input
                id={`${name}-${s}`}
                type="radio"
                name={name}
                checked={status === s}
                disabled={s === asset.status}
                onChange={() => setStatus(s)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="font-medium">{t(`assetStatus.${s}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`asset.statusHints.${s}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor={`${name}-note`}>
            {needsNote ? t('asset.statusNoteRequired') : t('asset.statusNote')}
          </Label>
          <Textarea id={`${name}-note`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            loading={save.isPending}
            disabled={status === asset.status}
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
          >
            {t('asset.changeStatusSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
