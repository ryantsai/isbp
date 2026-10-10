'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import { ExternalLinkIcon, MailIcon, PencilIcon, PhoneIcon, UserIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { CreateVendorInput, Vendor, VendorDetail } from '../contracts';
import { ComplianceBadge, ContractStatusBadge } from './badges';
import { contractHref, INVALIDATE, licenseHref, useDay, useMoney } from './lib';

export function VendorFormDialog({
  open,
  onOpenChange,
  vendor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: Vendor;
  onSaved?: (v: VendorDetail) => void;
}) {
  const t = useTranslations('itam.vendorForm');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{vendor ? t('editTitle', { name: vendor.name }) : t('createTitle')}</DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>
        {open && (
          <VendorForm
            vendor={vendor}
            onCancel={() => onOpenChange(false)}
            onSaved={(v) => {
              onOpenChange(false);
              onSaved?.(v);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function VendorForm({
  vendor,
  onCancel,
  onSaved,
}: {
  vendor?: Vendor;
  onCancel: () => void;
  onSaved: (v: VendorDetail) => void;
}) {
  const t = useTranslations('itam');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const activeId = useId();
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('vendorForm.nameRequired')).max(200),
        website: z
          .string()
          .trim()
          .max(500)
          .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), t('vendorForm.websiteInvalid')),
        contactName: z.string().trim().max(200),
        contactEmail: z
          .string()
          .trim()
          .max(320)
          .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), t('vendorForm.emailInvalid')),
        phone: z.string().trim().max(50),
        notes: z.string().max(5000),
        active: z.boolean(),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: vendor?.name ?? '',
      website: vendor?.website ?? '',
      contactName: vendor?.contactName ?? '',
      contactEmail: vendor?.contactEmail ?? '',
      phone: vendor?.phone ?? '',
      notes: vendor?.notes ?? '',
      active: vendor?.active ?? true,
    },
  });
  const list = useFieldList();
  const details = useWatch({
    control: form.control,
    name: ['website', 'contactName', 'phone', 'contactEmail', 'notes'],
  });
  const detailsFilled = countFilled(...details);

  const save = useApiMutation(
    (api, body: CreateVendorInput) =>
      vendor
        ? api.patch<VendorDetail>(`/itam/vendors/${vendor.id}`, body)
        : api.post<VendorDetail>('/itam/vendors', body),
    { invalidate: INVALIDATE, success: t('vendorForm.saved'), onSuccess: onSaved, silent: true },
  );
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        name: v.name.trim(),
        website: v.website.trim() || null,
        contactName: v.contactName.trim() || null,
        contactEmail: v.contactEmail.trim() || null,
        phone: v.phone.trim() || null,
        notes: v.notes.trim() || null,
        active: v.active,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('name', { message: t('vendorForm.nameTaken') });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });
  const field = (
    name: 'name' | 'website' | 'contactName' | 'contactEmail' | 'phone',
    label: string,
    type?: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field: f }) => (
        <FormItem className="min-w-0">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={type} {...f} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {field('name', t('fields.name'))}
        <FormField
          control={form.control}
          name="active"
          render={({ field: f }) => (
            <FormItem className="flex flex-row items-center gap-3">
              <FormControl>
                <Switch id={activeId} checked={f.value} onCheckedChange={f.onChange} />
              </FormControl>
              <FormLabel htmlFor={activeId} className="font-normal">
                {t('vendors.active')}
              </FormLabel>
            </FormItem>
          )}
        />
        <OptionalFields
          hint={list([
            t('vendors.contact'),
            t('vendors.phone'),
            t('vendors.email'),
            t('vendors.website'),
            t('fields.notes'),
          ])}
          filled={detailsFilled}
        >
          {field('website', t('vendors.website'), 'url')}
          <div className="grid gap-4 sm:grid-cols-2">
            {field('contactName', t('vendors.contact'))}
            {field('phone', t('vendors.phone'), 'tel')}
          </div>
          {field('contactEmail', t('vendors.email'), 'email')}
          <FormField
            control={form.control}
            name="notes"
            render={({ field: f }) => (
              <FormItem>
                <FormLabel>{t('fields.notes')}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...f} />
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
            {vendor ? tc('saveChanges') : tc('create')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

/** A vendor's contact, contracts, licences and spend. */
export function VendorSheet({
  vendorId,
  onOpenChange,
  canEdit,
}: {
  vendorId: string | null;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}) {
  const t = useTranslations('itam');
  const tc = useTranslations('common');
  const money = useMoney();
  const day = useDay();
  const { data: v, isLoading } = useApiQuery<VendorDetail>(vendorId ? `/itam/vendors/${vendorId}` : null);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Sheet open={Boolean(vendorId)} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-lg" closeLabel={tc('close')}>
          <SheetHeader>
            <SheetTitle className="pr-8">{v?.name ?? t('vendors.loading')}</SheetTitle>
            <SheetDescription>
              {v ? (v.active ? t('vendors.activeVendor') : t('vendors.inactiveVendor')) : ''}
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-5 pb-6">
            {isLoading || !v ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{t('vendors.annualSpend')}</dt>
                    <dd className="text-lg font-semibold">
                      {money(v.annualSpend, v.currency, { compact: true })}
                    </dd>
                  </div>
                  <div className="rounded-lg border px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{t('vendors.hardware12m')}</dt>
                    <dd className="text-lg font-semibold">
                      {money(v.hardwareSpend12m, v.currency, { compact: true })}
                    </dd>
                  </div>
                </dl>
                <section className="grid gap-2 text-sm" aria-label={t('vendors.contact')}>
                  {v.contactName && (
                    <p className="flex items-center gap-2">
                      <UserIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      {v.contactName}
                    </p>
                  )}
                  {v.contactEmail && (
                    <a href={`mailto:${v.contactEmail}`} className="flex items-center gap-2 hover:underline">
                      <MailIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      {v.contactEmail}
                    </a>
                  )}
                  {v.phone && (
                    <a
                      href={`tel:${v.phone.replace(/[^\d+]/g, '')}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <PhoneIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      {v.phone}
                    </a>
                  )}
                  {v.website && (
                    <a
                      href={v.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 items-center gap-2 hover:underline"
                    >
                      <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{v.website}</span>
                    </a>
                  )}
                  {v.notes && <p className="whitespace-pre-wrap text-muted-foreground">{v.notes}</p>}
                </section>
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">
                    {t('vendors.contracts', { count: v.contracts.length })}
                  </h3>
                  {v.contracts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {v.contracts.map((c) => (
                        <li key={c.id} className="grid gap-1 px-3 py-2 text-sm">
                          <div className="flex min-w-0 items-center gap-2">
                            <Link
                              href={contractHref(c)}
                              className="min-w-0 flex-1 truncate font-medium hover:underline"
                            >
                              {c.title}
                            </Link>
                            <ContractStatusBadge status={c.status} />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            <span className="font-mono">{c.reference}</span> · {day(c.endDate)} ·{' '}
                            {money(c.annualCost, c.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">
                    {t('vendors.licenses', { count: v.licenses.length })}
                  </h3>
                  {v.licenses.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {v.licenses.map((l) => (
                        <li key={l.id} className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
                          <Link href={licenseHref(l)} className="min-w-0 flex-1 truncate hover:underline">
                            {l.product}
                          </Link>
                          <ComplianceBadge state={l.complianceState} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <p className="text-xs text-muted-foreground">
                  <Badge variant="muted" className="mr-1">
                    {v.counts.assets}
                  </Badge>
                  {t('vendors.assetsBought')}
                </p>
                {canEdit && (
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <PencilIcon /> {t('actions.edit')}
                  </Button>
                )}
              </>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
      {canEdit && v && <VendorFormDialog open={editing} onOpenChange={setEditing} vendor={v} />}
    </>
  );
}
