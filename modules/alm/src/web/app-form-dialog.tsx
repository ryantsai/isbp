'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid, GridSpan } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { countFilled, OptionalFields } from '@isbp/ui/optional-fields';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { type FieldValues, useForm, type UseFormReturn, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  APP_CODE_RE,
  APP_STAGES,
  type AppDetail,
  type CreateAppInput,
  CRITICALITIES,
  DATA_CLASSIFICATIONS,
  DISPOSITIONS,
  HOSTINGS,
  type LookupItem,
  RESERVED_CODES,
  suggestCode,
} from '../contracts';
import { CRITICALITY_META, HOSTING_ICON, STAGE_META } from './badges';
import {
  attributesPayload,
  CustomFieldsSection,
  useAppFields,
  useApplyServerErrors,
  useAttributeDefaults,
  useAttributesResolver,
} from './custom-fields';
import { asDay, INVALIDATE } from './lib';
import { CiPicker, LookupSelect, NONE } from './pickers';

/** Create (no `app`) or edit an application: identity, lifecycle, ownership, CMDB link and details. */
export function AppFormDialog({
  open,
  onOpenChange,
  app,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app?: AppDetail;
  onSaved?: (app: AppDetail) => void;
}) {
  const t = useTranslations('alm.form');
  // The dialog's name is set here, not left to the header: the form inside is mounted per opening, after the dialog.
  const title = app ? t('editTitle', { name: app.name }) : t('createTitle');
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={768} purpose="form" aria-label={title}>
      {/* Mounted per opening: the form starts from the application as it is now. */}
      {open && (
        <AppForm
          title={title}
          app={app}
          onCancel={() => onOpenChange(false)}
          onSaved={(saved) => {
            onOpenChange(false);
            onSaved?.(saved);
          }}
        />
      )}
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <VStack gap={3} role="group" aria-label={title}>
      <Text type="label" color="secondary">
        {title}
      </Text>
      {children}
    </VStack>
  );
}

function AppForm({
  title,
  app,
  onCancel,
  onSaved,
}: {
  title: string;
  app?: AppDetail;
  onCancel: () => void;
  onSaved: (app: AppDetail) => void;
}) {
  const t = useTranslations('alm');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const applyErrors = useApplyServerErrors();
  const { fields, elements, ready } = useAppFields();
  const formId = useId();
  const ids = { business: useId(), technical: useId() };
  const [businessOwner, setBusinessOwner] = useState<PersonOption | null>(app?.businessOwner ?? null);
  const [technicalOwner, setTechnicalOwner] = useState<PersonOption | null>(app?.technicalOwner ?? null);
  const [ci, setCi] = useState<LookupItem | null>(
    app?.ci ? { id: app.ci.id, name: app.ci.name, hint: app.ci.reference } : null,
  );
  const [codeTouched, setCodeTouched] = useState(Boolean(app));

  const schema = useMemo(
    () =>
      z
        .object({
          name: z.string().trim().min(1, t('form.nameRequired')).max(200),
          code: z
            .string()
            .trim()
            .min(2, t('form.codeInvalid'))
            .max(32, t('form.codeInvalid'))
            .regex(APP_CODE_RE, t('form.codeInvalid'))
            .refine((c) => !RESERVED_CODES.has(c), t('form.codeReserved')),
          stage: z.enum(APP_STAGES),
          criticality: z.enum(CRITICALITIES),
          hosting: z.enum(HOSTINGS),
          disposition: z.string(),
          teamGroupId: z.string(),
          supportGroupId: z.string(),
          departmentId: z.string(),
          description: z.string().max(20_000),
          vendor: z.string().max(200),
          techStack: z.string().max(1000),
          documentationUrl: z
            .string()
            .trim()
            .max(500)
            .refine((u) => !u || /^https:\/\/\S+$/.test(u), t('form.httpsOnly')),
          dataClassification: z.enum(DATA_CLASSIFICATIONS),
          goLiveDate: z.string(),
          retireDate: z.string(),
          attributes: z.record(z.string(), z.unknown()),
        })
        .refine((v) => !v.goLiveDate || !v.retireDate || v.retireDate >= v.goLiveDate, {
          path: ['retireDate'],
          message: t('form.retireBeforeGoLive'),
        }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const resolver = useAttributesResolver<Values>(zodResolver(schema), fields);
  const form = useForm<Values>({
    resolver,
    defaultValues: {
      name: app?.name ?? '',
      code: app?.code ?? '',
      stage: app?.stage ?? 'planned',
      criticality: app?.criticality ?? 'medium',
      hosting: app?.hosting ?? 'on_prem',
      disposition: app?.disposition ?? NONE,
      teamGroupId: app?.team?.id ?? NONE,
      supportGroupId: app?.supportGroup?.id ?? NONE,
      departmentId: app?.department?.id ?? NONE,
      description: app?.description ?? '',
      vendor: app?.vendor ?? '',
      techStack: app?.techStack.join(', ') ?? '',
      documentationUrl: app?.documentationUrl ?? '',
      dataClassification: app?.dataClassification ?? 'internal',
      goLiveDate: app?.goLiveDate ?? '',
      retireDate: app?.retireDate ?? '',
      attributes: app?.attributes ?? {},
    },
  });
  useAttributeDefaults(form as unknown as UseFormReturn<FieldValues>, fields, ready, true, app?.attributes);
  const [disposition, description, vendor, techStack, documentationUrl, goLiveDate, retireDate] = useWatch({
    control: form.control,
    name: [
      'disposition',
      'description',
      'vendor',
      'techStack',
      'documentationUrl',
      'goLiveDate',
      'retireDate',
    ],
  });
  const detailsFilled = countFilled(
    disposition === NONE ? '' : disposition,
    description,
    vendor,
    techStack,
    documentationUrl,
    goLiveDate,
    retireDate,
    ci,
  );

  const save = useApiMutation(
    (api, body: CreateAppInput) =>
      app
        ? api.patch<AppDetail>(`/alm/applications/${app.code}`, (({ code: _code, ...rest }) => rest)(body))
        : api.post<AppDetail>('/alm/applications', body),
    {
      invalidate: INVALIDATE,
      success: (saved) => (app ? t('form.saved') : t('form.created', { name: saved.name })),
      onSuccess: onSaved,
      silent: true,
    },
  );

  const orNull = (v: string) => (v === NONE || v === '' ? null : v);
  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    const body: CreateAppInput = {
      code: v.code.trim(),
      name: v.name.trim(),
      description: v.description.trim() || null,
      stage: v.stage,
      criticality: v.criticality,
      hosting: v.hosting,
      disposition: orNull(v.disposition) as CreateAppInput['disposition'],
      businessOwnerId: businessOwner?.id ?? null,
      technicalOwnerId: technicalOwner?.id ?? null,
      teamGroupId: orNull(v.teamGroupId),
      supportGroupId: orNull(v.supportGroupId),
      departmentId: orNull(v.departmentId),
      vendor: v.vendor.trim() || null,
      ciId: ci?.id ?? null,
      techStack: [
        ...new Set(
          v.techStack
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ],
      documentationUrl: v.documentationUrl.trim() || null,
      dataClassification: v.dataClassification,
      goLiveDate: v.goLiveDate || null,
      retireDate: v.retireDate || null,
      ...(fields.length ? { attributes: attributesPayload(fields, v.attributes) } : {}),
    };
    try {
      await save.mutateAsync(body);
    } catch (err) {
      if (applyErrors(err, form.setError as never)) return;
      form.setError('root', { message: err instanceof ApiError ? errorText(err) : errorText(null) });
    }
  });

  const enumSelect = <K extends 'stage' | 'criticality' | 'hosting' | 'dataClassification' | 'disposition'>(
    name: K,
    label: string,
    options: readonly { value: string; label: string; icon?: LucideIcon }[],
    none?: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Selector
          label={label}
          width="100%"
          value={field.value as string}
          onChange={(v) => field.onChange(v)}
          options={none ? [{ value: NONE, label: none }, ...options] : [...options]}
          status={fieldStatus(fieldState)}
        />
      )}
    />
  );

  const lookup = (name: 'teamGroupId' | 'supportGroupId' | 'departmentId', label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <LookupSelect
          kind={name === 'departmentId' ? 'departments' : 'groups'}
          label={label}
          value={field.value === NONE ? null : field.value}
          onChange={(v) => field.onChange(v ?? NONE)}
          noneLabel={t('form.none')}
          status={fieldStatus(fieldState)}
        />
      )}
    />
  );

  /** Server-side issues on fields without a form control of their own (people pickers). */
  const serverError = (field: string) =>
    (form.formState.errors as Record<string, { message?: string } | undefined>)[field]?.message;

  const person = (
    id: string,
    label: string,
    value: PersonOption | null,
    set: (p: PersonOption | null) => void,
    field: 'businessOwnerId' | 'technicalOwnerId',
  ) => {
    const message = serverError(field);
    return (
      <Field label={label} inputID={id} status={message ? { type: 'error', message } : undefined}>
        <PersonPicker id={id} value={value} placeholder={t('form.personPlaceholder')} onChange={set} />
      </Field>
    );
  };

  return (
    <Form {...form}>
      <Layout
        header={
          <DialogHeader
            title={title}
            subtitle={t('form.hint')}
            onOpenChange={(next) => !next && onCancel()}
          />
        }
        content={
          <LayoutContent padding={4}>
            <form id={formId} onSubmit={onSubmit} noValidate>
              <FormLayout defaultOptionality="optional">
                <Section title={t('form.sections.identity')}>
                  <Grid columns={{ minWidth: 220, repeat: 'fit' }} gap={4} align="end">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field, fieldState }) => (
                        <TextInput
                          label={t('fields.name')}
                          isRequired
                          hasAutoFocus
                          placeholder={t('form.namePlaceholder')}
                          value={field.value}
                          onChange={(value) => {
                            field.onChange(value);
                            if (!codeTouched)
                              form.setValue('code', suggestCode(value), { shouldValidate: false });
                          }}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="code"
                      render={({ field, fieldState }) => (
                        <TextInput
                          label={t('fields.code')}
                          isRequired
                          isReadOnly={Boolean(app)}
                          autoComplete="off"
                          description={app ? t('form.codePermanent') : t('form.codeHint')}
                          value={field.value}
                          onChange={(value) => {
                            setCodeTouched(true);
                            field.onChange(value.toLowerCase());
                          }}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
                  </Grid>
                  <Grid columns={{ minWidth: 160, repeat: 'fit' }} gap={4} align="end">
                    {enumSelect(
                      'stage',
                      t('fields.stage'),
                      APP_STAGES.map((v) => ({ value: v, label: t(`stage.${v}`), icon: STAGE_META[v].icon })),
                    )}
                    {enumSelect(
                      'criticality',
                      t('fields.criticality'),
                      CRITICALITIES.map((v) => ({
                        value: v,
                        label: t(`criticality.${v}`),
                        icon: CRITICALITY_META[v].icon,
                      })),
                    )}
                    {enumSelect(
                      'hosting',
                      t('fields.hosting'),
                      HOSTINGS.map((v) => ({ value: v, label: t(`hosting.${v}`), icon: HOSTING_ICON[v] })),
                    )}
                    {enumSelect(
                      'dataClassification',
                      t('fields.dataClassification'),
                      DATA_CLASSIFICATIONS.map((v) => ({ value: v, label: t(`classification.${v}`) })),
                    )}
                  </Grid>
                </Section>

                <Section title={t('form.sections.ownership')}>
                  <Grid columns={{ minWidth: 220, repeat: 'fit' }} gap={4} align="end">
                    {person(
                      ids.business,
                      t('fields.businessOwner'),
                      businessOwner,
                      setBusinessOwner,
                      'businessOwnerId',
                    )}
                    {person(
                      ids.technical,
                      t('fields.technicalOwner'),
                      technicalOwner,
                      setTechnicalOwner,
                      'technicalOwnerId',
                    )}
                  </Grid>
                  <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={4} align="end">
                    {lookup('teamGroupId', t('fields.team'))}
                    {lookup('supportGroupId', t('fields.supportGroup'))}
                    {lookup('departmentId', t('fields.department'))}
                  </Grid>
                </Section>

                <OptionalFields label={t('form.sections.details')} filled={detailsFilled}>
                  <FormLayout defaultOptionality="optional">
                    <Grid columns={{ minWidth: 220, repeat: 'fit' }} gap={4} align="end">
                      {enumSelect(
                        'disposition',
                        t('fields.disposition'),
                        DISPOSITIONS.map((v) => ({ value: v, label: t(`disposition.${v}`) })),
                        t('form.notDecided'),
                      )}
                      <FormField
                        control={form.control}
                        name="goLiveDate"
                        render={({ field, fieldState }) => (
                          <DateInput
                            label={t('fields.goLiveDate')}
                            hasClear
                            value={asDay(field.value)}
                            onChange={(d) => field.onChange(d ?? '')}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="retireDate"
                        render={({ field, fieldState }) => (
                          <DateInput
                            label={t('fields.retireDate')}
                            hasClear
                            value={asDay(field.value)}
                            onChange={(d) => field.onChange(d ?? '')}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                      <CiPicker
                        label={t('fields.ci')}
                        description={t('form.ciHint')}
                        value={ci}
                        onChange={setCi}
                      />
                      <FormField
                        control={form.control}
                        name="vendor"
                        render={({ field, fieldState }) => (
                          <TextInput
                            label={t('fields.vendor')}
                            placeholder={t('form.vendorPlaceholder')}
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
                        name="techStack"
                        render={({ field, fieldState }) => (
                          <TextInput
                            label={t('fields.techStack')}
                            placeholder={t('form.techStackPlaceholder')}
                            description={t('form.techStackHint')}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                      <GridSpan columns="full">
                        <FormField
                          control={form.control}
                          name="documentationUrl"
                          render={({ field, fieldState }) => (
                            <TextInput
                              label={t('fields.documentationUrl')}
                              placeholder="https://"
                              autoComplete="off"
                              value={field.value}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              ref={field.ref}
                              status={fieldStatus(fieldState)}
                            />
                          )}
                        />
                      </GridSpan>
                      <GridSpan columns="full">
                        <FormField
                          control={form.control}
                          name="description"
                          render={({ field, fieldState }) => (
                            <TextArea
                              label={t('fields.description')}
                              rows={4}
                              description={t('form.markdownHint')}
                              value={field.value}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              ref={field.ref}
                              status={fieldStatus(fieldState)}
                            />
                          )}
                        />
                      </GridSpan>
                    </Grid>
                  </FormLayout>
                </OptionalFields>

                <CustomFieldsSection
                  elements={elements}
                  form={form as unknown as UseFormReturn<FieldValues>}
                />

                {form.formState.errors.root && (
                  <Banner
                    status="error"
                    title={form.formState.errors.root.message ?? ''}
                    collapsible={false}
                  />
                )}
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={onCancel} />
              <Button
                label={app ? tc('saveChanges') : tc('create')}
                variant="primary"
                type="submit"
                form={formId}
                isLoading={save.isPending}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Form>
  );
}
