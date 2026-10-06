'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Application, CreateRoleAssignmentInput, Role } from '@isbp/contracts';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import {
  AlertTriangleIcon,
  GlobeIcon,
  HourglassIcon,
  NetworkIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { UserPicker } from '@/components/pickers/user-picker';
import { GroupPicker } from '@/components/roles/group-picker';
import { useDurationText } from '@/components/roles/request-settings';
import { currentTime, fromDateInput, toDateInput, useAccessErrorText } from '@/components/roles/role-utils';
import { Segmented } from '@/components/roles/segmented';
import { applyServerErrors, useApiMutation, useApiQuery } from '@/lib/api';
import { APP_INVALIDATE } from './app-parts';
import { PermissionChip } from './app-permission-picker';

const EXPIRY = ['never', '7', '30', '90', 'custom'] as const;
type Expiry = (typeof EXPIRY)[number];
const DAY = 86_400_000;

const SERVER_FIELDS: Record<string, string> = {
  roleId: 'roleId',
  principalId: 'principal',
  scopeDepartmentId: 'departmentId',
  expiresAt: 'customDate',
  reason: 'reason',
};

function expiryDate(expiry: Expiry, customDate: string, now: number): Date | null {
  if (expiry === 'never') return null;
  if (expiry === 'custom') return fromDateInput(customDate, true);
  return new Date(now + Number(expiry) * DAY);
}

/** Grant one of the application's roles to a person or group — optionally for a department, until a date. */
export function AppGrantDialog({
  app,
  open,
  onOpenChange,
  roleId: prefillRoleId,
}: {
  app: Application;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleId?: string | null;
}) {
  const t = useTranslations('roles.grant');
  const ta = useTranslations('applications.grant');
  const tc = useTranslations('common');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const accessError = useAccessErrorText();
  const duration = useDurationText();

  const schema = useMemo(
    () =>
      z
        .object({
          roleId: z.string().min(1, t('validation.role')),
          principalType: z.enum(['user', 'group']),
          principal: z.object({ id: z.string(), name: z.string() }).nullable(),
          scopeType: z.enum(['global', 'department']),
          departmentId: z.string().nullable(),
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
    roleId: prefillRoleId ?? '',
    principalType: 'user',
    principal: null,
    scopeType: 'global',
    departmentId: null,
    expiry: 'never',
    customDate: '',
    reason: '',
  });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults() });

  useEffect(() => {
    if (open) form.reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillRoleId]);

  const roles = useApiQuery<{ items: Role[] }>(open ? `/applications/${app.id}/roles` : null);
  const [roleId, principalType, principal, scopeType, expiry, customDate] = useWatch({
    control: form.control,
    name: ['roleId', 'principalType', 'principal', 'scopeType', 'expiry', 'customDate'],
  });
  const all = roles.data?.items ?? [];
  const role = all.find((r) => r.id === roleId);
  const expiresAt = expiryDate(expiry, customDate, now.getTime());

  const mutation = useApiMutation(
    (api, body: CreateRoleAssignmentInput) =>
      api.post<{ id: string }>(`/applications/${app.id}/assignments`, body),
    {
      invalidate: APP_INVALIDATE,
      success: () => t('granted', { role: role?.name ?? '', name: principal?.name ?? '' }),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    const at = expiryDate(v.expiry, v.customDate, currentTime());
    const body: CreateRoleAssignmentInput = {
      roleId: v.roleId,
      principalType: v.principalType,
      principalId: v.principal!.id,
      scopeType: v.scopeType,
      scopeDepartmentId: v.scopeType === 'department' ? v.departmentId : null,
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
  });

  const rootError = form.formState.errors.root?.message;
  const principalError = form.formState.errors.principal?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{ta('title', { app: app.name })}</DialogTitle>
          <DialogDescription>{ta('description')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <FormField
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('role')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={roles.isLoading ? tc('loading') : t('rolePlaceholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-72">
                      {all.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <AnimatePresence initial={false} mode="wait">
                    {role && (
                      <motion.div
                        key={role.id}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="space-y-2 rounded-md bg-muted/50 px-3 py-2.5 text-sm"
                      >
                        {role.description && <p className="text-muted-foreground">{role.description}</p>}
                        <div className="flex flex-wrap gap-1">
                          {role.permissions.slice(0, 8).map((p) => (
                            <PermissionChip key={p} value={p} className="bg-background" />
                          ))}
                        </div>
                        {role.maxDurationDays !== null && (
                          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <HourglassIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            {ta('maxDurationNote', { duration: duration(role.maxDurationDays) })}
                          </p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-2" role="group" aria-labelledby="app-grant-principal">
              <span id="app-grant-principal" className="text-sm font-medium">
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
                  invalid={Boolean(principalError)}
                  describedBy={principalError ? 'app-grant-principal-error' : undefined}
                />
              )}
              <p className="text-xs text-muted-foreground">
                {principalType === 'group' ? t('groupHint') : t('userHint')}
              </p>
              {principalError && (
                <p id="app-grant-principal-error" className="text-xs text-destructive">
                  {principalError}
                </p>
              )}
            </div>

            <div className="grid gap-2" role="group" aria-labelledby="app-grant-scope">
              <span id="app-grant-scope" className="text-sm font-medium">
                {t('scope')}
              </span>
              <Segmented
                label={t('scope')}
                value={scopeType}
                onChange={(v) => {
                  form.setValue('scopeType', v);
                  form.clearErrors('departmentId');
                }}
                options={[
                  { value: 'global', label: tc('scope_values.global'), icon: <GlobeIcon /> },
                  { value: 'department', label: tc('scope_values.department'), icon: <NetworkIcon /> },
                ]}
              />
              <AnimatePresence initial={false}>
                {scopeType === 'department' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <FormField
                      control={form.control}
                      name="departmentId"
                      render={({ field }) => (
                        <FormItem className="px-0.5 pt-1 pb-0.5">
                          <FormLabel className="sr-only">{tc('department')}</FormLabel>
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
                  </motion.div>
                )}
              </AnimatePresence>
              <p className="text-xs text-muted-foreground">
                {scopeType === 'department' ? ta('scopeDepartment') : ta('scopeGlobal')}
              </p>
            </div>

            <div className="grid gap-2" role="group" aria-labelledby="app-grant-duration">
              <span id="app-grant-duration" className="text-sm font-medium">
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
                    <Textarea rows={2} maxLength={500} placeholder={ta('reasonPlaceholder')} {...field} />
                  </FormControl>
                  <FormDescription>{t('reasonHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {rootError && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                {rootError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                <ShieldCheckIcon /> {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
