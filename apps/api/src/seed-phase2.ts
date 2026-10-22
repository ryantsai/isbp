/**
 * Phase 2 demo access: who works the service desk, the CMDB, the knowledge base and Helpdesk AI.
 * Runs after the core and Phase 1 seeds and **before** module seeds, which rely on these grants (e.g. the
 * seeded change waiting for the change manager's approval). Modules never write core tables themselves.
 * Idempotent; roles of modules that are not installed are skipped.
 */
import { customFields, groups, roleAssignments, roles, users } from '@isbp/db/schema';
import type { FieldDef } from '@isbp/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import { CustomFieldAdminService } from './core/services/forms';
import { runWithContext } from './kernel/context';
import { buildAuthContext } from './kernel/http/auth';
import type { Kernel } from './kernel/kernel';
import { toSessionUser } from './kernel/sessions';

const t3 = (en: string, zh: string, ja: string) => ({ en, 'zh-TW': zh, 'ja-JP': ja });

/** Custom fields an IS department typically adds to configuration items (shows the CMDB is extensible). */
const CI_FIELDS: FieldDef[] = [
  {
    key: 'ipAddress',
    type: 'text',
    label: t3('IP address', 'IP 位址', 'IP アドレス'),
    placeholder: t3('e.g. 10.0.4.17', '例如 10.0.4.17', '例: 10.0.4.17'),
    validation: { pattern: '(\\d{1,3}\\.){3}\\d{1,3}' },
    width: 'half',
  },
  {
    key: 'operatingSystem',
    type: 'select',
    label: t3('Operating system', '作業系統', 'オペレーティング システム'),
    options: [
      { value: 'linux', label: t3('Linux', 'Linux', 'Linux') },
      { value: 'windows-server', label: t3('Windows Server', 'Windows Server', 'Windows Server') },
      { value: 'network-os', label: t3('Network OS', '網路作業系統', 'ネットワーク OS') },
      { value: 'other', label: t3('Other', '其他', 'その他') },
    ],
    width: 'half',
  },
  {
    key: 'warrantyEnd',
    type: 'date',
    label: t3('Warranty ends', '保固到期日', '保証終了日'),
    width: 'half',
  },
];

export type Grant = { role: string; groups?: string[]; users?: string[] };

const GRANTS: Grant[] = [
  { role: 'cmdb-manager', groups: ['it-admins'] },
  { role: 'cmdb-viewer', groups: ['service-desk', 'network-team', 'security-team', 'dba-team'] },
  { role: 'knowledge-agent', groups: ['service-desk', 'network-team', 'security-team'] },
  { role: 'knowledge-editor', groups: ['it-admins'], users: ['helpdesk'] },
  {
    role: 'itsm-agent',
    groups: ['service-desk', 'network-team', 'security-team', 'dba-team', 'it-admins'],
    users: ['helpdesk'],
  },
  { role: 'itsm-problem-manager', groups: ['network-team'], users: ['helpdesk'] },
  { role: 'itsm-change-manager', users: ['admin'] },
  { role: 'itsm-admin', groups: ['it-admins'] },
  {
    role: 'helpdesk-ai-agent',
    groups: ['service-desk', 'network-team', 'security-team'],
    users: ['helpdesk'],
  },
  { role: 'helpdesk-ai-admin', groups: ['it-admins'] },
];

/** Grants demo roles to groups and users (idempotent; roles of uninstalled modules are skipped). */
export async function grantDemoRoles(kernel: Kernel, grants: Grant[], reason: string): Promise<number> {
  const db = kernel.db;
  const keys = grants.map((g) => g.role);
  const roleRows = await db
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(inArray(roles.key, keys));
  const roleId = new Map(roleRows.map((r) => [r.key, r.id]));
  const groupKeys = [...new Set(grants.flatMap((g) => g.groups ?? []))];
  const groupRows = groupKeys.length
    ? await db.select({ id: groups.id, key: groups.key }).from(groups).where(inArray(groups.key, groupKeys))
    : [];
  const groupId = new Map(groupRows.map((g) => [g.key, g.id]));
  const usernames = [...new Set(grants.flatMap((g) => g.users ?? []))];
  const userRows = usernames.length
    ? await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.username, usernames))
    : [];
  const userId = new Map(userRows.map((u) => [u.username, u.id]));

  let granted = 0;
  for (const g of grants) {
    const role = roleId.get(g.role);
    if (!role) continue;
    const principals = [
      ...(g.groups ?? []).map((k) => ({ groupId: groupId.get(k) ?? null, userId: null })),
      ...(g.users ?? []).map((u) => ({ groupId: null, userId: userId.get(u) ?? null })),
    ].filter((p) => p.groupId || p.userId);
    for (const p of principals) {
      const [exists] = await db
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.roleId, role),
            p.groupId ? eq(roleAssignments.groupId, p.groupId) : eq(roleAssignments.userId, p.userId!),
          ),
        )
        .limit(1);
      if (exists) continue;
      await db.insert(roleAssignments).values({
        roleId: role,
        groupId: p.groupId,
        userId: p.userId,
        reason,
        source: 'system',
      });
      granted++;
    }
  }
  await kernel.rbac.bump();
  return granted;
}

export async function seedPhase2(kernel: Kernel) {
  const db = kernel.db;
  const granted = await grantDemoRoles(kernel, GRANTS, 'Phase 2 demo access');

  // CMDB custom fields (only when the module is installed and none exist yet).
  const admin = await db.select().from(users).where(eq(users.username, 'admin'));
  const hasCmdb = kernel.registry.get('cmdb');
  const [existing] = await db
    .select({ id: customFields.id })
    .from(customFields)
    .where(eq(customFields.entityType, 'cmdb.ci'))
    .limit(1);
  if (hasCmdb && admin[0] && !existing) {
    const u = admin[0];
    const principal = { type: 'user' as const, id: u.id, name: u.displayName };
    const auth = buildAuthContext(principal, toSessionUser(u), null, await kernel.rbac.permissionsFor(u.id));
    const svc = new CustomFieldAdminService(kernel.registry.context('core'));
    await runWithContext({ principal, requestId: 'seed' }, async () => {
      for (const field of CI_FIELDS) await svc.create({ entityType: 'cmdb.ci', field }, auth);
    });
  }
  kernel.logger.info({ granted }, 'phase 2 demo access granted');
}
