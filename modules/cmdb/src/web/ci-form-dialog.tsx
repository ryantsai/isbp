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
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { type FieldValues, useForm, type UseFormReturn, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  CI_CRITICALITIES,
  CI_ENVIRONMENTS,
  CI_STATUSES,
  type CiDetail,
  type CreateCiInput,
} from '../contracts';
import { CiStatusBadge, CriticalityBadge } from './badges';
import { ClassIcon } from './class-icon';
import {
  attributesPayload,
  CustomFieldsSection,
  useApplyServerErrors,
  useAttributeDefaults,
  useAttributesResolver,
  useCiFields,
} from './custom-fields';
import { INVALIDATE, useClasses, useLookup } from './data';
import { TagInput } from './tag-input';

const NONE = '__none__';

/**
 * Create (no `ci`) or edit a configuration item: identity, lifecycle, ownership, description, tags and
 * the custom fields admins defined for CIs.
 */
export function CiFormDialog({
  open,
  onOpenChange,
  ci,
  defaultClass,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ci?: CiDetail;
  defaultClass?: string;
  onSaved?: (ci: CiDetail) => void;
}) {
  const t = useTranslations('cmdb');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>
            {ci ? t('form.editTitle', { reference: ci.reference }) : t('form.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('form.hint')}</DialogDescription>
        </DialogHeader>
        {/* Mounted per opening: the form starts from the CI as it is now. */}
        <CiForm
          ci={ci}
          defaultClass={defaultClass}
          onCancel={() => onOpenChange(false)}
          onSaved={(saved) => {
            onOpenChange(false);
            onSaved?.(saved);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function CiForm({
  ci,
  defaultClass,
  onCancel,
  onSaved,
}: {
  ci?: CiDetail;
  defaultClass?: string;
  onCancel: () => void;
  onSaved: (ci: CiDetail) => void;
}) {
  const t = useTranslations('cmdb');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const applyErrors = useApplyServerErrors();
  const { options: classOptions } = useClasses();
  const groups = useLookup('groups');
  const departments = useLookup('departments');
  const { fields, elements, ready } = useCiFields();
  const [owner, setOwner] = useState<PersonOption | null>(ci?.owner ? { ...ci.owner } : null);
  const ids = { owner: useId(), tags: useId(), tagsHint: useId() };

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('form.nameRequired')).max(200),
        classKey: z.string().min(1, t('form.classPlaceholder')),
        status: z.enum(CI_STATUSES),
        environment: z.string(),
        criticality: z.enum(CI_CRITICALITIES),
        ownerId: z.string().nullable(),
        supportGroupId: z.string(),
        departmentId: z.string(),
        description: z.string().max(10_000),
        tags: z.array(z.string()).max(20),
        attributes: z.record(z.string(), z.unknown()),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const resolver = useAttributesResolver<Values>(zodResolver(schema), fields);
  const form = useForm<Values>({
    resolver,
    defaultValues: {
      name: ci?.name ?? '',
      classKey: ci?.class.key ?? defaultClass ?? '',
      status: ci?.status ?? 'in_use',
      environment: ci?.environment ?? NONE,
      criticality: ci?.criticality ?? 'medium',
      ownerId: ci?.owner?.id ?? null,
      supportGroupId: ci?.supportGroup?.id ?? NONE,
      departmentId: ci?.department?.id ?? NONE,
      description: ci?.description ?? '',
      tags: ci?.tags ?? [],
      attributes: ci?.attributes ?? {},
    },
  });
  useAttributeDefaults(form as unknown as UseFormReturn<FieldValues>, fields, ready, true, ci?.attributes);
  const list = useFieldList();
  const [environment, departmentId, description, tags] = useWatch({
    control: form.control,
    name: ['environment', 'departmentId', 'description', 'tags'],
  });
  const detailsFilled = countFilled(
    environment === NONE ? '' : environment,
    departmentId === NONE ? '' : departmentId,
    description,
    tags,
  );

  const save = useApiMutation(
    (api, body: CreateCiInput) =>
      ci ? api.patch<CiDetail>(`/cmdb/cis/${ci.id}`, body) : api.post<CiDetail>('/cmdb/cis', body),
    {
      invalidate: INVALIDATE,
      success: (saved) => (ci ? t('form.saved') : t('form.created', { reference: saved.reference })),
      onSuccess: onSaved,
      silent: true,
    },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    const body: CreateCiInput = {
      name: v.name.trim(),
      classKey: v.classKey,
      status: v.status,
      environment: v.environment === NONE ? null : (v.environment as CreateCiInput['environment']),
      criticality: v.criticality,
      ownerId: v.ownerId,
      supportGroupId: v.supportGroupId === NONE ? null : v.supportGroupId,
      departmentId: v.departmentId === NONE ? null : v.departmentId,
      description: v.description.trim() || null,
      tags: v.tags,
      ...(fields.length ? { attributes: attributesPayload(fields, v.attributes) } : {}),
    };
    try {
      await save.mutateAsync(body);
    } catch (err) {
      if (applyErrors(err, form.setError as never)) return;
      form.setError('root', {
        message: err instanceof ApiError ? errorText(err) : errorText(null),
      });
    }
  });

  const select = (
    name: 'supportGroupId' | 'departmentId',
    label: string,
    placeholder: string,
    items: { id: string; name: string }[],
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
              <SelectItem value={NONE}>
                <span className="text-muted-foreground">{placeholder}</span>
              </SelectItem>
              {items.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
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
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t('fields.name')}</FormLabel>
                <FormControl>
                  <Input autoFocus placeholder={t('form.namePlaceholder')} maxLength={200} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="classKey"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t('fields.class')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('form.classPlaceholder')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {classOptions.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        <ClassIcon name={c.icon} className="size-4 text-muted-foreground" />
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t('fields.status')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {CI_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        <CiStatusBadge status={s} quiet={false} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="criticality"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t('fields.criticality')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {CI_CRITICALITIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        <CriticalityBadge criticality={c} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={ids.owner}>{t('fields.owner')}</Label>
            <PersonPicker
              id={ids.owner}
              value={owner}
              placeholder={t('form.ownerPlaceholder')}
              invalid={Boolean(form.formState.errors.ownerId)}
              onChange={(p) => {
                setOwner(p);
                form.setValue('ownerId', p?.id ?? null, { shouldDirty: true });
                form.clearErrors('ownerId');
              }}
            />
            {form.formState.errors.ownerId && (
              <p className="text-xs text-destructive">{form.formState.errors.ownerId.message}</p>
            )}
          </div>
          {select('supportGroupId', t('fields.supportGroup'), t('form.groupPlaceholder'), groups.items)}
        </div>

        <OptionalFields
          hint={list([
            t('fields.environment'),
            t('fields.department'),
            t('fields.description'),
            t('fields.tags'),
          ])}
          filled={detailsFilled}
          contentClassName="grid gap-4 pt-3 sm:grid-cols-2"
        >
          <FormField
            control={form.control}
            name="environment"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t('fields.environment')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      <span className="text-muted-foreground">{t('fields.notSet')}</span>
                    </SelectItem>
                    {CI_ENVIRONMENTS.map((e) => (
                      <SelectItem key={e} value={e}>
                        {t(`environment.${e}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {select('departmentId', t('fields.department'), t('form.departmentPlaceholder'), departments.items)}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>{t('fields.description')}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="tags"
            render={({ field, fieldState }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel htmlFor={ids.tags}>{t('fields.tags')}</FormLabel>
                <TagInput
                  id={ids.tags}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t('form.tagsPlaceholder')}
                  aria-describedby={ids.tagsHint}
                  invalid={Boolean(fieldState.error)}
                />
                <FormDescription id={ids.tagsHint}>{t('form.tagsHint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
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
            {ci ? tc('saveChanges') : tc('create')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
