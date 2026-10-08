/**
 * Demo data (idempotent: skipped once any asset exists), all generic: the default classes and labels, three sites,
 * a few assets of every class with C/I/A scores, a stocktake in progress, two shared accounts (one whose password
 * must be changed) and an account review in progress filled from an exported account list. Written through the
 * module's own services, so numbering, history, audit and notifications are the real ones.
 */
import { groupMembers, groups, users } from '@isbp/db/schema';
import type { AuthContext, ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { addDays } from '../model';
import { assets, classes, labels, sites, subclasses } from './schema';
import { services } from './services';
import { companyToday, systemAuth } from './support';
import { ensureDefaults } from './taxonomy';

interface SeedAsset {
  name: string;
  cls: string;
  sub: string;
  site: string;
  cia: [number, number, number];
  label?: string;
  manager?: 'it' | 'sec' | 'net' | 'dba';
  group?: string;
  usersText?: string;
  location?: string;
  brand?: string;
  model?: string;
  version?: string;
  quantity?: number;
}

const ASSETS: SeedAsset[] = [
  {
    name: 'IT operations staff',
    cls: 'PE',
    sub: 'internal-people',
    site: 'HQ01',
    cia: [3, 1, 3],
    manager: 'it',
    usersText: 'IT department',
    quantity: 6,
    label: 'confidential',
  },
  {
    name: 'On-site support contractor',
    cls: 'PE',
    sub: 'external-people',
    site: 'HQ01',
    cia: [2, 1, 2],
    manager: 'it',
    usersText: 'Service desk',
    label: 'internal-use-only',
  },
  {
    name: 'Core firewall',
    cls: 'HW',
    sub: 'network-devices',
    site: 'DC01',
    cia: [4, 1, 4],
    manager: 'net',
    location: 'Data centre, rack A2',
    brand: 'Generic Networks',
    model: 'FW-2000',
    label: 'strictly-confidential',
  },
  {
    name: 'ERP database server',
    cls: 'HW',
    sub: 'servers',
    site: 'DC01',
    cia: [4, 1, 4],
    manager: 'dba',
    location: 'Data centre, rack B1',
    brand: 'Generic Systems',
    model: 'R-760',
    label: 'strictly-confidential',
  },
  {
    name: 'Backup server',
    cls: 'HW',
    sub: 'servers',
    site: 'DC01',
    cia: [3, 1, 3],
    manager: 'it',
    location: 'Data centre, rack B3',
    brand: 'Generic Systems',
    model: 'R-560',
    label: 'confidential',
  },
  {
    name: 'Encrypted USB drives',
    cls: 'HW',
    sub: 'portable-media',
    site: 'HQ01',
    cia: [3, 1, 1],
    manager: 'sec',
    location: 'IT office, locked cabinet',
    quantity: 12,
    label: 'confidential',
  },
  {
    name: 'Field team tablets',
    cls: 'HW',
    sub: 'mobile-devices',
    site: 'BR01',
    cia: [2, 1, 2],
    manager: 'it',
    location: 'Branch office',
    quantity: 8,
    label: 'internal-use-only',
  },
  {
    name: 'Meeting-room video system',
    cls: 'HW',
    sub: 'iot-devices',
    site: 'HQ01',
    cia: [1, 1, 2],
    group: 'it-admins',
    location: 'Meeting room 3',
  },
  {
    name: 'Server operating system',
    cls: 'SW',
    sub: 'operating-systems',
    site: 'DC01',
    cia: [2, 3, 3],
    manager: 'it',
    version: '2024 LTS',
  },
  {
    name: 'Office productivity suite',
    cls: 'SW',
    sub: 'packaged-software',
    site: 'HQ01',
    cia: [1, 2, 2],
    group: 'it-admins',
    usersText: 'All staff',
    version: '16.0',
    quantity: 180,
  },
  {
    name: 'Endpoint protection',
    cls: 'SW',
    sub: 'packaged-software',
    site: 'HQ01',
    cia: [2, 3, 3],
    manager: 'sec',
    version: '12.4',
  },
  {
    name: 'Information security procedures',
    cls: 'DA',
    sub: 'operational-documents',
    site: 'HQ01',
    cia: [2, 3, 2],
    manager: 'sec',
    label: 'internal-use-only',
    location: 'Document management system',
  },
  {
    name: 'ERP system manual',
    cls: 'DA',
    sub: 'system-documents',
    site: 'HQ01',
    cia: [2, 2, 1],
    manager: 'dba',
    label: 'confidential',
  },
  {
    name: 'Customer order database',
    cls: 'DA',
    sub: 'electronic-records',
    site: 'DC01',
    cia: [4, 4, 4],
    manager: 'dba',
    label: 'customer-confidential',
    location: 'ERP database server',
  },
  {
    name: 'Vendor contracts',
    cls: 'DA',
    sub: 'contracts',
    site: 'HQ01',
    cia: [3, 3, 2],
    manager: 'sec',
    label: 'confidential',
    location: 'Legal archive',
  },
  {
    name: 'Building access control',
    cls: 'SV',
    sub: 'internal-services',
    site: 'HQ01',
    cia: [2, 1, 3],
    group: 'it-admins',
  },
  {
    name: 'Internet connectivity',
    cls: 'SV',
    sub: 'external-services',
    site: 'DC01',
    cia: [1, 1, 4],
    manager: 'net',
    brand: 'Generic Telecom',
  },
];

async function groupMembersOf(ctx: ModuleContext, key: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: users.id })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .innerJoin(users, and(eq(users.id, groupMembers.userId), eq(users.status, 'active')))
    .where(eq(groups.key, key))
    .orderBy(asc(users.username))
    .limit(10);
  return rows.map((r) => r.id);
}

export async function seedIsms(ctx: ModuleContext) {
  const [existing] = await ctx.db.select({ n: count() }).from(assets);
  if (existing!.n > 0) return;
  await ensureDefaults(ctx);
  const s = services(ctx);
  const system = systemAuth('Information security seed');
  const today = companyToday();

  const [admin] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.username, 'admin'));
  const anyone = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.status, 'active'))
    .orderBy(asc(users.createdAt))
    .limit(12);
  if (!anyone.length) return;
  const fallback = admin?.id ?? anyone[0]!.id;
  const pick = async (key: string, i = 0) =>
    (await groupMembersOf(ctx, key))[i] ?? anyone[i % anyone.length]?.id ?? fallback;
  const people = {
    it: await pick('it-admins'),
    sec: await pick('security-team'),
    net: await pick('network-team'),
    dba: await pick('dba-team'),
  };
  const authOf = async (userId: string): Promise<AuthContext> => (await ctx.rbac.authFor(userId)) ?? system;
  /** The person when they hold the permission (the platform seed grants the demo roles first), else the module. */
  const actingAs = async (userId: string, permission: string) => {
    const auth = await authOf(userId);
    return auth.can(permission) ? auth : system;
  };

  /* sites */
  for (const site of [
    { code: 'DC01', name: 'Data centre' },
    { code: 'BR01', name: 'Branch office' },
  ]) {
    const [found] = await ctx.db.select({ id: sites.id }).from(sites).where(eq(sites.code, site.code));
    if (!found) await s.taxonomy.createSite({ ...site, description: null }, system);
  }

  /* assets */
  const [cls, subs, sts, lbls, grps] = await Promise.all([
    ctx.db.select().from(classes),
    ctx.db.select().from(subclasses),
    ctx.db.select().from(sites),
    ctx.db.select().from(labels),
    ctx.db
      .select({ id: groups.id, key: groups.key })
      .from(groups)
      .where(inArray(groups.key, ['it-admins'])),
  ]);
  const created: Record<string, { id: string; number: string }> = {};
  for (const a of ASSETS) {
    const klass = cls.find((c) => c.code === a.cls);
    const site = sts.find((x) => x.code === a.site) ?? sts[0];
    if (!klass || !site) continue;
    const row = await s.assets.create(
      {
        name: a.name,
        classId: klass.id,
        subclassId: subs.find((x) => x.classId === klass.id && x.key === a.sub)?.id ?? null,
        siteId: site.id,
        managerId: a.manager ? people[a.manager] : null,
        managerGroupId: a.group ? (grps.find((g) => g.key === a.group)?.id ?? null) : null,
        userIds: [],
        usersText: a.usersText ?? null,
        location: a.location ?? null,
        brand: a.brand ?? null,
        model: a.model ?? null,
        version: a.version ?? null,
        quantity: a.quantity ?? 1,
        confidentiality: a.cia[0],
        integrity: a.cia[1],
        availability: a.cia[2],
        classificationId: a.label ? (lbls.find((l) => l.key === a.label)?.id ?? null) : null,
      },
      system,
      { at: new Date(Date.now() - 40 * 86_400_000) },
    );
    created[a.name] = { id: row.id, number: row.number };
  }

  /* a stocktake in progress: hardware and software, a week in */
  const hw = cls.find((c) => c.code === 'HW');
  const sw = cls.find((c) => c.code === 'SW');
  if (hw && sw) {
    const st = await s.stocktakes.create(
      {
        name: `Yearly asset stocktake ${today.slice(0, 4)}`,
        dueOn: addDays(today, 14),
        startOn: null,
        scope: { classIds: [hw.id, sw.id], siteIds: [], managerIds: [], managerGroupIds: [] },
        recurrence: 'yearly',
      },
      await actingAs(people.sec, 'isms.stocktakes.manage'),
    );
    const items = await s.stocktakes.items(st.id, { page: 1, pageSize: 100, view: 'all' }, system);
    const byName = new Map(items.items.map((i) => [i.snapshot.name, i]));
    const record = async (
      name: string,
      who: string,
      input: Parameters<typeof s.stocktakes.recordItem>[2],
    ) => {
      const item = byName.get(name);
      if (item) await s.stocktakes.recordItem(st.id, item.id, input, await authOf(who));
    };
    await record('Core firewall', people.net, { result: 'confirmed' });
    await record('ERP database server', people.dba, { result: 'confirmed' });
    await record('Backup server', people.it, {
      result: 'changed',
      changes: { location: 'Data centre, rack B4' },
      note: 'Moved during the rack upgrade',
    });
    await record('Endpoint protection', people.sec, { result: 'confirmed' });
  }

  /* shared accounts: one healthy, one with a password change due */
  const [it2, it3] = [await pick('it-admins', 1), await pick('service-desk', 0)];
  const backup = await s.accounts.create(
    {
      accountName: 'svc-backup',
      targetSystem: 'Backup server console',
      custodianId: people.it,
      memberIds: [...new Set([people.it, it2, it3])],
      purpose: 'Nightly backup jobs and restores',
      project: 'Backup operations',
      requestReference: null,
      departmentId: null,
      lastPasswordChangeOn: addDays(today, -75),
      nextReviewOn: addDays(today, 120),
      notes: null,
    },
    system,
  );
  // A member was taken off the list: the custodian must change the password today.
  if (it3 !== people.it && it3 !== it2)
    await s.accounts.update(
      backup.id,
      { memberIds: [people.it, it2].filter((v, i, a) => a.indexOf(v) === i) },
      system,
    );
  await s.accounts.create(
    {
      accountName: 'report_reader',
      targetSystem: 'Reporting database (read-only)',
      custodianId: people.dba,
      memberIds: [...new Set([people.dba, await pick('dba-team', 1)])],
      purpose: 'Monthly management reports',
      project: null,
      requestReference: null,
      departmentId: null,
      lastPasswordChangeOn: addDays(today, -20),
      nextReviewOn: addDays(today, 60),
      notes: null,
    },
    system,
  );

  /* an account review in progress, filled from the firewall's exported account list */
  const review = await s.reviews.create(
    {
      target: 'Core firewall management console',
      targetRef: null,
      reviewerId: people.net,
      dueOn: addDays(today, 10),
      startOn: null,
      applicationId: null,
      recurrence: 'yearly',
    },
    await actingAs(people.sec, 'isms.reviews.manage'),
  );
  const [netUser] = await ctx.db
    .select({ username: users.username, name: users.displayName })
    .from(users)
    .where(eq(users.id, people.net));
  const [itUser] = await ctx.db
    .select({ username: users.username, name: users.displayName })
    .from(users)
    .where(eq(users.id, people.it));
  const lines = [
    'admin,Built-in administrator,Administrator,Enabled',
    `${netUser?.username ?? 'netops'},${netUser?.name ?? 'Network engineer'},Administrator,Enabled`,
    `${itUser?.username ?? 'itops'},${itUser?.name ?? 'IT engineer'},User,Enabled`,
    'monitor,Monitoring system,User,Enabled',
    'temp-vendor,Vendor engineer (project ended),Administrator,Enabled',
    'olduser,Former employee,User,Disabled',
  ];
  // One line per account (in a small demo the same person may play several parts).
  const seen = new Set<string>();
  const unique = lines.filter((l) => {
    const account = l.split(',')[0]!.toLowerCase();
    if (seen.has(account)) return false;
    seen.add(account);
    return true;
  });
  const csv = ['Account,User name,Privilege,Status', ...unique].join('\n');
  await s.reviews.importItems(review.id, csv, false, system);
  const reviewer = await authOf(people.net);
  const items = await s.reviews.items(review.id, { page: 1, pageSize: 50, view: 'all' }, system);
  const id = (account: string) => items.items.find((i) => i.accountName === account)?.id;
  const decide = async (
    account: string,
    decision: 'keep' | 'disable' | 'delete',
    note?: string,
    doneOn?: string,
  ) => {
    const itemId = id(account);
    if (itemId)
      await s.reviews.decide(
        review.id,
        [itemId],
        { decision, note: note ?? null, doneOn: doneOn ?? null },
        reviewer,
      );
  };
  await decide('admin', 'keep', 'Break-glass account, kept in the safe');
  if (netUser) await decide(netUser.username, 'keep');
  await decide('temp-vendor', 'disable', 'Project ended', addDays(today, -1));
}
