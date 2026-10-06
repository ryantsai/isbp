'use client';

import type { PermissionInfo } from '@isbp/contracts';
import { matchPermission, patternCovers } from '@isbp/sdk';
import { ApiError, usePlatform } from '@isbp/sdk/web';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { useErrorText } from '@/lib/api';

/* ───────────────────────── role labels ───────────────────────── */

/** Translated name/description for system roles (`core.systemRoles.<key>`); stored values otherwise. */
export function useRoleText() {
  const t = useTranslations('core.systemRoles');
  return useCallback(
    (role: { key: string; name: string; description?: string | null }) => ({
      name: t.has(`${role.key}.name`) ? t(`${role.key}.name`) : role.name,
      description: t.has(`${role.key}.description`)
        ? t(`${role.key}.description`)
        : (role.description ?? null),
    }),
    [t],
  );
}

/** Translated permission description (catalog descriptions are i18n keys such as `core.permissions.usersRead`). */
export function usePermissionText() {
  const t = useTranslations();
  return useCallback((description: string) => (t.has(description) ? t(description) : description), [t]);
}

/* ───────────────────────── privilege-escalation guard (UI mirror) ───────────────────────── */

/**
 * Mirrors the API guard: you can only grant patterns covered by permissions you hold **globally**.
 * UI hint only — the API remains the source of truth.
 */
export function useGrantable() {
  const { grants } = usePlatform();
  return useMemo(() => {
    const held = grants.filter((g) => g.s === 'g').map((g) => g.p);
    return (pattern: string) => held.some((h) => patternCovers(h, pattern));
  }, [grants]);
}

/** Friendlier messages for access-management failures (escalation guard, self-lockout, read-only roles). */
export function useAccessErrorText() {
  const t = useTranslations('roles.errors');
  const errorText = useErrorText();
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) {
        switch (err.code) {
          case 'PRIVILEGE_ESCALATION': {
            const missing = (err.details as { missing?: string[] } | undefined)?.missing ?? [];
            return t('escalation', { permissions: missing.slice(0, 5).join(', ') });
          }
          case 'SELF_LOCKOUT':
            return t('ownAdmin');
          case 'PRINCIPAL_OFFBOARDED':
            return t('offboarded');
          case 'SYSTEM_ROLE_READONLY':
            return t('systemReadOnly');
          default:
            if (isKeyConflict(err)) return t('keyTaken');
        }
      }
      return errorText(err);
    },
    [t, errorText],
  );
}

/** `POST /roles` with a key that already exists. */
export function isKeyConflict(err: unknown) {
  return (
    err instanceof ApiError &&
    err.code === 'CONFLICT' &&
    (err.details as { constraint?: string } | undefined)?.constraint === 'roles_app_key_uq'
  );
}

/* ───────────────────────── permission patterns ───────────────────────── */

export const isWildcard = (pattern: string) => pattern.includes('*');

/** True when `pattern` can match at least one key (three segments, or a trailing `*`). */
function matchesSomething(pattern: string) {
  return pattern.endsWith('*') || pattern.split('.').length === 3;
}

/** `grant` covers every key `pattern` covers (ignores patterns that match nothing). */
export function covers(grant: string, pattern: string) {
  return matchesSomething(pattern) && patternCovers(grant, pattern);
}

/** The first wildcard in `value` (other than `key` itself) that matches `key`. */
export function impliedBy(value: readonly string[], key: string): string | undefined {
  return value.find((p) => p !== key && isWildcard(p) && matchPermission(p, key));
}

export function isGranted(value: readonly string[], key: string) {
  return value.includes(key) || impliedBy(value, key) !== undefined;
}

export interface GroupState {
  /** Keys in the group that are granted (explicitly or via a wildcard). */
  count: number;
  total: number;
  all: boolean;
  some: boolean;
  /** Something at this level or below can be removed (so un-selecting changes the role). */
  removable: boolean;
  /** A broader wildcard (e.g. `core.*` for `core.users.*`) that already grants the whole group. */
  broader?: string;
}

export function groupState(value: readonly string[], keys: readonly string[], pattern: string): GroupState {
  const count = keys.filter((k) => isGranted(value, k)).length;
  return {
    count,
    total: keys.length,
    all: keys.length > 0 && count === keys.length,
    some: count > 0,
    removable: value.some((p) => covers(pattern, p)),
    broader: value.find((p) => p !== pattern && isWildcard(p) && covers(p, pattern)),
  };
}

/** Select: replace everything under `pattern` with the wildcard. Unselect: drop it and everything under it. */
export function toggleGroup(value: readonly string[], pattern: string, select: boolean): string[] {
  const kept = value.filter((p) => !covers(pattern, p));
  return select ? [...kept, pattern] : kept;
}

export function togglePermission(value: readonly string[], key: string, select: boolean): string[] {
  return select ? (value.includes(key) ? [...value] : [...value, key]) : value.filter((p) => p !== key);
}

export function normalizePermissions(value: readonly string[]) {
  return [...new Set(value)].sort();
}

export function diffPermissions(before: readonly string[], after: readonly string[]) {
  const b = new Set(before);
  const a = new Set(after);
  return { added: [...a].filter((p) => !b.has(p)), removed: [...b].filter((p) => !a.has(p)) };
}

/* ───────────────────────── catalog grouping ───────────────────────── */

export interface ResourceGroup {
  module: string;
  resource: string;
  /** `module.resource.*` */
  pattern: string;
  permissions: PermissionInfo[];
  keys: string[];
}

export interface ModuleGroup {
  module: string;
  /** `module.*` */
  pattern: string;
  resources: ResourceGroup[];
  keys: string[];
}

/** Catalog → module → resource (keys are `module.resource.action`). */
export function groupCatalog(catalog: readonly PermissionInfo[]): ModuleGroup[] {
  const modules = new Map<string, Map<string, PermissionInfo[]>>();
  for (const p of catalog) {
    const [module = p.key, resource = ''] = p.key.split('.');
    const resources = modules.get(module) ?? new Map<string, PermissionInfo[]>();
    resources.set(resource, [...(resources.get(resource) ?? []), p]);
    modules.set(module, resources);
  }
  return [...modules.entries()]
    .sort(([a], [b]) => (a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare(b)))
    .map(([module, resources]) => {
      const groups = [...resources.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([resource, permissions]) => ({
          module,
          resource,
          pattern: `${module}.${resource}.*`,
          permissions,
          keys: permissions.map((p) => p.key),
        }));
      return { module, pattern: `${module}.*`, resources: groups, keys: groups.flatMap((g) => g.keys) };
    });
}

/** `asset-types` → `Asset types` (fallback when a resource has no translated label). */
export function humanize(value: string) {
  const s = value.replace(/[-_]+/g, ' ').trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : value;
}

/** Lower-case slug suitable for `keySchema` (`^[a-z0-9][a-z0-9-_]*$`). */
export function slugify(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/** Wall-clock time for event handlers and validators (kept out of render paths). */
export const currentTime = () => Date.now();

/** Local `YYYY-MM-DD` for a date (native date inputs). */
export function toDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses a native date input value as a local calendar day; `end` = 23:59:59.999. */
export function fromDateInput(value: string, end = false): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = end
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
    : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
