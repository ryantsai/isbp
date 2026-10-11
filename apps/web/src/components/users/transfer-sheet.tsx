'use client';

import type { TransferOptions, TransferUserInput, UserDetail } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { duration, useReducedMotion } from '@isbp/ui/motion';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { GroupMultiSelect } from '@/components/pickers/group-multi-select';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { useRoleText } from '@/components/roles/role-utils';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';

/**
 * "Move to another department": the department, the manager (its manager suggested), the job title, the groups to
 * leave (the ones the old department shares) and to join (the ones the new department shares) and the
 * department-scoped roles to review — saved as one change (`POST /users/:id/transfer`).
 */
export function TransferSheet({
  user,
  open,
  onOpenChange,
}: {
  user: UserDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('users.transfer');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const roleText = useRoleText();
  const reduce = useReducedMotion();
  const ids = useId();
  const canAssign = useCan('core.roles.assign');
  const canGroups = useCan('core.groups.manage');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [manager, setManager] = useState<PickedUser | null>(user.manager);
  const [managerPicked, setManagerPicked] = useState(false);
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? '');
  const [leave, setLeave] = useState<string[]>([]);
  const [join, setJoin] = useState<string[]>([]);
  const [revoke, setRevoke] = useState<string[]>([]);
  const [seeded, setSeeded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const options = useApiQuery<TransferOptions>(
    open && departmentId ? `/users/${user.id}/transfer` : null,
    departmentId ? { departmentId } : undefined,
  );
  const suggestion = options.data?.department?.id === departmentId ? options.data : undefined;
  // Suggestions arrive per department: apply them once (the person's own choices win afterwards).
  if (suggestion && seeded !== departmentId) {
    setSeeded(departmentId);
    setLeave(suggestion.leave);
    setJoin(suggestion.join);
    if (!managerPicked) setManager(suggestion.department?.manager ?? null);
  }

  const reset = () => {
    setDepartmentId(null);
    setManager(user.manager);
    setManagerPicked(false);
    setJobTitle(user.jobTitle ?? '');
    setLeave([]);
    setJoin([]);
    setRevoke([]);
    setSeeded(null);
    setError(null);
  };

  const save = useApiMutation(
    (api, body: TransferUserInput) =>
      api.post<{ joined: number; left: number; revoked: number }>(`/users/${user.id}/transfer`, body),
    {
      invalidate: ['/users', '/groups', '/audit-logs', '/role-assignments', '/platform/dashboard'],
      success: t('done', { name: user.displayName, department: suggestion?.department?.name ?? '' }),
      onSuccess: () => {
        onOpenChange(false);
        reset();
      },
      silent: true,
    },
  );

  const same = departmentId !== null && departmentId === (user.department?.id ?? null);
  const manual = user.groups.filter((g) => g.source === 'manual' && g.groupSource === 'local');
  const kept = user.groups.filter((g) => !manual.includes(g));
  const roles = suggestion?.roles ?? [];
  const managerFromDepartment =
    !managerPicked && suggestion?.department?.manager && manager?.id === suggestion.department.manager.id
      ? suggestion.department.name
      : null;

  const roleDetail = (r: (typeof roles)[number]) =>
    [r.application, t('scopedTo', { department: r.scope.name }), r.oldDepartment ? t('forOldJob') : null]
      .filter(Boolean)
      .join(' · ');

  const submit = () => {
    setError(null);
    if (!departmentId) return setError(t('chooseDepartment'));
    if (same) return setError(t('sameDepartment'));
    save.mutate(
      {
        departmentId,
        managerId: manager?.id ?? null,
        jobTitle: jobTitle.trim() || null,
        leaveGroupIds: canGroups ? leave : [],
        joinGroupIds: canGroups ? join : [],
        revokeAssignmentIds: canAssign ? revoke : [],
      },
      { onError: (err) => setError(errorText(err)) },
    );
  };

  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) =>
    set(on ? [...new Set([...list, id])] : list.filter((x) => x !== id));

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <SheetContent className="sm:max-w-xl" dirty={departmentId !== null && !save.isPending}>
        <SheetHeader>
          <SheetTitle>{t('title', { name: user.displayName })}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <SheetBody className="py-2">
            <FormLayout defaultOptionality="optional">
              <Field
                label={t('department')}
                inputID={`${ids}-department`}
                isRequired
                description={
                  user.department ? t('currently', { department: user.department.name }) : undefined
                }
              >
                <DepartmentSelect
                  id={`${ids}-department`}
                  value={departmentId}
                  allowNone={false}
                  placeholder={t('departmentPlaceholder')}
                  aria-invalid={same || undefined}
                  onChange={(id) => {
                    setDepartmentId(id);
                    setError(null);
                  }}
                />
              </Field>

              {departmentId && !same && (
                <>
                  <Field
                    label={t('manager')}
                    inputID={`${ids}-manager`}
                    description={
                      managerFromDepartment
                        ? t('managerFrom', { department: managerFromDepartment })
                        : undefined
                    }
                  >
                    <motion.div
                      key={`${seeded}-${managerPicked}`}
                      initial={seeded && !managerPicked && !reduce ? { opacity: 0.35 } : false}
                      animate={{ opacity: 1 }}
                      transition={{ duration: duration.fast }}
                    >
                      <UserPicker
                        id={`${ids}-manager`}
                        value={manager}
                        excludeIds={[user.id]}
                        placeholder={t('noManager')}
                        onChange={(m) => {
                          setManager(m);
                          setManagerPicked(true);
                        }}
                      />
                    </motion.div>
                  </Field>
                  <TextInput label={t('jobTitle')} value={jobTitle} onChange={setJobTitle} />

                  {options.isLoading ? (
                    <Skeleton className="h-32 w-full" />
                  ) : (
                    canGroups && (
                      <>
                        <Field
                          label={t('leave')}
                          isGroupLabel
                          labelID={`${ids}-leave-label`}
                          inputID={`${ids}-leave`}
                          description={t('leaveHint')}
                        >
                          {user.groups.length === 0 ? (
                            <Text color="secondary">{t('noGroups')}</Text>
                          ) : (
                            <VStack
                              gap={2}
                              role="group"
                              aria-labelledby={`${ids}-leave-label`}
                              id={`${ids}-leave`}
                            >
                              {manual.map((g) => (
                                <CheckboxInput
                                  key={g.id}
                                  label={g.name}
                                  description={suggestion?.leave.includes(g.id) ? t('suggested') : undefined}
                                  value={leave.includes(g.id)}
                                  onChange={(v) => toggle(leave, setLeave, g.id, v)}
                                />
                              ))}
                              {kept.map((g) => (
                                <CheckboxInput
                                  key={g.id}
                                  label={g.name}
                                  description={t('synced', { source: tc(`source_values.${g.groupSource}`) })}
                                  value={false}
                                  isDisabled
                                />
                              ))}
                            </VStack>
                          )}
                        </Field>
                        <Field
                          label={t('join')}
                          isGroupLabel
                          labelID={`${ids}-join-label`}
                          inputID={`${ids}-join`}
                          description={suggestion?.join.length ? t('joinSuggested') : t('joinHint')}
                        >
                          <GroupMultiSelect
                            labelledBy={`${ids}-join-label`}
                            value={join}
                            onChange={setJoin}
                            exclude={user.groups.map((g) => g.id)}
                          />
                        </Field>
                      </>
                    )
                  )}

                  {roles.length > 0 && (
                    <Field
                      label={t('roles')}
                      isGroupLabel
                      labelID={`${ids}-roles-label`}
                      inputID={`${ids}-roles`}
                      description={canAssign ? t('rolesHint') : t('rolesHintReadOnly')}
                    >
                      {canAssign ? (
                        <VStack
                          gap={2}
                          role="group"
                          aria-labelledby={`${ids}-roles-label`}
                          id={`${ids}-roles`}
                        >
                          {roles.map((r) => (
                            <CheckboxInput
                              key={r.assignmentId}
                              label={t('removeRole', { role: roleText(r.role).name })}
                              description={roleDetail(r)}
                              value={revoke.includes(r.assignmentId)}
                              onChange={(v) => toggle(revoke, setRevoke, r.assignmentId, v)}
                            />
                          ))}
                        </VStack>
                      ) : (
                        <List density="compact">
                          {roles.map((r) => (
                            <ListItem
                              key={r.assignmentId}
                              label={roleText(r.role).name}
                              description={roleDetail(r)}
                            />
                          ))}
                        </List>
                      )}
                    </Field>
                  )}

                  <Text as="p" color="secondary" aria-live="polite">
                    {t('summary', {
                      join: canGroups ? join.length : 0,
                      leave: canGroups ? leave.length : 0,
                      roles: canAssign ? revoke.length : 0,
                    })}
                  </Text>
                </>
              )}
              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </SheetBody>
          <SheetFooter>
            <Button
              label={tc('cancel')}
              variant="secondary"
              type="button"
              onClick={() => onOpenChange(false)}
            />
            <Button label={t('submit')} variant="primary" isLoading={save.isPending} type="submit" />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
