'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreateRoleAssignmentInput,
  type Group,
  principalTypeSchema,
  type Role,
  scopeTypeSchema,
  type UserDetail,
} from '@isbp/contracts';
import { Badge } from '@isbp/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@isbp/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Textarea } from '@isbp/ui/textarea';
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  FileKeyIcon,
  GlobeIcon,
  NetworkIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { UserPicker } from '@/components/pickers/user-picker';
import { applyServerErrors, useApiMutation, useApiQuery } from '@/lib/api';
import { ACCESS_INVALIDATE } from './assignment-parts';
import { GroupPicker } from './group-picker';
import { Segmented } from './segmented';
import {
  currentTime,
  fromDateInput,
  toDateInput,
  useAccessErrorText,
  useGrantable,
  useRoleText,
} from './role-utils';

const EXPIRY = ['never', '7', '30', '90', 'custom'] as const;
type Expiry = (typeof EXPIRY)[number];
const DAY = 86_400_000;

export interface GrantPrefill {
  roleId?: string | null;
  userId?: string | null;
  groupId?: string | null;
}

/** Server validation paths → form fields. */
const SERVER_FIELDS: Record<string, string> = {
  roleId: 'roleId',
  principalId: 'principal',
  scopeDepartmentId: 'departmentId',
  scopeRecordType: 'recordType',
  scopeRecordId: 'recordId',
  expiresAt: 'customDate',
  reason: 'reason',
};

function expiryDate(expiry: Expiry, customDate: string, now: number): Date | null {
  if (expiry === 'never') return null;
  if (expiry === 'custom') return fromDateInput(customDate, true);
  return new Date(now + Number(expiry) * DAY);
}

/**
 * Grant a role to a person or group. Simple by default (role, who, how long, why); scope (department or
 * a single record) sits behind "advanced". Mirrors the API's escalation guard by disabling roles that
 * contain permissions you don't hold globally.
 */
export function GrantRoleSheet({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: GrantPrefill;
}) {
  const t = useTranslations('roles.grant');
  const tc = useTranslations('common');
  const tr = useTranslations('roles');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const roleText = useRoleText();
  const grantable = useGrantable();
  const accessError = useAccessErrorText();
  const [advanced, setAdvanced] = useState(false);

  const schema = useMemo(
    () =>
      z
        .object({
          roleId: z.string().min(1, t('validation.role')),
          principalType: principalTypeSchema,
          principal: z.object({ id: z.string(), name: z.string() }).nullable(),
          scopeType: scopeTypeSchema,
          departmentId: z.string().nullable(),
          recordType: z.string().trim().max(100),
          recordId: z.string().trim().max(200),
          expiry: z.enum(EXPIRY),
          customDate: z.string(),
          reason: z.string().trim().max(500, t('validation.reason')),
        })
        .superRefine((v, ctx) => {
          if (!v.principal)
            ctx.addIssue({
              code: 'custom',
              path: ['principal'],
              message: v.principalType === 'user' ? t('validation.user') : t('validation.group'),
            });
          if (v.scopeType === 'department' && !v.departmentId)
            ctx.addIssue({ code: 'custom', path: ['departmentId'], message: t('validation.department') });
          if (v.scopeType === 'record' && !v.recordType)
            ctx.addIssue({ code: 'custom', path: ['recordType'], message: t('validation.recordType') });
          if (v.scopeType === 'record' && !v.recordId)
            ctx.addIssue({ code: 'custom', path: ['recordId'], message: t('validation.recordId') });
          if (v.expiry === 'custom') {
            const d = fromDateInput(v.customDate, true);
            if (!d) ctx.addIssue({ code: 'custom', path: ['customDate'], message: t('validation.date') });
            else if (d.getTime() <= currentTime())
              ctx.addIssue({ code: 'custom', path: ['customDate'], message: t('validation.future') });
          }
        }),
    [t],
  );
  type Values = z.input<typeof schema>;

  const defaults = (): Values => ({
    roleId: prefill?.roleId ?? '',
    principalType: prefill?.groupId ? 'group' : 'user',
    principal: null,
    scopeType: 'global',
    departmentId: null,
    recordType: '',
    recordId: '',
    expiry: 'never',
    customDate: '',
    reason: '',
  });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults() });

  const roles = useApiQuery<{ items: Role[] }>(open ? '/roles' : null);
  // Deep links (`?assign=1&userId=…` / `&groupId=…`) only carry the id — fetch the name.
  const prefillUser = useApiQuery<UserDetail>(open && prefill?.userId ? `/users/${prefill.userId}` : null);
  const prefillGroup = useApiQuery<Group>(
    open && prefill?.groupId && !prefill.userId ? `/groups/${prefill.groupId}` : null,
  );

  useEffect(() => {
    if (!open) return;
    form.reset(defaults());
    setAdvanced(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill?.roleId, prefill?.userId, prefill?.groupId]);

  useEffect(() => {
    if (!open || form.getValues('principal')) return;
    if (prefillUser.data && prefillUser.data.id === prefill?.userId) {
      form.setValue('principalType', 'user');
      form.setValue('principal', { id: prefillUser.data.id, name: prefillUser.data.displayName });
    } else if (prefillGroup.data && prefillGroup.data.id === prefill?.groupId) {
      form.setValue('principalType', 'group');
      form.setValue('principal', { id: prefillGroup.data.id, name: prefillGroup.data.name });
    }
  }, [open, prefillUser.data, prefillGroup.data, prefill?.userId, prefill?.groupId, form]);

  const [roleId, principalType, principal, scopeType, expiry, customDate] = useWatch({
    control: form.control,
    name: ['roleId', 'principalType', 'principal', 'scopeType', 'expiry', 'customDate'],
  });
  const allRoles = roles.data?.items ?? [];
  const selectedRole = allRoles.find((r) => r.id === roleId);
  const expiresAt = expiryDate(expiry, customDate, now.getTime());

  const mutation = useApiMutation(
    (api, body: CreateRoleAssignmentInput) => api.post<{ id: string }>('/role-assignments', body),
    {
      invalidate: ACCESS_INVALIDATE,
      success: () =>
        t('granted', { role: selectedRole ? roleText(selectedRole).name : '', name: principal?.name ?? '' }),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );

  const onSubmit = form.handleSubmit(
    async (v) => {
      form.clearErrors('root');
      const at = expiryDate(v.expiry, v.customDate, currentTime());
      const body: CreateRoleAssignmentInput = {
        roleId: v.roleId,
        principalType: v.principalType,
        principalId: v.principal!.id,
        scopeType: v.scopeType,
        scopeDepartmentId: v.scopeType === 'department' ? v.departmentId : null,
        scopeRecordType: v.scopeType === 'record' ? v.recordType.trim() : null,
        scopeRecordId: v.scopeType === 'record' ? v.recordId.trim() : null,
        expiresAt: at ? at.toISOString() : null,
        reason: v.reason.trim() || null,
      };
      try {
        await mutation.mutateAsync(body);
      } catch (err) {
        const mapped = applyServerErrors(err, ((name: string, e: { message: string }) =>
          form.setError((SERVER_FIELDS[name] ?? 'root') as keyof Values, e)) as never);
        if (!mapped) form.setError('root', { message: accessError(err) });
      }
    },
    (errors) => {
      // Reveal the scope fields if that's where the problem is.
      if (errors.departmentId || errors.recordType || errors.recordId) setAdvanced(true);
    },
  );

  const systemRoles = allRoles.filter((r) => r.isSystem);
  const customRoles = allRoles.filter((r) => !r.isSystem);
  const canGrantRole = (r: Role) => r.permissions.every(grantable);
  const rootError = form.formState.errors.root?.message;
  const principalError = form.formState.errors.principal?.message;
  const scopeLabel =
    scopeType === 'department'
      ? tc('scope_values.department')
      : scopeType === 'record'
        ? tc('scope_values.record')
        : null;

  const roleItem = (r: Role) => {
    const ok = canGrantRole(r);
    return (
      <SelectItem key={r.id} value={r.id} disabled={!ok}>
        {roleText(r).name}
        {!ok && <span className="text-xs text-muted-foreground"> — {t('roleNotHeld')}</span>}
      </SelectItem>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody className="space-y-6 py-2">
              {/* role */}
              <FormField
                control={form.control}
                name="roleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('role')}</FormLabel>
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={roles.isLoading ? tc('loading') : t('rolePlaceholder')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-80">
                        {customRoles.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>{tr('customRoles')}</SelectLabel>
                            {customRoles.map(roleItem)}
                          </SelectGroup>
                        )}
                        {systemRoles.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>{tr('systemRoles')}</SelectLabel>
                            {systemRoles.map(roleItem)}
                          </SelectGroup>
                        )}
                      </SelectContent>
                    </Select>
                    <AnimatePresence initial={false} mode="wait">
                      {selectedRole && (
                        <motion.div
                          key={selectedRole.id}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="space-y-2 rounded-md bg-muted/50 px-3 py-2.5 text-sm"
                        >
                          {roleText(selectedRole).description && (
                            <p className="text-muted-foreground">{roleText(selectedRole).description}</p>
                          )}
                          <div className="flex flex-wrap gap-1">
                            {selectedRole.permissions.slice(0, 6).map((p) => (
                              <code
                                key={p}
                                className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                              >
                                {p}
                              </code>
                            ))}
                            {selectedRole.permissions.length > 6 && (
                              <span className="px-1 text-xs text-muted-foreground">
                                {tr('card.more', { count: selectedRole.permissions.length - 6 })}
                              </span>
                            )}
                            {selectedRole.permissions.length === 0 && (
                              <span className="text-xs text-muted-foreground">
                                {tr('card.permissions', { count: 0 })}
                              </span>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* who */}
              <div className="grid gap-2" role="group" aria-labelledby="grant-principal-label">
                <span id="grant-principal-label" className="text-sm font-medium">
                  {t('to')}
                </span>
                <Segmented
                  label={t('principalType')}
                  value={principalType}
                  onChange={(v) => {
                    if (v === principalType) return;
                    form.setValue('principalType', v);
                    form.setValue('principal', null);
                    form.clearErrors('principal');
                  }}
                  options={[
                    { value: 'user', label: t('person'), icon: <UserIcon /> },
                    { value: 'group', label: t('group'), icon: <UsersRoundIcon /> },
                  ]}
                />
                {principalType === 'user' ? (
                  <UserPicker
                    value={principal ? { id: principal.id, displayName: principal.name } : null}
                    onChange={(u) =>
                      form.setValue('principal', u ? { id: u.id, name: u.displayName } : null, {
                        shouldValidate: form.formState.isSubmitted,
                      })
                    }
                    placeholder={t('userPlaceholder')}
                    aria-label={t('person')}
                    aria-describedby={principalError ? 'grant-principal-error' : undefined}
                  />
                ) : (
                  <GroupPicker
                    value={principal}
                    onChange={(g) =>
                      form.setValue('principal', g ? { id: g.id, name: g.name } : null, {
                        shouldValidate: form.formState.isSubmitted,
                      })
                    }
                    placeholder={t('groupPlaceholder')}
                    aria-label={t('group')}
                    invalid={Boolean(principalError)}
                    describedBy={principalError ? 'grant-principal-error' : undefined}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {principalType === 'group' ? t('groupHint') : t('userHint')}
                </p>
                {principalError && (
                  <p id="grant-principal-error" className="text-xs text-destructive animate-in fade-in-0">
                    {principalError}
                  </p>
                )}
              </div>

              {/* how long */}
              <div className="grid gap-2" role="group" aria-labelledby="grant-duration-label">
                <span id="grant-duration-label" className="text-sm font-medium">
                  {t('duration')}
                </span>
                <Segmented
                  label={t('duration')}
                  value={expiry}
                  onChange={(v) => form.setValue('expiry', v, { shouldValidate: form.formState.isSubmitted })}
                  options={EXPIRY.map((e) => ({ value: e, label: t(`expiry.${e}`) }))}
                  className="[&>button]:px-2"
                />
                <AnimatePresence initial={false}>
                  {expiry === 'custom' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <FormField
                        control={form.control}
                        name="customDate"
                        render={({ field }) => (
                          <FormItem className="px-0.5 pt-1 pb-0.5">
                            <FormLabel className="sr-only">{t('customDate')}</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                min={toDateInput(new Date(now.getTime() + DAY))}
                                {...field}
                                className="w-full sm:w-52"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {expiresAt
                    ? t('endsAt', {
                        date: format.dateTime(expiresAt, { dateStyle: 'medium', timeStyle: 'short' }),
                      })
                    : t('permanentHint')}
                </p>
              </div>

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('reason')}{' '}
                      <span className="font-normal text-muted-foreground">({tc('optional')})</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea rows={2} maxLength={500} placeholder={t('reasonPlaceholder')} {...field} />
                    </FormControl>
                    <FormDescription>{t('reasonHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* advanced: scope */}
              <div>
                <button
                  type="button"
                  onClick={() => setAdvanced((a) => !a)}
                  aria-expanded={advanced}
                  className="flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <ChevronDownIcon
                    className={`size-4 transition-transform duration-200 ${advanced ? 'rotate-180' : ''}`}
                  />
                  {advanced ? tc('hideAdvanced') : t('limitScope')}
                  {!advanced && scopeLabel && <Badge variant="info">{scopeLabel}</Badge>}
                </button>
                <AnimatePresence initial={false}>
                  {advanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-4 px-0.5 pt-4 pb-0.5">
                        <div className="grid gap-2">
                          <span className="text-sm font-medium">{t('scope')}</span>
                          <Segmented
                            label={t('scope')}
                            value={scopeType}
                            onChange={(v) => {
                              form.setValue('scopeType', v);
                              form.clearErrors(['departmentId', 'recordType', 'recordId']);
                            }}
                            options={[
                              { value: 'global', label: tc('scope_values.global'), icon: <GlobeIcon /> },
                              {
                                value: 'department',
                                label: tc('scope_values.department'),
                                icon: <NetworkIcon />,
                              },
                              { value: 'record', label: tc('scope_values.record'), icon: <FileKeyIcon /> },
                            ]}
                          />
                          <p className="text-xs text-muted-foreground">{t(`scopeHint.${scopeType}`)}</p>
                        </div>
                        {scopeType === 'department' && (
                          <FormField
                            control={form.control}
                            name="departmentId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{tc('department')}</FormLabel>
                                <FormControl>
                                  <DepartmentSelect
                                    value={field.value}
                                    onChange={field.onChange}
                                    noneLabel={t('chooseDepartment')}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        {scopeType === 'record' && (
                          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
                            <FormField
                              control={form.control}
                              name="recordType"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('recordType')}</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder="group"
                                      spellCheck={false}
                                      autoComplete="off"
                                      className="font-mono"
                                      {...field}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="recordId"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('recordId')}</FormLabel>
                                  <FormControl>
                                    <Input
                                      spellCheck={false}
                                      autoComplete="off"
                                      className="font-mono"
                                      {...field}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {rootError && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  {rootError}
                </p>
              )}
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                <ShieldCheckIcon /> {t('submit')}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
