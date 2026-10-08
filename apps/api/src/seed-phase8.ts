/**
 * Phase 8 demo data: the "Configuration change request" process (docs/architecture.md §15.7), built the way an
 * administrator or the assistant builds one — the approval workflow and the form, proposed as a change set and
 * applied by the admin through the customisation kinds, so every check of the admin pages applies — and two requests
 * through it, made and decided through the real services:
 *
 * - waiting: the service desk asks to patch the ERP database (erp-db-01, a critical CI), waiting for the admin, the
 *   requester's manager (then the DBA team and the Change Advisory Board);
 * - approved: a quota change on the file server fs-01, approved by the manager and the CI's support group (IT
 *   administrators); its process action raised a change linked to the CI and submitted it to its own CAB
 *   authorization. The action runs here, synchronously, so the demo is the same on every reset.
 *
 * Runs after every other seed, so the numbered demo records the guides cite (INC, CHG, KB, CS …) keep their numbers.
 * The form is offered to the IT groups that can read the CMDB (picking CIs needs it), the admin's and the service
 * desk's among them. Idempotent: does nothing once the form exists, or when CMDB, ITSM or the demo groups are missing.
 */
import {
  approvalTasks,
  formSubmissions,
  forms,
  groups,
  processActionRuns,
  users,
  workflowDefinitions,
  workflowInstances,
} from '@isbp/db/schema';
import type { AuthContext, Db, WorkflowCompletion } from '@isbp/sdk/server';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  CAB_GROUP_KEY,
  CONFIG_CHANGE_AUDIENCE_GROUPS,
  CONFIG_CHANGE_FORM_KEY,
  CONFIG_CHANGE_WORKFLOW_NAME,
  configChangeForm,
  configChangeWorkflow,
  FALLBACK_GROUP_KEY,
} from './core/customizations/examples';
import { FormService } from './core/services/forms';
import { ApprovalService } from './core/services/workflows';
import { runWithContext } from './kernel/context';
import type { Kernel } from './kernel/kernel';

const DAY = 24 * 60 * 60 * 1000;
/** `YYYY-MM-DD`, `days` from today. */
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

export const DEMO_CHANGE_REQUESTS = {
  waiting: 'Patch erp-db-01 to PostgreSQL 16.6',
  approved: 'Raise the department share quota on fs-01',
} as const;

async function authOf(kernel: Kernel, userId: string): Promise<AuthContext> {
  const auth = await kernel.registry.context('core').rbac.authFor(userId);
  if (!auth) throw new Error(`seed: no such user ${userId}`);
  return auth;
}

const as = <T>(auth: AuthContext, fn: () => Promise<T>) =>
  runWithContext({ principal: auth.principal, requestId: 'seed' }, fn);

/** The workflow and the form, in one change set the admin applies (or through the kinds without the assistant). */
async function buildProcess(kernel: Kernel, admin: AuthContext, audience: string[]): Promise<void> {
  if (kernel.registry.get('assistant')) {
    const { ChangeSetService } = await import('@isbp/module-assistant/server');
    const service = new ChangeSetService(kernel.registry.context('assistant'));
    await as(admin, async () => {
      const { changeSet } = await service.propose(
        null,
        { ref: 'approval', kind: 'core.workflow', op: 'create', value: configChangeWorkflow },
        admin,
      );
      await service.propose(
        changeSet.id,
        { ref: 'form', kind: 'core.form', op: 'create', value: configChangeForm('$ref:approval', audience) },
        admin,
      );
      await service.update(
        changeSet.id,
        {
          title: 'Configuration change requests',
          summary:
            'A request form for changes to configuration items, picked from the CMDB. The end date can’t be before ' +
            'the start; a high-risk change needs a rollback plan. The requester’s manager approves, then the CIs’ ' +
            'support groups, then the Change Advisory Board when a CI is critical or the risk is high. Approved ' +
            'requests raise a change linked to the CIs and submit it to its own CAB authorization.',
        },
        admin,
      );
      await service.apply(changeSet.id, { confirm: false }, admin);
    });
    return;
  }
  await as(admin, () =>
    kernel.db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const source = { type: 'seed', id: 'phase8' };
      const wf = await kernel.customizations.apply(
        'core.workflow',
        { op: 'create', id: null, value: configChangeWorkflow },
        { auth: admin, tx, source },
      );
      await kernel.customizations.apply(
        'core.form',
        { op: 'create', id: null, value: configChangeForm(wf.id, audience) },
        { auth: admin, tx, source },
      );
    }),
  );
}

/** Decides each pending task as its assignee, approving, until the instance is no longer running. */
async function approveAll(kernel: Kernel, instanceId: string) {
  const approvals = new ApprovalService(kernel.registry.context('core'));
  for (let i = 0; i < 10; i++) {
    const [inst] = await kernel.db
      .select({ status: workflowInstances.status })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId));
    if (inst?.status !== 'running') return;
    const [task] = await kernel.db
      .select({ id: approvalTasks.id, assigneeId: approvalTasks.assigneeId })
      .from(approvalTasks)
      .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')))
      .orderBy(approvalTasks.createdAt)
      .limit(1);
    if (!task) return;
    const approver = await authOf(kernel, task.assigneeId);
    await as(approver, () =>
      approvals.decide(
        task.id,
        'approve',
        i === 0 ? 'Fine by me, within the maintenance window.' : null,
        approver,
      ),
    );
  }
}

/**
 * What the worker would do once the instance completed, now: the form moves on (and queues its actions), then each
 * queued action runs. The outbox delivers the same completion later; both handlers ignore what is already done.
 */
async function completeNow(kernel: Kernel, formSvc: FormService, instanceId: string, submissionId: string) {
  const [inst] = await kernel.db.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId));
  if (!inst || inst.status === 'running') return;
  const [last] = await kernel.db
    .select({ id: users.id, name: users.displayName })
    .from(approvalTasks)
    .innerJoin(users, eq(users.id, approvalTasks.decidedById))
    .where(and(eq(approvalTasks.instanceId, instanceId), isNotNull(approvalTasks.decidedAt)))
    .orderBy(desc(approvalTasks.decidedAt))
    .limit(1);
  const result: WorkflowCompletion = {
    instanceId,
    triggerKey: inst.triggerKey,
    subjectType: inst.subjectType,
    subjectId: inst.subjectId,
    outcome: inst.status as WorkflowCompletion['outcome'],
    requesterId: inst.requesterId,
    comment: inst.outcomeComment,
    decidedBy: last ?? null,
  };
  await formSvc.onWorkflowCompleted(result);
  const runs = await kernel.db
    .select({ id: processActionRuns.id })
    .from(processActionRuns)
    .where(and(eq(processActionRuns.submissionId, submissionId), eq(processActionRuns.status, 'queued')))
    .orderBy(processActionRuns.createdAt);
  for (const run of runs) {
    const { status } = await kernel.processActions.execute(run.id);
    if (status !== 'succeeded')
      kernel.logger.warn({ runId: run.id, status }, 'seed: a demo process action did not succeed');
  }
}

/** After every module seed and the other phases' links (it raises a change, so it comes last). */
export async function seedPhase8Links(kernel: Kernel): Promise<void> {
  if (!kernel.registry.get('cmdb') || !kernel.registry.get('itsm')) return;
  const db = kernel.db;
  const log = kernel.logger;
  const [existing] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(eq(forms.key, CONFIG_CHANGE_FORM_KEY));
  if (existing) return;
  const present = new Set(
    (
      await db
        .select({ key: groups.key })
        .from(groups)
        .where(inArray(groups.key, [CAB_GROUP_KEY, ...CONFIG_CHANGE_AUDIENCE_GROUPS]))
    ).map((g) => g.key),
  );
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'admin'));
  if (!present.has(CAB_GROUP_KEY) || !present.has(FALLBACK_GROUP_KEY) || !admin) {
    log.warn('seed: the configuration change process needs the admin and the cab and it-admins groups');
    return;
  }
  await kernel.rbac.bump();
  const adminAuth = await authOf(kernel, admin.id);
  // Offered to the IT groups that can read the CMDB (picking CIs needs it), as far as they exist.
  await buildProcess(
    kernel,
    adminAuth,
    CONFIG_CHANGE_AUDIENCE_GROUPS.filter((k) => present.has(k)),
  );

  const [wf] = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.name, CONFIG_CHANGE_WORKFLOW_NAME));
  log.info(
    { form: CONFIG_CHANGE_FORM_KEY, workflowId: wf?.id },
    'phase 8 configuration change process created',
  );

  // Two requests from the service desk (its manager is the admin).
  const [requester] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'helpdesk'));
  if (!requester) return;
  const { rows: ciRows } = await db.execute<{ id: string; name: string }>(
    sql`select id, name from cmdb.cis where name in ('erp-db-01', 'fs-01')`,
  );
  const ci = (name: string) => ciRows.find((r) => r.name === name)?.id;
  if (!ci('erp-db-01') || !ci('fs-01')) {
    log.warn('seed: demo CIs erp-db-01 and fs-01 not found; no configuration change requests');
    return;
  }
  const svc = new FormService(kernel.registry.context('core'));
  const desk = await authOf(kernel, requester.id);
  const submit = (data: Record<string, unknown>) =>
    as(desk, () => svc.submit(CONFIG_CHANGE_FORM_KEY, data, desk));

  // Approved: the manager and the file server's support group (IT administrators); no CAB for a medium CI at low risk.
  const approved = await submit({
    cis: [`cmdb.ci:${ci('fs-01')}`],
    title: DEMO_CHANGE_REQUESTS.approved,
    changeType: 'normal',
    risk: 'low',
    plannedStart: dateIn(9),
    plannedEnd: dateIn(10),
    description:
      'Raise the quota of the Finance department share on fs-01 from 500 GB to 750 GB for the year-end close ' +
      'archives. An online change on the DFS namespace: no restart.',
    backoutPlan: 'Set the quota back to 500 GB.',
  });
  if (approved.workflow) {
    await approveAll(kernel, approved.workflow.id);
    await completeNow(kernel, svc, approved.workflow.id, approved.id);
  }

  // Waiting for the admin: a critical database, so the DBA team and the CAB follow.
  await submit({
    cis: [`cmdb.ci:${ci('erp-db-01')}`],
    title: DEMO_CHANGE_REQUESTS.waiting,
    changeType: 'normal',
    risk: 'medium',
    plannedStart: dateIn(16),
    plannedEnd: dateIn(17),
    description:
      'Apply the PostgreSQL 16.6 minor release to the ERP primary (security fixes). The replica is patched first, ' +
      'then a controlled switchover; about 5 minutes of read-only ERP during the switchover.',
    backoutPlan:
      'Fail back to the unpatched replica, then reinstall 16.5 on the primary from the local package cache.',
  });

  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(formSubmissions)
    .innerJoin(forms, eq(forms.id, formSubmissions.formId))
    .where(eq(forms.key, CONFIG_CHANGE_FORM_KEY));
  log.info({ requests: n }, 'phase 8 configuration change requests created');
}
