'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { Card } from '@astryxdesign/core/Card';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Application, CreateRoleAssignmentInput, Role } from '@isbp/contracts';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import {
  GlobeIcon,
  HourglassIcon,
  NetworkIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { UserPicker } from '@/components/pickers/user-picker';
import { GroupPicker } from '@/components/roles/group-picker';
import { Segmented } from '@isbp/ui/segmented';
import { useDurationText } from '@/components/roles/request-settings';
import { currentTime, fromDateInput, toDateInput, useAccessErrorText } from '@/components/roles/role-utils';
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
  const formId = useId();
  const ids = useId();

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
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={512} purpose="form">
      <Form {...form}>
        <Layout
          header={
            <DialogHeader
              title={ta('title', { app: app.name })}
              subtitle={ta('description')}
              onOpenChange={onOpenChange}
            />
          }
          content={
            <LayoutContent padding={4}>
              <form id={formId} onSubmit={onSubmit} noValidate>
                <FormLayout defaultOptionality="required">
                  <FormField
                    control={form.control}
                    name="roleId"
                    render={({ field, fieldState }) => (
                      <VStack gap={2}>
                        <Selector
                          label={t('role')}
                          value={field.value || undefined}
                          onChange={field.onChange}
                          options={all.map((r) => ({ value: r.id, label: r.name }))}
                          placeholder={roles.isLoading ? tc('loading') : t('rolePlaceholder')}
                          isLoading={roles.isLoading}
                          hasSearch={all.length > 8}
                          status={fieldStatus(fieldState)}
                        />
                        <AnimatePresence initial={false} mode="wait">
                          {role && (
                            <motion.div
                              key={role.id}
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.18 }}
                            >
                              <Card variant="muted" padding={3}>
                                <VStack gap={2}>
                                  {role.description && <Text color="secondary">{role.description}</Text>}
                                  <HStack gap={1} wrap="wrap">
                                    {role.permissions.slice(0, 8).map((p) => (
                                      <PermissionChip key={p} value={p} />
                                    ))}
                                  </HStack>
                                  {role.maxDurationDays !== null && (
                                    <HStack gap={1.5} vAlign="start">
                                      <Icon icon={HourglassIcon} size="xsm" color="secondary" />
                                      <Text type="supporting">
                                        {ta('maxDurationNote', { duration: duration(role.maxDurationDays) })}
                                      </Text>
                                    </HStack>
                                  )}
                                </VStack>
                              </Card>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </VStack>
                    )}
                  />

                  <Field
                    label={t('to')}
                    isGroupLabel
                    labelID={`${ids}-to`}
                    inputID={`${ids}-principal`}
                    description={principalType === 'group' ? t('groupHint') : t('userHint')}
                    status={principalError ? { type: 'error', message: principalError } : undefined}
                  >
                    <VStack gap={2}>
                      <SegmentedControl
                        label={t('principalType')}
                        value={principalType}
                        onChange={(v) => {
                          if (v === principalType) return;
                          form.setValue('principalType', v as Values['principalType']);
                          form.setValue('principal', null);
                          form.clearErrors('principal');
                        }}
                      >
                        <SegmentedControlItem
                          value="user"
                          label={t('person')}
                          icon={<Icon icon={UserIcon} />}
                        />
                        <SegmentedControlItem
                          value="group"
                          label={t('group')}
                          icon={<Icon icon={UsersRoundIcon} />}
                        />
                      </SegmentedControl>
                      {principalType === 'user' ? (
                        <UserPicker
                          id={`${ids}-principal`}
                          value={principal ? { id: principal.id, displayName: principal.name } : null}
                          onChange={(u) =>
                            form.setValue('principal', u ? { id: u.id, name: u.displayName } : null, {
                              shouldValidate: form.formState.isSubmitted,
                            })
                          }
                          placeholder={t('userPlaceholder')}
                          aria-label={t('person')}
                        />
                      ) : (
                        <GroupPicker
                          id={`${ids}-principal`}
                          value={principal}
                          onChange={(g) =>
                            form.setValue('principal', g ? { id: g.id, name: g.name } : null, {
                              shouldValidate: form.formState.isSubmitted,
                            })
                          }
                          placeholder={t('groupPlaceholder')}
                          aria-label={t('group')}
                        />
                      )}
                    </VStack>
                  </Field>

                  <Field
                    label={t('scope')}
                    isGroupLabel
                    labelID={`${ids}-scope`}
                    inputID={`${ids}-scope-input`}
                    description={scopeType === 'department' ? ta('scopeDepartment') : ta('scopeGlobal')}
                  >
                    <VStack gap={2}>
                      <SegmentedControl
                        label={t('scope')}
                        value={scopeType}
                        onChange={(v) => {
                          form.setValue('scopeType', v as Values['scopeType']);
                          form.clearErrors('departmentId');
                        }}
                      >
                        <SegmentedControlItem
                          value="global"
                          label={tc('scope_values.global')}
                          icon={<Icon icon={GlobeIcon} />}
                        />
                        <SegmentedControlItem
                          value="department"
                          label={tc('scope_values.department')}
                          icon={<Icon icon={NetworkIcon} />}
                        />
                      </SegmentedControl>
                      <AnimatePresence initial={false}>
                        {scopeType === 'department' && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden px-0.5 pt-1 pb-0.5"
                          >
                            <FormField
                              control={form.control}
                              name="departmentId"
                              render={({ field, fieldState }) => (
                                <Field
                                  label={tc('department')}
                                  isLabelHidden
                                  inputID={`${ids}-department`}
                                  status={fieldStatus(fieldState)}
                                >
                                  <DepartmentSelect
                                    id={`${ids}-department`}
                                    value={field.value}
                                    onChange={field.onChange}
                                    noneLabel={t('chooseDepartment')}
                                  />
                                </Field>
                              )}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </VStack>
                  </Field>

                  <Field
                    label={t('duration')}
                    isGroupLabel
                    labelID={`${ids}-duration`}
                    inputID={`${ids}-duration-input`}
                  >
                    <VStack gap={2}>
                      <Segmented
                        label={t('duration')}
                        value={expiry}
                        onChange={(v) =>
                          form.setValue('expiry', v, { shouldValidate: form.formState.isSubmitted })
                        }
                        options={EXPIRY.map((e) => ({ value: e, label: t(`expiry.${e}`) }))}
                      />
                      <AnimatePresence initial={false}>
                        {expiry === 'custom' && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden px-0.5 pt-1 pb-0.5"
                          >
                            <FormField
                              control={form.control}
                              name="customDate"
                              render={({ field, fieldState }) => (
                                <DateInput
                                  label={t('customDate')}
                                  isLabelHidden
                                  value={(field.value || undefined) as ISODateString | undefined}
                                  onChange={(v) => field.onChange(v ?? '')}
                                  min={toDateInput(new Date(now.getTime() + DAY)) as ISODateString}
                                  status={fieldStatus(fieldState)}
                                  width={208}
                                />
                              )}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <div aria-live="polite">
                        <Text type="supporting">
                          {expiresAt
                            ? t('endsAt', {
                                date: format.dateTime(expiresAt, { dateStyle: 'medium', timeStyle: 'short' }),
                              })
                            : t('permanentHint')}
                        </Text>
                      </div>
                    </VStack>
                  </Field>

                  <FormField
                    control={form.control}
                    name="reason"
                    render={({ field, fieldState }) => (
                      <TextArea
                        label={t('reason')}
                        isOptional
                        rows={2}
                        maxLength={500}
                        placeholder={ta('reasonPlaceholder')}
                        description={t('reasonHint')}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        status={fieldStatus(fieldState)}
                      />
                    )}
                  />

                  {rootError && <Banner status="error" title={rootError} collapsible={false} />}
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
                  icon={<Icon icon={ShieldCheckIcon} />}
                  isLoading={mutation.isPending}
                  type="submit"
                  form={formId}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Form>
    </Dialog>
  );
}
