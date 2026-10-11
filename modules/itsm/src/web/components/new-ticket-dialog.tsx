'use client';

import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { Field } from '@astryxdesign/core/Field';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { applyServerErrors, useApiMutation } from '@isbp/ui/query';
import { SirenIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { type CreateTicketInput, priorityFor, type TicketDetail, type TicketType } from '../../contracts';
import { INVALIDATE, ticketHref, useCategories } from '../lib';
import type { CmdbCiOption } from '../types';
import { PriorityBadge, TYPE_ICON } from './badges';
import {
  AssigneeSelect,
  CategorySelect,
  CiPicker,
  fieldProps,
  GroupSelect,
  selectorSize,
  type SelectFieldProps,
} from './pickers';

const LEVELS = ['1', '2', '3'] as const;

/** Impact / urgency select with the long label ("High — work is blocked"). */
export function LevelSelect({
  kind,
  value,
  onChange,
  size,
  width,
  ...field
}: {
  kind: 'impact' | 'urgency';
  value: string;
  onChange: (v: string) => void;
} & SelectFieldProps) {
  const t = useTranslations('itsm');
  return (
    <Selector
      {...fieldProps(field, t(`${kind}.${value}`))}
      size={selectorSize(size)}
      width={width}
      value={value}
      onChange={onChange}
      options={LEVELS.map((l) => ({ value: l, label: t(`${kind}.${l}`) }))}
    />
  );
}

/** Segmented radio group of ticket types (icon + label). */
export function TypeRadio({
  types,
  value,
  onChange,
  label,
}: {
  types: readonly TicketType[];
  value: TicketType;
  onChange: (t: TicketType) => void;
  label: string;
}) {
  const t = useTranslations('itsm.types');
  return (
    <SegmentedControl label={label} layout="fill" value={value} onChange={(v) => onChange(v as TicketType)}>
      {types.map((type) => (
        <SegmentedControlItem
          key={type}
          value={type}
          label={t(type)}
          icon={<Icon icon={TYPE_ICON[type]} />}
        />
      ))}
    </SegmentedControl>
  );
}

const makeSchema = (t: (key: string) => string) =>
  z.object({
    type: z.enum(['incident', 'service_request', 'problem', 'change']),
    requester: z.custom<PersonOption | null>(),
    title: z.string().trim().min(3, t('titleTooShort')).max(200, t('titleTooLong')),
    description: z.string().max(20_000),
    impact: z.enum(LEVELS),
    urgency: z.enum(LEVELS),
    categoryId: z.string().nullable(),
    groupId: z.string().nullable(),
    assigneeId: z.string().nullable(),
    cis: z.array(z.custom<CmdbCiOption>()).max(20),
    major: z.boolean(),
  });
type Values = z.infer<ReturnType<typeof makeSchema>>;

/** Agents raise a ticket for anyone: classification, assignment and affected CIs up front. */
export function NewTicketDialog({
  open,
  onOpenChange,
  types = ['incident', 'service_request'],
  defaultType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types?: readonly TicketType[];
  defaultType?: TicketType;
}) {
  const t = useTranslations('itsm.newTicket');
  const tc = useTranslations('common');
  const router = useRouter();
  const uid = useId();
  const { enabledModules } = usePlatform();
  const canPickCis = useCan('cmdb.cis.read') && enabledModules.includes('cmdb');
  const schema = useMemo(() => makeSchema(t), [t]);
  const initialType = defaultType ?? types[0] ?? 'incident';
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: initialType,
      requester: null,
      title: '',
      description: '',
      impact: '2',
      urgency: '2',
      categoryId: null,
      groupId: null,
      assigneeId: null,
      cis: [],
      major: false,
    },
  });
  useEffect(() => {
    if (open)
      form.reset({
        type: initialType,
        requester: null,
        title: '',
        description: '',
        impact: '2',
        urgency: '2',
        categoryId: null,
        groupId: null,
        assigneeId: null,
        cis: [],
        major: false,
      });
  }, [open, initialType, form]);

  const [type, impact, urgency, groupId, categoryId] = useWatch({
    control: form.control,
    name: ['type', 'impact', 'urgency', 'groupId', 'categoryId'],
  });
  const priority = priorityFor(Number(impact), Number(urgency));
  const { categories } = useCategories(type);

  // A category routes to its default group when no group was picked yet.
  useEffect(() => {
    if (!categoryId || form.getValues('groupId')) return;
    const def = categories.find((c) => c.id === categoryId)?.defaultGroup;
    if (def) form.setValue('groupId', def.id);
  }, [categoryId, categories, form]);

  const create = useApiMutation(
    (api, body: CreateTicketInput) => api.post<TicketDetail>('/itsm/tickets', body),
    {
      invalidate: INVALIDATE,
      success: (r) => t('created', { reference: r.reference }),
      onSuccess: (r) => {
        onOpenChange(false);
        router.push(ticketHref(r.reference));
      },
    },
  );

  const submit = form.handleSubmit((v) =>
    create.mutate(
      {
        type: v.type,
        title: v.title.trim(),
        description: v.description.trim(),
        impact: Number(v.impact),
        urgency: Number(v.urgency),
        categoryId: v.categoryId,
        assignmentGroupId: v.groupId,
        assigneeId: v.assigneeId,
        requesterId: v.requester?.id ?? null,
        ciIds: v.cis.map((c) => c.id),
        channel: 'agent',
        major: v.type === 'incident' ? v.major : undefined,
      },
      { onError: (err) => applyServerErrors(err, form.setError as never) },
    ),
  );

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={672} purpose="form">
      <Form {...form}>
        <Layout
          header={
            <DialogHeader
              title={t(types.length === 1 ? `title_${types[0]}` : 'title')}
              subtitle={t('description')}
              onOpenChange={onOpenChange}
            />
          }
          content={
            <LayoutContent padding={4}>
              <form id={`${uid}-form`} onSubmit={submit} noValidate>
                <FormLayout defaultOptionality="optional">
                  {types.length > 1 && (
                    <FormField
                      control={form.control}
                      name="type"
                      render={({ field }) => (
                        <TypeRadio
                          types={types}
                          value={field.value}
                          onChange={(v) => {
                            field.onChange(v);
                            form.setValue('categoryId', null);
                          }}
                          label={t('type')}
                        />
                      )}
                    />
                  )}
                  <FormField
                    control={form.control}
                    name="requester"
                    render={({ field }) => (
                      <Field
                        label={t('requester')}
                        inputID={`${uid}-requester`}
                        description={t('requesterHint')}
                      >
                        <PersonPicker
                          id={`${uid}-requester`}
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t('requesterPlaceholder')}
                        />
                      </Field>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('titleLabel')}
                        isRequired
                        autoComplete="off"
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
                    name="description"
                    render={({ field, fieldState }) => (
                      <TextArea
                        label={t('descriptionLabel')}
                        rows={4}
                        description={t('markdownHint')}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  <Grid columns={{ minWidth: 260 }} gap={3}>
                    <FormField
                      control={form.control}
                      name="impact"
                      render={({ field }) => (
                        <LevelSelect
                          kind="impact"
                          label={t('impact')}
                          width="100%"
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="urgency"
                      render={({ field }) => (
                        <LevelSelect
                          kind="urgency"
                          label={t('urgency')}
                          width="100%"
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </Grid>
                  <HStack gap={2} vAlign="center" aria-live="polite">
                    <Text type="label">{t('priority')}</Text>
                    <PriorityBadge priority={priority} long />
                  </HStack>
                  <FormField
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <CategorySelect
                        label={t('category')}
                        width="100%"
                        type={type}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                  <Grid columns={{ minWidth: 220 }} gap={3}>
                    <FormField
                      control={form.control}
                      name="groupId"
                      render={({ field }) => (
                        <GroupSelect
                          label={t('group')}
                          width="100%"
                          value={field.value}
                          onChange={(v) => {
                            field.onChange(v);
                            form.setValue('assigneeId', null);
                          }}
                        />
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="assigneeId"
                      render={({ field }) => (
                        <AssigneeSelect
                          label={t('assignee')}
                          width="100%"
                          groupId={groupId}
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </Grid>
                  {canPickCis && (
                    <FormField
                      control={form.control}
                      name="cis"
                      render={({ field }) => (
                        <CiPicker label={t('cis')} value={field.value} onChange={field.onChange} />
                      )}
                    />
                  )}
                  {type === 'incident' && (
                    <FormField
                      control={form.control}
                      name="major"
                      render={({ field }) => (
                        <Switch
                          label={t('major')}
                          labelIcon={SirenIcon}
                          description={t('majorHint')}
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  )}
                </FormLayout>
              </form>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider padding={3}>
              <HStack gap={2} hAlign="end">
                <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
                <Button
                  label={t('submit')}
                  variant="primary"
                  type="submit"
                  form={`${uid}-form`}
                  isLoading={create.isPending}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Form>
    </Dialog>
  );
}
