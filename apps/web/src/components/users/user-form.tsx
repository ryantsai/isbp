'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createUserSchema, type UserDetail, updateUserSchema } from '@isbp/contracts';
import { localeLabels, locales } from '@isbp/i18n';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { duration, useReducedMotion } from '@isbp/ui/motion';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { type FieldValues, type Resolver, type UseFormReturn, useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import {
  attributesPayload,
  CustomFieldsSection,
  useApplyEntityErrors,
  useAttributeDefaults,
  useAttributesResolver,
  useEntityFields,
} from '@/components/fields/entity-fields';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { GroupMultiSelect } from '@/components/pickers/group-multi-select';
import { useDepartments } from '@/components/pickers/use-departments';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { useApiMutation, useErrorText } from '@/lib/api';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';

type CreateValues = z.input<typeof createUserSchema>;

const TIMEZONES = [
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;

/** "Mei" + "Lin" → "Mei Lin"; CJK names read family name first, without a space ("林" + "美玲" → "林美玲"). */
export function deriveDisplayName(given: string | null | undefined, family: string | null | undefined) {
  const g = (given ?? '').trim();
  const f = (family ?? '').trim();
  if (!g || !f) return g || f;
  return CJK.test(g + f) ? `${f}${g}` : `${g} ${f}`;
}

/** A named group of fields: a caption over a stack of fields. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <VStack gap={4} role="group" aria-labelledby={id}>
      <Text type="label" id={id}>
        {title}
      </Text>
      {children}
    </VStack>
  );
}

/**
 * Create (no `user`) or edit (`user`) a person. In the order onboarding happens: who they are (the display name
 * follows the given and family names), where they work (the manager follows the department), which groups give them
 * their access; language, time zone and password sit behind one disclosure.
 */
export function UserFormSheet({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: UserDetail;
}) {
  const t = useTranslations('users.form');
  const tc = useTranslations('common');
  const router = useRouter();
  const errorText = useErrorText();
  const reduce = useReducedMotion();
  const ids = useId();
  const editing = Boolean(user);
  const [manager, setManager] = useState<PickedUser | null>(null);
  /** Where the manager came from: picked by hand, or suggested by a department (its name). */
  const [managerFrom, setManagerFrom] = useState<{ picked: boolean; department: string | null }>({
    picked: false,
    department: null,
  });
  const [managerFlash, setManagerFlash] = useState(0);
  const { byId: departments } = useDepartments();
  const list = useFieldList();

  const custom = useEntityFields('core.user', open);
  const applyErrors = useApplyEntityErrors();
  const base = useAttributesResolver(
    zodResolver(
      editing ? (updateUserSchema as unknown as typeof createUserSchema) : createUserSchema,
    ) as Resolver<CreateValues>,
    custom.fields,
  );
  // The username rule's own text is the API's (English): show ours instead.
  const resolver: Resolver<CreateValues> = async (values, context, options) => {
    const result = await base(values, context, options);
    const username = result.errors.username;
    if (username?.type === 'invalid_format')
      result.errors.username = { ...username, message: t('usernameInvalid') };
    return result;
  };

  const form = useForm<CreateValues>({
    resolver,
    defaultValues: {
      email: '',
      username: '',
      displayName: '',
      givenName: '',
      familyName: '',
      jobTitle: '',
      phone: '',
      employeeId: '',
      departmentId: null,
      managerId: null,
      status: 'active',
      locale: 'en',
      timezone: 'Asia/Taipei',
      groupIds: [],
    },
  });

  useEffect(() => {
    if (!open) return;
    setManagerFrom({ picked: false, department: null });
    if (user) {
      form.reset({
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        givenName: user.givenName ?? '',
        familyName: user.familyName ?? '',
        jobTitle: user.jobTitle ?? '',
        phone: user.phone ?? '',
        employeeId: user.employeeId ?? '',
        departmentId: user.department?.id ?? null,
        managerId: user.manager?.id ?? null,
        locale: user.locale as CreateValues['locale'],
        timezone: user.timezone,
      });
      setManager(user.manager ? { id: user.manager.id, displayName: user.manager.displayName } : null);
    } else {
      form.reset();
      setManager(null);
    }
  }, [open, user, form]);
  // Custom fields: stored values (or defaults) once the definitions are known.
  useAttributeDefaults(
    form as unknown as UseFormReturn<FieldValues>,
    custom.fields,
    custom.ready,
    open,
    user?.attributes,
  );

  // While creating: the username follows the email, the display name follows the names, until edited by hand.
  const email = useWatch({ control: form.control, name: 'email' });
  const givenName = useWatch({ control: form.control, name: 'givenName' });
  const familyName = useWatch({ control: form.control, name: 'familyName' });
  useEffect(() => {
    if (editing || form.getFieldState('username').isDirty) return;
    const local = (email ?? '').split('@')[0]?.replace(/[^a-zA-Z0-9._-]/g, '') ?? '';
    form.setValue('username', local);
  }, [email, editing, form]);
  useEffect(() => {
    if (editing || form.getFieldState('displayName').isDirty) return;
    const derived = deriveDisplayName(givenName, familyName);
    form.setValue('displayName', derived, { shouldValidate: form.formState.isSubmitted && Boolean(derived) });
  }, [givenName, familyName, editing, form]);

  /** A new department suggests its manager, unless the manager was picked by hand. */
  const onDepartmentChange = (id: string | null, previous: string | null | undefined) => {
    form.setValue('departmentId', id, { shouldDirty: true });
    const next = id ? departments.get(id) : undefined;
    const old = previous ? departments.get(previous) : undefined;
    const fromOld = !manager || (old?.manager && manager.id === old.manager.id) || managerFrom.department;
    if (managerFrom.picked || !fromOld) return;
    const suggested = next?.manager && next.manager.id !== user?.id ? next.manager : null;
    if ((suggested?.id ?? null) === (manager?.id ?? null)) {
      setManagerFrom({ picked: false, department: suggested ? next!.name : null });
      return;
    }
    setManager(suggested);
    form.setValue('managerId', suggested?.id ?? null, { shouldDirty: true });
    setManagerFrom({ picked: false, department: suggested ? next!.name : null });
    setManagerFlash((n) => n + 1);
  };

  const create = useApiMutation((api, values: CreateValues) => api.post<UserDetail>('/users', values), {
    invalidate: ['/users', '/platform/dashboard', '/groups'],
    success: (u) => t('created', { name: u.displayName }),
    // Navigating away unmounts the sheet; closing it first would race with a second URL change.
    onSuccess: (u) => router.push(`/admin/users/${u.id}?new=1`),
    silent: true,
  });
  const update = useApiMutation(
    (api, values: CreateValues) => api.patch<UserDetail>(`/users/${user!.id}`, values),
    {
      invalidate: ['/users', '/platform/dashboard'],
      success: t('saved'),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const mutation = editing ? update : create;

  const onSubmit = form.handleSubmit(async (values) => {
    const { username: _u, status: _s, groupIds: _g, password: _p, attributes, ...editable } = values;
    // Custom-field values only once their definitions are loaded (never wipe them by accident).
    const customValues = custom.ready ? { attributes: attributesPayload(custom.fields, attributes) } : {};
    try {
      await mutation.mutateAsync(
        editing
          ? ({ ...editable, ...customValues } as CreateValues)
          : { ...values, attributes: undefined, ...customValues },
      );
    } catch (err) {
      if (!applyErrors(err, form.setError as never)) form.setError('root', { message: errorText(err) });
    }
  });

  const status = useWatch({ control: form.control, name: 'status' });
  const groupIds = useWatch({ control: form.control, name: 'groupIds' }) ?? [];
  const [employeeId, phone, password] = useWatch({
    control: form.control,
    name: ['employeeId', 'phone', 'password'],
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{editing ? t('editTitle', { name: user!.displayName }) : t('createTitle')}</SheetTitle>
          <SheetDescription>{editing ? t('editDescription') : t('createDescription')}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody className="py-2">
              <FormLayout defaultOptionality="optional">
                <Section title={t('sections.identity')}>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('email')}
                        type="email"
                        autoComplete="off"
                        isRequired
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                  {!editing && (
                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field, fieldState }) => (
                        <TextInput
                          label={t('username')}
                          autoComplete="off"
                          isRequired
                          description={t('usernameHint')}
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
                  )}
                  <Grid columns={{ minWidth: 200 }} gap={3}>
                    <FormField
                      control={form.control}
                      name="givenName"
                      render={({ field }) => (
                        <TextInput
                          label={t('givenName')}
                          autoComplete="off"
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                        />
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="familyName"
                      render={({ field }) => (
                        <TextInput
                          label={t('familyName')}
                          autoComplete="off"
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                        />
                      )}
                    />
                  </Grid>
                  <FormField
                    control={form.control}
                    name="displayName"
                    render={({ field, fieldState }) => (
                      <TextInput
                        label={t('displayName')}
                        autoComplete="off"
                        isRequired
                        description={!editing ? t('displayNameHint') : undefined}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />
                </Section>

                <Section title={t('sections.organisation')}>
                  <FormField
                    control={form.control}
                    name="jobTitle"
                    render={({ field }) => (
                      <TextInput
                        label={t('jobTitle')}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="departmentId"
                    render={({ field, fieldState }) => (
                      <Field
                        label={t('department')}
                        inputID={`${ids}-department`}
                        status={fieldStatus(fieldState)}
                      >
                        <DepartmentSelect
                          id={`${ids}-department`}
                          value={field.value}
                          onChange={(id) => onDepartmentChange(id, field.value)}
                        />
                      </Field>
                    )}
                  />
                  <Field
                    label={t('manager')}
                    inputID={`${ids}-manager`}
                    description={
                      managerFrom.department
                        ? t('managerFromDepartment', { department: managerFrom.department })
                        : undefined
                    }
                  >
                    <motion.div
                      key={managerFlash}
                      initial={managerFlash && !reduce ? { opacity: 0.35 } : false}
                      animate={{ opacity: 1 }}
                      transition={{ duration: duration.fast }}
                    >
                      <UserPicker
                        id={`${ids}-manager`}
                        value={manager}
                        excludeIds={user ? [user.id] : []}
                        placeholder={t('noManager')}
                        onChange={(m) => {
                          setManager(m);
                          setManagerFrom({ picked: true, department: null });
                          form.setValue('managerId', m?.id ?? null, { shouldDirty: true });
                        }}
                      />
                    </motion.div>
                  </Field>
                  {!editing && (
                    <Field
                      label={t('groups')}
                      isGroupLabel
                      labelID={`${ids}-groups-label`}
                      inputID={`${ids}-groups`}
                      description={t('groupsHint')}
                    >
                      <GroupMultiSelect
                        labelledBy={`${ids}-groups-label`}
                        value={groupIds}
                        onChange={(next) => form.setValue('groupIds', next, { shouldDirty: true })}
                      />
                    </Field>
                  )}
                </Section>

                {!editing && (
                  <Section title={t('sections.account')}>
                    <RadioList
                      label={t('status')}
                      value={status ?? 'active'}
                      onChange={(v) => form.setValue('status', v === 'pending' ? 'pending' : 'active')}
                    >
                      <RadioListItem
                        value="active"
                        label={t('statusActive')}
                        description={t('statusActiveHint')}
                      />
                      <RadioListItem
                        value="pending"
                        label={t('statusPending')}
                        description={t('statusPendingHint')}
                      />
                    </RadioList>
                  </Section>
                )}

                <OptionalFields
                  hint={list([t('employeeId'), t('phone')])}
                  filled={countFilled(employeeId, phone)}
                >
                  <Grid columns={{ minWidth: 200 }} gap={3}>
                    <FormField
                      control={form.control}
                      name="employeeId"
                      render={({ field }) => (
                        <TextInput
                          label={t('employeeId')}
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                        />
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <TextInput
                          label={t('phone')}
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                        />
                      )}
                    />
                  </Grid>
                </OptionalFields>

                <OptionalFields label={editing ? t('moreEditing') : t('more')} filled={countFilled(password)}>
                  <VStack gap={4}>
                    <Grid columns={{ minWidth: 200 }} gap={3}>
                      <FormField
                        control={form.control}
                        name="locale"
                        render={({ field }) => (
                          <Selector
                            label={t('locale')}
                            value={field.value}
                            onChange={field.onChange}
                            options={locales.map((l) => ({ value: l, label: localeLabels[l] }))}
                          />
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="timezone"
                        render={({ field }) => (
                          <Selector
                            label={t('timezone')}
                            value={field.value}
                            onChange={field.onChange}
                            options={[...new Set([field.value ?? 'UTC', ...TIMEZONES])]}
                          />
                        )}
                      />
                    </Grid>
                    {!editing && (
                      <FormField
                        control={form.control}
                        name="password"
                        render={({ field, fieldState }) => (
                          <TextInput
                            label={t('password')}
                            type="password"
                            autoComplete="new-password"
                            description={t('passwordHint')}
                            value={field.value ?? ''}
                            onChange={(v) => field.onChange(v || undefined)}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                    )}
                  </VStack>
                </OptionalFields>

                <CustomFieldsSection
                  elements={custom.elements}
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
            </SheetBody>
            <SheetFooter>
              <Button
                label={tc('cancel')}
                variant="secondary"
                type="button"
                onClick={() => onOpenChange(false)}
              />
              <Button
                label={editing ? tc('saveChanges') : tc('create')}
                variant="primary"
                isLoading={mutation.isPending}
                type="submit"
              />
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
