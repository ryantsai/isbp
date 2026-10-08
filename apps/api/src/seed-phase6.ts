/**
 * Phase 6 demo data: the assistant's roles, an API client for outside agents (MCP), and three change sets:
 *
 * - applied: a laptop-request approval workflow, its form and the service catalog item (prepared by the admin);
 * - in review: a custom field on tickets proposed by the service desk, waiting in the admin's approval inbox;
 * - draft: an approval workflow for knowledge articles, ready for someone who may apply it.
 *
 * Change sets are built with the assistant's own service, so they carry real dry runs, snapshots and audit entries.
 */
import { apiClients, groups, users } from '@isbp/db/schema';
import type { AuthContext } from '@isbp/sdk/server';
import { eq, sql } from 'drizzle-orm';
import { ApiClientService } from './core/services/applications';
import { runWithContext } from './kernel/context';
import type { Kernel } from './kernel/kernel';
import { type Grant, grantDemoRoles } from './seed-phase2';

const GRANTS: Grant[] = [
  {
    role: 'assistant-user',
    groups: ['it-admins', 'service-desk', 'app-owners', 'network-team', 'security-team', 'dba-team'],
  },
  { role: 'assistant-admin', groups: ['it-admins'] },
  // The service desk proposes configuration changes it can't apply itself.
  { role: 'configuration-viewer', groups: ['service-desk'] },
];

export const DEMO_MCP_CLIENT = 'Claude Code (demo)';

const t3 = (en: string, zh: string, ja: string) => ({ en, 'zh-TW': zh, 'ja-JP': ja });

export async function seedPhase6(kernel: Kernel): Promise<void> {
  if (!kernel.registry.get('assistant')) return;
  await grantDemoRoles(kernel, GRANTS, 'Phase 6 demo access');
}

async function authOf(kernel: Kernel, username: string): Promise<AuthContext | null> {
  const [u] = await kernel.db.select({ id: users.id }).from(users).where(eq(users.username, username));
  return u ? kernel.registry.context('assistant').rbac.authFor(u.id) : null;
}

/** An API client an outside agent (Claude Code) uses over MCP. Returns its one-time key for the seed log. */
async function ensureMcpClient(kernel: Kernel, admin: AuthContext) {
  const [existing] = await kernel.db
    .select({ id: apiClients.id })
    .from(apiClients)
    .where(eq(apiClients.name, DEMO_MCP_CLIENT));
  if (existing) return null;
  const created = await runWithContext({ principal: admin.principal, requestId: 'seed' }, () =>
    new ApiClientService(kernel.registry.context('core')).create(
      {
        name: DEMO_MCP_CLIENT,
        description: 'An outside AI agent: reads the platform and proposes change sets over MCP',
        applicationIds: [],
        allApplications: false,
        permissions: [
          'core.mcp.use',
          'assistant.agent.use',
          'core.workflows.read',
          'core.forms.read',
          'core.custom-fields.read',
          'core.roles.read',
          'core.groups.read',
          'core.users.read',
        ],
        allowedCidrs: [],
        secretExpiresInDays: 90,
      },
      admin,
    ),
  );
  return { clientId: created.client.clientId, apiKey: created.secret };
}

/** After every module seed (the change sets touch ITSM's catalog). */
export async function seedPhase6Links(kernel: Kernel): Promise<{ clientId: string; apiKey: string } | null> {
  if (!kernel.registry.get('assistant')) return null;
  const { ChangeSetService } = await import('@isbp/module-assistant/server');
  const ctx = kernel.registry.context('assistant');
  const log = kernel.logger;
  await kernel.rbac.bump();
  const admin = await authOf(kernel, 'admin');
  const desk = await authOf(kernel, 'helpdesk');
  if (!admin) return null;
  const mcp = await ensureMcpClient(kernel, admin);

  const { rows } = await kernel.db.execute<{ n: number }>(
    sql`select count(*)::int as n from assistant.change_sets`,
  );
  if ((rows[0]?.n ?? 0) > 0) return mcp;
  const service = new ChangeSetService(ctx);
  const as = <T>(auth: AuthContext, fn: () => Promise<T>) =>
    runWithContext({ principal: auth.principal, requestId: 'seed' }, fn);

  /* ── 1. Applied: laptop requests over 60 000 TWD ── */
  const id = async (q: ReturnType<typeof sql>) =>
    (await kernel.db.execute<{ id: string }>(q)).rows[0]?.id ?? null;
  const laptopCategory = kernel.registry.get('itsm')
    ? await id(sql`select id from itsm.categories where key = 'hardware-laptop'`)
    : null;
  const [deskGroup] = await kernel.db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.key, 'service-desk'));
  await as(admin, async () => {
    const first = await service.propose(
      null,
      {
        ref: 'approval',
        kind: 'core.workflow',
        op: 'create',
        value: {
          name: 'Laptop request approval',
          description: 'Department head; IT asset management too above 60 000 TWD',
          triggerKey: 'core.form-submission',
          isDefault: false,
          graph: {
            steps: [
              {
                id: 'department-head',
                type: 'approval',
                name: t3('Department head approval', '部門主管簽核', '部門長の承認'),
                approvers: [{ type: 'department-head' }],
                mode: 'any',
                sla: { dueHours: 48, remindHours: 24, onBreach: 'notify' },
              },
              {
                id: 'it-assets',
                type: 'approval',
                name: t3('IT asset management', 'IT 資產管理', 'IT 資産管理'),
                when: { fact: 'data.amount', op: 'gt', value: 60000 },
                approvers: [{ type: 'role', roleKey: 'itam-asset-manager' }],
                mode: 'any',
              },
            ],
          },
        },
      },
      admin,
    );
    const setId = first.changeSet.id;
    await service.propose(
      setId,
      {
        ref: 'form',
        kind: 'core.form',
        op: 'create',
        value: {
          key: 'laptop-request',
          name: t3('Laptop request', '筆電申請', 'ノート PC の申請'),
          description: t3(
            'A new or replacement laptop. Above 60 000 TWD, IT asset management approves too.',
            '新購或汰換筆電。超過 60,000 元時，另需 IT 資產管理核准。',
            '新規または交換用のノート PC。60,000 TWD を超える場合は IT 資産管理の承認も必要です。',
          ),
          icon: 'laptop',
          category: 'Hardware',
          schema: {
            elements: [
              {
                id: 'model',
                key: 'model',
                type: 'select',
                label: t3('Model', '機型', 'モデル'),
                required: true,
                options: [
                  { value: 'standard', label: t3('Standard 14″', '標準 14 吋', '標準 14 インチ') },
                  {
                    value: 'performance',
                    label: t3('Performance 16″', '高效能 16 吋', 'ハイパフォーマンス 16 インチ'),
                  },
                ],
              },
              {
                id: 'amount',
                key: 'amount',
                type: 'number',
                label: t3('Estimated cost (TWD)', '預估金額（新台幣）', '見積額 (TWD)'),
                required: true,
                validation: { min: 0 },
              },
              {
                id: 'justification',
                key: 'justification',
                type: 'textarea',
                label: t3('Why do you need it?', '申請原因', '必要な理由'),
                required: true,
              },
            ],
          },
          workflowId: '$ref:approval',
          audience: { type: 'everyone' },
          active: true,
        },
      },
      admin,
    );
    if (kernel.registry.get('itsm'))
      await service.propose(
        setId,
        {
          kind: 'itsm.catalog-item',
          op: 'create',
          value: {
            formKey: 'laptop-request',
            active: true,
            categoryId: laptopCategory,
            groupId: deskGroup?.id ?? null,
            priority: 3,
            fulfilOn: 'approved',
          },
        },
        admin,
      );
    await service.update(
      setId,
      {
        title: 'Laptop requests over 60 000 TWD',
        summary:
          'A laptop request form in the portal. The department head approves every request; IT asset management also ' +
          'approves above 60 000 TWD. Approved requests become service desk tickets in Hardware › Laptop.',
      },
      admin,
    );
    await service.apply(setId, { confirm: false }, admin);
  });

  /* ── 2. In review: the service desk wants the affected site on tickets ── */
  if (desk) {
    await as(desk, async () => {
      const { changeSet } = await service.propose(
        null,
        {
          kind: 'core.custom-field',
          op: 'create',
          note: 'We route on-site visits by site; today agents type it into the description.',
          value: {
            entityType: 'itsm.ticket',
            field: {
              key: 'affectedSite',
              type: 'select',
              label: t3('Affected site', '受影響據點', '影響を受ける拠点'),
              options: [
                { value: 'taipei', label: t3('Taipei HQ', '台北總部', '台北本社') },
                { value: 'hsinchu', label: t3('Hsinchu', '新竹', '新竹') },
                { value: 'tokyo', label: t3('Tokyo', '東京', '東京') },
              ],
            },
          },
        },
        desk,
      );
      await service.update(
        changeSet.id,
        {
          title: 'Record the affected site on tickets',
          summary: 'A select field on tickets for the site involved.',
        },
        desk,
      );
      await service.submit(changeSet.id, { note: 'Needed before the Hsinchu office opens.' }, desk);
    });

    /* ── 3. Draft: knowledge articles reviewed by the service desk ── */
    await as(desk, async () => {
      const { changeSet } = await service.propose(
        null,
        {
          kind: 'core.workflow',
          op: 'create',
          value: {
            name: 'Knowledge article review',
            description: 'A service desk agent reviews new articles before they are published',
            triggerKey: 'knowledge.publish',
            isDefault: true,
            graph: {
              steps: [
                {
                  id: 'service-desk',
                  type: 'approval',
                  name: t3('Service desk review', '服務台審核', 'サービス デスクのレビュー'),
                  approvers: [{ type: 'group', groupKey: 'service-desk' }],
                  mode: 'any',
                },
              ],
            },
          },
        },
        desk,
      );
      await service.update(changeSet.id, { title: 'Review knowledge articles before publishing' }, desk);
    });
  }
  log.info('phase 6 change sets created');
  return mcp;
}
