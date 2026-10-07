/**
 * Phase 3 demo data owned by the platform (modules never write core tables or each other's):
 *  - `seedPhase3` (before module seeds): the delivery groups Application Development and PMO, and who
 *    works assets, projects and applications;
 *  - `seedPhase3Links` (after module seeds): links between records of different modules (tasks ↔
 *    changes, releases ↔ changes, projects ↔ applications, an incident ↔ the laptop it is about) and a
 *    couple of sample attachments, so the "Linked records" and "Attachments" panels look alive.
 * Idempotent; anything of a module that isn't installed is skipped.
 */
import { departments, groupMembers, groups, users } from '@isbp/db/schema';
import type { RecordRef } from '@isbp/sdk/server';
import { and, eq, or, sql } from 'drizzle-orm';
import type { Kernel } from './kernel/kernel';
import { type Grant, grantDemoRoles } from './seed-phase2';

const GRANTS: Grant[] = [
  { role: 'itam-viewer', groups: ['service-desk', 'network-team', 'security-team'] },
  { role: 'itam-asset-manager', groups: ['it-admins'], users: ['helpdesk'] },
  { role: 'itam-contract-manager', groups: ['finance-team'] },
  {
    role: 'projects-manager',
    groups: ['it-admins', 'network-team', 'security-team', 'dba-team', 'dev-team'],
  },
  { role: 'projects-pmo', groups: ['pmo'] },
  {
    role: 'alm-viewer',
    groups: ['service-desk', 'network-team', 'security-team', 'dba-team', 'cab', 'app-owners'],
    users: ['helpdesk'],
  },
  { role: 'alm-release-manager', groups: ['dev-team'] },
  // Release managers link releases to their changes, so they need to see changes.
  { role: 'itsm-change-viewer', groups: ['dev-team'] },
  { role: 'alm-manager', groups: ['it-admins'] },
];

async function ensureGroup(
  kernel: Kernel,
  key: string,
  name: string,
  description: string,
  memberIds: string[],
) {
  const db = kernel.db;
  let [g] = await db.select({ id: groups.id }).from(groups).where(eq(groups.key, key));
  if (!g) [g] = await db.insert(groups).values({ key, name, description }).returning({ id: groups.id });
  if (memberIds.length)
    await db
      .insert(groupMembers)
      .values(memberIds.map((userId) => ({ groupId: g!.id, userId })))
      .onConflictDoNothing();
}

export async function seedPhase3(kernel: Kernel) {
  const db = kernel.db;
  const appDept = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(and(eq(departments.code, 'IT-APP'), eq(users.status, 'active')));
  await ensureGroup(
    kernel,
    'dev-team',
    'Application Development',
    'Builds and releases the in-house applications',
    appDept.map((u) => u.id),
  );
  const pmo = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.jobTitle, 'IT Program Manager'), eq(users.username, 'admin')));
  await ensureGroup(
    kernel,
    'pmo',
    'Project Management Office',
    'Portfolio oversight and project approvals',
    pmo.map((u) => u.id),
  );
  const granted = await grantDemoRoles(kernel, GRANTS, 'Phase 3 demo access');
  kernel.logger.info({ granted }, 'phase 3 demo access granted');
}

/* ───────────────────────── cross-module links ───────────────────────── */

const installed = (kernel: Kernel, ...ids: string[]) => ids.every((id) => kernel.registry.get(id));

async function one(kernel: Kernel, query: ReturnType<typeof sql>): Promise<string | null> {
  try {
    const { rows } = await kernel.db.execute<{ id: string }>(query);
    return rows[0]?.id ?? null;
  } catch (err) {
    kernel.logger.warn({ err }, 'phase 3 link lookup failed');
    return null;
  }
}

export async function seedPhase3Links(kernel: Kernel) {
  const pairs: [RecordRef | null, RecordRef | null][] = [];
  const ref = (type: string, id: string | null): RecordRef | null => (id ? { type, id } : null);

  const change = async (title: string) =>
    ref(
      'itsm.change',
      await one(kernel, sql`select id from itsm.tickets where type = 'change' and title = ${title}`),
    );
  const ticket = async (title: string) =>
    ref(
      'itsm.ticket',
      await one(kernel, sql`select id from itsm.tickets where type <> 'change' and title = ${title}`),
    );
  const ci = async (name: string) =>
    ref('cmdb.ci', await one(kernel, sql`select id from cmdb.cis where name = ${name}`));
  const task = async (key: string, title: string) =>
    ref(
      'projects.task',
      await one(
        kernel,
        sql`select t.id from projects.tasks t join projects.projects p on p.id = t.project_id
            where p.key = ${key} and t.title = ${title}`,
      ),
    );
  const project = async (key: string) =>
    ref('projects.project', await one(kernel, sql`select id from projects.projects where key = ${key}`));
  const app = async (code: string) =>
    ref('alm.application', await one(kernel, sql`select id from alm.applications where code = ${code}`));
  const release = async (code: string, version: string) =>
    ref(
      'alm.release',
      await one(
        kernel,
        sql`select r.id from alm.releases r join alm.applications a on a.id = r.application_id
            where a.code = ${code} and r.version = ${version}`,
      ),
    );

  if (installed(kernel, 'itsm', 'cmdb', 'projects')) {
    const coreSwitch = await task('NET', 'Replace core switch tpe-sw-core-01');
    pairs.push([coreSwitch, await change('Core switch firmware upgrade tpe-sw-core-01')]);
    pairs.push([coreSwitch, await ci('tpe-sw-core-01')]);
    const mfa = await task('ZTA', 'Enforce MFA for VPN');
    pairs.push([mfa, await ticket('MFA push notifications delayed for some Android users')]);
    pairs.push([mfa, await ci('vpn-gw-01')]);
  }
  if (installed(kernel, 'itsm', 'alm')) {
    pairs.push([await release('erp', '12.1.0'), await change('Deploy Finance ERP 12.1.0 to production')]);
    pairs.push([await release('erp', '12.0.0'), await change('Deploy Finance ERP 12.0.0 to production')]);
    pairs.push([await release('hr-portal', '3.4.0'), await change('Deploy HR Portal 3.4.0 to production')]);
  }
  if (installed(kernel, 'projects', 'alm')) {
    pairs.push([await task('ERP', 'Cut over production to ERP v12'), await release('erp', '12.1.0')]);
    pairs.push([await project('ERP'), await app('erp')]);
    pairs.push([await project('ITSM'), await app('service-desk')]);
  }
  if (installed(kernel, 'itsm', 'itam')) {
    // The incident about a draining battery ↔ the reporter's own laptop.
    const incident = await one(
      kernel,
      sql`select id from itsm.tickets where title = 'Laptop battery drains in two hours' limit 1`,
    );
    const laptop = await one(
      kernel,
      sql`select a.id from itam.assets a join itsm.tickets t on t.requester_id = a.assigned_to
          where t.title = 'Laptop battery drains in two hours' and a.category = 'laptop' limit 1`,
    );
    pairs.push([ref('itsm.ticket', incident), ref('itam.asset', laptop)]);
  }

  let linked = 0;
  for (const [a, b] of pairs) {
    if (!a || !b) continue;
    try {
      if ((await kernel.records.link(a, b)).created) linked++;
    } catch (err) {
      kernel.logger.warn({ err, a, b }, 'phase 3 link failed');
    }
  }

  // A sample document on a change (Assets attaches its own signed contract PDF).
  let attached = 0;
  const attachOnce = async (record: RecordRef | null, name: string, data: Buffer) => {
    if (!record) return;
    const existing = await kernel.files.list(record);
    if (existing.some((f) => f.name === name)) return;
    await kernel.files.attach(record, { name, data });
    attached++;
  };
  if (installed(kernel, 'itsm')) {
    await attachOnce(
      await change('Core switch firmware upgrade tpe-sw-core-01'),
      'core-switch-upgrade-runbook.md',
      Buffer.from(
        [
          '# tpe-sw-core-01 firmware upgrade runbook',
          '',
          '1. Back up the running configuration to the TFTP server.',
          '2. Upgrade the standby member and fail over.',
          '3. Upgrade the second member; confirm both run the target release.',
          '4. Verify OSPF neighbours, uplinks and VLAN gateways (ping sweep).',
          '',
          'Backout: boot both members from the previous image kept on flash.',
        ].join('\n'),
      ),
    );
  }
  kernel.logger.info({ linked, attached }, 'phase 3 cross-module links created');
}
