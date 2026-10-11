'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Switch } from '@astryxdesign/core/Switch';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { FormDialog } from '@isbp/ui/form-dialog';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatTile } from '@isbp/ui/stat-tile';
import { ExternalLinkIcon, MailIcon, PencilIcon, PhoneIcon, UserIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
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
  // Mounted per opening: the dialog takes its accessible name from the header it opens with.
  if (!open) return null;
  return (
    <VendorForm
      vendor={vendor}
      onCancel={() => onOpenChange(false)}
      onSaved={(v) => {
        onOpenChange(false);
        onSaved?.(v);
      }}
    />
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
    options: { type?: 'email'; isRequired?: boolean } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field: f, fieldState }) => (
        <TextInput
          label={label}
          type={options.type}
          isRequired={options.isRequired}
          value={f.value}
          onChange={f.onChange}
          onBlur={f.onBlur}
          ref={f.ref}
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
        size="md"
        title={vendor ? t('vendorForm.editTitle', { name: vendor.name }) : t('vendorForm.createTitle')}
        subtitle={t('vendorForm.hint')}
        onSubmit={onSubmit}
        submitLabel={vendor ? tc('saveChanges') : tc('create')}
        cancelLabel={tc('cancel')}
        isSubmitting={save.isPending}
        defaultOptionality="optional"
      >
        {field('name', t('fields.name'), { isRequired: true })}
        <FormField
          control={form.control}
          name="active"
          render={({ field: f }) => (
            <Switch label={t('vendors.active')} value={f.value} onChange={f.onChange} />
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
          {field('website', t('vendors.website'))}
          <Grid columns={{ minWidth: 200 }} gap={4}>
            {field('contactName', t('vendors.contact'))}
            {field('phone', t('vendors.phone'))}
          </Grid>
          {field('contactEmail', t('vendors.email'), { type: 'email' })}
          <FormField
            control={form.control}
            name="notes"
            render={({ field: f, fieldState }) => (
              <TextArea
                label={t('fields.notes')}
                rows={3}
                value={f.value}
                onChange={f.onChange}
                onBlur={f.onBlur}
                ref={f.ref}
                status={fieldStatus(fieldState)}
              />
            )}
          />
        </OptionalFields>
        {form.formState.errors.root && (
          <Banner status="error" title={form.formState.errors.root.message ?? ''} collapsible={false} />
        )}
      </FormDialog>
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
          <SheetBody className="pb-6">
            {isLoading || !v ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <VStack gap={5}>
                <Grid columns={2} gap={2}>
                  <StatTile
                    label={t('vendors.annualSpend')}
                    value={money(v.annualSpend, v.currency, { compact: true })}
                  />
                  <StatTile
                    label={t('vendors.hardware12m')}
                    value={money(v.hardwareSpend12m, v.currency, { compact: true })}
                  />
                </Grid>
                <VStack as="section" gap={2} aria-label={t('vendors.contact')}>
                  {v.contactName && (
                    <HStack gap={2} vAlign="center">
                      <Icon icon={UserIcon} color="secondary" />
                      <Text>{v.contactName}</Text>
                    </HStack>
                  )}
                  {v.contactEmail && (
                    <HStack gap={2} vAlign="center">
                      <Icon icon={MailIcon} color="secondary" />
                      <Link href={`mailto:${v.contactEmail}`}>{v.contactEmail}</Link>
                    </HStack>
                  )}
                  {v.phone && (
                    <HStack gap={2} vAlign="center">
                      <Icon icon={PhoneIcon} color="secondary" />
                      <Link href={`tel:${v.phone.replace(/[^\d+]/g, '')}`}>{v.phone}</Link>
                    </HStack>
                  )}
                  {v.website && (
                    <HStack gap={2} vAlign="center">
                      <Icon icon={ExternalLinkIcon} color="secondary" />
                      <StackItem size="fill">
                        <Link href={v.website} target="_blank" maxLines={1}>
                          {v.website}
                        </Link>
                      </StackItem>
                    </HStack>
                  )}
                  {v.notes && (
                    <Text as="p" color="secondary">
                      {v.notes}
                    </Text>
                  )}
                </VStack>
                <VStack as="section" gap={2}>
                  <Heading level={3}>{t('vendors.contracts', { count: v.contracts.length })}</Heading>
                  {v.contracts.length === 0 ? (
                    <Text color="secondary">—</Text>
                  ) : (
                    <List hasDividers>
                      {v.contracts.map((c) => (
                        <ListItem
                          key={c.id}
                          href={contractHref(c)}
                          label={c.title}
                          description={`${c.reference} · ${day(c.endDate)} · ${money(c.annualCost, c.currency)}`}
                          endContent={<ContractStatusBadge status={c.status} />}
                        />
                      ))}
                    </List>
                  )}
                </VStack>
                <VStack as="section" gap={2}>
                  <Heading level={3}>{t('vendors.licenses', { count: v.licenses.length })}</Heading>
                  {v.licenses.length === 0 ? (
                    <Text color="secondary">—</Text>
                  ) : (
                    <List hasDividers>
                      {v.licenses.map((l) => (
                        <ListItem
                          key={l.id}
                          href={licenseHref(l)}
                          label={l.product}
                          endContent={<ComplianceBadge state={l.complianceState} />}
                        />
                      ))}
                    </List>
                  )}
                </VStack>
                <HStack gap={1} vAlign="center">
                  <Badge variant="neutral" label={v.counts.assets} />
                  <Text type="supporting">{t('vendors.assetsBought')}</Text>
                </HStack>
                {canEdit && (
                  <HStack>
                    <Button
                      label={t('actions.edit')}
                      variant="secondary"
                      icon={<Icon icon={PencilIcon} />}
                      onClick={() => setEditing(true)}
                    />
                  </HStack>
                )}
              </VStack>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
      {canEdit && v && <VendorFormDialog open={editing} onOpenChange={setEditing} vendor={v} />}
    </>
  );
}
