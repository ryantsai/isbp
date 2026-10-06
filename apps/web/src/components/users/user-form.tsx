'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createUserSchema, type Group, type UserDetail, updateUserSchema } from '@isbp/contracts';
import { localeLabels, locales } from '@isbp/i18n';
import type { Page } from '@isbp/sdk';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
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
import { ChevronDownIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { applyServerErrors, useApiMutation, useApiQuery } from '@/lib/api';

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Create (no `user`) or edit (`user`) a person. Simple by default: identity + department up front;
 * groups, password, language and time zone sit behind "advanced".
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
  const editing = Boolean(user);
  const [advanced, setAdvanced] = useState(false);
  const [manager, setManager] = useState<PickedUser | null>(null);
  const groups = useApiQuery<Page<Group>>(open && !editing ? '/groups' : null, {
    pageSize: 100,
    sort: 'name',
  });

  const form = useForm<CreateValues>({
    resolver: zodResolver(
      editing ? (updateUserSchema as unknown as typeof createUserSchema) : createUserSchema,
    ),
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
    setAdvanced(false);
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

  // Suggest a username from the email while creating.
  const email = useWatch({ control: form.control, name: 'email' });
  useEffect(() => {
    if (editing || form.getFieldState('username').isDirty) return;
    const local = (email ?? '').split('@')[0]?.replace(/[^a-zA-Z0-9._-]/g, '') ?? '';
    form.setValue('username', local);
  }, [email, editing, form]);

  const create = useApiMutation((api, values: CreateValues) => api.post<UserDetail>('/users', values), {
    invalidate: ['/users', '/platform/dashboard', '/groups'],
    success: (u) => t('created', { name: u.displayName }),
    // Navigating away unmounts the sheet; closing it first would race with a second URL change.
    onSuccess: (u) => router.push(`/admin/users/${u.id}`),
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
    const { username: _u, status: _s, groupIds: _g, password: _p, ...editable } = values;
    try {
      await mutation.mutateAsync(editing ? (editable as CreateValues) : values);
    } catch (err) {
      if (!applyServerErrors(err, form.setError as never))
        form.setError('root', { message: (err as Error).message });
    }
  });

  const status = useWatch({ control: form.control, name: 'status' });
  const groupIds = useWatch({ control: form.control, name: 'groupIds' }) ?? [];

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
              <Section title={t('sections.identity')}>
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('email')}</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="off" {...field} />
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
                        <FormLabel>{t('username')}</FormLabel>
                        <FormControl>
                          <Input autoComplete="off" {...field} />
                        </FormControl>
                        <FormDescription>{t('usernameHint')}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('displayName')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="givenName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('givenName')}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="familyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('familyName')}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
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
                        <DepartmentSelect value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-2">
                  <Label>{t('manager')}</Label>
                  <UserPicker
                    value={manager}
                    excludeIds={user ? [user.id] : []}
                    placeholder={t('noManager')}
                    onChange={(m) => {
                      setManager(m);
                      form.setValue('managerId', m?.id ?? null, { shouldDirty: true });
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="employeeId"
                    render={({ field }) => (
                      <FormItem>
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
                      <FormItem>
                        <FormLabel>{t('phone')}</FormLabel>
                        <FormControl>
                          <Input type="tel" {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
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
                        className="relative rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 aria-checked:border-primary aria-checked:bg-primary/5"
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

              <div>
                <button
                  type="button"
                  onClick={() => setAdvanced((a) => !a)}
                  aria-expanded={advanced}
                  className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  <ChevronDownIcon
                    className={`size-4 transition-transform duration-200 ${advanced ? 'rotate-180' : ''}`}
                  />
                  {advanced ? tc('hideAdvanced') : tc('showAdvanced')}
                </button>
                <AnimatePresence initial={false}>
                  {advanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-4 pt-4">
                        <div className="grid grid-cols-2 gap-3">
                          <FormField
                            control={form.control}
                            name="locale"
                            render={({ field }) => (
                              <FormItem>
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
                              <FormItem>
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
                          <>
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
                            <div className="grid gap-2">
                              <Label>{t('groups')}</Label>
                              <p className="text-xs text-muted-foreground">{t('groupsHint')}</p>
                              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                                {(groups.data?.items ?? [])
                                  .filter((g) => !g.isSystem)
                                  .map((g) => {
                                    const checked = groupIds.includes(g.id);
                                    return (
                                      <label
                                        key={g.id}
                                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50"
                                      >
                                        <Checkbox
                                          checked={checked}
                                          onCheckedChange={(v) =>
                                            form.setValue(
                                              'groupIds',
                                              v ? [...groupIds, g.id] : groupIds.filter((id) => id !== g.id),
                                              { shouldDirty: true },
                                            )
                                          }
                                        />
                                        {g.name}
                                      </label>
                                    );
                                  })}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {form.formState.errors.root && (
                <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
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
