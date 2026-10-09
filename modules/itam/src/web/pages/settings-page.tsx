'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Page } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { EmptyState } from '@isbp/ui/empty-state';
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
import { SavedIndicator } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { CircleCheckIcon, CircleMinusIcon, LayersIcon, PlusIcon, SlidersHorizontalIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  ASSET_CATEGORIES,
  type CreateModelInput,
  DEFAULT_LIFESPAN_MONTHS,
  type ItamSettings,
  type Model,
} from '../../contracts';
import { CategoryIcon, CategoryLabel } from '../badges';
import { INVALIDATE } from '../lib';

const ALL = '__all__';

/** Assets administration: the hardware model catalogue and the module's general settings. */
export default function SettingsPage() {
  const t = useTranslations('itam.settingsPage');
  const [state, set] = useListState();
  const tab = state.tab === 'general' ? 'general' : 'models';
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs value={tab} onValueChange={(v) => set({ tab: v === 'models' ? undefined : v })}>
        <TabsList>
          <TabsTrigger value="models">
            <LayersIcon aria-hidden />
            {t('tabs.models')}
          </TabsTrigger>
          <TabsTrigger value="general">
            <SlidersHorizontalIcon aria-hidden />
            {t('tabs.general')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="models" className="min-w-0">
          {tab === 'models' && <ModelsTab />}
        </TabsContent>
        <TabsContent value="general" className="min-w-0">
          {tab === 'general' && <GeneralTab />}
        </TabsContent>
      </Tabs>
    </>
  );
}

function ModelsTab() {
  const t = useTranslations('itam');
  const [state, set] = useListState({ pageSize: 25 });
  const [editing, setEditing] = useState<Model | 'new' | null>(null);
  const category = (state.category as string | undefined) || undefined;
  const { data, isLoading, isFetching, error, refetch } = useApiQuery<Page<Model>>('/itam/models', {
    page: state.page,
    pageSize: state.pageSize,
    q: state.q,
    category,
    sort: state.sort,
  });
  const columns = useMemo<DataTableColumn<Model>[]>(
    () => [
      {
        id: 'name',
        header: t('fields.model'),
        meta: { className: 'max-w-72' },
        cell: ({ row }) => (
          <button
            type="button"
            className="block max-w-full truncate text-left font-medium outline-none hover:underline focus-visible:underline"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(row.original);
            }}
          >
            {row.original.manufacturer} {row.original.name}
          </button>
        ),
      },
      {
        id: 'category',
        header: t('fields.category'),
        meta: { sortKey: 'category' },
        cell: ({ row }) => <CategoryLabel category={row.original.category} />,
      },
      {
        id: 'partNumber',
        header: t('settingsPage.partNumber'),
        meta: {
          className: 'hidden font-mono text-xs text-muted-foreground md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) => row.original.partNumber ?? '—',
      },
      {
        id: 'lifespan',
        header: t('settingsPage.lifespan'),
        meta: {
          className: 'hidden whitespace-nowrap sm:table-cell',
          headerClassName: 'hidden sm:table-cell',
        },
        cell: ({ row }) => t('settingsPage.months', { months: row.original.lifespanMonths }),
      },
      {
        id: 'assets',
        header: t('settingsPage.assets'),
        meta: { sortKey: 'assets', className: 'text-right tabular-nums', headerClassName: 'text-right' },
        cell: ({ row }) => row.original.assetCount,
      },
      {
        id: 'active',
        header: t('vendors.status'),
        meta: { className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
        cell: ({ row }) =>
          row.original.active ? (
            <Badge variant="success">
              <CircleCheckIcon aria-hidden /> {t('vendors.active')}
            </Badge>
          ) : (
            <Badge variant="muted">
              <CircleMinusIcon aria-hidden /> {t('vendors.inactive')}
            </Badge>
          ),
      },
    ],
    [t],
  );
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('settingsPage.modelsHint')}</p>
        <Button onClick={() => setEditing('new')}>
          <PlusIcon /> {t('settingsPage.newModel')}
        </Button>
      </div>
      <DataTable
        label={t('settingsPage.tabs.models')}
        columns={columns}
        data={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        pageSize={state.pageSize}
        sort={state.sort}
        loading={isLoading}
        fetching={isFetching}
        error={error}
        onRetry={() => refetch()}
        getRowId={(m) => m.id}
        onRowClick={(m) => setEditing(m)}
        onPageChange={(page) => set({ page })}
        onPageSizeChange={(pageSize) => set({ pageSize })}
        onSortChange={(sort) => set({ sort })}
        toolbar={
          <>
            <SearchInput
              value={state.q ?? ''}
              onChange={(q) => set({ q })}
              placeholder={t('settingsPage.searchModels')}
              className="sm:w-64"
            />
            <Select
              value={category ?? ALL}
              onValueChange={(v) => set({ category: v === ALL ? undefined : v })}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label={t('fields.category')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('hardware.filters.allCategories')}</SelectItem>
                {ASSET_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    <CategoryIcon category={c} className="text-muted-foreground" />
                    {t(`category.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        empty={<EmptyState icon={<LayersIcon />} title={t('settingsPage.noModels')} />}
      />
      {editing && (
        <ModelDialog model={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ModelDialog({ model, onClose }: { model?: Model; onClose: () => void }) {
  const t = useTranslations('itam');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const activeId = useId();
  const schema = useMemo(
    () =>
      z.object({
        category: z.enum(ASSET_CATEGORIES),
        manufacturer: z.string().trim().min(1, t('settingsPage.manufacturerRequired')).max(100),
        name: z.string().trim().min(1, t('settingsPage.nameRequired')).max(200),
        partNumber: z.string().trim().max(100),
        lifespanMonths: z
          .string()
          .trim()
          .refine(
            (v) => v === '' || (/^\d{1,3}$/.test(v) && Number(v) >= 1),
            t('settingsPage.lifespanInvalid'),
          ),
        active: z.boolean(),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      category: model?.category ?? 'laptop',
      manufacturer: model?.manufacturer ?? '',
      name: model?.name ?? '',
      partNumber: model?.partNumber ?? '',
      lifespanMonths: model ? String(model.lifespanMonths) : '',
      active: model?.active ?? true,
    },
  });
  const save = useApiMutation(
    (api, body: CreateModelInput) =>
      model ? api.patch<Model>(`/itam/models/${model.id}`, body) : api.post<Model>('/itam/models', body),
    { invalidate: INVALIDATE, success: t('settingsPage.modelSaved'), onSuccess: onClose, silent: true },
  );
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        category: v.category,
        manufacturer: v.manufacturer.trim(),
        name: v.name.trim(),
        partNumber: v.partNumber.trim() || null,
        ...(v.lifespanMonths ? { lifespanMonths: Number(v.lifespanMonths) } : {}),
        active: v.active,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        const field =
          (err.details as { field?: string } | undefined)?.field === 'category' ? 'category' : 'name';
        form.setError(field, {
          message: field === 'category' ? t('settingsPage.categoryLocked') : t('settingsPage.modelTaken'),
        });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });
  const category = useWatch({ control: form.control, name: 'category' });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{model ? t('settingsPage.editModel') : t('settingsPage.newModel')}</DialogTitle>
          <DialogDescription>{t('settingsPage.modelHint')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.category')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
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
            <div className="grid gap-4 sm:grid-cols-2">
              {(['manufacturer', 'name'] as const).map((n) => (
                <FormField
                  key={n}
                  control={form.control}
                  name={n}
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{t(`settingsPage.${n}`)}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              <FormField
                control={form.control}
                name="partNumber"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{t('settingsPage.partNumber')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lifespanMonths"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{t('settingsPage.lifespanMonths')}</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        placeholder={String(DEFAULT_LIFESPAN_MONTHS[category])}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>{t('settingsPage.lifespanHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-3">
                  <FormControl>
                    <Switch id={activeId} checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel htmlFor={activeId} className="font-normal">
                    {t('settingsPage.activeModel')}
                  </FormLabel>
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={save.isPending}>
                {model ? tc('saveChanges') : tc('create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const GENERAL = [
  { key: 'currency', field: 'currency', label: 'currency', hint: 'currencyHint', kind: 'text' },
  {
    key: 'reminders.warrantyDays',
    field: 'warrantyDays',
    label: 'warrantyDays',
    hint: 'warrantyDaysHint',
    kind: 'number',
  },
  {
    key: 'compliance.underUsedPercent',
    field: 'underUsedPercent',
    label: 'underUsed',
    hint: 'underUsedHint',
    kind: 'number',
  },
  { key: 'wipe.months', field: 'wipeMonths', label: 'wipeMonths', hint: 'wipeMonthsHint', kind: 'number' },
  {
    key: 'wipe.remindDays',
    field: 'wipeRemindDays',
    label: 'wipeRemindDays',
    hint: 'wipeRemindDaysHint',
    kind: 'number',
  },
] as const;

/** The module's settings, edited in place for people who may change them (the same as Administration → Modules). */
function GeneralTab() {
  const t = useTranslations('itam.settingsPage');
  const tc = useTranslations('common');
  const { data } = useApiQuery<ItamSettings>('/itam/settings');
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [savedAt, setSavedAt] = useState<number | undefined>();
  const values: Record<string, string> =
    draft ?? (data ? Object.fromEntries(GENERAL.map((g) => [g.field, String(data[g.field])])) : {});
  const save = useApiMutation(
    (api, body: Record<string, unknown>) => api.put('/modules/itam/settings', { values: body }),
    {
      invalidate: ['/itam', '/modules'],
      onSuccess: () => {
        setDraft(null);
        setSavedAt(Date.now());
      },
    },
  );
  const display = (g: (typeof GENERAL)[number]) =>
    !data
      ? ''
      : g.field === 'underUsedPercent'
        ? `${data.underUsedPercent}%`
        : g.field === 'wipeMonths'
          ? t('months', { months: data.wipeMonths })
          : g.kind === 'number'
            ? t('days', { days: data[g.field] as number })
            : String(data[g.field]);
  const editable = Boolean(data?.canEditSettings);
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t('generalTitle')}</CardTitle>
        <CardDescription>{editable ? t('generalEditHint') : t('generalHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              Object.fromEntries(
                GENERAL.map((g) => [
                  g.key,
                  g.kind === 'number' ? Number(values[g.field]) : values[g.field]!.trim().toUpperCase(),
                ]),
              ),
            );
          }}
        >
          <dl className="divide-y">
            {GENERAL.map((g) => (
              <div
                key={g.key}
                className="grid gap-1 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-4"
              >
                <dt className="text-sm font-medium">
                  {editable ? <Label htmlFor={`itam-setting-${g.field}`}>{t(g.label)}</Label> : t(g.label)}
                </dt>
                <dd className="min-w-0 space-y-1">
                  {editable ? (
                    <Input
                      id={`itam-setting-${g.field}`}
                      inputMode={g.kind === 'number' ? 'numeric' : undefined}
                      maxLength={g.field === 'currency' ? 3 : undefined}
                      className="w-32"
                      value={values[g.field] ?? ''}
                      aria-describedby={`itam-setting-${g.field}-hint`}
                      onChange={(e) => setDraft({ ...values, [g.field]: e.target.value })}
                    />
                  ) : (
                    <span className="text-sm font-semibold">{display(g)}</span>
                  )}
                  <p id={`itam-setting-${g.field}-hint`} className="text-xs text-muted-foreground">
                    {t(g.hint)}
                  </p>
                </dd>
              </div>
            ))}
          </dl>
          {editable ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!draft} loading={save.isPending}>
                {tc('save')}
              </Button>
              <SavedIndicator at={savedAt} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('askAdmin')}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
