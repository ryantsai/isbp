import { assignFormTaskConfigSchema } from '@isbp/contracts';
import { defineManifest, type WorkflowGraph } from '@isbp/sdk';
import { z } from 'zod';
import { DEFAULT_BLOCKED_EXTENSIONS } from '../kernel/files/policy';

const recordRef = z.object({ type: z.string(), id: z.string() });
const userRef = z.object({ userId: z.uuid(), email: z.string() });
const requestRef = z.object({
  requestId: z.uuid(),
  number: z.number(),
  roleId: z.uuid(),
  beneficiaryId: z.uuid(),
});
const submissionRef = z.object({ submissionId: z.uuid(), number: z.number(), formId: z.uuid() });
const assignmentRef = z.object({
  assignmentId: z.uuid(),
  formId: z.uuid(),
  periodKey: z.string().nullable().describe('The period it covers, e.g. 2026-10'),
});
const processActionRunRef = z.object({
  runId: z.uuid(),
  submissionId: z.uuid(),
  type: z.string(),
  actionId: z.string(),
});

/** Facts every access-request workflow can use in conditions and "approver from fact" rules. */
export const accessRequestFacts = z.object({
  role: z.object({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    riskLevel: z.enum(['low', 'medium', 'high']),
    ownerId: z.uuid().nullable(),
    application: z.string().describe('Application key, e.g. isbp'),
  }),
  request: z.object({
    durationDays: z.number().int().nullable(),
    permanent: z.boolean(),
    scopeType: z.enum(['global', 'department', 'record']),
    forSomeoneElse: z.boolean(),
  }),
});

export const formSubmissionFacts = z.object({
  form: z.object({ key: z.string(), category: z.string().nullable() }),
  data: z.record(z.string(), z.unknown()).describe('Submitted values by field key, e.g. data.amount'),
  records: z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .describe(
      'Facts of the records picked in record fields, by field key, e.g. records.ci.criticality (a list per fact for multi-pick fields)',
    ),
});

const requestFact = (key: string) => `core.recordFacts.${key}`;

/**
 * Approval facts of a request (`core.request`), when a record field picks one (e.g. "the request this follows up").
 * Statuses read `workflows.status.request.<status>`; the department is the requester's current one.
 */
export const requestFactsSchema = z.object({
  formKey: z.string().meta({ label: requestFact('formKey') }),
  status: z
    .enum(['submitted', 'pending', 'approved', 'rejected', 'cancelled'])
    .meta({ label: requestFact('status'), valueLabels: 'workflows.status.request' }),
  requesterId: z
    .uuid()
    .nullable()
    .meta({ label: requestFact('requesterId'), ref: 'user' }),
  departmentCode: z
    .string()
    .nullable()
    .meta({ label: requestFact('departmentCode') }),
});
export type RequestFacts = z.output<typeof requestFactsSchema>;

/**
 * Manager → (high-risk only) security review → access owner (or IAM, or platform admins). Installed
 * once as a published, editable definition.
 */
const accessRequestGraph: WorkflowGraph = {
  steps: [
    {
      id: 'manager',
      type: 'approval',
      name: { en: 'Manager approval', 'zh-TW': '主管簽核', 'ja-JP': '上長の承認' },
      approvers: [{ type: 'manager' }],
      mode: 'any',
      ifNoApprover: 'skip',
      sla: {
        dueHours: 48,
        remindHours: 24,
        onBreach: 'escalate',
        escalateTo: [{ type: 'manager', level: 2 }],
      },
    },
    {
      id: 'security',
      type: 'approval',
      name: { en: 'Security review', 'zh-TW': '資安審查', 'ja-JP': 'セキュリティ審査' },
      when: { fact: 'role.riskLevel', op: 'eq', value: 'high' },
      approvers: [{ type: 'role', roleKey: 'platform-admin' }],
      mode: 'any',
      sla: { dueHours: 72, remindHours: 48, onBreach: 'notify' },
    },
    {
      id: 'owner',
      type: 'approval',
      name: { en: 'Access owner approval', 'zh-TW': '權限擁有者簽核', 'ja-JP': 'アクセス所有者の承認' },
      approvers: [
        {
          type: 'fact',
          fact: 'role.ownerId',
          fallback: {
            type: 'role',
            roleKey: 'identity-admin',
            fallback: { type: 'role', roleKey: 'platform-admin' },
          },
        },
      ],
      mode: 'any',
      sla: { dueHours: 72, remindHours: 48, onBreach: 'notify' },
    },
  ],
};

/**
 * The platform's own module. It is declared exactly like any other module; the only privilege it has
 * is `system: true` (cannot be disabled) and being mounted at `/api/v1`.
 */
export const coreManifest = defineManifest({
  id: 'core',
  version: '0.1.0',
  name: 'core.meta.name',
  description: 'core.meta.description',
  icon: 'layout-dashboard',
  system: true,
  navigation: [
    {
      id: 'dashboard',
      label: 'core.nav.dashboard',
      href: '/',
      icon: 'layout-dashboard',
      section: 'main',
      order: 0,
    },
    {
      id: 'approvals',
      label: 'core.nav.approvals',
      href: '/approvals',
      icon: 'list-checks',
      badge: 'approvals',
      section: 'main',
      order: 1,
    },
    {
      id: 'requests',
      label: 'core.nav.requests',
      href: '/requests',
      icon: 'clipboard-list',
      section: 'main',
      order: 2,
    },
    {
      id: 'users',
      label: 'core.nav.users',
      href: '/admin/users',
      icon: 'users',
      permission: 'core.users.read',
      section: 'admin',
      group: 'core.nav.groupIdentity',
      order: 10,
    },
    {
      id: 'groups',
      label: 'core.nav.groups',
      href: '/admin/groups',
      icon: 'users-round',
      permission: 'core.groups.read',
      section: 'admin',
      group: 'core.nav.groupIdentity',
      order: 20,
    },
    {
      id: 'departments',
      label: 'core.nav.departments',
      href: '/admin/departments',
      icon: 'network',
      permission: 'core.departments.read',
      section: 'admin',
      group: 'core.nav.groupIdentity',
      order: 30,
    },
    {
      id: 'roles',
      label: 'core.nav.roles',
      href: '/admin/roles',
      icon: 'shield-check',
      permission: 'core.roles.read',
      section: 'admin',
      group: 'core.nav.groupAccess',
      order: 40,
    },
    {
      id: 'applications',
      label: 'core.nav.applications',
      href: '/admin/applications',
      icon: 'app-window',
      permission: 'core.applications.read',
      section: 'admin',
      group: 'core.nav.groupAccess',
      order: 42,
    },
    {
      id: 'api-clients',
      label: 'core.nav.apiClients',
      href: '/admin/api-clients',
      icon: 'plug',
      permission: 'core.api-clients.manage',
      section: 'admin',
      group: 'core.nav.groupAccess',
      order: 44,
    },
    {
      id: 'workflows',
      label: 'core.nav.workflows',
      href: '/admin/workflows',
      icon: 'workflow',
      permission: 'core.workflows.read',
      section: 'admin',
      group: 'core.nav.groupAutomation',
      order: 46,
    },
    {
      id: 'forms',
      label: 'core.nav.forms',
      href: '/admin/forms',
      icon: 'file-pen-line',
      permission: 'core.forms.manage',
      section: 'admin',
      group: 'core.nav.groupAutomation',
      order: 47,
    },
    {
      id: 'custom-fields',
      label: 'core.nav.customFields',
      href: '/admin/custom-fields',
      icon: 'text-cursor-input',
      permission: 'core.custom-fields.manage',
      section: 'admin',
      group: 'core.nav.groupAutomation',
      order: 48,
    },
    {
      id: 'notifications',
      label: 'core.nav.notifications',
      href: '/admin/notifications',
      icon: 'bell-ring',
      permission: 'core.notifications.manage',
      section: 'admin',
      group: 'core.nav.groupAutomation',
      order: 49,
    },
    {
      id: 'ai',
      label: 'core.nav.ai',
      href: '/admin/ai',
      icon: 'sparkles',
      permission: 'core.ai.manage',
      section: 'admin',
      group: 'core.nav.groupAutomation',
      order: 49.5,
    },
    {
      id: 'audit',
      label: 'core.nav.audit',
      href: '/admin/audit',
      icon: 'scroll-text',
      permission: 'core.audit.read',
      section: 'admin',
      group: 'core.nav.groupPlatform',
      order: 50,
    },
    {
      id: 'modules',
      label: 'core.nav.modules',
      href: '/admin/modules',
      icon: 'blocks',
      permission: 'core.modules.read',
      section: 'admin',
      group: 'core.nav.groupPlatform',
      order: 60,
    },
    {
      id: 'databases',
      label: 'core.nav.databases',
      href: '/admin/databases',
      icon: 'database',
      permission: 'core.databases.read',
      section: 'admin',
      group: 'core.nav.groupPlatform',
      order: 65,
    },
    {
      id: 'identity',
      label: 'core.nav.identity',
      href: '/admin/identity-providers',
      icon: 'key-round',
      permission: 'core.idp.read',
      section: 'admin',
      group: 'core.nav.groupPlatform',
      order: 70,
    },
  ],
  permissions: [
    {
      key: 'core.users.read',
      description: 'core.permissions.usersRead',
      scopes: ['global', 'department', 'record'],
    },
    {
      key: 'core.users.create',
      description: 'core.permissions.usersCreate',
      scopes: ['global', 'department'],
    },
    {
      key: 'core.users.update',
      description: 'core.permissions.usersUpdate',
      scopes: ['global', 'department', 'record'],
    },
    {
      key: 'core.users.lifecycle',
      description: 'core.permissions.usersLifecycle',
      scopes: ['global', 'department'],
    },
    {
      key: 'core.users.credentials',
      description: 'core.permissions.usersCredentials',
      scopes: ['global', 'department'],
    },
    { key: 'core.groups.read', description: 'core.permissions.groupsRead' },
    { key: 'core.groups.manage', description: 'core.permissions.groupsManage', scopes: ['global', 'record'] },
    { key: 'core.departments.read', description: 'core.permissions.departmentsRead' },
    {
      key: 'core.departments.manage',
      description: 'core.permissions.departmentsManage',
      scopes: ['global', 'department'],
    },
    { key: 'core.roles.read', description: 'core.permissions.rolesRead' },
    { key: 'core.roles.manage', description: 'core.permissions.rolesManage' },
    {
      key: 'core.roles.assign',
      description: 'core.permissions.rolesAssign',
      scopes: ['global', 'department'],
    },
    { key: 'core.audit.read', description: 'core.permissions.auditRead' },
    { key: 'core.modules.read', description: 'core.permissions.modulesRead' },
    { key: 'core.modules.manage', description: 'core.permissions.modulesManage' },
    { key: 'core.idp.read', description: 'core.permissions.idpRead' },
    { key: 'core.idp.manage', description: 'core.permissions.idpManage' },
    { key: 'core.workflows.read', description: 'core.permissions.workflowsRead' },
    { key: 'core.workflows.manage', description: 'core.permissions.workflowsManage' },
    { key: 'core.forms.read', description: 'core.permissions.formsRead' },
    { key: 'core.forms.manage', description: 'core.permissions.formsManage' },
    { key: 'core.custom-fields.read', description: 'core.permissions.customFieldsRead' },
    { key: 'core.custom-fields.manage', description: 'core.permissions.customFieldsManage' },
    { key: 'core.notifications.manage', description: 'core.permissions.notificationsManage' },
    { key: 'core.ai.manage', description: 'core.permissions.aiManage' },
    {
      key: 'core.access-requests.read',
      description: 'core.permissions.accessRequestsRead',
      scopes: ['global', 'department'],
    },
    {
      key: 'core.applications.read',
      description: 'core.permissions.applicationsRead',
      scopes: ['global', 'record'],
    },
    {
      key: 'core.applications.manage',
      description: 'core.permissions.applicationsManage',
      scopes: ['global', 'record'],
    },
    { key: 'core.api-clients.manage', description: 'core.permissions.apiClientsManage' },
    {
      key: 'core.role-query.read',
      description: 'core.permissions.roleQueryRead',
      scopes: ['global', 'record'],
    },
    { key: 'core.databases.read', description: 'core.permissions.databasesRead' },
    { key: 'core.databases.manage', description: 'core.permissions.databasesManage' },
    { key: 'core.mcp.use', description: 'core.permissions.mcpUse' },
  ],
  roles: [
    {
      key: 'platform-admin',
      name: 'Platform administrator',
      description: 'Full access to everything',
      permissions: ['*'],
    },
    {
      key: 'identity-admin',
      name: 'Identity administrator',
      description: 'Manage people, groups, departments and role assignments',
      permissions: [
        'core.users.*',
        'core.groups.*',
        'core.departments.*',
        'core.roles.read',
        'core.roles.assign',
        'core.audit.read',
        'core.access-requests.read',
        'core.custom-fields.read',
        'core.custom-fields.manage',
      ],
    },
    {
      key: 'workflow-admin',
      name: 'Workflow administrator',
      description: 'Design approval workflows, forms, custom fields and notification channels',
      permissions: [
        'core.workflows.*',
        'core.forms.*',
        'core.custom-fields.*',
        'core.notifications.*',
        'core.access-requests.read',
      ],
    },
    {
      key: 'application-manager',
      name: 'Application manager',
      description: 'Manage an application’s roles and permissions (assign it scoped to one application)',
      permissions: ['core.applications.*', 'core.role-query.read'],
    },
    {
      key: 'security-auditor',
      name: 'Security auditor',
      description: 'Read-only access to every module and the audit trail',
      permissions: ['*.*.read'],
    },
    {
      key: 'database-admin',
      name: 'Database connection administrator',
      description: 'Register external databases, their credentials and purposes',
      permissions: ['core.databases.*'],
    },
    {
      key: 'module-admin',
      name: 'Module administrator',
      description: 'Enable, disable and configure modules',
      permissions: ['core.modules.*'],
    },
    {
      key: 'configuration-viewer',
      name: 'Configuration viewer',
      description:
        'See workflows, forms, custom fields, roles and module settings, and propose changes to them',
      permissions: [
        'core.workflows.read',
        'core.forms.read',
        'core.custom-fields.read',
        'core.roles.read',
        'core.modules.read',
      ],
    },
    {
      key: 'everyone',
      name: 'Everyone',
      description: 'Baseline access granted to every active user',
      permissions: ['core.departments.read'],
      grantByDefault: true,
    },
  ],
  events: {
    // Role changes also refresh cached permissions after commit (change sets apply them in a longer transaction).
    consumes: [
      'core.notification.created',
      'core.role.updated',
      'core.role.deleted',
      'core.process-action.queued',
    ],
    emits: [
      { name: 'core.user.created', schema: userRef.extend({ status: z.string() }) },
      { name: 'core.user.updated', schema: userRef.extend({ changes: z.array(z.string()) }) },
      { name: 'core.user.onboarded', schema: userRef },
      {
        name: 'core.user.offboarded',
        description: 'Modules must revoke the user’s access',
        schema: userRef.extend({ reason: z.string().nullable() }),
      },
      { name: 'core.user.suspended', schema: userRef },
      { name: 'core.user.reactivated', schema: userRef },
      {
        name: 'core.user.transferred',
        description:
          'A person moved to another department: the old and the new manager are asked to review their access (nothing is revoked)',
        schema: z.object({
          userId: z.uuid(),
          fromDepartmentId: z.uuid().nullable(),
          toDepartmentId: z.uuid().nullable(),
        }),
      },
      { name: 'core.group.created', schema: z.object({ groupId: z.uuid() }) },
      { name: 'core.group.updated', schema: z.object({ groupId: z.uuid() }) },
      { name: 'core.group.deleted', schema: z.object({ groupId: z.uuid() }) },
      {
        name: 'core.group.members_changed',
        schema: z.object({ groupId: z.uuid(), added: z.array(z.uuid()), removed: z.array(z.uuid()) }),
      },
      { name: 'core.department.created', schema: z.object({ departmentId: z.uuid() }) },
      { name: 'core.department.updated', schema: z.object({ departmentId: z.uuid() }) },
      { name: 'core.department.deleted', schema: z.object({ departmentId: z.uuid() }) },
      { name: 'core.role.created', schema: z.object({ roleId: z.uuid() }) },
      { name: 'core.role.updated', schema: z.object({ roleId: z.uuid() }) },
      { name: 'core.role.deleted', schema: z.object({ roleId: z.uuid() }) },
      {
        name: 'core.role-assignment.granted',
        schema: z.object({ assignmentId: z.uuid(), roleId: z.uuid() }),
      },
      {
        name: 'core.role-assignment.revoked',
        schema: z.object({ assignmentId: z.uuid(), roleId: z.uuid() }),
      },
      {
        name: 'core.role-assignment.expired',
        schema: z.object({ assignmentId: z.uuid(), roleId: z.uuid() }),
      },
      {
        name: 'core.record.linked',
        description: 'Two records were linked (`a`/`b` in canonical order)',
        schema: z.object({ linkId: z.uuid(), a: recordRef, b: recordRef }),
      },
      { name: 'core.record.unlinked', schema: z.object({ linkId: z.uuid(), a: recordRef, b: recordRef }) },
      {
        name: 'core.file.attached',
        schema: z.object({ fileId: z.uuid(), record: recordRef, name: z.string(), size: z.number() }),
      },
      {
        name: 'core.file.deleted',
        schema: z.object({ fileId: z.uuid(), record: recordRef, name: z.string() }),
      },
      { name: 'core.module.enabled', schema: z.object({ moduleId: z.string() }) },
      { name: 'core.module.disabled', schema: z.object({ moduleId: z.string() }) },
      {
        name: 'core.workflow.completed',
        description:
          'A workflow instance finished; the trigger owner gets it through `workflows.onCompleted`',
        schema: z.object({
          instanceId: z.uuid(),
          triggerKey: z.string(),
          subjectType: z.string(),
          subjectId: z.string(),
          outcome: z.enum(['approved', 'rejected', 'cancelled']),
          requesterId: z.uuid().nullable(),
          comment: z.string().nullable(),
        }),
      },
      {
        name: 'core.notification.created',
        description: 'Internal: hands new notifications to the worker for delivery',
        schema: z.object({ userIds: z.array(z.uuid()), deliveryIds: z.array(z.uuid()) }),
      },
      { name: 'core.access-request.submitted', schema: requestRef },
      { name: 'core.access-request.approved', schema: requestRef.extend({ assignmentId: z.uuid() }) },
      { name: 'core.access-request.rejected', schema: requestRef },
      { name: 'core.access-request.cancelled', schema: requestRef },
      { name: 'core.access-request.failed', schema: requestRef.extend({ reason: z.string() }) },
      { name: 'core.form-submission.created', schema: submissionRef },
      {
        name: 'core.form-submission.completed',
        schema: submissionRef.extend({ status: z.enum(['approved', 'rejected', 'cancelled']) }),
      },
      {
        name: 'core.process-action.queued',
        description: 'Internal: hands new (or retried) process action runs of a submission to the worker',
        schema: z.object({ submissionId: z.uuid(), runIds: z.array(z.uuid()).min(1) }),
      },
      {
        name: 'core.process-action.succeeded',
        description: 'A form’s process action did its work (e.g. created a change)',
        schema: processActionRunRef,
      },
      {
        name: 'core.process-action.failed',
        description: 'A form’s process action failed for good (after its retries, or at once for a refusal)',
        schema: processActionRunRef.extend({ code: z.string() }),
      },
      {
        name: 'core.form-assignment.created',
        description:
          'A form was assigned to a person or group, due by a date (by hand or a core.assign-form job)',
        schema: assignmentRef.extend({
          assigneeUserId: z.uuid().nullable(),
          assigneeGroupId: z.uuid().nullable(),
          dueAt: z.iso.datetime(),
          source: z.string().describe('job or manual'),
        }),
      },
      {
        name: 'core.form-assignment.completed',
        description: 'The assignee submitted the assigned form (`late`: after the due date)',
        schema: assignmentRef.extend({ submissionId: z.uuid(), late: z.boolean() }),
      },
      { name: 'core.form-assignment.cancelled', schema: assignmentRef },
      {
        name: 'core.form-assignment.overdue',
        description:
          'An assignment passed its due date without being done (published once, by the reminder job)',
        schema: assignmentRef.extend({ dueAt: z.iso.datetime() }),
      },
      { name: 'core.application.created', schema: z.object({ applicationId: z.uuid() }) },
      { name: 'core.application.updated', schema: z.object({ applicationId: z.uuid() }) },
      { name: 'core.application.deleted', schema: z.object({ applicationId: z.uuid() }) },
      { name: 'core.api-client.created', schema: z.object({ apiClientId: z.uuid() }) },
      { name: 'core.api-client.updated', schema: z.object({ apiClientId: z.uuid() }) },
      { name: 'core.api-client.revoked', schema: z.object({ apiClientId: z.uuid() }) },
      { name: 'core.db-connection.created', schema: z.object({ connectionId: z.uuid() }) },
      {
        name: 'core.db-connection.updated',
        description: 'Settings or credentials changed: modules drop cached state for it',
        schema: z.object({ connectionId: z.uuid() }),
      },
      { name: 'core.db-connection.deleted', schema: z.object({ connectionId: z.uuid(), key: z.string() }) },
      {
        name: 'core.directory.synced',
        schema: z.object({
          idpId: z.uuid(),
          created: z.number(),
          updated: z.number(),
          suspended: z.number(),
        }),
      },
    ],
  },
  settings: [
    {
      key: 'branding.productName',
      label: 'core.settings.productName',
      type: 'string',
      default: 'IS Big Platform',
    },
    {
      key: 'branding.supportEmail',
      label: 'core.settings.supportEmail',
      type: 'string',
      default: 'it-support@example.com',
    },
    {
      key: 'security.loginBanner',
      label: 'core.settings.loginBanner',
      description: 'core.settings.loginBannerHelp',
      type: 'text',
      default: '',
      advanced: true,
    },
    {
      key: 'notifications.email.enabled',
      label: 'core.settings.emailEnabled',
      type: 'boolean',
      default: false,
      advanced: true,
    },
    {
      key: 'notifications.email.host',
      label: 'core.settings.emailHost',
      type: 'string',
      default: '',
      advanced: true,
    },
    {
      key: 'notifications.email.port',
      label: 'core.settings.emailPort',
      type: 'number',
      default: 587,
      advanced: true,
    },
    {
      key: 'notifications.email.secure',
      label: 'core.settings.emailSecure',
      description: 'core.settings.emailSecureHelp',
      type: 'boolean',
      default: false,
      advanced: true,
    },
    {
      key: 'notifications.email.username',
      label: 'core.settings.emailUsername',
      type: 'string',
      default: '',
      advanced: true,
    },
    {
      key: 'notifications.email.password',
      label: 'core.settings.emailPassword',
      type: 'secret',
      advanced: true,
    },
    {
      key: 'notifications.email.from',
      label: 'core.settings.emailFrom',
      description: 'core.settings.emailFromHelp',
      type: 'string',
      default: '',
      advanced: true,
    },
    // AI gateway (Administration → AI). Secrets are encrypted at rest; `advanced` keeps them off the
    // generic module settings form.
    {
      key: 'ai.chat.provider',
      label: 'core.settings.aiChatProvider',
      type: 'select',
      default: 'none',
      options: [
        { value: 'none', label: 'None (builtin features only)' },
        { value: 'anthropic', label: 'Anthropic (Claude)' },
        { value: 'openai-compatible', label: 'OpenAI-compatible' },
      ],
      advanced: true,
    },
    {
      key: 'ai.chat.baseUrl',
      label: 'core.settings.aiChatBaseUrl',
      type: 'string',
      default: '',
      advanced: true,
    },
    { key: 'ai.chat.apiKey', label: 'core.settings.aiChatApiKey', type: 'secret', advanced: true },
    { key: 'ai.chat.model', label: 'core.settings.aiChatModel', type: 'string', default: '', advanced: true },
    {
      key: 'ai.chat.inputPrice',
      label: 'core.settings.aiChatInputPrice',
      type: 'number',
      default: 0,
      advanced: true,
    },
    {
      key: 'ai.chat.outputPrice',
      label: 'core.settings.aiChatOutputPrice',
      type: 'number',
      default: 0,
      advanced: true,
    },
    {
      key: 'ai.embeddings.provider',
      label: 'core.settings.aiEmbeddingsProvider',
      type: 'select',
      default: 'builtin',
      options: [
        { value: 'builtin', label: 'Builtin (offline)' },
        { value: 'openai-compatible', label: 'OpenAI-compatible' },
      ],
      advanced: true,
    },
    {
      key: 'ai.embeddings.baseUrl',
      label: 'core.settings.aiEmbeddingsBaseUrl',
      type: 'string',
      default: '',
      advanced: true,
    },
    {
      key: 'ai.embeddings.apiKey',
      label: 'core.settings.aiEmbeddingsApiKey',
      type: 'secret',
      advanced: true,
    },
    {
      key: 'ai.embeddings.model',
      label: 'core.settings.aiEmbeddingsModel',
      type: 'string',
      default: '',
      advanced: true,
    },
    {
      key: 'ai.embeddings.dimensions',
      label: 'core.settings.aiEmbeddingsDimensions',
      type: 'number',
      default: 0,
      advanced: true,
    },
    {
      key: 'ai.embeddings.price',
      label: 'core.settings.aiEmbeddingsPrice',
      type: 'number',
      default: 0,
      advanced: true,
    },
    {
      key: 'ai.masking.enabled',
      label: 'core.settings.aiMasking',
      type: 'boolean',
      default: true,
      advanced: true,
    },
    {
      key: 'ai.masking.categories',
      label: 'core.settings.aiMaskingCategories',
      type: 'string',
      default: 'email,phone,ip,card,id,secret',
      advanced: true,
    },
    {
      key: 'ai.masking.custom',
      label: 'core.settings.aiMaskingCustom',
      type: 'text',
      default: '',
      advanced: true,
    },
    {
      key: 'ai.budget.monthlyUsd',
      label: 'core.settings.aiMonthlyBudget',
      type: 'number',
      default: 0,
      advanced: true,
    },
    {
      key: 'notifications.retentionDays',
      label: 'core.settings.notificationRetention',
      type: 'number',
      default: 90,
      advanced: true,
    },
    {
      key: 'files.maxSizeMb',
      label: 'core.settings.filesMaxSize',
      description: 'core.settings.filesMaxSizeHelp',
      type: 'number',
      default: 25,
      advanced: true,
    },
    {
      key: 'files.blockedExtensions',
      label: 'core.settings.filesBlocked',
      description: 'core.settings.filesBlockedHelp',
      type: 'string',
      default: DEFAULT_BLOCKED_EXTENSIONS.join(', '),
      advanced: true,
    },
    {
      key: 'processActions.webhookHosts',
      label: 'core.settings.webhookHosts',
      description: 'core.settings.webhookHostsHelp',
      type: 'text',
      default: '',
    },
  ],
  processActions: [
    {
      action: 'grant-role',
      name: 'core.processActions.grantRole.name',
      description: 'core.processActions.grantRole.description',
      icon: 'key-round',
      permission: 'core.roles.assign',
    },
    {
      action: 'notify',
      name: 'core.processActions.notify.name',
      description: 'core.processActions.notify.description',
      icon: 'bell',
      permission: 'core.forms.manage',
    },
    {
      action: 'webhook',
      name: 'core.processActions.webhook.name',
      description: 'core.processActions.webhook.description',
      icon: 'webhook',
      permission: 'core.notifications.manage',
    },
    {
      action: 'remind',
      name: 'core.processActions.remind.name',
      description: 'core.processActions.remind.description',
      icon: 'alarm-clock',
      permission: 'core.forms.manage',
    },
  ],
  taskTypes: [
    {
      type: 'assign-form',
      name: 'core.taskTypes.assignForm.name',
      description: 'core.taskTypes.assignForm.description',
      icon: 'clipboard-check',
      permission: 'core.forms.manage',
      config: assignFormTaskConfigSchema,
    },
  ],
  ai: {
    tools: [
      {
        name: 'core.find_users',
        description: 'Search people by name, email or username and return their status and department.',
        input: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) }),
        permission: 'core.users.read',
        readOnly: true,
      },
      {
        name: 'core.explain_access',
        description: 'Explain which roles and permissions a user has, and through which group or assignment.',
        input: z.object({ userId: z.uuid() }),
        permission: 'core.roles.read',
        readOnly: true,
      },
      {
        name: 'core.find_groups',
        description:
          'Search groups by name or key and return their key, name, description and member count. Group keys are what approval workflows and form audiences use.',
        input: z.object({
          query: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(100).default(25),
        }),
        permission: 'core.groups.read',
        readOnly: true,
      },
      {
        name: 'core.find_roles',
        description:
          'Search platform roles by name or key and return their key, name and permissions; optionally the permission catalogue with what each permission allows.',
        input: z.object({
          query: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(100).default(25),
          includePermissionCatalog: z.boolean().default(false),
        }),
        permission: 'core.roles.read',
        readOnly: true,
      },
      {
        name: 'core.find_departments',
        description:
          'Search departments by name or code and return their code, name, place in the organisation (path) and manager.',
        input: z.object({
          query: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(100).default(25),
        }),
        permission: 'core.departments.read',
        readOnly: true,
      },
      {
        name: 'core.offboard_user',
        description: 'Offboard a user: disable sign-in, revoke sessions, remove groups and role assignments.',
        input: z.object({ userId: z.uuid(), reason: z.string().max(500) }),
        permission: 'core.users.lifecycle',
        destructive: true,
      },
    ],
  },
  search: { entities: ['user', 'group', 'role', 'department', 'request'] },
  records: {
    types: [
      {
        // Form submissions (REQ-…): evidence and links on the request page. Pickers list them for form readers;
        // the resolver shows each person only their own requests and those they were asked to approve.
        type: 'request',
        name: 'core.recordTypes.request',
        icon: 'file-text',
        permission: 'core.forms.read',
        facts: requestFactsSchema,
      },
    ],
  },
  workflows: [
    {
      key: 'core.access-request',
      name: 'core.workflows.accessRequest.name',
      description: 'core.workflows.accessRequest.description',
      subject: 'access-request',
      facts: accessRequestFacts,
      required: true,
      defaultGraph: accessRequestGraph,
    },
    {
      key: 'core.form-submission',
      name: 'core.workflows.formSubmission.name',
      description: 'core.workflows.formSubmission.description',
      subject: 'form-submission',
      facts: formSubmissionFacts,
    },
  ],
  notifications: [
    { type: 'core.approval.assigned', defaultChannels: ['inApp', 'email'] },
    { type: 'core.approval.reminder', defaultChannels: ['inApp', 'email'] },
    { type: 'core.approval.escalated', defaultChannels: ['inApp', 'email'] },
    { type: 'core.approval.overdue', defaultChannels: ['inApp'] },
    { type: 'core.approval.delegated', defaultChannels: ['inApp', 'email'] },
    { type: 'core.workflow.fyi', defaultChannels: ['inApp'] },
    { type: 'core.access-request.approved', defaultChannels: ['inApp', 'email'] },
    { type: 'core.access-request.rejected', defaultChannels: ['inApp', 'email'] },
    { type: 'core.access-request.failed', defaultChannels: ['inApp', 'email'], mandatory: true },
    { type: 'core.access.expiring', defaultChannels: ['inApp', 'email'] },
    { type: 'core.form-submission.approved', defaultChannels: ['inApp', 'email'] },
    { type: 'core.form-submission.rejected', defaultChannels: ['inApp', 'email'] },
    { type: 'core.access.granted', defaultChannels: ['inApp', 'email'] },
    /** To the old and the new manager when a person changes department: review their access. */
    { type: 'core.user.transferred', defaultChannels: ['inApp', 'email'] },
    { type: 'core.process-action.failed', defaultChannels: ['inApp', 'email'] },
    /** Sent by a form's `core.notify` action (title and message come from the form). */
    { type: 'core.process-action.message', defaultChannels: ['inApp', 'email'] },
    /** Sent on its date by a form's `core.remind` action (title and message come from the form). */
    { type: 'core.reminder.due', defaultChannels: ['inApp', 'email'] },
    /** To the assignee (or the assigned group's members) of a form someone must fill in by a date. */
    { type: 'core.form-assignment.assigned', defaultChannels: ['inApp', 'email'] },
    /** Due within two days, or overdue (at most once a day). */
    { type: 'core.form-assignment.reminder', defaultChannels: ['inApp', 'email'] },
    /** To the form's editors when an assignment passes its due date undone. */
    { type: 'core.form-assignment.overdue', defaultChannels: ['inApp', 'email'] },
  ],
  customFields: {
    entities: [
      { type: 'user', name: 'core.entities.user' },
      { type: 'group', name: 'core.entities.group' },
      { type: 'department', name: 'core.entities.department' },
    ],
  },
  customizations: [
    {
      kind: 'workflow',
      label: 'core.customizations.workflow',
      description:
        'An approval workflow for a trigger (form submissions, access requests, module events): its steps, approvers, conditions and SLAs, and whether it is the trigger’s default. Applying publishes a new version.',
      icon: 'workflow',
      readPermission: 'core.workflows.read',
      applyPermission: 'core.workflows.manage',
      operations: ['create', 'update', 'archive'],
    },
    {
      kind: 'form',
      label: 'core.customizations.form',
      description:
        'A request form in the portal: its questions, conditional fields, who sees it and the approval workflow attached to it. Applying publishes the form.',
      icon: 'file-pen-line',
      readPermission: 'core.forms.read',
      applyPermission: 'core.forms.manage',
      operations: ['create', 'update', 'archive'],
    },
    {
      kind: 'custom-field',
      label: 'core.customizations.customField',
      description:
        'A custom field on people, groups, departments or module records (such as a cost centre or an asset tag); its key and type are fixed once created.',
      icon: 'text-cursor-input',
      readPermission: 'core.custom-fields.read',
      applyPermission: 'core.custom-fields.manage',
      operations: ['create', 'update', 'archive'],
    },
    {
      kind: 'role',
      label: 'core.customizations.role',
      description:
        'A platform role: a named set of permission patterns. Only permissions the person applying holds can be added; system roles are read-only.',
      icon: 'shield-check',
      readPermission: 'core.roles.read',
      applyPermission: 'core.roles.manage',
      operations: ['create', 'update', 'delete'],
    },
    {
      kind: 'group',
      label: 'core.customizations.group',
      description:
        'A group of people (an approval team, a committee): its key, name, description and custom fields. Workflows and forms name it by key; its members are people, added on the group’s page, never part of the change.',
      icon: 'users-round',
      readPermission: 'core.groups.read',
      applyPermission: 'core.groups.manage',
      operations: ['create', 'update', 'delete'],
    },
    {
      kind: 'notification-channel',
      label: 'core.customizations.notificationChannel',
      description:
        'Which notifications a Teams, Slack or webhook channel receives, in which language, and whether it is on. The address and secrets are never part of it.',
      icon: 'bell-ring',
      readPermission: 'core.notifications.manage',
      applyPermission: 'core.notifications.manage',
      operations: ['update'],
    },
    {
      kind: 'module-settings',
      label: 'core.customizations.moduleSettings',
      description:
        'The settings of an enabled module (product name, retention periods, module options), without secrets or the AI provider settings.',
      icon: 'settings',
      readPermission: 'core.modules.read',
      applyPermission: 'core.modules.manage',
      operations: ['update'],
    },
  ],
});
