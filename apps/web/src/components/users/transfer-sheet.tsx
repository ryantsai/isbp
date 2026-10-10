'use client';

import type { TransferOptions, TransferUserInput, UserDetail } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
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
import { type ReactNode, useState } from 'react';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { GroupMultiSelect } from '@/components/pickers/group-multi-select';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { useRoleText } from '@/components/roles/role-utils';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

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
          <SheetBody className="space-y-5 py-2">
            <Field
              id="transfer-department"
              label={
                <>
                  {t('department')}{' '}
                  <span aria-hidden className="text-destructive">
                    *
                  </span>
                </>
              }
              hint={user.department ? t('currently', { department: user.department.name }) : undefined}
            >
              <DepartmentSelect
                id="transfer-department"
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
              <div className="space-y-5">
                <Field
                  id="transfer-manager"
                  label={t('manager')}
                  hint={
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
                      id="transfer-manager"
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
                <Field id="transfer-title" label={t('jobTitle')}>
                  <Input id="transfer-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
                </Field>

                {options.isLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : (
                  canGroups && (
                    <>
                      <fieldset className="min-w-0 space-y-2">
                        <legend className="text-sm font-medium">{t('leave')}</legend>
                        <p className="text-xs text-muted-foreground">{t('leaveHint')}</p>
                        {user.groups.length === 0 ? (
                          <p className="text-sm text-muted-foreground">{t('noGroups')}</p>
                        ) : (
                          <ul className="divide-y rounded-md border">
                            {manual.map((g) => (
                              <li key={g.id}>
                                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm">
                                  <Checkbox
                                    checked={leave.includes(g.id)}
                                    onCheckedChange={(v) => toggle(leave, setLeave, g.id, v === true)}
                                  />
                                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                                  {suggestion?.leave.includes(g.id) && (
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      {t('suggested')}
                                    </span>
                                  )}
                                </label>
                              </li>
                            ))}
                            {kept.map((g) => (
                              <li
                                key={g.id}
                                className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground"
                              >
                                <Checkbox disabled checked={false} aria-label={g.name} />
                                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                                <span className="shrink-0 text-xs">
                                  {t('synced', { source: tc(`source_values.${g.groupSource}`) })}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </fieldset>
                      <div className="grid min-w-0 gap-2">
                        <Label id="transfer-join-label">{t('join')}</Label>
                        <p className="text-xs text-muted-foreground">
                          {suggestion?.join.length ? t('joinSuggested') : t('joinHint')}
                        </p>
                        <GroupMultiSelect
                          labelledBy="transfer-join-label"
                          value={join}
                          onChange={setJoin}
                          exclude={user.groups.map((g) => g.id)}
                        />
                      </div>
                    </>
                  )
                )}

                {roles.length > 0 && (
                  <fieldset className="min-w-0 space-y-2">
                    <legend className="text-sm font-medium">{t('roles')}</legend>
                    <p className="text-xs text-muted-foreground">
                      {canAssign ? t('rolesHint') : t('rolesHintReadOnly')}
                    </p>
                    <ul className="divide-y rounded-md border">
                      {roles.map((r) => {
                        const name = roleText(r.role).name;
                        const line = (
                          <>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{name}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {[r.application, t('scopedTo', { department: r.scope.name })]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </span>
                            {r.oldDepartment && (
                              <span className="shrink-0 text-xs text-warning-foreground">
                                {t('forOldJob')}
                              </span>
                            )}
                          </>
                        );
                        return (
                          <li key={r.assignmentId}>
                            {canAssign ? (
                              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm">
                                <Checkbox
                                  checked={revoke.includes(r.assignmentId)}
                                  onCheckedChange={(v) =>
                                    toggle(revoke, setRevoke, r.assignmentId, v === true)
                                  }
                                  aria-label={t('removeRole', { role: name })}
                                />
                                {line}
                              </label>
                            ) : (
                              <div className="flex items-center gap-2.5 px-3 py-2 text-sm">{line}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                )}

                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {t('summary', {
                    join: canGroups ? join.length : 0,
                    leave: canGroups ? leave.length : 0,
                    roles: canAssign ? revoke.length : 0,
                  })}
                </p>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {t('submit')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
