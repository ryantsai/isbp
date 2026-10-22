/**
 * Demo data so the UI looks alive on first run. Idempotent: does nothing if the admin account exists
 * (use `pnpm db:reset` to start over). Module seeds run through each module's own `seed()` hook.
 */
import { fakerEN as faker } from '@faker-js/faker';
import {
  applications,
  auditLogs,
  departments,
  groupMembers,
  groups,
  identityProviders,
  roleAssignments,
  rolePermissions,
  roles,
  users,
  uuidv7,
} from '@isbp/db/schema';
import { eq, sql } from 'drizzle-orm';
import { v7 } from 'uuid';
import { bootstrap } from './bootstrap';
import { auditHash } from './kernel/audit';
import { runWithContext } from './kernel/context';
import { hashPassword } from './kernel/passwords';
import { EVERYONE_GROUP_KEY, PLATFORM_APP_KEY } from './kernel/rbac';
import { seedPhase1 } from './seed-phase1';
import { seedPhase2 } from './seed-phase2';
import { seedPhase3, seedPhase3Links } from './seed-phase3';
import { seedPhase4, seedPhase4Links } from './seed-phase4';
import { seedPhase5, seedPhase5Links } from './seed-phase5';
import { seedPhase6, seedPhase6Links } from './seed-phase6';
import { seedPhase8Links } from './seed-phase8';
import { seedPhase11Links } from './seed-phase11';
import { seedFormAssignments } from './seed-assignments';
import { seedIsmsAccess } from './seed-isms';

const { config, kernel } = await bootstrap('isbp-seed');
const db = kernel.db;
const log = kernel.logger;

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe-2026!';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo-2026!pass';
const DOMAIN = 'isbp.example';

faker.seed(20261006);

/* ───────────────────────── reference data ───────────────────────── */

const TW = {
  surnames: [
    ['陳', 'Chen'],
    ['林', 'Lin'],
    ['黃', 'Huang'],
    ['張', 'Chang'],
    ['李', 'Lee'],
    ['王', 'Wang'],
    ['吳', 'Wu'],
    ['劉', 'Liu'],
    ['蔡', 'Tsai'],
    ['楊', 'Yang'],
    ['許', 'Hsu'],
    ['鄭', 'Cheng'],
    ['謝', 'Hsieh'],
    ['郭', 'Kuo'],
    ['洪', 'Hung'],
  ],
  given: [
    ['怡君', 'Yi-Chun'],
    ['志明', 'Chih-Ming'],
    ['雅婷', 'Ya-Ting'],
    ['家豪', 'Chia-Hao'],
    ['淑芬', 'Shu-Fen'],
    ['俊傑', 'Chun-Chieh'],
    ['美玲', 'Mei-Ling'],
    ['冠宇', 'Kuan-Yu'],
    ['佩珊', 'Pei-Shan'],
    ['建宏', 'Chien-Hung'],
    ['宜蓁', 'Yi-Chen'],
    ['承恩', 'Cheng-En'],
    ['詩涵', 'Shih-Han'],
    ['柏翰', 'Po-Han'],
  ],
};
const JP = {
  surnames: [
    ['佐藤', 'Sato'],
    ['鈴木', 'Suzuki'],
    ['高橋', 'Takahashi'],
    ['田中', 'Tanaka'],
    ['伊藤', 'Ito'],
    ['渡辺', 'Watanabe'],
    ['山本', 'Yamamoto'],
    ['中村', 'Nakamura'],
    ['小林', 'Kobayashi'],
    ['加藤', 'Kato'],
  ],
  given: [
    ['健太', 'Kenta'],
    ['陽菜', 'Hina'],
    ['翔太', 'Shota'],
    ['美咲', 'Misaki'],
    ['大輔', 'Daisuke'],
    ['結衣', 'Yui'],
    ['拓海', 'Takumi'],
    ['葵', 'Aoi'],
    ['蓮', 'Ren'],
    ['さくら', 'Sakura'],
  ],
};

interface DeptSeed {
  code: string;
  name: string;
  children?: DeptSeed[];
}

const ORG: DeptSeed = {
  code: 'HQ',
  name: 'Headquarters',
  children: [
    {
      code: 'IS',
      name: 'Information Technology',
      children: [
        { code: 'IS-INFRA', name: 'Infrastructure & Cloud' },
        { code: 'IS-SD', name: 'Service Desk' },
        { code: 'IS-APP', name: 'Application Services' },
        { code: 'IS-SEC', name: 'Information Security' },
        { code: 'IS-DATA', name: 'Data & Database Services' },
      ],
    },
    { code: 'HR', name: 'Human Resources' },
    { code: 'FIN', name: 'Finance' },
    {
      code: 'SALES',
      name: 'Sales',
      children: [
        { code: 'SALES-TPE', name: 'Sales Taipei' },
        { code: 'SALES-TYO', name: 'Sales Tokyo' },
        { code: 'SALES-GLB', name: 'Global Accounts' },
      ],
    },
    { code: 'OPS', name: 'Operations' },
    { code: 'RND', name: 'Research & Development' },
  ],
};

const TITLES: Record<string, string[]> = {
  'IS-INFRA': ['Cloud Engineer', 'Systems Administrator', 'Network Engineer', 'Site Reliability Engineer'],
  'IS-SD': ['Service Desk Analyst', 'Service Desk Lead', 'Desktop Support Technician'],
  'IS-APP': ['Application Engineer', 'Integration Developer', 'Release Manager'],
  'IS-SEC': ['Security Analyst', 'IAM Engineer', 'Security Architect'],
  'IS-DATA': ['Database Administrator', 'Data Engineer'],
  IS: ['IS Director', 'IS Program Manager'],
  HR: ['HR Business Partner', 'Recruiter', 'HR Specialist'],
  FIN: ['Financial Analyst', 'Accountant', 'Controller'],
  SALES: ['Sales Director'],
  'SALES-TPE': ['Account Executive', 'Sales Engineer'],
  'SALES-TYO': ['Account Executive', 'Sales Engineer'],
  'SALES-GLB': ['Key Account Manager'],
  OPS: ['Operations Manager', 'Logistics Coordinator', 'Facilities Specialist'],
  RND: ['Software Engineer', 'Hardware Engineer', 'Research Scientist', 'Product Manager'],
  HQ: ['Chief Executive Officer', 'Executive Assistant'],
};

/* ───────────────────────── helpers ───────────────────────── */

type Culture = 'tw' | 'jp' | 'en';

function person(culture: Culture) {
  if (culture === 'tw') {
    const [s, sr] = faker.helpers.arrayElement(TW.surnames);
    const [g, gr] = faker.helpers.arrayElement(TW.given);
    return {
      displayName: `${s}${g}`,
      givenName: g,
      familyName: s,
      ascii: `${gr!.toLowerCase().replace('-', '')}.${sr!.toLowerCase()}`,
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
    };
  }
  if (culture === 'jp') {
    const [s, sr] = faker.helpers.arrayElement(JP.surnames);
    const [g, gr] = faker.helpers.arrayElement(JP.given);
    return {
      displayName: `${s} ${g}`,
      givenName: g,
      familyName: s,
      ascii: `${gr!.toLowerCase()}.${sr!.toLowerCase()}`,
      locale: 'ja-JP',
      timezone: 'Asia/Tokyo',
    };
  }
  const first = faker.person.firstName();
  const last = faker.person.lastName();
  return {
    displayName: `${first} ${last}`,
    givenName: first,
    familyName: last,
    ascii: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, ''),
    locale: 'en',
    timezone: faker.helpers.arrayElement([
      'America/Los_Angeles',
      'Europe/London',
      'Asia/Singapore',
      'Asia/Taipei',
    ]),
  };
}

const daysAgo = (d: number) =>
  new Date(Date.now() - d * 86_400_000 - faker.number.int({ min: 0, max: 86_000_000 }));

/* ───────────────────────── seed ───────────────────────── */

async function seedCore() {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'admin'));
  if (existing) {
    log.info('core demo data already present — skipping (pnpm db:reset to start over)');
    return false;
  }
  const [app] = await db.select().from(applications).where(eq(applications.key, PLATFORM_APP_KEY));
  if (!app) throw new Error('Run migrations first');

  // Departments
  const deptIds = new Map<string, string>();
  async function insertDept(d: DeptSeed, parent: { id: string; path: string } | null, order: number) {
    const id = uuidv7();
    const path = `${parent?.path ?? '/'}${id}/`;
    await db
      .insert(departments)
      .values({ id, code: d.code, name: d.name, parentId: parent?.id ?? null, path, sortOrder: order });
    deptIds.set(d.code, id);
    let i = 0;
    for (const c of d.children ?? []) await insertDept(c, { id, path }, i++);
  }
  await insertDept(ORG, null, 0);

  // Admin + named demo accounts
  const adminHash = await hashPassword(ADMIN_PASSWORD);
  const demoHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();
  const [admin] = await db
    .insert(users)
    .values({
      email: `admin@${DOMAIN}`,
      username: 'admin',
      displayName: 'Platform Admin',
      jobTitle: 'Platform Owner',
      departmentId: deptIds.get('IS')!,
      passwordHash: adminHash,
      locale: 'en',
      timezone: 'Asia/Taipei',
      onboardedAt: daysAgo(120),
      lastLoginAt: now,
      createdAt: daysAgo(120),
    })
    .returning();

  const named = [
    {
      username: 'helpdesk',
      displayName: '林雅婷',
      givenName: '雅婷',
      familyName: '林',
      jobTitle: 'Service Desk Lead',
      dept: 'IS-SD',
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
    },
    {
      username: 'hr.partner',
      displayName: '佐藤 美咲',
      givenName: '美咲',
      familyName: '佐藤',
      jobTitle: 'HR Business Partner',
      dept: 'HR',
      locale: 'ja-JP',
      timezone: 'Asia/Tokyo',
    },
    {
      username: 'auditor',
      displayName: 'Olivia Bennett',
      givenName: 'Olivia',
      familyName: 'Bennett',
      jobTitle: 'Security Auditor',
      dept: 'IS-SEC',
      locale: 'en',
      timezone: 'Europe/London',
    },
  ];
  const demo: Record<string, string> = {};
  for (const n of named) {
    const [u] = await db
      .insert(users)
      .values({
        email: `${n.username}@${DOMAIN}`,
        username: n.username,
        displayName: n.displayName,
        givenName: n.givenName,
        familyName: n.familyName,
        jobTitle: n.jobTitle,
        departmentId: deptIds.get(n.dept)!,
        managerId: admin!.id,
        passwordHash: demoHash,
        locale: n.locale,
        timezone: n.timezone,
        onboardedAt: daysAgo(90),
        lastLoginAt: daysAgo(1),
        createdAt: daysAgo(90),
      })
      .returning();
    demo[n.username] = u!.id;
  }

  // The rest of the organisation
  const codes = [...deptIds.keys()];
  const leaders = new Map<string, string>();
  const people: { id: string; dept: string; status: string }[] = [];
  const usedEmails = new Set<string>();
  for (let i = 0; i < 180; i++) {
    const dept =
      i < codes.length
        ? codes[i]!
        : faker.helpers.weightedArrayElement([
            { weight: 3, value: 'IS-INFRA' },
            { weight: 3, value: 'IS-SD' },
            { weight: 3, value: 'IS-APP' },
            { weight: 2, value: 'IS-SEC' },
            { weight: 2, value: 'IS-DATA' },
            { weight: 2, value: 'HR' },
            { weight: 3, value: 'FIN' },
            { weight: 3, value: 'SALES-TPE' },
            { weight: 3, value: 'SALES-TYO' },
            { weight: 2, value: 'SALES-GLB' },
            { weight: 3, value: 'OPS' },
            { weight: 5, value: 'RND' },
          ]);
    const culture: Culture =
      dept === 'SALES-TYO'
        ? faker.helpers.arrayElement(['jp', 'jp', 'jp', 'en'])
        : faker.helpers.weightedArrayElement([
            { weight: 6, value: 'tw' },
            { weight: 2, value: 'jp' },
            { weight: 3, value: 'en' },
          ]);
    const p = person(culture);
    let local = p.ascii;
    for (let n = 2; usedEmails.has(local); n++) local = `${p.ascii}${n}`;
    usedEmails.add(local);
    const status = faker.helpers.weightedArrayElement([
      { weight: 88, value: 'active' as const },
      { weight: 4, value: 'pending' as const },
      { weight: 3, value: 'suspended' as const },
      { weight: 5, value: 'offboarded' as const },
    ]);
    const created = daysAgo(faker.number.int({ min: 3, max: 900 }));
    const [u] = await db
      .insert(users)
      .values({
        email: `${local}@${DOMAIN}`,
        username: local,
        displayName: p.displayName,
        givenName: p.givenName,
        familyName: p.familyName,
        jobTitle: faker.helpers.arrayElement(TITLES[dept] ?? ['Specialist']),
        phone:
          culture === 'jp'
            ? `+81 3-${faker.string.numeric(4)}-${faker.string.numeric(4)}`
            : `+886 2-${faker.string.numeric(4)}-${faker.string.numeric(4)}`,
        employeeId: `E${String(10_000 + i).padStart(6, '0')}`,
        departmentId: deptIds.get(dept)!,
        managerId: leaders.get(dept) ?? admin!.id,
        status,
        authSource: faker.helpers.weightedArrayElement([
          { weight: 6, value: 'oidc' as const },
          { weight: 2, value: 'ldap' as const },
          { weight: 2, value: 'local' as const },
        ]),
        locale: p.locale,
        timezone: p.timezone,
        createdAt: created,
        onboardedAt: status === 'pending' ? null : created,
        offboardedAt: status === 'offboarded' ? daysAgo(faker.number.int({ min: 1, max: 60 })) : null,
        lastLoginAt: status === 'active' ? daysAgo(faker.number.float({ min: 0, max: 30 })) : null,
      })
      .returning({ id: users.id });
    if (!leaders.has(dept)) {
      leaders.set(dept, u!.id);
      await db
        .update(departments)
        .set({ managerId: u!.id })
        .where(eq(departments.id, deptIds.get(dept)!));
    }
    people.push({ id: u!.id, dept, status });
  }

  // Groups
  const groupDefs = [
    { key: 'it-admins', name: 'IS Administrators', description: 'Platform and identity administrators' },
    { key: 'service-desk', name: 'Service Desk', description: 'First-line support agents' },
    { key: 'network-team', name: 'Network Team', description: 'Network & connectivity engineers' },
    { key: 'security-team', name: 'Security Team', description: 'Information security & IAM' },
    { key: 'dba-team', name: 'DBA Team', description: 'Database administrators' },
    {
      key: 'cab',
      name: 'Change Advisory Board',
      description: 'Approves normal and major changes (Phase 1 workflows)',
    },
    { key: 'hr-team', name: 'HR Team', description: 'People operations' },
    { key: 'finance-team', name: 'Finance Team', description: 'Finance & procurement' },
    {
      key: 'app-owners',
      name: 'Application Owners',
      description: 'Business owners of applications',
      source: 'oidc' as const,
    },
    {
      key: 'vpn-users',
      name: 'VPN Users',
      description: 'Synchronised from Active Directory',
      source: 'ldap' as const,
    },
  ];
  const groupIds = new Map<string, string>();
  const [everyoneGroup] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.key, EVERYONE_GROUP_KEY));
  groupIds.set(EVERYONE_GROUP_KEY, everyoneGroup!.id);
  for (const g of groupDefs) {
    const [row] = await db
      .insert(groups)
      .values({
        key: g.key,
        name: g.name,
        description: g.description,
        source: g.source ?? 'local',
        createdAt: daysAgo(200),
      })
      .returning();
    groupIds.set(g.key, row!.id);
  }
  const memberships: { groupId: string; userId: string; source: string }[] = [
    { groupId: groupIds.get('it-admins')!, userId: admin!.id, source: 'manual' },
    { groupId: groupIds.get('service-desk')!, userId: demo.helpdesk!, source: 'manual' },
    { groupId: groupIds.get('hr-team')!, userId: demo['hr.partner']!, source: 'manual' },
    { groupId: groupIds.get('security-team')!, userId: demo.auditor!, source: 'manual' },
  ];
  const byDept: Record<string, string[]> = {
    'it-admins': ['IS'],
    'service-desk': ['IS-SD'],
    'network-team': ['IS-INFRA'],
    'security-team': ['IS-SEC'],
    'dba-team': ['IS-DATA'],
    'hr-team': ['HR'],
    'finance-team': ['FIN'],
  };
  for (const p of people.filter((x) => x.status === 'active')) {
    for (const [key, depts] of Object.entries(byDept))
      if (depts.includes(p.dept))
        memberships.push({ groupId: groupIds.get(key)!, userId: p.id, source: 'manual' });
    if (faker.datatype.boolean(0.35))
      memberships.push({ groupId: groupIds.get('vpn-users')!, userId: p.id, source: 'sync' });
    if (p.dept.startsWith('IS') && faker.datatype.boolean(0.2))
      memberships.push({ groupId: groupIds.get('cab')!, userId: p.id, source: 'manual' });
    if (faker.datatype.boolean(0.06))
      memberships.push({ groupId: groupIds.get('app-owners')!, userId: p.id, source: 'sync' });
  }
  const unique = new Map(memberships.map((m) => [`${m.groupId}:${m.userId}`, m]));
  await db
    .insert(groupMembers)
    .values(
      [...unique.values()].map((m) => ({ ...m, addedAt: daysAgo(faker.number.int({ min: 1, max: 200 })) })),
    );

  // Custom roles (system roles come from manifests via registry.sync)
  const custom = [
    {
      // Not the service desk module's "Service desk agent" (itsm-agent): this one only reads the directory.
      key: 'directory-lookup',
      name: 'Directory lookup',
      description: 'Look up people and groups, for example to support callers',
      permissions: ['core.users.read', 'core.groups.read'],
    },
    {
      key: 'hr-partner',
      name: 'HR partner',
      description: 'Onboard, update and offboard people in assigned departments',
      permissions: ['core.users.read', 'core.users.create', 'core.users.update', 'core.users.lifecycle'],
    },
    {
      key: 'group-manager',
      name: 'Group manager',
      description: 'Manage membership of specific groups',
      permissions: ['core.groups.read', 'core.groups.manage'],
    },
  ];
  const roleIds = new Map<string, string>();
  for (const r of await db.select().from(roles).where(eq(roles.applicationId, app.id)))
    roleIds.set(r.key, r.id);
  for (const r of custom) {
    const [row] = await db
      .insert(roles)
      .values({ applicationId: app.id, key: r.key, name: r.name, description: r.description })
      .returning();
    await db
      .insert(rolePermissions)
      .values(r.permissions.map((permission) => ({ roleId: row!.id, permission })));
    roleIds.set(r.key, row!.id);
  }

  const contractor = people.find((p) => p.status === 'active' && p.dept === 'IS-INFRA')!;
  await db.insert(roleAssignments).values([
    {
      roleId: roleIds.get('platform-admin')!,
      userId: admin!.id,
      grantedAt: daysAgo(120),
      reason: 'Bootstrap administrator',
      source: 'system',
    },
    {
      roleId: roleIds.get('identity-admin')!,
      groupId: groupIds.get('it-admins')!,
      grantedBy: admin!.id,
      grantedAt: daysAgo(100),
    },
    {
      roleId: roleIds.get('security-auditor')!,
      groupId: groupIds.get('security-team')!,
      grantedBy: admin!.id,
      grantedAt: daysAgo(80),
    },
    {
      roleId: roleIds.get('directory-lookup')!,
      groupId: groupIds.get('service-desk')!,
      grantedBy: admin!.id,
      grantedAt: daysAgo(80),
    },
    {
      roleId: roleIds.get('hr-partner')!,
      userId: demo['hr.partner']!,
      scopeType: 'department',
      scopeDepartmentId: deptIds.get('SALES')!,
      grantedBy: admin!.id,
      grantedAt: daysAgo(30),
      reason: 'HR partner for the Sales organisation',
    },
    {
      roleId: roleIds.get('module-admin')!,
      userId: contractor.id,
      expiresAt: new Date(Date.now() + 3 * 86_400_000),
      grantedBy: admin!.id,
      grantedAt: daysAgo(4),
      reason: 'Temporary access for the module rollout (CHG-1042)',
    },
    {
      roleId: roleIds.get('group-manager')!,
      userId: demo.helpdesk!,
      scopeType: 'record',
      scopeRecordType: 'group',
      scopeRecordId: groupIds.get('vpn-users')!,
      grantedBy: admin!.id,
      grantedAt: daysAgo(12),
      reason: 'Owns VPN access requests',
    },
  ]);

  // Identity providers (disabled examples — fill in real values to enable)
  await db.insert(identityProviders).values([
    {
      key: 'entra',
      name: 'Microsoft Entra ID',
      type: 'oidc',
      enabled: false,
      config: {
        preset: 'entra',
        issuer: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
        clientId: '00000000-0000-0000-0000-000000000000',
        scopes: 'openid profile email',
        claims: { email: 'email', name: 'name', username: 'preferred_username', groups: 'groups' },
      },
      secrets: kernel.box.encryptJson({ clientSecret: 'replace-me' }),
      jitProvisioning: true,
      defaultDepartmentId: deptIds.get('HQ')!,
      groupMappings: [
        { external: '11111111-2222-3333-4444-555555555555', groupId: groupIds.get('app-owners')! },
      ],
      displayOrder: 1,
    },
    {
      key: 'corp-ad',
      name: 'Corporate Active Directory',
      type: 'ldap',
      enabled: false,
      config: {
        url: 'ldaps://dc01.corp.example:636',
        bindDn: 'CN=svc-isbp,OU=Service Accounts,DC=corp,DC=example',
        baseDn: 'OU=Staff,DC=corp,DC=example',
        userFilter: '(&(objectClass=user)(sAMAccountName={{username}}))',
        attributes: { username: 'sAMAccountName', email: 'mail', name: 'displayName', memberOf: 'memberOf' },
      },
      secrets: kernel.box.encryptJson({ bindPassword: 'replace-me' }),
      groupMappings: [
        { external: 'CN=VPN-Users,OU=Groups,DC=corp,DC=example', groupId: groupIds.get('vpn-users')! },
      ],
      syncEnabled: true,
      syncCron: '0 */6 * * *',
      lastSyncAt: daysAgo(0.2),
      lastSyncStatus: 'success',
      lastSyncMessage: '1,284 entries · 3 created · 41 updated · 1 suspended',
      displayOrder: 2,
    },
  ]);

  // Two weeks of audit history (backdated, hashed like real rows)
  const active = people.filter((p) => p.status === 'active');
  const names = new Map(
    (await db.select({ id: users.id, name: users.displayName }).from(users)).map((u) => [u.id, u.name]),
  );
  const entries: Omit<typeof auditLogs.$inferInsert, 'hash' | 'seq'>[] = [];
  for (let i = 0; i < 650; i++) {
    const at = daysAgo(faker.number.float({ min: 0, max: 13.9 }));
    const actor = faker.helpers.weightedArrayElement([
      { weight: 5, value: admin!.id },
      { weight: 2, value: demo['hr.partner']! },
      { weight: 2, value: demo.helpdesk! },
      { weight: 10, value: faker.helpers.arrayElement(active).id },
    ]);
    const target = faker.helpers.arrayElement(people);
    const kind = faker.helpers.weightedArrayElement([
      { weight: 50, value: 'login' },
      { weight: 5, value: 'login_failed' },
      { weight: 14, value: 'user.updated' },
      { weight: 5, value: 'group.members_added' },
      { weight: 4, value: 'role-assignment.granted' },
      { weight: 3, value: 'user.created' },
      { weight: 2, value: 'access.denied' },
      { weight: 1, value: 'user.offboarded' },
    ]);
    const base = {
      eventId: v7({ msecs: at.getTime() }),
      occurredAt: at,
      actorType: 'user',
      actorId: actor,
      actorName: names.get(actor) ?? null,
      onBehalfOfId: null,
      moduleId: 'core',
      ip: `10.${faker.number.int({ min: 10, max: 40 })}.${faker.number.int(255)}.${faker.number.int(255)}`,
      userAgent: faker.internet.userAgent(),
      requestId: uuidv7(),
      metadata: null,
      changes: null,
      outcome: 'success',
      category: 'data',
    };
    switch (kind) {
      case 'login':
        entries.push({
          ...base,
          action: 'core.auth.login',
          category: 'security',
          entityType: 'user',
          entityId: actor,
          entityLabel: names.get(actor) ?? null,
          metadata: { provider: faker.helpers.arrayElement(['oidc', 'oidc', 'local', 'ldap']) },
        });
        break;
      case 'login_failed':
        entries.push({
          ...base,
          actorType: 'user',
          actorId: null,
          actorName: 'anonymous',
          action: 'core.auth.login_failed',
          category: 'security',
          outcome: 'failure',
          entityType: 'user',
          entityId: target.id,
          entityLabel: names.get(target.id) ?? null,
          metadata: { provider: 'local', reason: 'bad_password' },
        });
        break;
      case 'user.updated': {
        const field = faker.helpers.arrayElement(['jobTitle', 'phone', 'departmentId', 'displayName']);
        entries.push({
          ...base,
          action: 'core.user.updated',
          entityType: 'user',
          entityId: target.id,
          entityLabel: names.get(target.id) ?? null,
          changes: {
            [field]:
              field === 'jobTitle'
                ? ['Specialist', 'Senior Specialist']
                : field === 'phone'
                  ? [null, '+886 2-2345-6789']
                  : ['…', '…'],
          },
        });
        break;
      }
      case 'group.members_added':
        entries.push({
          ...base,
          action: 'core.group.members_added',
          entityType: 'group',
          entityId: groupIds.get('vpn-users')!,
          entityLabel: 'VPN Users',
          metadata: { userIds: [target.id] },
        });
        break;
      case 'role-assignment.granted':
        entries.push({
          ...base,
          action: 'core.role-assignment.granted',
          category: 'security',
          entityType: 'user',
          entityId: target.id,
          entityLabel: names.get(target.id) ?? null,
          metadata: {
            role: faker.helpers.arrayElement(['directory-lookup', 'group-manager']),
            scopeType: 'global',
          },
        });
        break;
      case 'user.created':
        entries.push({
          ...base,
          action: 'core.user.created',
          entityType: 'user',
          entityId: target.id,
          entityLabel: names.get(target.id) ?? null,
          metadata: { status: 'pending' },
        });
        break;
      case 'access.denied':
        entries.push({
          ...base,
          action: 'core.access.denied',
          category: 'security',
          outcome: 'denied',
          metadata: { permission: 'core.roles.manage', method: 'POST', route: '/api/v1/roles' },
        });
        break;
      default:
        entries.push({
          ...base,
          action: 'core.user.offboarded',
          entityType: 'user',
          entityId: target.id,
          entityLabel: names.get(target.id) ?? null,
          changes: { status: ['active', 'offboarded'] },
          metadata: { reason: 'Resigned', removedGroups: 3, removedRoles: 0 },
        });
    }
  }
  entries.sort((a, b) => a.occurredAt!.getTime() - b.occurredAt!.getTime());
  for (let i = 0; i < entries.length; i += 200) {
    await db.insert(auditLogs).values(entries.slice(i, i + 200).map((e) => ({ ...e, hash: auditHash(e) })));
  }

  log.info(
    {
      departments: deptIds.size,
      users: people.length + 4,
      groups: groupIds.size,
      auditEntries: entries.length,
    },
    'core demo data created',
  );
  return true;
}

try {
  await kernel.migrate();
  let apiKey: { apiClient: string; apiKey: string } | null = null;
  let biKey: { clientId: string; apiKey: string } | null = null;
  let mcpKey: { clientId: string; apiKey: string } | null = null;
  /**
   * A plain employee to try the product as: no roles beyond everyone's, managed by their department's head. Added
   * last, so none of the demo's random choices (requesters, assignees) change.
   */
  const seedEmployee = async () => {
    const [dept] = await db.select().from(departments).where(eq(departments.code, 'SALES-TPE'));
    await db.insert(users).values({
      email: `employee@${DOMAIN}`,
      username: 'employee',
      displayName: 'Daniel Wu',
      givenName: 'Daniel',
      familyName: 'Wu',
      jobTitle: 'Account Manager',
      departmentId: dept!.id,
      managerId: dept!.managerId,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      locale: 'en',
      timezone: 'Asia/Taipei',
      onboardedAt: daysAgo(60),
      lastLoginAt: daysAgo(2),
      createdAt: daysAgo(60),
    });
  };
  await runWithContext({ principal: { type: 'system', id: null, name: 'seed' } }, async () => {
    const created = await seedCore();
    if (created) apiKey = await seedPhase1(kernel);
    // Module roles exist after migrate; grant them before module seeds, which rely on them.
    const modules = created || process.argv.includes('--modules');
    if (modules) {
      await seedPhase2(kernel);
      await seedPhase3(kernel);
      biKey = await seedPhase4(kernel);
      await seedPhase5(kernel);
      await seedPhase6(kernel);
      await seedIsmsAccess(kernel);
    }
    for (const m of kernel.registry.modules) {
      if (m.seed && modules) {
        await m.seed(kernel.registry.context(m.manifest.id));
        log.info({ module: m.manifest.id }, 'module seed complete');
      }
    }
    // Links between records of different modules, once every module has its demo data.
    if (modules) {
      await seedPhase3Links(kernel);
      await seedPhase4Links(kernel);
      await seedPhase5Links(kernel);
      mcpKey = await seedPhase6Links(kernel);
      await seedPhase11Links(kernel);
      // Last: it raises a change and requests, so the numbered records above keep their numbers.
      await seedPhase8Links(kernel);
      // The recurring server room inspection (assigned forms); it adds requests, so it comes after the above.
      await seedFormAssignments(kernel);
    }
    if (created) await seedEmployee();
  });
  await kernel.rbac.bump();
  await db.execute(sql`analyze`);
  if (config.NODE_ENV !== 'production') {
    log.info(
      `Sign in at ${config.PUBLIC_URL}/login → admin / ${ADMIN_PASSWORD}   (demo: helpdesk, hr.partner, auditor, employee / ${DEMO_PASSWORD})`,
    );
    const bi = biKey as { clientId: string; apiKey: string } | null;
    if (bi)
      log.info(
        `Data API demo client ${bi.clientId} — API key (shown once): ${bi.apiKey}\n` +
          `  curl -H "Authorization: Bearer ${bi.apiKey}" "${config.PUBLIC_URL}/api/v1/etl/data/customers-by-region?region=north"`,
      );
    const mcp = mcpKey as { clientId: string; apiKey: string } | null;
    if (mcp)
      log.info(
        `MCP demo client ${mcp.clientId} — API key (shown once): ${mcp.apiKey}\n` +
          `  claude mcp add --transport http isbp ${config.PUBLIC_URL}/api/v1/mcp --header "Authorization: Bearer ${mcp.apiKey}"`,
      );
    const key = apiKey as { apiClient: string; apiKey: string } | null;
    if (key)
      log.info(
        `Role Query demo client ${key.apiClient} — API key (shown once): ${key.apiKey}\n` +
          `  curl -H "Authorization: Bearer ${key.apiKey}" "${config.PUBLIC_URL}/api/v1/role-query/users/hr.partner?application=finance-erp"`,
      );
  }
} finally {
  await kernel.close();
}
