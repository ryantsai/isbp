/**
 * Demo data (idempotent: skipped once any server exists). Runs after the platform's Phase 4 seed, which
 * creates the demo database and the connections:
 *
 * - `contoso-erp-admin` (PostgreSQL, reachable): REALLY synced and provisioned through the provisioner —
 *   accounts `demo_u_<username>`, one pending password reveal for `admin`, an unmanaged legacy account.
 * - `hr-sql01` (SQL Server) and `fin-ora01` (Oracle) point at hosts that do not exist: their inventory is
 *   synthetic ("synced yesterday") and nothing connects to them at seed time; one grant on hr-sql01 failed.
 * - History over the last weeks (rejected, expired, revoked), one request waiting for approval and the
 *   "Q4 2026 database access review" in progress with items for `admin`.
 */
import { groupMembers, groups, users } from '@isbp/db/schema';
import type { LocalizedText } from '@isbp/sdk';
import { type DbConnectionInfo, localize, type ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, eq, inArray, notInArray } from 'drizzle-orm';
import { REQUEST_TRIGGER, type RequestFacts } from '../manifest';
import {
  accountNameFor,
  addDays,
  type EndReason,
  formatRequestRef,
  loginNameFor,
  type Risk,
  todayIn,
} from '../model';
import { createAccountSteps, generatePassword, grantRoleSteps } from './ddl';
import { connectionOf, DbExecutor } from './engine';
import {
  accounts,
  grants,
  inventoryAccounts,
  inventoryMemberships,
  inventoryRoles,
  requestableRoles,
  requests,
  reviewItems,
  reviews,
  servers,
} from './schema';
import { services } from './services';

const DAY = 86_400_000;
const daysAgo = (d: number, hour = 9) => {
  const t = new Date(Date.now() - d * DAY);
  t.setUTCHours(hour, (d * 7) % 60, 0, 0);
  return t;
};
const daysAhead = (d: number) => new Date(Date.now() + d * DAY);
const TZ = 'Asia/Taipei';

interface Person {
  id: string;
  username: string;
  email: string;
  displayName: string;
}

const text = (en: string, zh: string, ja: string): LocalizedText => ({ en, 'zh-TW': zh, 'ja-JP': ja });

export async function seed(ctx: ModuleContext) {
  const db = ctx.db;
  const [existing] = await db.select({ n: count() }).from(servers);
  if ((existing?.n ?? 0) > 0) return;
  const s = services(ctx);
  const log = ctx.logger;
  const today = todayIn(TZ);

  /* ───────────── people & groups ───────────── */

  const groupRows = await db.select({ id: groups.id, key: groups.key }).from(groups);
  const groupId = (key: string) => groupRows.find((g) => g.key === key)?.id ?? null;
  const named = await db
    .select({ id: users.id, username: users.username, email: users.email, displayName: users.displayName })
    .from(users)
    .where(inArray(users.username, ['admin', 'helpdesk', 'hr.partner', 'auditor']));
  const byName = new Map(named.map((u) => [u.username, u as Person]));
  const admin = byName.get('admin');
  if (!admin) {
    log.warn('dbaccess seed: no admin user — skipping');
    return;
  }
  const membersOf = async (key: string): Promise<Person[]> => {
    const gid = groupId(key);
    if (!gid) return [];
    return (await db
      .select({ id: users.id, username: users.username, email: users.email, displayName: users.displayName })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(
        and(
          eq(groupMembers.groupId, gid),
          eq(users.status, 'active'),
          notInArray(users.username, ['admin', 'helpdesk', 'hr.partner', 'auditor']),
        ),
      )
      .orderBy(asc(users.username))) as Person[];
  };
  const dbas = await membersOf('dba-team');
  const finance = await membersOf('finance-team');
  const hr = await membersOf('hr-team');
  const taken = new Set([...dbas, ...finance, ...hr].map((p) => p.id));
  const others = (
    (await db
      .select({ id: users.id, username: users.username, email: users.email, displayName: users.displayName })
      .from(users)
      .where(
        and(
          eq(users.status, 'active'),
          notInArray(users.username, ['admin', 'helpdesk', 'hr.partner', 'auditor']),
        ),
      )
      .orderBy(asc(users.username))
      .limit(80)) as Person[]
  ).filter((p) => !taken.has(p.id));
  const pick = (list: Person[], i: number): Person | undefined => list[i % Math.max(1, list.length)];

  /* ───────────── helpers ───────────── */

  const mkServer = async (
    connection: DbConnectionInfo,
    v: Partial<typeof servers.$inferInsert> & { displayName: string },
  ) => {
    const [row] = await db
      .insert(servers)
      .values({ connectionId: connection.id, engine: connection.engine, ...v })
      .returning();
    return row!;
  };

  const mkRole = async (serverId: string, v: Omit<typeof requestableRoles.$inferInsert, 'serverId'>) => {
    const [row] = await db
      .insert(requestableRoles)
      .values({ serverId, ...v })
      .returning();
    return row!;
  };

  const mkRequest = async (v: {
    person: Person;
    role: typeof requestableRoles.$inferSelect;
    status: 'pending' | 'approved' | 'rejected' | 'cancelled';
    createdDaysAgo: number;
    decidedDaysAgo?: number;
    expiresOn: string | null;
    justification: string;
    comment?: string | null;
  }) => {
    const [row] = await db
      .insert(requests)
      .values({
        requesterId: v.person.id,
        roleId: v.role.id,
        serverId: v.role.serverId,
        expiresOn: v.expiresOn,
        timeZone: TZ,
        justification: v.justification,
        status: v.status,
        decidedAt: v.decidedDaysAgo !== undefined ? daysAgo(v.decidedDaysAgo, 11) : null,
        decisionComment: v.comment ?? null,
        createdAt: daysAgo(v.createdDaysAgo),
        updatedAt: daysAgo(v.decidedDaysAgo ?? v.createdDaysAgo, 11),
      })
      .returning();
    return row!;
  };

  const mkAccount = async (
    serverId: string,
    person: Person | null,
    name: string,
    authMode: 'password' | 'windows' | 'external',
    createdDaysAgo: number,
  ) => {
    const [row] = await db
      .insert(accounts)
      .values({
        serverId,
        userId: person?.id ?? null,
        name,
        authMode,
        createdByPlatform: true,
        createdAt: daysAgo(createdDaysAgo),
      })
      .onConflictDoNothing()
      .returning();
    return (
      row ??
      (
        await db
          .select()
          .from(accounts)
          .where(and(eq(accounts.serverId, serverId), eq(accounts.name, name)))
      )[0]!
    );
  };

  /** A synthetic grant (servers that are not reachable, or history). */
  const mkGrant = async (v: {
    role: typeof requestableRoles.$inferSelect;
    person: Person | null;
    accountName: string;
    accountId?: string | null;
    requestId?: string | null;
    status: 'active' | 'expired' | 'revoked' | 'failed';
    grantedDaysAgo: number | null;
    expiresAt: Date | null;
    endedDaysAgo?: number;
    endReason?: EndReason;
    endNote?: string;
    lastError?: string;
    source?: 'request' | 'adopted';
  }) => {
    const [row] = await db
      .insert(grants)
      .values({
        serverId: v.role.serverId,
        roleId: v.role.id,
        userId: v.person?.id ?? null,
        requestId: v.requestId ?? null,
        accountId: v.accountId ?? null,
        accountName: v.accountName,
        source: v.source ?? 'request',
        status: v.status,
        operation: 'grant',
        grantedAt: v.grantedDaysAgo === null ? null : daysAgo(v.grantedDaysAgo, 10),
        expiresAt: v.expiresAt,
        endedAt: v.endedDaysAgo !== undefined ? daysAgo(v.endedDaysAgo, 2) : null,
        endReason: v.endReason ?? null,
        endNote: v.endNote ?? null,
        attempts: v.status === 'failed' ? 3 : 1,
        lastAttemptAt: v.status === 'failed' ? daysAgo(1, 3) : null,
        lastError: v.lastError ?? null,
        createdAt: daysAgo((v.grantedDaysAgo ?? 2) + 0.2),
      })
      .returning();
    if (v.requestId) await db.update(requests).set({ grantId: row!.id }).where(eq(requests.id, v.requestId));
    return row!;
  };

  const syntheticInventory = async (
    serverId: string,
    inv: {
      accounts: {
        name: string;
        kind: string;
        enabled?: boolean;
        createdDaysAgo: number;
        lastLoginDaysAgo?: number;
      }[];
      roles: { database: string; name: string }[];
      memberships: { database: string; roleName: string; memberName: string }[];
    },
  ) => {
    const syncedAt = daysAgo(1, 18);
    await db.insert(inventoryAccounts).values(
      inv.accounts.map((a) => ({
        serverId,
        name: a.name,
        kind: a.kind,
        enabled: a.enabled ?? true,
        createdOn: daysAgo(a.createdDaysAgo),
        lastLoginAt: a.lastLoginDaysAgo === undefined ? null : daysAgo(a.lastLoginDaysAgo, 8),
        syncedAt,
      })),
    );
    await db.insert(inventoryRoles).values(inv.roles.map((r) => ({ serverId, ...r, syncedAt })));
    await db.insert(inventoryMemberships).values(inv.memberships.map((m) => ({ serverId, ...m, syncedAt })));
    await db
      .update(servers)
      .set({ lastSyncAt: syncedAt, lastSyncStatus: 'ok' })
      .where(eq(servers.id, serverId));
  };

  const connections = await ctx.databases.list({ purpose: 'admin' });
  const conn = (key: string) => connections.find((c) => c.key === key);
  const dbaGroup = groupId('dba-team');

  /* ───────────── Contoso ERP (real PostgreSQL) ───────────── */

  const erpConn = conn('contoso-erp-admin');
  if (erpConn) {
    const erp = await mkServer(erpConn, {
      displayName: 'Contoso ERP (PostgreSQL)',
      environment: 'production',
      accountPattern: 'demo_u_{username}',
      authMode: 'password',
      passwordLength: 24,
      autoSync: true,
      ownerGroupId: dbaGroup,
      createdBy: admin.id,
      createdAt: daysAgo(60),
    });
    let reachable = true;
    try {
      // Access granted outside the platform (a legacy report login): shows as unmanaged access.
      const exec = new DbExecutor(ctx, await connectionOf(ctx, erpConn.id));
      if (!(await exec.account('demo_u_legacy_report')))
        await exec.run(
          createAccountSteps('postgres', {
            login: 'demo_u_legacy_report',
            mode: 'password',
            password: generatePassword(24, 'postgres'),
            validUntil: 'infinity',
          }),
        );
      const target = { login: 'demo_u_legacy_report', role: 'demo_reporting', database: '' };
      if (!(await exec.isMember(target))) await exec.run(grantRoleSteps('postgres', target));
      await s.servers.sync(erp.id);
    } catch (err) {
      reachable = false;
      log.warn(
        { err },
        'dbaccess seed: the demo server is not reachable — inventory and provisioning skipped',
      );
    }
    const roleOwner = pick(dbas, 0);
    const role = async (
      roleName: string,
      input: Omit<typeof requestableRoles.$inferInsert, 'serverId' | 'roleName'>,
    ) => {
      // Every role needs an owner (the approver): admin when the demo group is missing.
      const v = input.ownerUserId || input.ownerGroupId ? input : { ...input, ownerUserId: admin.id };
      if (reachable) {
        const created = await s.servers.createRole(erp.id, { roleName, ...v } as never);
        await db
          .update(requestableRoles)
          .set({ createdAt: daysAgo(58) })
          .where(eq(requestableRoles.id, created.id));
        return created;
      }
      await db
        .insert(inventoryRoles)
        .values({ serverId: erp.id, name: roleName, syncedAt: new Date() })
        .onConflictDoNothing();
      return mkRole(erp.id, { roleName, ...v });
    };
    const reporting = await role('demo_reporting', {
      name: text('ERP reporting (read-only)', 'ERP 報表（唯讀）', 'ERP レポート (読み取り専用)'),
      description: text(
        'Read every table of the ERP schema for reports and ad-hoc analysis.',
        '可讀取 ERP 結構描述中的所有資料表，供報表與臨時分析使用。',
        'レポートやアドホック分析のために ERP スキーマのすべてのテーブルを読み取れます。',
      ),
      ownerGroupId: dbaGroup,
      risk: 'low',
      defaultDays: 90,
      maxDays: 180,
      allowPermanent: false,
      justificationRequired: true,
    });
    const analyst = await role('demo_finance_analyst', {
      name: text('Finance analyst', '財務分析師', '財務アナリスト'),
      description: text(
        'Orders, invoices and customers for month-end analysis.',
        '可讀取訂單、發票與客戶資料，供月結分析使用。',
        '月末分析のための受注、請求書、顧客データ。',
      ),
      ownerGroupId: groupId('finance-team'),
      risk: 'medium',
      defaultDays: 30,
      maxDays: 90,
      allowPermanent: false,
      justificationRequired: true,
    });
    const appRw = await role('demo_app_rw', {
      name: text('ERP application read-write', 'ERP 應用程式讀寫', 'ERP アプリケーション読み書き'),
      description: text(
        'Change ERP data directly. For data fixes during an approved change only.',
        '可直接修改 ERP 資料。僅限於已核准變更期間的資料修正。',
        'ERP データを直接変更できます。承認済みの変更中のデータ修正のみに使用します。',
      ),
      ownerUserId: roleOwner?.id ?? admin.id,
      risk: 'high',
      defaultDays: 7,
      maxDays: 14,
      allowPermanent: false,
      justificationRequired: true,
    });
    const readonly = await role('demo_readonly', {
      name: text('Data warehouse read-only', '資料倉儲唯讀', 'データ ウェアハウス読み取り専用'),
      description: text(
        'Read the dw schema (sales and customer dimensions).',
        '可讀取 dw 結構描述（銷售與客戶維度）。',
        'dw スキーマ (売上と顧客ディメンション) を読み取れます。',
      ),
      ownerUserId: admin.id,
      risk: 'low',
      defaultDays: null,
      maxDays: null,
      allowPermanent: true,
      justificationRequired: false,
    });

    /** Approved request + grant, provisioned for real through the provisioner. */
    const provisioned = async (
      person: Person | undefined,
      r: typeof requestableRoles.$inferSelect,
      createdDaysAgo: number,
      expiresOn: string | null,
      justification: string,
    ) => {
      if (!person) return;
      const req = await mkRequest({
        person,
        role: r,
        status: 'approved',
        createdDaysAgo,
        decidedDaysAgo: Math.max(0, createdDaysAgo - 1),
        expiresOn,
        justification,
      });
      const g = await ctx.transaction((tx) => s.grants.createForRequest(tx, req, r));
      await db.update(requests).set({ grantId: g.id }).where(eq(requests.id, req.id));
      if (reachable) await s.grants.provision(g.id);
      await db
        .update(grants)
        .set({
          createdAt: daysAgo(Math.max(0, createdDaysAgo - 1), 11),
          ...(reachable ? { grantedAt: daysAgo(Math.max(0, createdDaysAgo - 1), 11) } : {}),
        })
        .where(eq(grants.id, g.id));
    };

    const p1 = pick(finance, 0);
    const p2 = pick(dbas, 1);
    const p3 = pick(others, 0);
    const p4 = pick(others, 1);
    const p8 = pick(others, 2);
    // admin: a fresh account with a password waiting to be revealed.
    await provisioned(
      admin,
      reporting,
      1,
      addDays(today, 90),
      'Quarterly KPI pack for the leadership meeting.',
    );
    await provisioned(
      p1,
      analyst,
      12,
      addDays(today, 40),
      'Month-end close: reconcile invoices against orders.',
    );
    await provisioned(
      p2,
      appRw,
      5,
      addDays(today, 2),
      'CHG-00042: correct order totals after the pricing bug.',
    );
    await provisioned(p3, readonly, 40, null, 'Sales dashboards read the warehouse.');
    await provisioned(p4, readonly, 33, null, 'Customer segmentation model.');
    await provisioned(p8, readonly, 21, null, 'Weekly regional sales report.');
    if (reachable) await s.servers.sync(erp.id);

    // History: an expired grant, an early revocation, a rejected and a cancelled request.
    const p5 = pick(others, 3);
    const p6 = pick(dbas, 2) ?? pick(others, 4);
    const p7 = pick(others, 5);
    if (p5) {
      const r = await mkRequest({
        person: p5,
        role: reporting,
        status: 'approved',
        createdDaysAgo: 112,
        decidedDaysAgo: 111,
        expiresOn: addDays(today, -20),
        justification: 'Audit sampling for the annual financial statements.',
      });
      await mkGrant({
        role: reporting,
        person: p5,
        accountName: accountNameFor('demo_u_{username}', p5, 'postgres')!,
        requestId: r.id,
        status: 'expired',
        grantedDaysAgo: 111,
        expiresAt: daysAgo(20, 15),
        endedDaysAgo: 20,
        endReason: 'expired',
      });
    }
    if (p6) {
      const r = await mkRequest({
        person: p6,
        role: appRw,
        status: 'approved',
        createdDaysAgo: 16,
        decidedDaysAgo: 15,
        expiresOn: addDays(today, -2),
        justification: 'Data migration of legacy customers (CHG-00031).',
      });
      await mkGrant({
        role: appRw,
        person: p6,
        accountName: accountNameFor('demo_u_{username}', p6, 'postgres')!,
        requestId: r.id,
        status: 'revoked',
        grantedDaysAgo: 15,
        expiresAt: daysAgo(2, 15),
        endedDaysAgo: 9,
        endReason: 'revoked',
        endNote: 'Migration finished early — write access no longer needed.',
      });
    }
    if (p7)
      await mkRequest({
        person: p7,
        role: appRw,
        status: 'rejected',
        createdDaysAgo: 12,
        decidedDaysAgo: 11,
        expiresOn: addDays(today, -5),
        justification: 'Need to fix my own orders.',
        comment: 'Use the reporting role and raise a change for data fixes.',
      });
    const p9 = pick(others, 6);
    if (p9)
      await mkRequest({
        person: p9,
        role: analyst,
        status: 'cancelled',
        createdDaysAgo: 26,
        decidedDaysAgo: 25,
        expiresOn: addDays(today, -1),
        justification: 'Budget variance analysis.',
      });
  }

  /* ───────────── HR on SQL Server (unreachable, synthetic inventory) ───────────── */

  const hrConn = conn('hr-sql01');
  let pendingRole: typeof requestableRoles.$inferSelect | null = null;
  if (hrConn) {
    const hrServer = await mkServer(hrConn, {
      displayName: 'HR (SQL Server)',
      environment: 'production',
      accountPattern: '{username}',
      authMode: 'windows',
      windowsDomain: 'CONTOSO',
      autoSync: true,
      ownerGroupId: dbaGroup,
      createdBy: admin.id,
      createdAt: daysAgo(50),
    });
    const login = (p: Person) =>
      loginNameFor(accountNameFor('{username}', p, 'mssql')!, 'mssql', 'windows', 'CONTOSO');
    const readers = [pick(hr, 0), pick(hr, 1), pick(others, 7)].filter((p): p is Person => Boolean(p));
    const payroll = pick(hr, 2);
    const drifter = pick(others, 8);
    const failedPerson = pick(others, 9);
    const datareader = await mkRole(hrServer.id, {
      database: 'HRIS',
      roleName: 'db_datareader',
      name: text('HRIS read-only', 'HRIS 唯讀', 'HRIS 読み取り専用'),
      description: text(
        'Read employee master data in HRIS.',
        '可讀取 HRIS 中的員工主檔資料。',
        'HRIS の従業員マスター データを読み取れます。',
      ),
      ownerGroupId: groupId('hr-team'),
      risk: 'low',
      defaultDays: 30,
      maxDays: 90,
      allowPermanent: false,
      justificationRequired: true,
      createdAt: daysAgo(48),
    });
    const payrollRole = await mkRole(hrServer.id, {
      database: 'HRIS',
      roleName: 'hr_payroll_read',
      name: text('Payroll (read)', '薪資（讀取）', '給与 (読み取り)'),
      description: text(
        'Salaries and payroll runs. Personal data: high risk.',
        '薪資與薪資計算批次。屬個人資料：高風險。',
        '給与と給与計算の実行。個人データ: 高リスク。',
      ),
      ownerGroupId: groupId('hr-team'),
      risk: 'high',
      defaultDays: 7,
      maxDays: 30,
      allowPermanent: false,
      justificationRequired: true,
      createdAt: daysAgo(48),
    });
    pendingRole = payrollRole;
    const memberships: { database: string; roleName: string; memberName: string }[] = [
      { database: 'HRIS', roleName: 'db_owner', memberName: 'svc_isbp' },
      { database: 'HRIS', roleName: 'db_datareader', memberName: 'hr_app' },
      { database: 'HRIS', roleName: 'db_datawriter', memberName: 'hr_app' },
      { database: '', roleName: 'sysadmin', memberName: 'svc_isbp' },
    ];
    for (const [i, p] of readers.entries()) {
      const name = login(p);
      const account = await mkAccount(hrServer.id, p, name, 'windows', 40 - i * 7);
      const r = await mkRequest({
        person: p,
        role: datareader,
        status: 'approved',
        createdDaysAgo: 30 - i * 6,
        decidedDaysAgo: 29 - i * 6,
        expiresOn: addDays(today, 20 + i * 15),
        justification: 'Headcount reporting for the business review.',
      });
      await mkGrant({
        role: datareader,
        person: p,
        accountName: name,
        accountId: account.id,
        requestId: r.id,
        status: 'active',
        grantedDaysAgo: 29 - i * 6,
        expiresAt: daysAhead(20 + i * 15),
      });
      memberships.push({ database: 'HRIS', roleName: 'db_datareader', memberName: name });
    }
    if (payroll) {
      const name = login(payroll);
      const account = await mkAccount(hrServer.id, payroll, name, 'windows', 20);
      const r = await mkRequest({
        person: payroll,
        role: payrollRole,
        status: 'approved',
        createdDaysAgo: 6,
        decidedDaysAgo: 5,
        expiresOn: addDays(today, 9),
        justification: 'Payroll run checks for the October cycle.',
      });
      await mkGrant({
        role: payrollRole,
        person: payroll,
        accountName: name,
        accountId: account.id,
        requestId: r.id,
        status: 'active',
        grantedDaysAgo: 5,
        expiresAt: daysAhead(9),
      });
      memberships.push({ database: 'HRIS', roleName: 'hr_payroll_read', memberName: name });
    }
    if (drifter)
      memberships.push({ database: 'HRIS', roleName: 'hr_payroll_read', memberName: login(drifter) });
    if (failedPerson) {
      const r = await mkRequest({
        person: failedPerson,
        role: datareader,
        status: 'approved',
        createdDaysAgo: 2,
        decidedDaysAgo: 1,
        expiresOn: addDays(today, 30),
        justification: 'Onboarding analytics for new hires.',
      });
      await mkGrant({
        role: datareader,
        person: failedPerson,
        accountName: login(failedPerson),
        requestId: r.id,
        status: 'failed',
        grantedDaysAgo: null,
        expiresAt: daysAhead(30),
        lastError: 'ENOTFOUND: getaddrinfo ENOTFOUND sql-hr-01.corp.contoso.example',
      });
    }
    const people = [...readers, payroll, drifter].filter((p): p is Person => Boolean(p));
    await syntheticInventory(hrServer.id, {
      accounts: [
        { name: 'sa', kind: 'SQL_LOGIN', enabled: false, createdDaysAgo: 1400 },
        { name: 'svc_isbp', kind: 'SQL_LOGIN', createdDaysAgo: 400, lastLoginDaysAgo: 0 },
        { name: 'hr_app', kind: 'SQL_LOGIN', createdDaysAgo: 900 },
        { name: 'CONTOSO\\old_contractor', kind: 'WINDOWS_LOGIN', createdDaysAgo: 600 },
        { name: 'CONTOSO\\HR-Reporting', kind: 'WINDOWS_GROUP', createdDaysAgo: 700 },
        ...people.map((p, i) => ({ name: login(p), kind: 'WINDOWS_LOGIN', createdDaysAgo: 40 - i * 5 })),
      ],
      roles: [
        { database: '', name: 'sysadmin' },
        { database: '', name: 'securityadmin' },
        { database: 'HRIS', name: 'db_owner' },
        { database: 'HRIS', name: 'db_datareader' },
        { database: 'HRIS', name: 'db_datawriter' },
        { database: 'HRIS', name: 'hr_payroll_read' },
      ],
      memberships: [
        ...new Map(memberships.map((m) => [`${m.database}|${m.roleName}|${m.memberName}`, m])).values(),
      ],
    });
  }

  /* ───────────── Finance on Oracle (unreachable, synthetic inventory) ───────────── */

  const finConn = conn('fin-ora01');
  if (finConn) {
    const fin = await mkServer(finConn, {
      displayName: 'Finance ledger (Oracle)',
      environment: 'production',
      accountPattern: '{username}',
      authMode: 'password',
      passwordLength: 24,
      autoSync: true,
      ownerGroupId: dbaGroup,
      createdBy: admin.id,
      createdAt: daysAgo(45),
    });
    const user = (p: Person) => accountNameFor('{username}', p, 'oracle')!;
    const readOnly = await mkRole(fin.id, {
      roleName: 'FIN_READONLY',
      name: text('General ledger read-only', '總帳唯讀', '総勘定元帳 読み取り専用'),
      description: text(
        'Journals, balances and the chart of accounts.',
        '可讀取分錄、餘額與會計科目表。',
        '仕訳、残高、勘定科目表。',
      ),
      ownerGroupId: groupId('finance-team'),
      risk: 'medium',
      defaultDays: 30,
      maxDays: 90,
      allowPermanent: false,
      justificationRequired: true,
      createdAt: daysAgo(44),
    });
    const posting = await mkRole(fin.id, {
      roleName: 'FIN_POSTING',
      name: text('Journal posting', '分錄過帳', '仕訳の転記'),
      description: text(
        'Post and reverse journals. Segregation of duties applies.',
        '可過帳與迴轉分錄。須遵守職責分離。',
        '仕訳の転記と取り消し。職務分掌が適用されます。',
      ),
      ownerGroupId: groupId('finance-team'),
      risk: 'high',
      defaultDays: 7,
      maxDays: 30,
      allowPermanent: false,
      justificationRequired: true,
      createdAt: daysAgo(44),
    });
    const memberships: { database: string; roleName: string; memberName: string }[] = [
      { database: '', roleName: 'FIN_POSTING', memberName: 'TMPLOAD' },
      { database: '', roleName: 'FIN_READONLY', memberName: 'GL_BATCH' },
    ];
    const readers = [pick(finance, 1), pick(finance, 2), pick(others, 10)].filter((p): p is Person =>
      Boolean(p),
    );
    for (const [i, p] of readers.entries()) {
      const name = user(p);
      const account = await mkAccount(fin.id, p, name, 'password', 35 - i * 4);
      const r = await mkRequest({
        person: p,
        role: readOnly,
        status: 'approved',
        createdDaysAgo: 28 - i * 8,
        decidedDaysAgo: 27 - i * 8,
        expiresOn: addDays(today, 10 + i * 20),
        justification: 'Quarter-end reconciliation of the ledger.',
      });
      await mkGrant({
        role: readOnly,
        person: p,
        accountName: name,
        accountId: account.id,
        requestId: r.id,
        status: 'active',
        grantedDaysAgo: 27 - i * 8,
        expiresAt: daysAhead(10 + i * 20),
      });
      memberships.push({ database: '', roleName: 'FIN_READONLY', memberName: name });
    }
    const poster = pick(finance, 3);
    if (poster) {
      const name = user(poster);
      const account = await mkAccount(fin.id, poster, name, 'password', 14);
      const r = await mkRequest({
        person: poster,
        role: posting,
        status: 'approved',
        createdDaysAgo: 4,
        decidedDaysAgo: 3,
        expiresOn: addDays(today, 4),
        justification: 'Accrual postings for the month-end close.',
      });
      await mkGrant({
        role: posting,
        person: poster,
        accountName: name,
        accountId: account.id,
        requestId: r.id,
        status: 'active',
        grantedDaysAgo: 3,
        expiresAt: daysAhead(4),
      });
      memberships.push({ database: '', roleName: 'FIN_POSTING', memberName: name });
    }
    const leaver = pick(others, 11);
    if (leaver) {
      const r = await mkRequest({
        person: leaver,
        role: readOnly,
        status: 'approved',
        createdDaysAgo: 70,
        decidedDaysAgo: 69,
        expiresOn: addDays(today, -10),
        justification: 'Cost centre analysis.',
      });
      await mkGrant({
        role: readOnly,
        person: leaver,
        accountName: user(leaver),
        requestId: r.id,
        status: 'expired',
        grantedDaysAgo: 69,
        expiresAt: daysAgo(10, 15),
        endedDaysAgo: 10,
        endReason: 'expired',
      });
    }
    await syntheticInventory(fin.id, {
      accounts: [
        { name: 'ISBP_ADMIN', kind: 'OPEN', createdDaysAgo: 400, lastLoginDaysAgo: 0 },
        { name: 'GL_BATCH', kind: 'OPEN', createdDaysAgo: 1200, lastLoginDaysAgo: 1 },
        { name: 'TMPLOAD', kind: 'OPEN', createdDaysAgo: 210, lastLoginDaysAgo: 95 },
        { name: 'OLD_AUDITOR', kind: 'LOCKED', enabled: false, createdDaysAgo: 800, lastLoginDaysAgo: 400 },
        ...[...readers, poster]
          .filter((p): p is Person => Boolean(p))
          .map((p, i) => ({ name: user(p), kind: 'OPEN', createdDaysAgo: 35 - i * 4, lastLoginDaysAgo: i })),
      ],
      roles: [
        { database: '', name: 'FIN_READONLY' },
        { database: '', name: 'FIN_POSTING' },
        { database: '', name: 'FIN_ADMIN' },
      ],
      memberships,
    });
  }

  /* ───────────── a request waiting for approval ───────────── */

  const partner = byName.get('hr.partner');
  if (pendingRole && partner) {
    const expiresOn = addDays(today, 7);
    const [req] = await db
      .insert(requests)
      .values({
        requesterId: partner.id,
        roleId: pendingRole.id,
        serverId: pendingRole.serverId,
        expiresOn,
        timeZone: 'Asia/Tokyo',
        justification: 'Year-end bonus simulation needs read access to the payroll tables for one week.',
        createdAt: daysAgo(0, 1),
      })
      .returning();
    const [server] = await db.select().from(servers).where(eq(servers.id, pendingRole.serverId));
    const approverIds = pendingRole.ownerGroupId
      ? (
          await db
            .select({ id: users.id })
            .from(groupMembers)
            .innerJoin(users, eq(users.id, groupMembers.userId))
            .where(and(eq(groupMembers.groupId, pendingRole.ownerGroupId), eq(users.status, 'active')))
            .limit(100)
        ).map((r) => r.id)
      : [];
    const facts: RequestFacts = {
      role: {
        risk: pendingRole.risk as Risk,
        approverIds,
        environment: 'production',
        permanent: false,
        days: 7,
      },
    };
    const reference = formatRequestRef(req!.number);
    await ctx.transaction(async (tx) => {
      const started = await ctx.workflows.start(
        REQUEST_TRIGGER,
        {
          subject: {
            type: 'request',
            id: req!.id,
            label: Object.fromEntries(
              (['en', 'zh-TW', 'ja-JP'] as const).map((l) => [
                l,
                `${reference} ${localize(pendingRole!.name, l)} · ${server!.displayName}`,
              ]),
            ),
            href: `/dbaccess/requests/${reference}`,
          },
          facts,
          requesterId: partner.id,
          subjectUserId: partner.id,
        },
        { tx },
      );
      await tx
        .update(requests)
        .set({ instanceId: started?.instanceId ?? null })
        .where(eq(requests.id, req!.id));
      await s.grants.trackRequest(tx, req!.id, 'pending');
    });
  }

  /* ───────────── portal entries for the history ───────────── */

  const tracked = await db
    .select()
    .from(requests)
    .where(notInArray(requests.status, ['pending']));
  await ctx.transaction(async (tx) => {
    for (const r of tracked) {
      const g = r.grantId ? (await tx.select().from(grants).where(eq(grants.id, r.grantId)))[0] : undefined;
      await s.grants.trackRequest(tx, r.id, g ? g.status : r.status === 'approved' ? 'active' : r.status);
    }
  });

  /* ───────────── access review in progress ───────────── */

  const auditor = byName.get('auditor');
  const [review] = await db
    .insert(reviews)
    .values({
      name: 'Q4 2026 database access review',
      serverIds: [],
      minRisk: 'low',
      reviewerRule: 'owner',
      startOn: addDays(today, -5),
      dueOn: addDays(today, 10),
      policy: 'revoke',
      recurrence: 'quarterly',
      status: 'scheduled',
      createdBy: auditor?.id ?? admin.id,
      createdAt: daysAgo(6),
    })
    .returning();
  await s.reviews.start(review!.id);
  await db
    .update(reviews)
    .set({ startedAt: daysAgo(5, 1) })
    .where(eq(reviews.id, review!.id));
  // Some decisions already made: one of admin's items, and items of group-owned roles.
  const items = await db
    .select({ item: reviewItems, userId: grants.userId })
    .from(reviewItems)
    .innerJoin(grants, eq(grants.id, reviewItems.grantId))
    .where(eq(reviewItems.reviewId, review!.id))
    .orderBy(asc(reviewItems.createdAt), asc(reviewItems.id));
  const adminItems = items.filter((i) => i.item.reviewerUserId === admin.id);
  if (adminItems[0])
    await db
      .update(reviewItems)
      .set({
        decision: 'keep',
        comment: 'Still builds the regional sales dashboards.',
        decidedBy: admin.id,
        decidedAt: daysAgo(3, 6),
      })
      .where(eq(reviewItems.id, adminItems[0].item.id));
  const groupItems = items.filter((i) => i.item.reviewerGroupId);
  for (const [n, i] of groupItems.slice(0, 3).entries()) {
    const members = await db
      .select({ id: users.id })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.groupId, i.item.reviewerGroupId!), eq(users.status, 'active')))
      .orderBy(asc(users.username))
      .limit(3);
    const decider = members.find((m) => m.id !== i.userId);
    if (!decider) continue;
    await db
      .update(reviewItems)
      .set({
        decision: n === 2 ? 'revoke' : 'keep',
        comment:
          n === 2
            ? 'Moved to another team: access no longer needed.'
            : 'Confirmed with the person: still needed.',
        decidedBy: decider.id,
        decidedAt: daysAgo(2 - n * 0.5, 7),
      })
      .where(eq(reviewItems.id, i.item.id));
  }

  const totals = await db.select({ n: count() }).from(grants);
  log.info({ grants: totals[0]?.n ?? 0, reviewItems: items.length }, 'dbaccess demo data');
}
