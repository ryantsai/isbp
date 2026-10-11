'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Page } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { DataTable, type DataTableColumn, useListState } from '@isbp/ui/data-table';
import { EmptyState } from '@isbp/ui/empty-state';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { FormDialog } from '@isbp/ui/form-dialog';
import { SavedIndicator } from '@isbp/ui/motion';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { PageHeader } from '@isbp/ui/page-header';
import { applyServerErrors, useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
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
  const panelId = useId();
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <VStack gap={3}>
        <TabList
          role="tablist"
          value={tab}
          onChange={(v) => set({ tab: v === 'models' ? undefined : v })}
          hasDivider
        >
          <Tab value="models" label={t('tabs.models')} icon={<Icon icon={LayersIcon} />} panelId={panelId} />
          <Tab
            value="general"
            label={t('tabs.general')}
            icon={<Icon icon={SlidersHorizontalIcon} />}
            panelId={panelId}
          />
        </TabList>
        <div role="tabpanel" id={panelId} aria-label={t(`tabs.${tab}`)} className="min-w-0">
          {tab === 'models' && <ModelsTab />}
          {tab === 'general' && <GeneralTab />}
        </div>
      </VStack>
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
          <Link
            color="primary"
            weight="medium"
            maxLines={1}
            onClick={(e) => {
              e.stopPropagation();
              setEditing(row.original);
            }}
          >
            {row.original.manufacturer} {row.original.name}
          </Link>
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
          className: 'hidden md:table-cell',
          headerClassName: 'hidden md:table-cell',
        },
        cell: ({ row }) =>
          row.original.partNumber ? (
            <Text type="code" size="xsm" color="secondary">
              {row.original.partNumber}
            </Text>
          ) : (
            '—'
          ),
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
            <Badge
              variant="success"
              label={t('vendors.active')}
              icon={<Icon icon={CircleCheckIcon} size="xsm" />}
            />
          ) : (
            <Badge
              variant="neutral"
              label={t('vendors.inactive')}
              icon={<Icon icon={CircleMinusIcon} size="xsm" />}
            />
          ),
      },
    ],
    [t],
  );
  return (
    <VStack gap={4}>
      <HStack gap={2} wrap="wrap" hAlign="between" vAlign="center">
        <Text color="secondary">{t('settingsPage.modelsHint')}</Text>
        <Button
          label={t('settingsPage.newModel')}
          variant="primary"
          icon={<Icon icon={PlusIcon} />}
          onClick={() => setEditing('new')}
        />
      </HStack>
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
            <Selector
              label={t('fields.category')}
              isLabelHidden
              width={176}
              value={category ?? ALL}
              onChange={(v) => set({ category: v === ALL ? undefined : v })}
              options={[
                { value: ALL, label: t('hardware.filters.allCategories') },
                ...ASSET_CATEGORIES.map((c) => ({
                  value: c,
                  label: t(`category.${c}`),
                  icon: <CategoryIcon category={c} />,
                })),
              ]}
            />
          </>
        }
        empty={<EmptyState icon={<LayersIcon />} title={t('settingsPage.noModels')} />}
      />
      {editing && (
        <ModelDialog model={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </VStack>
  );
}

function ModelDialog({ model, onClose }: { model?: Model; onClose: () => void }) {
  const t = useTranslations('itam');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const schema = useMemo(
    () =>
      z.object({
        category: z.enum(ASSET_CATEGORIES),
        manufacturer: z.string().trim().min(1, t('settingsPage.manufacturerRequired')).max(100),
        name: z.string().trim().min(1, t('settingsPage.nameRequired')).max(200),
        partNumber: z.string().trim().max(100),
        lifespanMonths: z
          .number()
          .int(t('settingsPage.lifespanInvalid'))
          .min(1, t('settingsPage.lifespanInvalid'))
          .max(999, t('settingsPage.lifespanInvalid'))
          .nullable(),
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
      lifespanMonths: model ? model.lifespanMonths : null,
      active: model?.active ?? true,
    },
  });
  const save = useApiMutation(
    (api, body: CreateModelInput) =>
      model ? api.patch<Model>(`/itam/models/${model.id}`, body) : api.post<Model>('/itam/models', body),
    { invalidate: INVALIDATE, success: t('settingsPage.modelSaved'), onSuccess: onClose, silent: true },
  );
  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    try {
      await save.mutateAsync({
        category: v.category,
        manufacturer: v.manufacturer.trim(),
        name: v.name.trim(),
        partNumber: v.partNumber.trim() || null,
        ...(v.lifespanMonths ? { lifespanMonths: v.lifespanMonths } : {}),
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
      if (applyServerErrors(err, form.setError as never)) return;
      form.setError('root', { message: errorText(err) });
    }
  });
  const [category, partNumber, lifespanMonths] = useWatch({
    control: form.control,
    name: ['category', 'partNumber', 'lifespanMonths'],
  });
  const list = useFieldList();
  const detailsFilled = countFilled(partNumber, lifespanMonths);
  return (
    <Form {...form}>
      <FormDialog
        isOpen
        onOpenChange={(o) => !o && onClose()}
        title={model ? t('settingsPage.editModel') : t('settingsPage.newModel')}
        subtitle={t('settingsPage.modelHint')}
        onSubmit={onSubmit}
        submitLabel={model ? tc('saveChanges') : tc('create')}
        cancelLabel={tc('cancel')}
        isSubmitting={save.isPending}
        defaultOptionality="required"
      >
        <FormField
          control={form.control}
          name="category"
          render={({ field, fieldState }) => (
            <Selector
              label={t('fields.category')}
              value={field.value}
              onChange={(v) => field.onChange(v)}
              options={ASSET_CATEGORIES.map((c) => ({
                value: c,
                label: t(`category.${c}`),
                icon: <CategoryIcon category={c} />,
              }))}
              status={fieldStatus(fieldState)}
            />
          )}
        />
        <Grid columns={{ minWidth: 200 }} gap={4}>
          {(['manufacturer', 'name'] as const).map((n) => (
            <FormField
              key={n}
              control={form.control}
              name={n}
              render={({ field, fieldState }) => (
                <TextInput
                  label={t(`settingsPage.${n}`)}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  status={fieldStatus(fieldState)}
                />
              )}
            />
          ))}
        </Grid>
        <FormField
          control={form.control}
          name="active"
          render={({ field }) => (
            <Switch label={t('settingsPage.activeModel')} value={field.value} onChange={field.onChange} />
          )}
        />
        <OptionalFields
          hint={list([t('settingsPage.partNumber'), t('settingsPage.lifespanMonths')])}
          filled={detailsFilled}
        >
          <FormLayout defaultOptionality="optional">
            <Grid columns={{ minWidth: 200 }} gap={4}>
              <FormField
                control={form.control}
                name="partNumber"
                render={({ field, fieldState }) => (
                  <TextInput
                    label={t('settingsPage.partNumber')}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    status={fieldStatus(fieldState)}
                  />
                )}
              />
              <FormField
                control={form.control}
                name="lifespanMonths"
                render={({ field, fieldState }) => (
                  <NumberInput
                    label={t('settingsPage.lifespanMonths')}
                    description={t('settingsPage.lifespanHint')}
                    placeholder={String(DEFAULT_LIFESPAN_MONTHS[category])}
                    isIntegerOnly
                    hasClear
                    min={1}
                    max={999}
                    value={field.value}
                    onChange={(v) => field.onChange(v)}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    status={fieldStatus(fieldState)}
                  />
                )}
              />
            </Grid>
          </FormLayout>
        </OptionalFields>
        {form.formState.errors.root && (
          <Banner status="error" title={form.formState.errors.root.message ?? ''} collapsible={false} />
        )}
      </FormDialog>
    </Form>
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
      <CardContent>
        {editable ? (
          <form
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
            <VStack gap={4}>
              <div className="max-w-sm">
                <FormLayout defaultOptionality="required">
                  {GENERAL.map((g) =>
                    g.kind === 'number' ? (
                      <NumberInput
                        key={g.key}
                        label={t(g.label)}
                        description={t(g.hint)}
                        isIntegerOnly
                        min={0}
                        value={values[g.field] ? Number(values[g.field]) : null}
                        onChange={(n) => setDraft({ ...values, [g.field]: String(n) })}
                      />
                    ) : (
                      <TextInput
                        key={g.key}
                        label={t(g.label)}
                        description={t(g.hint)}
                        value={values[g.field] ?? ''}
                        onChange={(v) => setDraft({ ...values, [g.field]: v.slice(0, 3) })}
                      />
                    ),
                  )}
                </FormLayout>
              </div>
              <HStack gap={3} vAlign="center" wrap="wrap">
                <Button
                  label={tc('save')}
                  variant="primary"
                  isLoading={save.isPending}
                  isDisabled={!draft}
                  type="submit"
                />
                <SavedIndicator at={savedAt} />
              </HStack>
            </VStack>
          </form>
        ) : (
          <VStack gap={4}>
            <MetadataList>
              {GENERAL.map((g) => (
                <MetadataListItem key={g.key} label={t(g.label)}>
                  <VStack>
                    <Text weight="semibold">{display(g)}</Text>
                    <Text type="supporting">{t(g.hint)}</Text>
                  </VStack>
                </MetadataListItem>
              ))}
            </MetadataList>
            <Text as="p" color="secondary">
              {t('askAdmin')}
            </Text>
          </VStack>
        )}
      </CardContent>
    </Card>
  );
}
