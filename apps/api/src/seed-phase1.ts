/**
 * Phase 1 demo data: custom fields, external applications, requestable roles, workflows, forms,
 * channels, an API client and requests in every state — driven through the real services and the
 * workflow engine, so timelines, notifications and audit records are consistent.
 */
import { fakerEN as faker } from '@faker-js/faker';
import type { FormSchema } from '@isbp/sdk';
import {
  accessRequests,
  applications,
  approvalTasks,
  departments,
  formSubmissions,
  groupMembers,
  groups,
  notificationChannels,
  notifications,
  roleAssignments,
  roles,
  users,
  workflowDefinitions,
  workflowInstances,
} from '@isbp/db/schema';
import type { AuthContext, FieldDef, ModuleContext, WorkflowGraph } from '@isbp/sdk/server';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { AccessService } from './core/services/access';
import { ACCESS_REQUEST_TRIGGER, AccessRequestService } from './core/services/access-requests';
import { ApiClientService, ApplicationService } from './core/services/applications';
import { CustomFieldAdminService, FORM_SUBMISSION_TRIGGER, FormService } from './core/services/forms';
import { ApprovalService, WorkflowAdminService } from './core/services/workflows';
import { runWithContext } from './kernel/context';
import { buildAuthContext } from './kernel/http/auth';
import type { Kernel } from './kernel/kernel';
import { toSessionUser } from './kernel/sessions';

const HOUR = 3_600_000;
const t3 = (en: string, zh: string, ja: string) => ({ en, 'zh-TW': zh, 'ja-JP': ja });

export async function seedPhase1(kernel: Kernel) {
  const db = kernel.db;
  const log = kernel.logger;
  const ctx: ModuleContext = kernel.registry.context('core');

  const byUsername = async (username: string) => {
    const [u] = await db.select().from(users).where(eq(users.username, username));
    if (!u) throw new Error(`seed: missing user ${username}`);
    return u;
  };
  const admin = await byUsername('admin');
  const helpdesk = await byUsername('helpdesk');
  const hr = await byUsername('hr.partner');
  const auditor = await byUsername('auditor');

  const authCache = new Map<string, AuthContext>();
  async function as<T>(userId: string, fn: (auth: AuthContext) => Promise<T>): Promise<T> {
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    const principal = { type: 'user' as const, id: u!.id, name: u!.displayName };
    let auth = authCache.get(userId);
    if (!auth) {
      auth = buildAuthContext(principal, toSessionUser(u!), null, await kernel.rbac.permissionsFor(u!.id));
      authCache.set(userId, auth);
    }
    const a = auth;
    return runWithContext({ principal, requestId: 'seed' }, () => fn(a));
  }

  const deptRows = await db.select().from(departments);
  const dept = (code: string) => deptRows.find((d) => d.code === code)!;
  const leaderOf = (code: string) => dept(code).managerId!;
  const groupRows = await db.select().from(groups);
  const groupId = (key: string) => groupRows.find((g) => g.key === key)!.id;
  const activePeople = await db
    .select({
      id: users.id,
      departmentId: users.departmentId,
      managerId: users.managerId,
      locale: users.locale,
    })
    .from(users)
    .where(
      and(
        eq(users.status, 'active'),
        sql`${users.username} not in ('admin','helpdesk','hr.partner','auditor')`,
      ),
    );
  const leaders = new Set(deptRows.map((d) => d.managerId).filter(Boolean));
  const staff = activePeople.filter((p) => p.managerId && !leaders.has(p.id) && p.managerId !== admin.id);

  /* ───────────── custom fields ───────────── */

  const userFields: FieldDef[] = [
    {
      key: 'costCenter',
      type: 'text',
      label: t3('Cost center', '成本中心', 'コストセンター'),
      help: t3('Format CC-0000', '格式 CC-0000', '形式 CC-0000'),
      validation: { pattern: 'CC-\\d{4}' },
      width: 'half',
    },
    {
      key: 'employmentType',
      type: 'select',
      label: t3('Employment type', '聘僱類型', '雇用形態'),
      options: [
        { value: 'employee', label: t3('Employee', '正職員工', '正社員') },
        { value: 'contractor', label: t3('Contractor', '約聘人員', '契約社員') },
        { value: 'intern', label: t3('Intern', '實習生', 'インターン') },
      ],
      width: 'half',
    },
    {
      key: 'contractEnd',
      type: 'date',
      label: t3('Contract end date', '合約到期日', '契約終了日'),
      visibleWhen: { fact: 'employmentType', op: 'in', value: ['contractor', 'intern'] },
      width: 'half',
    },
    {
      key: 'office',
      type: 'select',
      label: t3('Office', '辦公室', 'オフィス'),
      options: [
        { value: 'tpe-hq', label: t3('Taipei HQ', '台北總部', '台北本社') },
        { value: 'hsinchu', label: t3('Hsinchu', '新竹', '新竹') },
        { value: 'tokyo', label: t3('Tokyo', '東京', '東京') },
        { value: 'london', label: t3('London', '倫敦', 'ロンドン') },
        { value: 'remote', label: t3('Remote', '遠端', 'リモート') },
      ],
      width: 'half',
    },
    {
      key: 'laptopTag',
      type: 'text',
      label: t3('Laptop asset tag', '筆電資產編號', 'PC 資産番号'),
      placeholder: t3('e.g. NB-10234', '例如 NB-10234', '例: NB-10234'),
      width: 'half',
    },
  ];
  const groupFields: FieldDef[] = [
    {
      key: 'owner',
      type: 'user',
      label: t3('Business owner', '業務負責人', 'ビジネスオーナー'),
      width: 'half',
    },
    {
      key: 'reviewCadence',
      type: 'select',
      label: t3('Access review cadence', '權限覆核週期', 'アクセスレビュー周期'),
      options: [
        { value: 'quarterly', label: t3('Quarterly', '每季', '四半期ごと') },
        { value: 'semiannual', label: t3('Every 6 months', '每半年', '半年ごと') },
        { value: 'annual', label: t3('Annually', '每年', '毎年') },
      ],
      width: 'half',
    },
  ];
  const deptFields: FieldDef[] = [
    {
      key: 'costCenter',
      type: 'text',
      label: t3('Cost center', '成本中心', 'コストセンター'),
      validation: { pattern: 'CC-\\d{4}' },
    },
    {
      key: 'headcountBudget',
      type: 'number',
      label: t3('Headcount budget', '編制人數', '人員予算'),
      validation: { min: 0, max: 5000 },
    },
  ];
  await as(admin.id, async (auth) => {
    const cf = new CustomFieldAdminService(ctx);
    for (const field of userFields) await cf.create({ entityType: 'core.user', field }, auth);
    for (const field of groupFields) await cf.create({ entityType: 'core.group', field }, auth);
    for (const field of deptFields) await cf.create({ entityType: 'core.department', field }, auth);
  });
  // Values: cost centers per department, employment types, offices by locale.
  const ccOf = new Map(deptRows.map((d, i) => [d.id, `CC-${String(1000 + i * 10).padStart(4, '0')}`]));
  for (const d of deptRows)
    await db
      .update(departments)
      .set({
        attributes: { costCenter: ccOf.get(d.id), headcountBudget: faker.number.int({ min: 4, max: 60 }) },
      })
      .where(eq(departments.id, d.id));
  const everyone = await db
    .select({
      id: users.id,
      departmentId: users.departmentId,
      locale: users.locale,
      timezone: users.timezone,
    })
    .from(users);
  for (const u of everyone) {
    const employmentType = faker.helpers.weightedArrayElement([
      { weight: 88, value: 'employee' },
      { weight: 9, value: 'contractor' },
      { weight: 3, value: 'intern' },
    ]);
    const office =
      u.locale === 'ja-JP'
        ? 'tokyo'
        : u.locale === 'zh-TW'
          ? faker.helpers.arrayElement(['tpe-hq', 'tpe-hq', 'hsinchu'])
          : u.timezone === 'Europe/London'
            ? 'london'
            : faker.helpers.arrayElement(['remote', 'london', 'tpe-hq']);
    await db
      .update(users)
      .set({
        attributes: {
          costCenter: u.departmentId ? ccOf.get(u.departmentId) : undefined,
          employmentType,
          ...(employmentType !== 'employee'
            ? { contractEnd: faker.date.soon({ days: 300 }).toISOString().slice(0, 10) }
            : {}),
          office,
          ...(faker.datatype.boolean(0.8)
            ? { laptopTag: `NB-${faker.number.int({ min: 10000, max: 19999 })}` }
            : {}),
        },
      })
      .where(eq(users.id, u.id));
  }
  for (const key of ['vpn-users', 'cab', 'security-team', 'finance-team'])
    await db
      .update(groups)
      .set({
        attributes: {
          owner: key === 'finance-team' ? leaderOf('FIN') : admin.id,
          reviewCadence: key === 'cab' ? 'annual' : 'quarterly',
        },
      })
      .where(eq(groups.key, key));

  /* ───────────── external applications ───────────── */

  const access = new AccessService(ctx);
  const appSvc = new ApplicationService(ctx, access);
  const appDefs = [
    {
      key: 'finance-erp',
      name: 'Finance ERP',
      description: 'Accounts payable, payments and vendor master data',
      homepageUrl: 'https://erp.isbp.example',
      ownerId: leaderOf('FIN'),
      permissions: [
        ['invoices.read', 'View invoices'],
        ['invoices.create', 'Enter supplier invoices'],
        ['invoices.approve', 'Approve invoices for payment'],
        ['payments.release', 'Release payment runs'],
        ['vendors.manage', 'Maintain vendor master data'],
        ['reports.export', 'Export financial reports'],
      ],
      roles: [
        {
          key: 'ap-clerk',
          name: 'AP clerk',
          permissions: ['invoices.read', 'invoices.create'],
          risk: 'low',
          requestable: true,
        },
        {
          key: 'ap-approver',
          name: 'AP approver',
          permissions: ['invoices.*', 'reports.export'],
          risk: 'medium',
          requestable: true,
          max: 365,
        },
        {
          key: 'treasurer',
          name: 'Treasurer',
          permissions: ['payments.release', 'invoices.read'],
          risk: 'high',
          requestable: true,
          max: 30,
        },
        {
          key: 'finance-auditor',
          name: 'Finance auditor',
          permissions: ['invoices.read', 'reports.export'],
          risk: 'low',
          requestable: false,
        },
      ],
    },
    {
      key: 'hr-portal',
      name: 'HR Portal',
      description: 'Employee records, leave and payroll',
      homepageUrl: 'https://hr.isbp.example',
      ownerId: hr.id,
      permissions: [
        ['employees.read', 'View employee records'],
        ['employees.update', 'Edit employee records'],
        ['leave.approve', 'Approve leave'],
        ['payroll.read', 'View payroll'],
        ['payroll.run', 'Run payroll'],
      ],
      roles: [
        {
          key: 'hr-viewer',
          name: 'HR viewer',
          permissions: ['employees.read'],
          risk: 'low',
          requestable: true,
          max: 90,
        },
        {
          key: 'hr-specialist',
          name: 'HR specialist',
          permissions: ['employees.*', 'leave.approve'],
          risk: 'medium',
          requestable: false,
        },
        {
          key: 'payroll-admin',
          name: 'Payroll administrator',
          permissions: ['payroll.*', 'employees.read'],
          risk: 'high',
          requestable: true,
          max: 14,
        },
      ],
    },
    {
      key: 'expense-app',
      name: 'Expense Claims',
      description: 'Travel and expense claims',
      homepageUrl: null,
      ownerId: leaderOf('FIN'),
      permissions: [
        ['claims.submit', 'Submit claims'],
        ['claims.approve', 'Approve claims of your team'],
        ['claims.audit', 'Audit all claims'],
      ],
      roles: [
        {
          key: 'claimant',
          name: 'Claimant',
          permissions: ['claims.submit'],
          risk: 'low',
          requestable: false,
        },
        {
          key: 'claims-approver',
          name: 'Claims approver',
          permissions: ['claims.submit', 'claims.approve'],
          risk: 'low',
          requestable: true,
        },
        {
          key: 'claims-auditor',
          name: 'Claims auditor',
          permissions: ['claims.*'],
          risk: 'medium',
          requestable: true,
          max: 180,
        },
      ],
    },
  ] as const;
  const appRoleIds = new Map<string, string>();
  await as(admin.id, async (auth) => {
    for (const def of appDefs) {
      const created = await appSvc.create(
        {
          key: def.key,
          name: def.name,
          description: def.description,
          homepageUrl: def.homepageUrl,
          ownerId: def.ownerId,
        },
        auth,
      );
      for (const [key, description] of def.permissions)
        await appSvc.addPermission(created.id, { key, description }, auth);
      for (const r of def.roles) {
        const role = await appSvc.createRole(
          created.id,
          { key: r.key, name: r.name, permissions: [...r.permissions] },
          auth,
        );
        appRoleIds.set(`${def.key}:${r.key}`, role.id);
        await access.updateRequestSettings(
          role.id,
          {
            requestable: r.requestable,
            riskLevel: r.risk,
            ownerId: def.ownerId,
            maxDurationDays: 'max' in r ? r.max : null,
            requestWorkflowId: null,
          },
          auth,
          { applicationId: created.id },
        );
      }
    }
  });
  const grantApp = async (
    appKey: string,
    roleKey: string,
    principal: { userId?: string; groupId?: string },
    opts: Partial<typeof roleAssignments.$inferInsert> = {},
  ) =>
    db
      .insert(roleAssignments)
      .values({
        roleId: appRoleIds.get(`${appKey}:${roleKey}`)!,
        userId: principal.userId ?? null,
        groupId: principal.groupId ?? null,
        grantedBy: admin.id,
        grantedAt: new Date(Date.now() - faker.number.int({ min: 5, max: 200 }) * 24 * HOUR),
        ...opts,
      })
      .onConflictDoNothing();
  await grantApp('finance-erp', 'ap-clerk', { groupId: groupId('finance-team') });
  await grantApp('finance-erp', 'ap-approver', { userId: leaderOf('FIN') });
  await grantApp('finance-erp', 'finance-auditor', { groupId: groupId('security-team') });
  await grantApp('hr-portal', 'hr-specialist', { groupId: groupId('hr-team') });
  await grantApp(
    'hr-portal',
    'hr-viewer',
    { userId: hr.id },
    { scopeType: 'department', scopeDepartmentId: dept('SALES').id },
  );
  await grantApp('expense-app', 'claimant', { groupId: groupId('everyone') });
  for (const d of deptRows.filter((x) => x.managerId))
    await grantApp('expense-app', 'claims-approver', { userId: d.managerId! });

  /* ───────────── requestable platform roles ───────────── */

  const platformRoles = await db
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .innerJoin(applications, eq(applications.id, roles.applicationId))
    .where(eq(applications.key, 'isbp'));
  const platformRole = (key: string) => platformRoles.find((r) => r.key === key)!.id;

  /* ───────────── workflows ───────────── */

  const wfAdmin = new WorkflowAdminService(ctx);
  const [defaultAccess] = await db
    .select()
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.key, `${ACCESS_REQUEST_TRIGGER}.default`));
  const securityTeamGraph: WorkflowGraph = {
    steps: defaultAccess!.draft.steps.map((s) =>
      s.id === 'security' && s.type === 'approval'
        ? {
            ...s,
            approvers: [
              {
                type: 'group',
                groupKey: 'security-team',
                fallback: { type: 'role', roleKey: 'platform-admin' },
              },
            ],
          }
        : s,
    ),
  };
  const privilegedGraph: WorkflowGraph = {
    steps: [
      {
        id: 'manager',
        type: 'approval',
        name: t3('Manager approval', '主管簽核', '上長の承認'),
        approvers: [{ type: 'manager' }],
        mode: 'any',
        ifNoApprover: 'skip',
        sla: {
          dueHours: 24,
          remindHours: 8,
          onBreach: 'escalate',
          escalateTo: [{ type: 'department-head' }],
        },
      },
      {
        id: 'reviews',
        type: 'parallel',
        name: t3('Security and owner review', '資安與擁有者審查', 'セキュリティとオーナーの審査'),
        branches: [
          {
            id: 'b_security',
            name: t3('Security', '資安', 'セキュリティ'),
            steps: [
              {
                id: 'security',
                type: 'approval',
                name: t3('Security team', '資安團隊', 'セキュリティチーム'),
                approvers: [
                  {
                    type: 'group',
                    groupKey: 'security-team',
                    fallback: { type: 'role', roleKey: 'platform-admin' },
                  },
                ],
                mode: 'any',
                sla: { dueHours: 48, remindHours: 24, onBreach: 'notify' },
                instructions: t3(
                  'Check the justification and that the period is as short as possible.',
                  '請確認申請理由，並確認使用期間已盡可能縮短。',
                  '申請理由を確認し、期間ができるだけ短いことを確認してください。',
                ),
              },
            ],
          },
          {
            id: 'b_owner',
            name: t3('Access owner', '權限擁有者', 'アクセス所有者'),
            steps: [
              {
                id: 'owner',
                type: 'approval',
                name: t3('Access owner approval', '權限擁有者簽核', 'アクセス所有者の承認'),
                approvers: [
                  {
                    type: 'fact',
                    fact: 'role.ownerId',
                    fallback: { type: 'role', roleKey: 'platform-admin' },
                  },
                ],
                mode: 'any',
              },
            ],
          },
        ],
      },
      {
        id: 'longer',
        type: 'condition',
        name: t3('Long-lived access?', '長期權限？', '長期のアクセス？'),
        branches: [
          {
            id: 'b_long',
            name: t3('More than 14 days', '超過 14 天', '14 日を超える'),
            when: {
              any: [
                { fact: 'request.permanent', op: 'eq', value: true },
                { fact: 'request.durationDays', op: 'gt', value: 14 },
              ],
            },
            steps: [
              {
                id: 'director',
                type: 'approval',
                name: t3('Director approval', '處長核准', '本部長の承認'),
                approvers: [
                  { type: 'manager', level: 2, fallback: { type: 'role', roleKey: 'platform-admin' } },
                ],
                mode: 'any',
              },
            ],
          },
        ],
        otherwise: { id: 'b_short', name: t3('Up to 14 days', '14 天以內', '14 日以内'), steps: [] },
      },
      {
        id: 'fyi',
        type: 'notify',
        name: t3('Tell the requester', '通知申請人', '申請者に通知'),
        recipients: [{ type: 'requester' }],
        message: t3(
          'All reviewers have approved your request.',
          '所有審核者都已核准您的申請。',
          'すべての審査者が申請を承認しました。',
        ),
      },
    ],
  };
  const equipmentGraph: WorkflowGraph = {
    steps: [
      {
        id: 'manager',
        type: 'approval',
        name: t3('Manager approval', '主管簽核', '上長の承認'),
        approvers: [{ type: 'manager' }],
        mode: 'any',
        ifNoApprover: 'skip',
        sla: {
          dueHours: 24,
          remindHours: 8,
          onBreach: 'escalate',
          escalateTo: [{ type: 'department-head' }],
        },
      },
      {
        id: 'cost',
        type: 'condition',
        name: t3('Cost check', '金額檢查', '金額チェック'),
        branches: [
          {
            id: 'b_expensive',
            name: t3('Over 45,000', '超過 45,000', '45,000 超'),
            when: { fact: 'data.estimatedCost', op: 'gt', value: 45_000 },
            steps: [
              {
                id: 'finance',
                type: 'approval',
                name: t3('Finance approval', '財務核准', '経理の承認'),
                approvers: [{ type: 'group', groupKey: 'finance-team' }],
                mode: 'any',
                sla: { dueHours: 48, onBreach: 'notify' },
              },
            ],
          },
        ],
        otherwise: { id: 'b_cheap', name: t3('Up to 1,500', '1,500 以內', '1,500 以下'), steps: [] },
      },
      {
        id: 'fyi',
        type: 'notify',
        name: t3('Tell the service desk', '通知服務台', 'サービス デスクに通知'),
        recipients: [{ type: 'group', groupKey: 'service-desk' }],
        message: t3(
          'Approved — please order and prepare the equipment.',
          '已核准，請採購並準備設備。',
          '承認済みです。機器を手配してください。',
        ),
      },
    ],
  };
  const softwareGraph: WorkflowGraph = {
    steps: [
      {
        id: 'manager',
        type: 'approval',
        name: t3('Manager approval', '主管簽核', '上長の承認'),
        approvers: [{ type: 'manager' }],
        mode: 'any',
        ifNoApprover: 'skip',
      },
      {
        id: 'security',
        type: 'approval',
        name: t3('Security review', '資安審查', 'セキュリティ審査'),
        when: { fact: 'data.dataClassification', op: 'in', value: ['confidential', 'restricted'] },
        approvers: [{ type: 'group', groupKey: 'security-team' }],
        mode: 'any',
      },
      {
        id: 'licensing',
        type: 'approval',
        name: t3('License purchase', '授權採購', 'ライセンス購入'),
        when: { fact: 'data.licenseType', op: 'neq', value: 'free' },
        approvers: [
          { type: 'group', groupKey: 'finance-team' },
          { type: 'group', groupKey: 'it-admins' },
        ],
        mode: 'all',
      },
    ],
  };
  const reviewGraph: WorkflowGraph = {
    steps: [
      {
        id: 'comms',
        type: 'approval',
        name: t3('Communications review', '溝通內容審查', '広報レビュー'),
        approvers: [{ type: 'group', groupKey: 'it-admins' }],
        mode: 'any',
        when: { fact: 'post.severity', op: 'neq', value: 'info' },
        sla: { dueHours: 4, onBreach: 'approve' },
      },
    ],
  };

  const wfIds: Record<string, string> = {};
  await as(admin.id, async (auth) => {
    await wfAdmin.update(defaultAccess!.id, { draft: securityTeamGraph }, auth);
    await wfAdmin.publish(defaultAccess!.id, auth);
    const mk = async (
      name: string,
      description: string,
      triggerKey: string,
      graph: WorkflowGraph,
      key: string,
    ) => {
      const d = await wfAdmin.create({ name, description, triggerKey, key }, auth);
      await wfAdmin.update(d.id, { draft: graph }, auth);
      await wfAdmin.publish(d.id, auth);
      wfIds[key] = d.id;
      return d.id;
    };
    await mk(
      'Privileged access',
      'Parallel security and owner review; director sign-off for long-lived access',
      ACCESS_REQUEST_TRIGGER,
      privilegedGraph,
      'privileged-access',
    );
    // The access-request default stays the manifest's workflow (its first publish made it the default).
    await mk(
      'Equipment purchase',
      'Manager, then finance above 1,500; the service desk is told',
      FORM_SUBMISSION_TRIGGER,
      equipmentGraph,
      'equipment-purchase',
    );
    await mk(
      'Software request',
      'Manager; security for sensitive data; finance and IS for paid licenses',
      FORM_SUBMISSION_TRIGGER,
      softwareGraph,
      'software-request',
    );
    const review = await mk(
      'Announcement review',
      'Maintenance and incident notices are checked before they go out',
      'announcements.publish',
      reviewGraph,
      'announcement-review',
    );
    // Optional trigger: keep publishing immediate until an admin opts in.
    await wfAdmin.clearDefault(review);
    // A draft that was never published, to show the builder's draft state.
    const draft = await wfAdmin.create(
      {
        name: 'Contractor onboarding (draft)',
        triggerKey: FORM_SUBMISSION_TRIGGER,
        key: 'contractor-onboarding',
      },
      auth,
    );
    await wfAdmin.update(draft.id, { draft: { steps: [equipmentGraph.steps[0]!] } }, auth);
  });

  // Requestable platform roles (with owners, risk, limits, one workflow override).
  await as(admin.id, async (auth) => {
    const settings: [string, 'low' | 'medium' | 'high', number | null, string | null, string | null][] = [
      ['announcements-editor', 'low', 180, admin.id, null],
      ['directory-lookup', 'low', null, helpdesk.id, null],
      ['security-auditor', 'medium', 90, auditor.id, null],
      ['module-admin', 'high', 30, admin.id, wfIds['privileged-access']!],
      ['workflow-admin', 'medium', 180, admin.id, null],
    ];
    for (const [key, riskLevel, maxDurationDays, ownerId, requestWorkflowId] of settings)
      await access.updateRequestSettings(
        platformRole(key),
        { requestable: true, riskLevel, maxDurationDays, ownerId, requestWorkflowId },
        auth,
      );
  });

  /* ───────────── forms ───────────── */

  const formsSvc = new FormService(ctx);
  const opt = (value: string, en: string, zh: string, ja: string) => ({ value, label: t3(en, zh, ja) });
  const equipment: FormSchema = {
    elements: [
      { id: 'h1', type: 'heading', text: t3('What do you need?', '您需要什麼？', '何が必要ですか？') },
      {
        id: 'f1',
        key: 'itemType',
        type: 'select',
        label: t3('Item', '品項', '品目'),
        required: true,
        options: [
          opt('laptop', 'Laptop', '筆記型電腦', 'ノート PC'),
          opt('monitor', 'Monitor', '螢幕', 'モニター'),
          opt('dock', 'Docking station', '擴充基座', 'ドッキングステーション'),
          opt('headset', 'Headset', '耳機麥克風', 'ヘッドセット'),
          opt('other', 'Something else', '其他', 'その他'),
        ],
        width: 'half',
      },
      {
        id: 'f2',
        key: 'laptopModel',
        type: 'select',
        label: t3('Laptop model', '筆電型號', 'PC モデル'),
        required: true,
        options: [
          opt('std14', 'Standard 14″', '標準 14 吋', 'スタンダード 14 インチ'),
          opt('perf16', 'Performance 16″', '高效能 16 吋', 'ハイパフォーマンス 16 インチ'),
          opt('mbp', 'MacBook Pro', 'MacBook Pro', 'MacBook Pro'),
        ],
        visibleWhen: { fact: 'itemType', op: 'eq', value: 'laptop' },
        width: 'half',
      },
      {
        id: 'f3',
        key: 'otherItem',
        type: 'text',
        label: t3('Describe the item', '請描述品項', '品目の説明'),
        required: true,
        visibleWhen: { fact: 'itemType', op: 'eq', value: 'other' },
      },
      {
        id: 'f4',
        key: 'quantity',
        type: 'number',
        label: t3('Quantity', '數量', '数量'),
        required: true,
        defaultValue: 1,
        validation: { min: 1, max: 20 },
        width: 'half',
      },
      {
        id: 'f5',
        key: 'estimatedCost',
        type: 'number',
        label: t3('Estimated cost (TWD)', '預估費用（新台幣）', '概算費用（TWD）'),
        help: t3(
          'Above 45,000 TWD, Finance approves too.',
          '超過 45,000 元需財務核准。',
          '45,000 TWD を超えると経理の承認も必要です。',
        ),
        validation: { min: 0, max: 1_500_000 },
        width: 'half',
      },
      {
        id: 'f6',
        key: 'neededBy',
        type: 'date',
        label: t3('Needed by', '需求日期', '必要日'),
        width: 'half',
      },
      {
        id: 'f7',
        key: 'deliverTo',
        type: 'select',
        label: t3('Deliver to', '送達地點', '配送先'),
        options: userFields[3]!.options!,
        width: 'half',
      },
      { id: 'd1', type: 'divider' },
      {
        id: 'f8',
        key: 'forSomeoneElse',
        type: 'boolean',
        label: t3('This is for someone else', '為他人申請', '他の人のための申請'),
      },
      {
        id: 'f9',
        key: 'recipient',
        type: 'user',
        label: t3('Who is it for?', '使用者是誰？', '誰のためですか？'),
        required: true,
        visibleWhen: { fact: 'forSomeoneElse', op: 'eq', value: true },
      },
      {
        id: 'f10',
        key: 'justification',
        type: 'textarea',
        label: t3('Business justification', '業務需求說明', '業務上の理由'),
        required: true,
        validation: { minLength: 10, maxLength: 2000 },
      },
    ],
  };
  const software: FormSchema = {
    elements: [
      {
        id: 'p1',
        type: 'paragraph',
        text: t3(
          'Check the approved software list first — listed tools can be installed from the self-service portal without a request.',
          '請先查看核准軟體清單，清單中的工具可直接從自助入口網站安裝，無需申請。',
          'まず承認済みソフトウェア一覧を確認してください。一覧にあるツールは申請なしでセルフサービスからインストールできます。',
        ),
      },
      {
        id: 's1',
        key: 'softwareName',
        type: 'text',
        label: t3('Software', '軟體名稱', 'ソフトウェア'),
        required: true,
        width: 'half',
      },
      {
        id: 's2',
        key: 'vendorUrl',
        type: 'url',
        label: t3('Vendor website', '廠商網站', 'ベンダーサイト'),
        width: 'half',
      },
      {
        id: 's3',
        key: 'licenseType',
        type: 'select',
        label: t3('License', '授權方式', 'ライセンス'),
        required: true,
        options: [
          opt('free', 'Free / open source', '免費／開源', '無料／OSS'),
          opt('subscription', 'Subscription', '訂閱制', 'サブスクリプション'),
          opt('perpetual', 'Perpetual', '永久授權', '買い切り'),
        ],
        width: 'half',
      },
      {
        id: 's4',
        key: 'seats',
        type: 'number',
        label: t3('Number of users', '使用人數', '利用者数'),
        validation: { min: 1, max: 10000 },
        defaultValue: 1,
        width: 'half',
      },
      {
        id: 's5',
        key: 'dataClassification',
        type: 'select',
        label: t3(
          'Most sensitive data it will touch',
          '將處理的最高敏感等級資料',
          '扱う最も機密性の高いデータ',
        ),
        required: true,
        options: [
          opt('public', 'Public', '公開', '公開'),
          opt('internal', 'Internal', '內部', '社内'),
          opt('confidential', 'Confidential', '機密', '機密'),
          opt('restricted', 'Restricted', '極機密', '極秘'),
        ],
      },
      {
        id: 's6',
        key: 'platforms',
        type: 'multiselect',
        label: t3('Platforms', '作業平台', 'プラットフォーム'),
        options: [
          opt('windows', 'Windows', 'Windows', 'Windows'),
          opt('macos', 'macOS', 'macOS', 'macOS'),
          opt('web', 'Web', '網頁', 'Web'),
        ],
      },
      {
        id: 's7',
        key: 'purpose',
        type: 'textarea',
        label: t3('What will you use it for?', '用途說明', '用途'),
        required: true,
        validation: { minLength: 10 },
      },
    ],
  };
  const lostDevice: FormSchema = {
    elements: [
      {
        id: 'l0',
        type: 'paragraph',
        text: t3(
          'Report as soon as possible — the service desk will lock the device and revoke its sessions.',
          '請盡快通報，服務台將鎖定裝置並撤銷其工作階段。',
          'できるだけ早く報告してください。サービス デスクが端末をロックしセッションを無効化します。',
        ),
      },
      {
        id: 'l1',
        key: 'deviceType',
        type: 'select',
        label: t3('Device', '裝置', '端末'),
        required: true,
        options: [
          opt('laptop', 'Laptop', '筆記型電腦', 'ノート PC'),
          opt('phone', 'Phone', '手機', 'スマートフォン'),
          opt('token', 'Security key', '安全金鑰', 'セキュリティキー'),
        ],
        width: 'half',
      },
      {
        id: 'l2',
        key: 'assetTag',
        type: 'text',
        label: t3('Asset tag', '資產編號', '資産番号'),
        width: 'half',
      },
      {
        id: 'l3',
        key: 'lostOn',
        type: 'date',
        label: t3('When', '日期', '日付'),
        required: true,
        width: 'half',
      },
      { id: 'l4', key: 'stolen', type: 'boolean', label: t3('It was stolen', '遭竊', '盗難') },
      {
        id: 'l5',
        key: 'policeReport',
        type: 'text',
        label: t3('Police report number', '報案編號', '警察の受理番号'),
        visibleWhen: { fact: 'stolen', op: 'eq', value: true },
      },
      {
        id: 'l6',
        key: 'details',
        type: 'textarea',
        label: t3('What happened?', '發生經過', '状況'),
        required: true,
      },
    ],
  };
  await as(admin.id, async (auth) => {
    const mk = async (
      key: string,
      name: ReturnType<typeof t3>,
      description: ReturnType<typeof t3>,
      icon: string,
      category: string,
      schema: FormSchema,
      workflowDefinitionId: string | null,
    ) => {
      const f = await formsSvc.create({ key, name, description, icon, category }, auth);
      await formsSvc.update(f.id, { draft: schema, workflowDefinitionId }, auth);
      await formsSvc.publish(f.id, auth);
    };
    await mk(
      'equipment-request',
      t3('Request a laptop or equipment', '申請筆電或設備', 'PC・機器の申請'),
      t3(
        'Laptops, monitors, docks and headsets',
        '筆電、螢幕、擴充基座與耳機',
        'ノート PC、モニター、ドック、ヘッドセット',
      ),
      'laptop',
      'hardware',
      equipment,
      wfIds['equipment-purchase']!,
    );
    await mk(
      'software-request',
      t3('Request new software', '申請新軟體', '新しいソフトウェアの申請'),
      t3(
        'Tools and licenses not on the approved list',
        '未列入核准清單的工具與授權',
        '承認リストにないツールとライセンス',
      ),
      'app-window',
      'software',
      software,
      wfIds['software-request']!,
    );
    await mk(
      'lost-device',
      t3('Report a lost or stolen device', '通報遺失或遭竊裝置', '紛失・盗難の報告'),
      t3(
        'Laptops, phones and security keys',
        '筆電、手機與安全金鑰',
        'ノート PC、スマートフォン、セキュリティキー',
      ),
      'shield-alert',
      'security',
      lostDevice,
      null,
    );
  });

  /* ───────────── requests in every state (through the engine) ───────────── */

  await kernel.rbac.bump();
  authCache.clear();
  const accessSvc = new AccessRequestService(ctx);
  const approvals = new ApprovalService(ctx);

  /** Decides pending tasks as their assignees until the instance completes (or `stopAfter` decisions). */
  async function drive(
    instanceId: string,
    choose: (stepId: string) => 'approve' | 'reject' = () => 'approve',
    stopAfter = 20,
  ) {
    for (let i = 0; i < stopAfter; i++) {
      const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId));
      if (!inst || inst.status !== 'running') return inst?.status;
      const [task] = await db
        .select()
        .from(approvalTasks)
        .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')))
        .orderBy(approvalTasks.createdAt)
        .limit(1);
      if (!task) return inst.status;
      const decision = choose(task.stepId);
      await as(task.assigneeId, (auth) =>
        approvals.decide(
          task.id,
          decision,
          decision === 'reject'
            ? faker.helpers.arrayElement([
                'Please use the shared reporting role instead.',
                'Not needed for your current projects — ask again when the rollout starts.',
                'Too broad: request the clerk role first.',
              ])
            : (faker.helpers.maybe(() => 'Looks good.', { probability: 0.4 }) ?? null),
          auth,
        ),
      );
    }
    const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId));
    return inst?.status;
  }

  async function complete(instanceId: string, kind: 'access' | 'form') {
    const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId));
    if (!inst || inst.status === 'running') return;
    const result = {
      instanceId,
      triggerKey: inst.triggerKey,
      subjectType: inst.subjectType,
      subjectId: inst.subjectId,
      outcome: inst.status,
      requesterId: inst.requesterId,
      comment: inst.outcomeComment,
    };
    if (kind === 'access') await accessSvc.onWorkflowCompleted(result);
    else await formsSvc.onWorkflowCompleted(result);
  }

  /** Moves a whole request (and its workflow, tasks, timeline, notifications) into the past. */
  async function backdate(kind: 'access' | 'form', id: string, hours: number) {
    const shift = sql`make_interval(hours => ${hours})`;
    const table = kind === 'access' ? accessRequests : formSubmissions;
    const [row] = await db.select({ inst: table.workflowInstanceId }).from(table).where(eq(table.id, id));
    if (kind === 'access')
      await db.execute(sql`update core.access_requests set created_at = created_at - ${shift}, updated_at = updated_at - ${shift},
        decided_at = decided_at - ${shift}, expires_at = expires_at - ${shift} where id = ${id}`);
    else
      await db.execute(sql`update core.form_submissions set created_at = created_at - ${shift}, updated_at = updated_at - ${shift},
        completed_at = completed_at - ${shift} where id = ${id}`);
    if (!row?.inst) return;
    await db.execute(
      sql`update core.workflow_instances set started_at = started_at - ${shift}, completed_at = completed_at - ${shift} where id = ${row.inst}`,
    );
    await db.execute(sql`update core.approval_tasks set created_at = created_at - ${shift}, decided_at = decided_at - ${shift},
      due_at = due_at - ${shift}, remind_at = remind_at - ${shift} where instance_id = ${row.inst}`);
    await db.execute(
      sql`update core.workflow_events set created_at = created_at - ${shift} where instance_id = ${row.inst}`,
    );
    await db.execute(
      sql`update core.notifications set created_at = created_at - ${shift} where data->>'instanceId' = ${row.inst}`,
    );
  }

  const request = async (
    who: string,
    roleId: string,
    opts: { durationDays?: number | null; justification?: string; for?: string } = {},
  ) =>
    as(who, (auth) =>
      accessSvc.create(
        {
          roleId,
          beneficiaryId: opts.for ?? null,
          scopeType: 'global',
          durationDays: opts.durationDays ?? null,
          justification:
            opts.justification ??
            faker.helpers.arrayElement([
              'Needed for the quarter-end close and the audit preparation.',
              'Taking over the duties of a colleague on parental leave.',
              'Required for the new vendor onboarding project.',
              'Joining the incident response rota from next month.',
            ]),
        },
        auth,
      ),
    );

  // Waiting for the admin (their manager): the demo accounts' requests.
  const r1 = await request(helpdesk.id, platformRole('announcements-editor'), {
    durationDays: 90,
    justification: 'I publish the service desk maintenance notices for the APAC region.',
  });
  await backdate('access', r1.id, 20);
  const r2 = await request(hr.id, appRoleIds.get('finance-erp:ap-clerk')!, {
    durationDays: 60,
    justification: 'Checking supplier invoices for the HR contractor payments.',
  });
  await backdate('access', r2.id, 3);
  // High risk with the privileged workflow: parallel security + owner review.
  const r3 = await request(auditor.id, platformRole('module-admin'), {
    durationDays: 7,
    justification: 'Read the module configuration during the Q4 access review.',
  });
  await backdate('access', r3.id, 30);
  if (r3.workflow) await drive(r3.workflow.id, () => 'approve', 1); // manager (admin) approved, reviews running

  // Completed requests from across the organisation.
  const pool = faker.helpers.shuffle(staff).slice(0, 16);
  const choices = [
    platformRole('announcements-editor'),
    appRoleIds.get('finance-erp:ap-clerk')!,
    appRoleIds.get('hr-portal:hr-viewer')!,
    appRoleIds.get('expense-app:claims-approver')!,
    appRoleIds.get('finance-erp:ap-approver')!,
    platformRole('directory-lookup'),
  ];
  for (const [i, p] of pool.entries()) {
    const roleId = choices[i % choices.length]!;
    const [role] = await db.select({ max: roles.maxDurationDays }).from(roles).where(eq(roles.id, roleId));
    const durationDays = role?.max
      ? Math.min(role.max, faker.helpers.arrayElement([14, 30, 60, 90]))
      : faker.helpers.arrayElement([null, 30, 90]);
    try {
      const r = await request(p.id, roleId, { durationDays });
      if (!r.workflow) continue;
      const outcome = i % 7 === 3 ? 'reject' : 'approve';
      if (i % 5 === 4) {
        // Leave a few waiting with their managers (overdue ones show the SLA badge).
        await backdate('access', r.id, faker.number.int({ min: 2, max: 60 }));
        continue;
      }
      await drive(r.workflow.id, (step) =>
        step === 'manager' || outcome === 'approve' ? 'approve' : 'reject',
      );
      await complete(r.workflow.id, 'access');
      await backdate('access', r.id, faker.number.int({ min: 24, max: 24 * 13 }));
    } catch (err) {
      log.warn({ err }, 'seed: skipped one access request');
    }
  }
  // One withdrawn by the requester.
  const withdrawn = await request(pool[0]!.id, appRoleIds.get('hr-portal:payroll-admin')!, {
    durationDays: 7,
  });
  await as(pool[0]!.id, (auth) =>
    accessSvc.cancel(withdrawn.id, 'Not needed any more — payroll moved to next month.', auth),
  );
  await backdate('access', withdrawn.id, 50);

  // Form submissions.
  const submit = (who: string, key: string, data: Record<string, unknown>) =>
    as(who, (auth) => formsSvc.submit(key, data, auth));
  const s1 = await submit(helpdesk.id, 'equipment-request', {
    itemType: 'laptop',
    laptopModel: 'perf16',
    quantity: 1,
    estimatedCost: 66_000,
    neededBy: new Date(Date.now() + 14 * 24 * HOUR).toISOString().slice(0, 10),
    deliverTo: 'tpe-hq',
    forSomeoneElse: false,
    justification: 'My current laptop cannot run the new remote-support tooling (4 years old, 8 GB RAM).',
  });
  await backdate('form', s1.id, 5);
  for (const [i, p] of faker.helpers.shuffle(staff).slice(0, 8).entries()) {
    const isEquipment = i % 2 === 0;
    const data = isEquipment
      ? {
          itemType: faker.helpers.arrayElement(['monitor', 'dock', 'headset', 'laptop']),
          laptopModel: 'std14',
          quantity: faker.number.int({ min: 1, max: 3 }),
          estimatedCost: faker.helpers.arrayElement([5_400, 7_800, 28_500, 56_700]),
          deliverTo: 'tpe-hq',
          justification: 'Second screen for the new hybrid desk setup.',
        }
      : {
          softwareName: faker.helpers.arrayElement([
            'Figma',
            'JetBrains IntelliJ IDEA',
            'Postman',
            'draw.io',
            'Tableau',
          ]),
          licenseType: faker.helpers.arrayElement(['free', 'subscription']),
          seats: faker.number.int({ min: 1, max: 5 }),
          dataClassification: faker.helpers.arrayElement(['internal', 'confidential']),
          platforms: ['windows'],
          purpose: 'Designing and testing the new self-service portal integrations.',
        };
    try {
      const s = await submit(p.id, isEquipment ? 'equipment-request' : 'software-request', data);
      if (s.workflow && i !== 5) {
        await drive(s.workflow.id, () => (i === 3 ? 'reject' : 'approve'));
        await complete(s.workflow.id, 'form');
      }
      await backdate('form', s.id, faker.number.int({ min: 6, max: 24 * 12 }));
    } catch (err) {
      log.warn({ err }, 'seed: skipped one form submission');
    }
  }
  const lost = await submit(staff[0]!.id, 'lost-device', {
    deviceType: 'phone',
    lostOn: new Date(Date.now() - 2 * 24 * HOUR).toISOString().slice(0, 10),
    stolen: true,
    policeReport: 'TPE-2026-118842',
    details: 'Left in a taxi after the customer visit; the taxi company could not find it.',
  });
  await backdate('form', lost.id, 40);

  // The admin has read the older notifications.
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.userId, admin.id), sql`${notifications.createdAt} < now() - interval '2 days'`),
    );

  /* ───────────── delegation, channels, API client ───────────── */

  await as(hr.id, (auth) =>
    approvals.createDelegation(auth.user!.id, {
      delegateId: helpdesk.id,
      startsAt: new Date(Date.now() + 7 * 24 * HOUR),
      endsAt: new Date(Date.now() + 14 * 24 * HOUR),
      reason: 'Annual leave',
    }),
  );
  const box = kernel.box;
  await db.insert(notificationChannels).values([
    {
      name: 'IS Operations (Microsoft Teams)',
      type: 'teams',
      enabled: false,
      host: 'example.com',
      locale: 'en',
      types: ['core.access-request.*', 'announcements.post.published'],
      secrets: box.encryptJson({ url: 'https://example.com/teams-webhook-placeholder' }),
      createdBy: admin.id,
    },
    {
      name: '#is-approvals (Slack)',
      type: 'slack',
      enabled: false,
      host: 'example.com',
      locale: 'zh-TW',
      types: ['core.approval.escalated', 'core.approval.overdue'],
      secrets: box.encryptJson({ url: 'https://example.com/slack-webhook-placeholder' }),
      createdBy: admin.id,
    },
  ]);
  const [financeErp] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.key, 'finance-erp'));
  const created = await as(admin.id, (auth) =>
    new ApiClientService(ctx).create(
      {
        name: 'Finance ERP role sync',
        description: 'Reads who may approve invoices and release payments',
        applicationIds: [financeErp!.id],
        allApplications: false,
        permissions: [],
        allowedCidrs: [],
        secretExpiresInDays: 365,
      },
      auth,
    ),
  );

  const sec = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId('security-team')));
  const pendingTasks = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(approvalTasks)
    .where(and(eq(approvalTasks.status, 'pending'), isNotNull(approvalTasks.assigneeId)));
  const grants = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(roleAssignments)
    .where(inArray(roleAssignments.source, ['request']));
  log.info(
    { securityTeam: sec[0]?.n, pendingTasks: pendingTasks[0]?.n, grantedByRequest: grants[0]?.n },
    'phase 1 demo data created',
  );
  return { apiClient: created.client.clientId, apiKey: created.secret };
}
