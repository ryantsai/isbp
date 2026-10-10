'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createUserSchema, type UserDetail, updateUserSchema } from '@isbp/contracts';
import { localeLabels, locales } from '@isbp/i18n';
import { Button } from '@isbp/ui/button';
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
import { duration, useReducedMotion } from '@isbp/ui/motion';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
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
import { type ReactNode, useEffect, useState } from 'react';
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4">
      <legend className="mb-3 text-xs font-semibold text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

/** The visual "required" mark; the control itself carries `aria-required`. */
function Required() {
  return (
    <span aria-hidden className="text-destructive">
      *
    </span>
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
            <SheetBody className="space-y-7 py-2">
              <p className="text-xs text-muted-foreground">{t('requiredNote')}</p>
              <Section title={t('sections.identity')}>
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('email')} <Required />
                      </FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="off" aria-required {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {!editing && (
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t('username')} <Required />
                        </FormLabel>
                        <FormControl>
                          <Input autoComplete="off" aria-required {...field} />
                        </FormControl>
                        <FormDescription>{t('usernameHint')}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="givenName"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>{t('givenName')}</FormLabel>
                        <FormControl>
                          <Input autoComplete="off" {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="familyName"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>{t('familyName')}</FormLabel>
                        <FormControl>
                          <Input autoComplete="off" {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('displayName')} <Required />
                      </FormLabel>
                      <FormControl>
                        <Input autoComplete="off" aria-required {...field} />
                      </FormControl>
                      {!editing && <FormDescription>{t('displayNameHint')}</FormDescription>}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </Section>

              <Section title={t('sections.organisation')}>
                <FormField
                  control={form.control}
                  name="jobTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('jobTitle')}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ''} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="departmentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('department')}</FormLabel>
                      <FormControl>
                        <DepartmentSelect
                          value={field.value}
                          onChange={(id) => onDepartmentChange(id, field.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-2">
                  <Label htmlFor="person-manager">{t('manager')}</Label>
                  <motion.div
                    key={managerFlash}
                    initial={managerFlash && !reduce ? { opacity: 0.35 } : false}
                    animate={{ opacity: 1 }}
                    transition={{ duration: duration.fast }}
                  >
                    <UserPicker
                      id="person-manager"
                      value={manager}
                      excludeIds={user ? [user.id] : []}
                      placeholder={t('noManager')}
                      aria-describedby={managerFrom.department ? 'person-manager-hint' : undefined}
                      onChange={(m) => {
                        setManager(m);
                        setManagerFrom({ picked: true, department: null });
                        form.setValue('managerId', m?.id ?? null, { shouldDirty: true });
                      }}
                    />
                  </motion.div>
                  {managerFrom.department && (
                    <p id="person-manager-hint" className="text-xs text-muted-foreground" aria-live="polite">
                      {t('managerFromDepartment', { department: managerFrom.department })}
                    </p>
                  )}
                </div>
                {!editing && (
                  <div className="grid gap-2">
                    <Label id="person-groups-label">{t('groups')}</Label>
                    <p className="text-xs text-muted-foreground">{t('groupsHint')}</p>
                    <GroupMultiSelect
                      labelledBy="person-groups-label"
                      value={groupIds}
                      onChange={(ids) => form.setValue('groupIds', ids, { shouldDirty: true })}
                    />
                  </div>
                )}
              </Section>

              {!editing && (
                <Section title={t('sections.account')}>
                  <div role="radiogroup" aria-label={t('status')} className="grid grid-cols-2 gap-2">
                    {(['active', 'pending'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={status === s}
                        onClick={() => form.setValue('status', s)}
                        className="relative min-w-0 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-checked:border-primary aria-checked:bg-primary/5 motion-reduce:transition-none"
                      >
                        <div className="text-sm font-medium">
                          {s === 'active' ? t('statusActive') : t('statusPending')}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {s === 'active' ? t('statusActiveHint') : t('statusPendingHint')}
                        </div>
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              <OptionalFields
                hint={list([t('employeeId'), t('phone')])}
                filled={countFilled(employeeId, phone)}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="employeeId"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>{t('employeeId')}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>{t('phone')}</FormLabel>
                        <FormControl>
                          <Input type="tel" {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </OptionalFields>

              <OptionalFields label={editing ? t('moreEditing') : t('more')} filled={countFilled(password)}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="locale"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>{t('locale')}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {locales.map((l) => (
                              <SelectItem key={l} value={l}>
                                {localeLabels[l]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="timezone"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>{t('timezone')}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {[...new Set([field.value ?? 'UTC', ...TIMEZONES])].map((tz) => (
                              <SelectItem key={tz} value={tz}>
                                {tz}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>
                {!editing && (
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('password')}</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            autoComplete="new-password"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value || undefined)}
                          />
                        </FormControl>
                        <FormDescription>{t('passwordHint')}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </OptionalFields>

              <CustomFieldsSection
                elements={custom.elements}
                form={form as unknown as UseFormReturn<FieldValues>}
              />

              {form.formState.errors.root && (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.root.message}
                </p>
              )}
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                {editing ? tc('saveChanges') : tc('create')}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
