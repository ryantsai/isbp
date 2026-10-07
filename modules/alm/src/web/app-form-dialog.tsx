'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
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
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { type FieldValues, useForm, type UseFormReturn } from 'react-hook-form';
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
import { CriticalityBadge, HostingLabel, StageBadge } from './badges';
import {
  attributesPayload,
  CustomFieldsSection,
  useAppFields,
  useApplyServerErrors,
  useAttributeDefaults,
  useAttributesResolver,
} from './custom-fields';
import { INVALIDATE } from './lib';
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
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{app ? t('editTitle', { name: app.name }) : t('createTitle')}</DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>
        {/* Mounted per opening: the form starts from the application as it is now. */}
        {open && (
          <AppForm
            app={app}
            onCancel={() => onOpenChange(false)}
            onSaved={(saved) => {
              onOpenChange(false);
              onSaved?.(saved);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-4">
      <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function AppForm({
  app,
  onCancel,
  onSaved,
}: {
  app?: AppDetail;
  onCancel: () => void;
  onSaved: (app: AppDetail) => void;
}) {
  const t = useTranslations('alm');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const applyErrors = useApplyServerErrors();
  const { fields, elements, ready } = useAppFields();
  const ids = {
    business: useId(),
    technical: useId(),
    team: useId(),
    support: useId(),
    department: useId(),
    ci: useId(),
    ciHint: useId(),
  };
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
    values: readonly string[],
    render: (v: string) => ReactNode,
    none?: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>{label}</FormLabel>
          <Select value={field.value as string} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {none && (
                <SelectItem value={NONE}>
                  <span className="text-muted-foreground">{none}</span>
                </SelectItem>
              )}
              {values.map((v) => (
                <SelectItem key={v} value={v}>
                  {render(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const lookup = (name: 'teamGroupId' | 'supportGroupId' | 'departmentId', id: string, label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel htmlFor={id}>{label}</FormLabel>
          <LookupSelect
            id={id}
            kind={name === 'departmentId' ? 'departments' : 'groups'}
            value={field.value === NONE ? null : field.value}
            onChange={(v) => field.onChange(v ?? NONE)}
            noneLabel={t('form.none')}
          />
          <FormMessage />
        </FormItem>
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
  ) => (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <PersonPicker id={id} value={value} placeholder={t('form.personPlaceholder')} onChange={set} />
      {serverError(field) && <p className="text-xs text-destructive">{serverError(field)}</p>}
    </div>
  );

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="grid gap-6" noValidate>
        <Section title={t('form.sections.identity')}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.name')}</FormLabel>
                  <FormControl>
                    <Input
                      autoFocus
                      maxLength={200}
                      placeholder={t('form.namePlaceholder')}
                      {...field}
                      onChange={(e) => {
                        field.onChange(e);
                        if (!codeTouched)
                          form.setValue('code', suggestCode(e.target.value), { shouldValidate: false });
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.code')}</FormLabel>
                  <FormControl>
                    <Input
                      className="font-mono"
                      maxLength={32}
                      readOnly={Boolean(app)}
                      autoCapitalize="none"
                      spellCheck={false}
                      {...field}
                      onChange={(e) => {
                        setCodeTouched(true);
                        field.onChange(e.target.value.toLowerCase());
                      }}
                    />
                  </FormControl>
                  <FormDescription>{app ? t('form.codePermanent') : t('form.codeHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {enumSelect('stage', t('fields.stage'), APP_STAGES, (v) => (
              <StageBadge stage={v as never} />
            ))}
            {enumSelect('criticality', t('fields.criticality'), CRITICALITIES, (v) => (
              <CriticalityBadge criticality={v as never} />
            ))}
            {enumSelect('hosting', t('fields.hosting'), HOSTINGS, (v) => (
              <HostingLabel hosting={v as never} />
            ))}
            {enumSelect(
              'disposition',
              t('fields.disposition'),
              DISPOSITIONS,
              (v) => t(`disposition.${v}`),
              t('form.notDecided'),
            )}
          </div>
        </Section>

        <Section title={t('form.sections.ownership')}>
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {lookup('teamGroupId', ids.team, t('fields.team'))}
            {lookup('supportGroupId', ids.support, t('fields.supportGroup'))}
            {lookup('departmentId', ids.department, t('fields.department'))}
          </div>
        </Section>

        <Section title={t('form.sections.details')}>
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.description')}</FormLabel>
                <FormControl>
                  <Textarea rows={4} {...field} />
                </FormControl>
                <FormDescription>{t('form.markdownHint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={ids.ci}>{t('fields.ci')}</Label>
              <CiPicker id={ids.ci} value={ci} onChange={setCi} aria-describedby={ids.ciHint} />
              <p id={ids.ciHint} className="text-xs text-muted-foreground">
                {t('form.ciHint')}
              </p>
            </div>
            <FormField
              control={form.control}
              name="vendor"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.vendor')}</FormLabel>
                  <FormControl>
                    <Input maxLength={200} placeholder={t('form.vendorPlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="techStack"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.techStack')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('form.techStackPlaceholder')} {...field} />
                  </FormControl>
                  <FormDescription>{t('form.techStackHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="documentationUrl"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.documentationUrl')}</FormLabel>
                  <FormControl>
                    <Input type="url" inputMode="url" placeholder="https://" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {enumSelect('dataClassification', t('fields.dataClassification'), DATA_CLASSIFICATIONS, (v) =>
              t(`classification.${v}`),
            )}
            <FormField
              control={form.control}
              name="goLiveDate"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.goLiveDate')}</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="retireDate"
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>{t('fields.retireDate')}</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Section>

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
            {app ? tc('saveChanges') : tc('create')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
