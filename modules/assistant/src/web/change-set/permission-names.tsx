'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { createContext, type ReactNode, use, useCallback } from 'react';
import type { PermissionRole } from '../../contracts';

/*
 * Permission codes in messages ("needs core.workflows.manage") read as the roles that grant them ("needs Workflow
 * administrator"): the change set's API lists the narrowest system roles for every permission its page names.
 */

const PermissionRoles = createContext<readonly PermissionRole[]>([]);

export function PermissionNamesProvider({
  roles,
  children,
}: {
  roles: readonly PermissionRole[] | undefined;
  children: ReactNode;
}) {
  return <PermissionRoles value={roles ?? []}>{children}</PermissionRoles>;
}

/** A permission as the role(s) that grant it ("Workflow administrator or Platform administrator"), else its code. */
export function usePermissionName() {
  const roles = use(PermissionRoles);
  const t = useTranslations();
  const format = useFormatter();
  return useCallback(
    (permission: string): string => {
      const entry = roles.find((r) => r.permission === permission);
      if (!entry?.roles.length) return permission;
      const names = entry.roles.map((r) => {
        const key = r.moduleId === null ? null : `${r.moduleId}.systemRoles.${r.key}.name`;
        return key && t.has(key) ? t(key) : r.name;
      });
      return format.list(names, { type: 'disjunction' });
    },
    [roles, t, format],
  );
}

/** Several permissions as roles: "Workflow administrator and Identity administrator". */
export function usePermissionList() {
  const name = usePermissionName();
  const format = useFormatter();
  return useCallback(
    (permissions: readonly string[]) =>
      format.list([...new Set(permissions.map(name))], { type: 'conjunction' }),
    [name, format],
  );
}
