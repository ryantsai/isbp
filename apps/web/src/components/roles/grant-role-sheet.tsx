'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { Card } from '@astryxdesign/core/Card';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector, type SelectorOptionType } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreateRoleAssignmentInput,
  type Group,
  principalTypeSchema,
  type Role,
  scopeTypeSchema,
  type UserDetail,
} from '@isbp/contracts';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { OptionalFields } from '@isbp/ui/optional-fields';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { FileKeyIcon, GlobeIcon, NetworkIcon, ShieldCheckIcon, UserIcon, UsersRoundIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { PermissionChip } from '@/components/applications/app-permission-picker';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { UserPicker } from '@/components/pickers/user-picker';
import { applyServerErrors, useApiMutation, useApiQuery } from '@/lib/api';
import { ACCESS_INVALIDATE } from './assignment-parts';
import { GroupPicker } from './group-picker';
import { Segmented } from '@isbp/ui/segmented';
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
  const ids = useId();
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

  const roleOption = (r: Role) => {
    const ok = canGrantRole(r);
    return {
      value: r.id,
      label: roleText(r).name,
      disabled: !ok,
      description: ok ? undefined : t('roleNotHeld'),
    };
  };
  const roleOptions: SelectorOptionType[] = [
    ...(customRoles.length > 0
      ? [{ type: 'section' as const, title: tr('customRoles'), options: customRoles.map(roleOption) }]
      : []),
    ...(systemRoles.length > 0
      ? [{ type: 'section' as const, title: tr('systemRoles'), options: systemRoles.map(roleOption) }]
      : []),
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody>
              <FormLayout defaultOptionality="required">
                {/* role */}
                <FormField
                  control={form.control}
                  name="roleId"
                  render={({ field, fieldState }) => (
                    <VStack gap={2}>
                      <Selector
                        label={t('role')}
                        value={field.value || undefined}
                        onChange={field.onChange}
                        options={roleOptions}
                        placeholder={roles.isLoading ? tc('loading') : t('rolePlaceholder')}
                        isLoading={roles.isLoading}
                        hasSearch={allRoles.length > 8}
                        status={fieldStatus(fieldState)}
                      />
                      <AnimatePresence initial={false} mode="wait">
                        {selectedRole && (
                          <motion.div
                            key={selectedRole.id}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.18 }}
                          >
                            <Card variant="muted" padding={3}>
                              <VStack gap={2}>
                                {roleText(selectedRole).description && (
                                  <Text color="secondary">{roleText(selectedRole).description}</Text>
                                )}
                                <HStack gap={1} wrap="wrap" vAlign="center">
                                  {selectedRole.permissions.slice(0, 6).map((p) => (
                                    <PermissionChip key={p} value={p} />
                                  ))}
                                  {selectedRole.permissions.length > 6 && (
                                    <Text type="supporting">
                                      {tr('card.more', { count: selectedRole.permissions.length - 6 })}
                                    </Text>
                                  )}
                                  {selectedRole.permissions.length === 0 && (
                                    <Text type="supporting">{tr('card.permissions', { count: 0 })}</Text>
                                  )}
                                </HStack>
                              </VStack>
                            </Card>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </VStack>
                  )}
                />

                {/* who */}
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

                {/* how long */}
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
                      placeholder={t('reasonPlaceholder')}
                      description={t('reasonHint')}
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />

                {/* advanced: scope */}
                <OptionalFields
                  label={advanced ? tc('hideAdvanced') : t('limitScope')}
                  open={advanced}
                  onOpenChange={setAdvanced}
                  hint={scopeLabel}
                >
                  <VStack gap={4}>
                    <Field
                      label={t('scope')}
                      isGroupLabel
                      labelID={`${ids}-scope`}
                      inputID={`${ids}-scope-input`}
                      description={t(`scopeHint.${scopeType}`)}
                    >
                      <SegmentedControl
                        label={t('scope')}
                        value={scopeType}
                        onChange={(v) => {
                          form.setValue('scopeType', v as Values['scopeType']);
                          form.clearErrors(['departmentId', 'recordType', 'recordId']);
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
                        <SegmentedControlItem
                          value="record"
                          label={tc('scope_values.record')}
                          icon={<Icon icon={FileKeyIcon} />}
                        />
                      </SegmentedControl>
                    </Field>
                    {scopeType === 'department' && (
                      <FormField
                        control={form.control}
                        name="departmentId"
                        render={({ field, fieldState }) => (
                          <Field
                            label={tc('department')}
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
                    )}
                    {scopeType === 'record' && (
                      <Grid columns={{ minWidth: 160 }} gap={3}>
                        <FormField
                          control={form.control}
                          name="recordType"
                          render={({ field, fieldState }) => (
                            <TextInput
                              label={t('recordType')}
                              placeholder="group"
                              autoComplete="off"
                              value={field.value ?? ''}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              ref={field.ref}
                              status={fieldStatus(fieldState)}
                            />
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="recordId"
                          render={({ field, fieldState }) => (
                            <TextInput
                              label={t('recordId')}
                              autoComplete="off"
                              value={field.value ?? ''}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              ref={field.ref}
                              status={fieldStatus(fieldState)}
                            />
                          )}
                        />
                      </Grid>
                    )}
                  </VStack>
                </OptionalFields>

                {rootError && <Banner status="error" title={rootError} collapsible={false} />}
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
                label={t('submit')}
                variant="primary"
                icon={<Icon icon={ShieldCheckIcon} />}
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
