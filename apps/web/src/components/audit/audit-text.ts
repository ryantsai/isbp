'use client';

import type { AuditLog, AuditRef, RecordTypeInfo } from '@isbp/contracts';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useRoleText } from '@/components/roles/role-utils';
import { useApiQuery } from '@/lib/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "What changed": a plain name for a family of actions (`?changed=roles`), as the API's `actions` prefixes. */
export const CHANGED = {
  people: ['core.user.*'],
  signIns: ['core.auth.*'],
  groups: ['core.group.*'],
  departments: ['core.department.*'],
  roles: ['core.role.*'],
  roleGrants: ['core.role-assignment.*', 'core.access-request.*'],
  applications: ['core.application.*', 'core.api-client.*'],
  forms: ['core.form.*', 'core.custom-field.*', 'core.form-assignment.*'],
  requests: ['core.form-submission.*'],
  workflows: ['core.workflow-definition.*'],
  approvals: ['core.approval.*', 'core.approval-delegation.*', 'core.workflow.*'],
  changeSets: ['assistant.change-set.*'],
  modules: ['core.module.*', 'core.notification-channel.*', 'core.ai.*'],
  signInProviders: ['core.idp.*', 'core.directory.*'],
} as const;
export type ChangedKey = keyof typeof CHANGED;
export const CHANGED_KEYS = Object.keys(CHANGED) as ChangedKey[];

/** Record types' display names (`GET /records/types`), cached for the audit pages. */
function useRecordTypeNames() {
  const tr = useTranslations();
  const { data } = useApiQuery<{ items: RecordTypeInfo[] }>('/records/types', { all: 'true' });
  return useCallback(
    (type: string) => {
      const info = data?.items.find((i) => i.type === type);
      if (!info) return null;
      return tr.has(info.name) ? tr(info.name) : info.name;
    },
    [data, tr],
  );
}

/**
 * How audit records read: the target's name (resolved from `refs` when the record has no label), what kind of thing
 * it is, field labels, and values with ids turned into names. Unknown fields keep their technical name.
 */
export function useAuditText() {
  const t = useTranslations('audit');
  const tr = useTranslations();
  const roleText = useRoleText();
  const recordType = useRecordTypeNames();

  const refName = useCallback(
    (ref: AuditRef | undefined) =>
      ref
        ? ref.type === 'role' && ref.key
          ? roleText({ key: ref.key, name: ref.name, moduleId: ref.moduleId }).name
          : ref.name
        : null,
    [roleText],
  );

  const ref = useCallback(
    (log: Pick<AuditLog, 'refs'>, id: unknown) =>
      typeof id === 'string' ? refName(log.refs?.[id.toLowerCase()] ?? log.refs?.[id]) : null,
    [refName],
  );

  // Roles read in the viewer's language (the stored label is the role's English name).
  const targetName = useCallback(
    (log: Pick<AuditLog, 'entityLabel' | 'entityId' | 'refs'>) => {
      const known = log.entityId ? log.refs?.[log.entityId.toLowerCase()] : undefined;
      if (known?.type === 'role') return refName(known);
      return log.entityLabel || ref(log, log.entityId);
    },
    [ref, refName],
  );

  const typeName = useCallback(
    (type: string | null | undefined) => {
      if (!type) return null;
      const key = `entityTypes.${type.replaceAll('.', '_')}`;
      if (t.has(key)) return t(key);
      return recordType(type);
    },
    [t, recordType],
  );

  const fieldLabel = useCallback(
    (field: string) => (t.has(`fields.${field}`) ? t(`fields.${field}`) : null),
    [t],
  );

  /** One value of a change: names for ids, Yes/No, "—" for nothing; `null` when it should show as data. */
  const valueText = useCallback(
    (log: Pick<AuditLog, 'refs'>, field: string, value: unknown): string | null => {
      if (value === null || value === undefined || value === '') return '—';
      if (typeof value === 'boolean') return value ? t('values.yes') : t('values.no');
      if (typeof value === 'string') {
        if (UUID.test(value)) return ref(log, value) ?? value;
        const enumKey = `values.${field}.${value}`;
        if (t.has(enumKey)) return t(enumKey);
        return value;
      }
      if (typeof value === 'number') return String(value);
      return null;
    },
    [t, ref],
  );

  /** A short second line for a record: the role granted, the group or person added, the fields changed. */
  const summary = useCallback(
    (log: AuditLog, subject?: { type: 'user' | 'group' | 'role'; id: string }) => {
      const meta = (log.metadata ?? {}) as Record<string, unknown>;
      if (log.action.startsWith('core.role-assignment.')) {
        const role =
          ref(log, meta.roleId) ??
          (typeof meta.role === 'string' ? refName(log.refs?.[`role:${meta.role}`]) : null);
        const who = subject?.type === 'role' ? targetName(log) : null;
        return [role && subject?.type !== 'role' ? role : null, who].filter(Boolean).join(' · ') || null;
      }
      if (log.action === 'core.group.members_added' || log.action === 'core.group.members_removed') {
        if (subject?.type === 'user') return targetName(log);
        const ids = Array.isArray(meta.userIds) ? meta.userIds : [];
        if (ids.length === 1) return ref(log, ids[0]) ?? t('people', { count: 1 });
        return ids.length ? t('people', { count: ids.length }) : null;
      }
      if (log.action === 'core.user.transferred') {
        const change = log.changes?.departmentId;
        if (change)
          return `${valueText(log, 'departmentId', change[0])} → ${valueText(log, 'departmentId', change[1])}`;
      }
      const fields = Object.keys(log.changes ?? {});
      if (fields.length) return fields.map((f) => fieldLabel(f) ?? f).join(t('fieldSeparator'));
      return null;
    },
    [ref, refName, targetName, valueText, fieldLabel, t],
  );

  return { targetName, typeName, fieldLabel, valueText, summary, refName: ref, tr };
}
