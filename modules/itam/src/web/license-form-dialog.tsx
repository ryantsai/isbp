'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Page } from '@isbp/sdk';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
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
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { applyServerErrors, useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
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
  const t = useTranslations('itam.licenseForm');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>
            {license ? t('editTitle', { reference: license.reference }) : t('createTitle')}
          </DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>
        {open && (
          <LicenseForm
            license={license}
            onCancel={() => onOpenChange(false)}
            onSaved={(l) => {
              onOpenChange(false);
              onSaved?.(l);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
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
  const ids = { removeKey: useId(), vendor: useId() };

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
      render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>{label}</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o} value={o}>
                  {t(`${ns}.${o}` as 'licenseType.per_user')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  const input = (
    name: 'product' | 'publisher' | 'quantity' | 'startDate' | 'endDate',
    label: string,
    props: { type?: string; placeholder?: string; hint?: string; inputMode?: 'numeric' } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={props.type} placeholder={props.placeholder} inputMode={props.inputMode} {...field} />
          </FormControl>
          {props.hint && <FormDescription>{props.hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          {input('product', t('fields.product'), {
            placeholder: 'Microsoft 365 E3',
            hint: t('licenseForm.productHint'),
          })}
          {select('licenseType', t('fields.licenseType'), LICENSE_TYPES, 'licenseType')}
          {input('quantity', t('fields.quantity'), {
            inputMode: 'numeric',
            hint: t('licenseForm.quantityHint'),
          })}
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
          {input('startDate', t('fields.startDate'), { type: 'date' })}
          {input('endDate', t('fields.endDate'), { type: 'date', hint: t('licenseForm.endHint') })}
        </div>
        <OptionalFields
          hint={list([t('fields.publisher'), t('fields.cost'), t('fields.licenseKey'), t('fields.notes')])}
          filled={detailsFilled}
          contentClassName="grid gap-4 pt-3 sm:grid-cols-2"
        >
          {input('publisher', t('fields.publisher'))}
          {canContracts && (
            <FormField
              control={form.control}
              name="contractId"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.contract')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>
                        <span className="text-muted-foreground">{t('licenseForm.noContract')}</span>
                      </SelectItem>
                      {(contracts?.items ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="font-mono text-xs text-muted-foreground">{c.reference}</span>{' '}
                          {c.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
            <FormField
              control={form.control}
              name="cost"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.cost')}</FormLabel>
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
          {select('billing', t('fields.billing'), LICENSE_BILLING, 'billing')}
          <FormField
            control={form.control}
            name="licenseKey"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>{t('fields.licenseKey')}</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="off" spellCheck={false} {...field} />
                </FormControl>
                <FormDescription>
                  {license?.hasKey ? t('licenseForm.keyKeep') : t('licenseForm.keyHint')}
                </FormDescription>
                {license?.hasKey && (
                  <div className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={ids.removeKey}
                      checked={removeKey}
                      onCheckedChange={(c) => setRemoveKey(c === true)}
                    />
                    <Label htmlFor={ids.removeKey} className="font-normal">
                      {t('licenseForm.removeKey')}
                    </Label>
                  </div>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>{t('fields.notes')}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </OptionalFields>
        {form.formState.errors.root && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {license ? tc('saveChanges') : tc('create')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
