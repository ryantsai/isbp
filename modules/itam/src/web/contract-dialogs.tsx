'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
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
  const t = useTranslations('itam.contractForm');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>
            {contract ? t('editTitle', { reference: contract.reference }) : t('createTitle')}
          </DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>
        {open && (
          <ContractForm
            contract={contract}
            onCancel={() => onOpenChange(false)}
            onSaved={(c) => {
              onOpenChange(false);
              onSaved?.(c);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
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
  const ids = { owner: useId(), vendor: useId(), autoRenew: useId(), draft: useId() };

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

  const input = (
    name: 'title' | 'startDate' | 'endDate' | 'noticeDays',
    label: string,
    props: { type?: string; hint?: string; inputMode?: 'numeric' } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={props.type} inputMode={props.inputMode} {...field} />
          </FormControl>
          {props.hint && <FormDescription>{props.hint}</FormDescription>}
          <FormMessage />
        </FormItem>
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
                  {t(`${ns}.${o}` as 'contractKind.support')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{input('title', t('fields.title'))}</div>
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
          {select('kind', t('fields.kind'), CONTRACT_KINDS, 'contractKind')}
          {input('startDate', t('fields.startDate'), { type: 'date' })}
          {input('endDate', t('fields.endDate'), { type: 'date' })}
        </div>
        <OptionalFields
          hint={list([t('fields.noticeDays'), t('fields.cost'), t('fields.owner'), t('fields.notes')])}
          filled={detailsFilled}
          contentClassName="grid gap-4 pt-3 sm:grid-cols-2"
        >
          {input('noticeDays', t('fields.noticeDays'), {
            inputMode: 'numeric',
            hint: t('contractForm.noticeHint'),
          })}
          <FormField
            control={form.control}
            name="autoRenew"
            render={({ field }) => (
              <FormItem className="flex min-w-0 flex-row items-center gap-3 self-end pb-2">
                <FormControl>
                  <Switch id={ids.autoRenew} checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel htmlFor={ids.autoRenew} className="font-normal">
                  {t('fields.autoRenew')}
                </FormLabel>
              </FormItem>
            )}
          />
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
          {select('billing', t('fields.billing'), CONTRACT_BILLING, 'billing')}
          <div className="grid min-w-0 gap-2 sm:col-span-2">
            <Label htmlFor={ids.owner}>{t('fields.owner')}</Label>
            <PersonPicker
              id={ids.owner}
              value={owner}
              onChange={setOwner}
              placeholder={t('contractForm.ownerPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">{t('contractForm.ownerHint')}</p>
          </div>
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>{t('fields.notes')}</FormLabel>
                <FormControl>
                  <Textarea rows={5} {...field} />
                </FormControl>
                <FormDescription>{t('contractForm.notesHint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {!contract && (
            <FormField
              control={form.control}
              name="draft"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 sm:col-span-2">
                  <FormControl>
                    <Checkbox
                      id={ids.draft}
                      checked={field.value}
                      onCheckedChange={(c) => field.onChange(c === true)}
                    />
                  </FormControl>
                  <FormLabel htmlFor={ids.draft} className="font-normal">
                    {t('contractForm.draft')}
                  </FormLabel>
                </FormItem>
              )}
            />
          )}
        </OptionalFields>
        <CustomFieldsSection elements={elements} form={form as unknown as UseFormReturn<FieldValues>} />
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
            {contract ? tc('saveChanges') : tc('create')}
          </Button>
        </DialogFooter>
      </form>
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
  const ids = { start: useId(), end: useId(), cost: useId(), note: useId() };
  const defaultStart = contract.endDate ? addDays(contract.endDate, 1) : contract.today;
  const termDays =
    contract.startDate && contract.endDate
      ? Math.max(30, Math.round((Date.parse(contract.endDate) - Date.parse(contract.startDate)) / 86_400_000))
      : 364;
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(addDays(defaultStart, termDays));
  const [cost, setCost] = useState(contract.cost !== null ? String(contract.cost) : '');
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
    if (cost !== '' && !(Number(cost) >= 0)) return setError(t('costInvalid'));
    try {
      await renew.mutateAsync({
        startDate: start,
        endDate: end,
        cost: cost === '' ? null : Number(cost),
        note: note.trim() || null,
      });
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { reference: contract.reference })}</DialogTitle>
          <DialogDescription>{t('hint', { end: day(contract.endDate) })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={ids.start}>{t('start')}</Label>
              <Input id={ids.start} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={ids.end}>{t('end')}</Label>
              <Input
                id={ids.end}
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                aria-invalid={Boolean(error) || undefined}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={ids.cost}>{t('cost', { currency: contract.currency })}</Label>
            <Input id={ids.cost} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={ids.note}>{t('note')}</Label>
            <Textarea
              id={ids.note}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
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
            <Button type="submit" loading={renew.isPending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const ids = { asset: useId(), license: useId() };
  const save = useApiMutation(
    (api, body: { assetIds: string[]; licenseIds: string[] }) =>
      api.put<ContractDetail>(`/itam/contracts/${contract.id}/items`, body),
    { invalidate: INVALIDATE, success: t('saved'), onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { reference: contract.reference })}</DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor={ids.asset}>{t('addAsset')}</Label>
            <div className="flex min-w-0 gap-2">
              <div className="min-w-0 flex-1">
                <AssetPicker
                  id={ids.asset}
                  value={asset}
                  onChange={setAsset}
                  excludeIds={assets.map((a) => a.id)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!asset}
                onClick={() => {
                  if (asset) setAssets((list) => [...list, asset]);
                  setAsset(null);
                }}
              >
                <PlusIcon /> {tc('add')}
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={ids.license}>{t('addLicense')}</Label>
            <div className="flex min-w-0 gap-2">
              <div className="min-w-0 flex-1">
                <LicensePicker
                  id={ids.license}
                  value={license}
                  onChange={setLicense}
                  excludeIds={licenses.map((l) => l.id)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!license}
                onClick={() => {
                  if (license) setLicenses((list) => [...list, license]);
                  setLicense(null);
                }}
              >
                <PlusIcon /> {tc('add')}
              </Button>
            </div>
          </div>
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">
              {t('covered', { count: assets.length + licenses.length })}
            </h3>
            {assets.length + licenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('nothing')}</p>
            ) : (
              <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                {assets.map((a) => (
                  <li key={a.id} className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm">
                    <CategoryIcon category={a.category} className="text-muted-foreground" label />
                    <span className="font-mono text-xs text-muted-foreground">{a.tag}</span>
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('remove', { name: a.tag })}
                      onClick={() => setAssets((list) => list.filter((x) => x.id !== a.id))}
                    >
                      <XIcon />
                    </Button>
                  </li>
                ))}
                {licenses.map((l) => (
                  <li key={l.id} className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm">
                    <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="font-mono text-xs text-muted-foreground">{l.reference}</span>
                    <span className="min-w-0 flex-1 truncate">{l.product}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('remove', { name: l.reference })}
                      onClick={() => setLicenses((list) => list.filter((x) => x.id !== l.id))}
                    >
                      <XIcon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate({ assetIds: assets.map((a) => a.id), licenseIds: licenses.map((l) => l.id) })
            }
          >
            {tc('saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
