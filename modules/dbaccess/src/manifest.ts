import { defineManifest, type WorkflowGraph } from '@isbp/sdk';
import { z } from 'zod';
import {
  aiListMyAccessInput,
  aiRequestAccessInput,
  endReasonSchema,
  environmentSchema,
  riskSchema,
  syncTaskConfigSchema,
} from './contracts';

export const PERMISSIONS = {
  request: 'dbaccess.self.request',
  servers: 'dbaccess.servers.manage',
  grantsRead: 'dbaccess.grants.read',
  grantsManage: 'dbaccess.grants.manage',
  reviewsRead: 'dbaccess.reviews.read',
  reviewsManage: 'dbaccess.reviews.manage',
} as const;

export const REQUEST_TRIGGER = 'dbaccess.request';

/** Facts the request workflow decides on (`role.risk`, `role.approverIds`, …). */
export const requestFactsSchema = z.object({
  role: z.object({
    risk: riskSchema,
    approverIds: z
      .array(z.uuid())
      .describe('The role owner, or the members of the owning group (any one of them approves)'),
    environment: environmentSchema.describe("The server's environment"),
    permanent: z.boolean().describe('No end date was requested'),
    days: z.number().int().describe('Requested duration in days (0 when permanent)'),
  }),
});
export type RequestFacts = z.infer<typeof requestFactsSchema>;

/**
 * Request approval: the requester's manager, then the role owner (a person, or any member of the owning
 * group), then information security for high-risk roles.
 */
const requestGraph: WorkflowGraph = {
  steps: [
    {
      id: 'manager',
      type: 'approval',
      name: { en: 'Manager approval', 'zh-TW': '主管核准', 'ja-JP': '上長の承認' },
      approvers: [{ type: 'manager' }],
      mode: 'any',
      ifNoApprover: 'skip',
      sla: { dueHours: 48, remindHours: 24, onBreach: 'notify' },
    },
    {
      id: 'owner',
      type: 'approval',
      name: { en: 'Role owner approval', 'zh-TW': '角色擁有者核准', 'ja-JP': 'ロール所有者の承認' },
      approvers: [
        { type: 'fact', fact: 'role.approverIds', fallback: { type: 'role', roleKey: 'dbaccess-dba' } },
      ],
      mode: 'any',
      sla: { dueHours: 48, remindHours: 24, onBreach: 'notify' },
      instructions: {
        en: 'Check that the person needs this database role for their work, for the requested period.',
        'zh-TW': '請確認此人在申請期間內確實需要此資料庫角色才能完成工作。',
        'ja-JP':
          'この人が申請期間中、業務のためにこのデータベース ロールを必要としていることを確認してください。',
      },
    },
    {
      id: 'security',
      type: 'approval',
      name: {
        en: 'Information security approval',
        'zh-TW': '資訊安全核准',
        'ja-JP': '情報セキュリティの承認',
      },
      when: { fact: 'role.risk', op: 'eq', value: 'high' },
      approvers: [
        {
          type: 'group',
          groupKey: 'security-team',
          fallback: { type: 'role', roleKey: 'dbaccess-review-manager' },
        },
      ],
      mode: 'any',
      sla: { dueHours: 72, remindHours: 48, onBreach: 'notify' },
      instructions: {
        en: 'High-risk role: confirm the business need and that the duration is as short as possible.',
        'zh-TW': '高風險角色：請確認業務需求，且期限盡可能縮短。',
        'ja-JP': '高リスクのロールです。業務上の必要性と、期間ができるだけ短いことを確認してください。',
      },
    },
  ],
};

const grantRef = z.object({
  grantId: z.uuid(),
  userId: z.uuid().nullable(),
  serverId: z.uuid(),
  roleId: z.uuid(),
  accountName: z.string().nullable(),
});
const requestRef = z.object({
  requestId: z.uuid(),
  reference: z.string(),
  userId: z.uuid().nullable(),
  roleId: z.uuid(),
});

/**
 * Database access: self-service requests for database roles on SQL Server, Oracle and PostgreSQL, approval,
 * automated provisioning with a one-time credential reveal, time-bound access, access reviews and drift.
 */
export const manifest = defineManifest({
  id: 'dbaccess',
  version: '0.1.0',
  name: 'dbaccess.meta.name',
  description: 'dbaccess.meta.description',
  icon: 'database',
  dependsOn: [],
  navigation: [
    {
      id: 'mine',
      label: 'dbaccess.nav.mine',
      href: '/dbaccess',
      icon: 'database',
      permission: PERMISSIONS.request,
      section: 'main',
      group: 'dbaccess.nav.group',
      order: 64,
    },
    {
      id: 'grants',
      label: 'dbaccess.nav.grants',
      href: '/dbaccess/grants',
      icon: 'key-round',
      permission: PERMISSIONS.grantsRead,
      section: 'main',
      group: 'dbaccess.nav.group',
      order: 65,
    },
    {
      id: 'reviews',
      label: 'dbaccess.nav.reviews',
      href: '/dbaccess/reviews',
      icon: 'clipboard-check',
      permission: PERMISSIONS.request,
      section: 'main',
      group: 'dbaccess.nav.group',
      order: 66,
    },
    {
      id: 'servers',
      label: 'dbaccess.nav.servers',
      href: '/dbaccess/servers',
      icon: 'server-cog',
      permission: PERMISSIONS.servers,
      section: 'main',
      group: 'dbaccess.nav.group',
      order: 67,
    },
  ],
  permissions: [
    { key: PERMISSIONS.request, description: 'dbaccess.permissions.selfRequest' },
    { key: PERMISSIONS.servers, description: 'dbaccess.permissions.serversManage' },
    { key: PERMISSIONS.grantsRead, description: 'dbaccess.permissions.grantsRead' },
    { key: PERMISSIONS.grantsManage, description: 'dbaccess.permissions.grantsManage' },
    { key: PERMISSIONS.reviewsRead, description: 'dbaccess.permissions.reviewsRead' },
    { key: PERMISSIONS.reviewsManage, description: 'dbaccess.permissions.reviewsManage' },
  ],
  roles: [
    {
      key: 'dbaccess-requester',
      name: 'Database access requester',
      description:
        'Request database roles and manage your own database access (granted to everyone by default)',
      permissions: [PERMISSIONS.request],
      grantByDefault: true,
    },
    {
      key: 'dbaccess-dba',
      name: 'Database access administrator',
      description:
        'Configure servers and requestable roles, run inventory syncs, see all access, revoke, adopt unmanaged access and retry provisioning',
      permissions: [PERMISSIONS.servers, PERMISSIONS.grantsRead, PERMISSIONS.grantsManage],
    },
    {
      key: 'dbaccess-auditor',
      name: 'Database access auditor',
      description: 'See all database access, accounts, drift and access reviews',
      permissions: [PERMISSIONS.grantsRead, PERMISSIONS.reviewsRead],
    },
    {
      key: 'dbaccess-review-manager',
      name: 'Database access review manager',
      description: 'Run access review campaigns: start, follow up, close and export them',
      permissions: [PERMISSIONS.reviewsManage, PERMISSIONS.reviewsRead, PERMISSIONS.grantsRead],
    },
  ],
  events: {
    emits: [
      { name: 'dbaccess.request.submitted', schema: requestRef.extend({ risk: riskSchema }) },
      { name: 'dbaccess.request.approved', schema: requestRef },
      { name: 'dbaccess.request.rejected', schema: requestRef },
      { name: 'dbaccess.request.cancelled', schema: requestRef },
      {
        name: 'dbaccess.grant.provisioned',
        description: 'The account holds the role on the server (verified)',
        schema: grantRef.extend({ expiresAt: z.string().nullable() }),
      },
      { name: 'dbaccess.grant.extended', schema: grantRef.extend({ expiresAt: z.string().nullable() }) },
      { name: 'dbaccess.grant.adopted', schema: grantRef },
      {
        name: 'dbaccess.grant.revoked',
        description: 'The role was removed from the account (expiry, early revocation, review, offboarding)',
        schema: grantRef.extend({ reason: endReasonSchema }),
      },
      {
        name: 'dbaccess.grant.failed',
        schema: grantRef.extend({ operation: z.enum(['grant', 'revoke']), error: z.string() }),
      },
      {
        name: 'dbaccess.account.created',
        schema: z.object({
          accountId: z.uuid(),
          serverId: z.uuid(),
          userId: z.uuid().nullable(),
          name: z.string(),
        }),
      },
      {
        name: 'dbaccess.account.disabled',
        schema: z.object({
          accountId: z.uuid(),
          serverId: z.uuid(),
          userId: z.uuid().nullable(),
          name: z.string(),
        }),
      },
      {
        name: 'dbaccess.server.synced',
        schema: z.object({
          serverId: z.uuid(),
          accounts: z.number(),
          roles: z.number(),
          memberships: z.number(),
          unmanaged: z.number(),
        }),
      },
      { name: 'dbaccess.review.started', schema: z.object({ reviewId: z.uuid(), items: z.number() }) },
      {
        name: 'dbaccess.review.closed',
        schema: z.object({ reviewId: z.uuid(), kept: z.number(), revoked: z.number() }),
      },
    ],
    consumes: ['core.user.offboarded'],
  },
  settings: [
    {
      key: 'provisioning.retrySeconds',
      label: 'dbaccess.settings.retrySeconds',
      description: 'dbaccess.settings.retrySecondsHelp',
      type: 'number',
      default: 30,
      advanced: true,
    },
  ],
  ai: {
    tools: [
      {
        name: 'dbaccess.list_my_access',
        description:
          "List the caller's database access: roles on SQL Server, Oracle and PostgreSQL servers with the account name, status (provisioning, active, expiring, failed…) and end date, plus open access requests. Use it to answer 'which databases can I use?' or 'when does my access end?'.",
        input: aiListMyAccessInput,
        permission: PERMISSIONS.request,
      },
      {
        name: 'dbaccess.request_access',
        description:
          'Request a database role for the caller (it goes to approval: manager, role owner and, for high-risk roles, information security). Give the role (name or id), an optional end date within the role maximum, and a justification. Returns the request reference.',
        input: aiRequestAccessInput,
        permission: PERMISSIONS.request,
        destructive: true,
      },
    ],
  },
  portal: {
    entries: [
      {
        id: 'request-database-access',
        label: 'dbaccess.portal.request',
        description: 'dbaccess.portal.requestDescription',
        icon: 'database',
        href: '/dbaccess/request',
        permission: PERMISSIONS.request,
        order: 40,
      },
    ],
  },
  workflows: [
    {
      key: REQUEST_TRIGGER,
      name: 'dbaccess.workflows.request.name',
      description: 'dbaccess.workflows.request.description',
      subject: 'request',
      facts: requestFactsSchema,
      required: true,
      defaultGraph: requestGraph,
    },
  ],
  notifications: [
    { type: 'dbaccess.request.approved', defaultChannels: ['inApp', 'email'] },
    { type: 'dbaccess.request.rejected', defaultChannels: ['inApp', 'email'] },
    { type: 'dbaccess.grant.ready', defaultChannels: ['inApp', 'email'] },
    { type: 'dbaccess.grant.expiring', defaultChannels: ['inApp', 'email'] },
    { type: 'dbaccess.grant.revoked', defaultChannels: ['inApp', 'email'] },
    { type: 'dbaccess.provisioning.failed', defaultChannels: ['inApp', 'email'] },
    { type: 'dbaccess.review.assigned', defaultChannels: ['inApp', 'email'] },
    { type: 'dbaccess.review.reminder', defaultChannels: ['inApp', 'email'] },
  ],
  taskTypes: [
    {
      type: 'sync',
      name: 'dbaccess.taskTypes.sync.name',
      description: 'dbaccess.taskTypes.sync.description',
      icon: 'refresh-cw',
      permission: PERMISSIONS.servers,
      config: syncTaskConfigSchema,
    },
  ],
});
