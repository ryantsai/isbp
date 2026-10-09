/**
 * Core flows: self-service access requests, request forms with approvals and process actions, and the service desk's
 * incident lifecycle (ITSM, raised from the portal).
 */
import type { Json } from '../client';
import { defineFlow } from '../flow';

const REQUEST_REF = /^REQ-\d{5,}$/;

/* ───────────────────────────── access-request ───────────────────────────── */

export const accessRequest = defineFlow({
  name: 'access-request',
  area: 'core',
  description:
    'Request a role → manager (+ security, owner) approve or the manager rejects → granted → revoked',
  // Its own requesters: they hold the requested roles for a while, which would change what other flows see.
  personas: ['admin', 'requester', 'manager', 'roleowner'],
  async run(ctx) {
    const admin = ctx.as('admin');
    const requester = ctx.as('requester');
    const me = ctx.user('requester');
    const sfx = ctx.rand.suffix();
    const risk = ctx.rand.weighted([
      ['low', 4],
      ['medium', 3],
      ['high', 2],
    ] as const);
    const withOwner = ctx.rand.bool(0.7);
    const maxDurationDays = ctx.rand.pick([null, 30, 90, 365]);
    const managerRejects = ctx.rand.bool(0.25);
    ctx.tag(`risk ${risk}`);
    ctx.tag(managerRejects ? 'manager rejects' : 'approved');
    if (!withOwner) ctx.tag('no owner');

    const role = await ctx.step('admin makes a role requestable', async () => {
      const catalog = ctx.expect.ok(await admin.get('/permissions')).body.items as { key: string }[];
      const readable = catalog.filter((p) => p.key.endsWith('.read') && !p.key.startsWith('core.'));
      const permissions = ctx.rand.sample(readable, 1, 3).map((p) => p.key);
      const created = ctx.expect.status(
        await admin.post('/roles', {
          key: `sim-access-${sfx}`,
          name: `Sim ${ctx.rand.words(1, 3)} ${sfx}`,
          description: ctx.rand.sentence(),
          permissions,
        }),
        201,
      ).body;
      const settings = ctx.expect.ok(
        await admin.put(`/roles/${created.id}/request-settings`, {
          requestable: true,
          riskLevel: risk,
          ownerId: withOwner ? ctx.user('roleowner').id : null,
          maxDurationDays,
          requestWorkflowId: null,
        }),
      ).body;
      ctx.expect.equal(settings.requestable, true, 'the role is requestable');
      return { id: created.id as string, name: created.name as string, permissions };
    });

    await ctx.step('the requester finds it in the catalog', async () => {
      const list = ctx.expect.ok(await requester.get('/requestable-roles', { query: { q: sfx } })).body.items;
      const item = ctx.expect.find(list as Json[], (r) => r.id === role.id, 'the role is offered');
      ctx.expect.equal(
        [item.held, item.pendingRequest, item.riskLevel],
        [false, null, risk],
        'held, pending, risk',
      );
    });

    const durationDays = maxDurationDays ? ctx.rand.int(1, maxDurationDays) : ctx.rand.pick([null, 7, 30]);
    const justification = ctx.rand.sentence(5, 14);

    if (maxDurationDays && ctx.rand.bool(0.2))
      await ctx.step('a request for longer than the role allows is refused', async () => {
        const res = await requester.post('/access-requests', {
          roleId: role.id,
          durationDays: maxDurationDays + ctx.rand.int(1, 60),
          justification,
        });
        ctx.expect.code(res, 'DURATION_TOO_LONG');
      });

    await ctx.step('the preview shows who approves', async () => {
      const p = ctx.expect.ok(
        await requester.post('/access-requests/preview', { roleId: role.id, durationDays }),
      ).body;
      const outcomes = Object.fromEntries((p.steps as Json[]).map((s) => [s.id, s.outcome]));
      ctx.expect.equal(
        outcomes,
        { manager: 'ask', security: risk === 'high' ? 'ask' : 'skipped', owner: 'ask' },
        'approval path',
      );
      const managerStep = (p.steps as Json[]).find((s) => s.id === 'manager');
      ctx.expect.find(
        managerStep.people as Json[],
        (x) => x.id === ctx.user('manager').id,
        'the manager is asked',
      );
    });

    const doubleSubmit = ctx.rand.bool(0.15);
    const request = await ctx.step(
      doubleSubmit ? 'the requester asks for it twice at once' : 'the requester asks for it',
      async () => {
        const body = { roleId: role.id, durationDays, justification };
        let res;
        if (doubleSubmit) {
          ctx.tag('double submit');
          const both = await Promise.all([
            requester.post('/access-requests', body),
            requester.post('/access-requests', body),
          ]);
          res = ctx.expect.oneOk(both, 'one request is made', [409]);
          const all = ctx.expect.ok(
            await admin.get('/access-requests', { query: { scope: 'all', roleId: role.id } }),
          ).body;
          ctx.expect.equal(all.items.length, 1, 'access requests for the role');
        } else res = ctx.expect.status(await requester.post('/access-requests', body), 201);
        ctx.expect.equal(res.body.status, 'pending', 'status');
        ctx.expect.match(res.body.reference, REQUEST_REF, 'reference');
        ctx.expect.truthy(res.body.workflow?.id, 'the request started an approval');
        return res.body as Json;
      },
    );
    const instanceId = request.workflow.id as string;
    /** The requester is told of the decision once (they are also the beneficiary). */
    const toldOnce = (type: string) =>
      ctx.step('the requester is told once', async () => {
        const about = (n: Json) => n.type === type && JSON.stringify(n).includes(request.reference);
        const seen = await ctx.eventually(
          () => requester.get('/me/notifications', { query: { pageSize: 100 } }),
          (r) => ((r.body?.items ?? []) as Json[]).some(about),
          { label: `the ${type} notification` },
        );
        ctx.expect.equal((seen.body.items as Json[]).filter(about).length, 1, `${type} notifications`);
      });

    if (ctx.rand.bool(0.2))
      await ctx.step('asking twice is refused', async () => {
        ctx.expect.code(
          await requester.post('/access-requests', { roleId: role.id, durationDays, justification }),
          'DUPLICATE_REQUEST',
          409,
        );
      });

    await ctx.step('it shows in My requests', async () => {
      const mine = ctx.expect.ok(await requester.get('/me/requests', { query: { q: sfx } })).body.items;
      const row = ctx.expect.find(
        mine as Json[],
        (r) => r.reference === request.reference,
        'the request is listed',
      );
      ctx.expect.equal([row.kind, row.status], ['access', 'pending'], 'kind and status');
      const page = ctx.expect.ok(await requester.get(`/requests/${request.reference}`)).body;
      ctx.expect.equal([page.kind, page.request?.id], ['access', request.id], 'the request page');
    });

    if (managerRejects) {
      const comment = ctx.rand.sentence(4, 10);
      await ctx.step('the manager rejects it (a comment is required)', async () => {
        const task = await ctx.approvals.taskOf(instanceId, 'manager');
        ctx.expect.code(await ctx.as('manager').post(`/approvals/${task.id}/reject`, {}), 'COMMENT_REQUIRED');
        const outcome = await ctx.approvals.decide(instanceId, 'manager', 'reject', {
          comment,
          viaInbox: request.reference,
        });
        ctx.expect.equal(outcome, 'rejected', 'outcome');
      });
      await ctx.step('the request is rejected and nothing granted', async () => {
        const done = await ctx.eventually(
          () => requester.get(`/access-requests/${request.id}`),
          (r) => r.body?.status === 'rejected',
          { label: 'the rejection' },
        );
        ctx.expect.equal(done.body.workflow?.outcomeComment, comment, 'the reason is kept');
        const grants = ctx.expect.ok(
          await admin.get('/role-assignments', { query: { userId: me.id, roleId: role.id } }),
        ).body;
        ctx.expect.equal(grants.items.length, 0, 'role assignments');
        const offered = ctx.expect.ok(await requester.get('/requestable-roles', { query: { q: sfx } })).body
          .items;
        const item = ctx.expect.find(offered as Json[], (r) => r.id === role.id, 'still offered');
        ctx.expect.equal([item.held, item.pendingRequest], [false, null], 'held, pending');
      });
      await toldOnce('core.access-request.rejected');
    } else {
      await ctx.step('the manager approves from their inbox', async () => {
        const twice = ctx.rand.bool(0.15);
        if (twice) ctx.tag('double approve');
        const outcome = await ctx.approvals.decide(instanceId, 'manager', 'approve', {
          viaInbox: request.reference,
          comment: ctx.rand.bool() ? ctx.rand.sentence(2, 6) : undefined,
          twice,
        });
        ctx.expect.equal(outcome, 'running', 'more approvals follow');
      });
      await ctx.step('the other approvers approve', async () => {
        const { status, decisions } = await ctx.approvals.approveAll(instanceId, {
          avoid: [ctx.personaOf(me.id)!],
          prefer: ['roleowner'],
        });
        ctx.expect.equal(status, 'approved', 'workflow outcome');
        const steps = decisions.map((d) => d.stepId);
        ctx.expect.equal(steps, risk === 'high' ? ['security', 'owner'] : ['owner'], 'steps decided');
        if (withOwner) ctx.expect.equal(decisions.at(-1)!.persona, 'roleowner', 'the access owner approved');
      });
      const assignment = await ctx.step('the grant appears', async () => {
        await ctx.eventually(
          () => requester.get(`/access-requests/${request.id}`),
          (r) => r.body?.status === 'approved',
          { label: 'the grant' },
        );
        const grants = ctx.expect.ok(
          await admin.get('/role-assignments', { query: { userId: me.id, roleId: role.id } }),
        ).body.items as Json[];
        ctx.expect.equal(grants.length, 1, 'exactly one role assignment');
        const a = grants[0]!;
        if (durationDays) {
          ctx.expect.truthy(a.expiresAt, 'a time-bound grant has an end');
          const days = (new Date(a.expiresAt).getTime() - Date.now()) / 86_400_000;
          ctx.expect.truthy(
            Math.abs(days - durationDays) < 0.2,
            `it ends in ${durationDays} days (got ${days.toFixed(2)})`,
          );
        } else ctx.expect.equal(a.expiresAt, null, 'a permanent grant has no end');
        const perms = ctx.expect.ok(await requester.get('/me/permissions')).body;
        ctx.expect.find(perms.sources as Json[], (s) => s.role?.id === role.id, 'my access shows the role');
        for (const p of role.permissions)
          ctx.expect.find(perms.grants as Json[], (g) => JSON.stringify(g).includes(p), `I hold ${p}`);
        const offered = ctx.expect.ok(await requester.get('/requestable-roles', { query: { q: sfx } })).body
          .items;
        const item = ctx.expect.find(offered as Json[], (r) => r.id === role.id, 'still offered');
        ctx.expect.equal(item.held, true, 'held');
        return a;
      });
      await toldOnce('core.access-request.approved');
      await ctx.step('the admin revokes it', async () => {
        ctx.expect.ok(await admin.delete(`/role-assignments/${assignment.id}`));
        const perms = ctx.expect.ok(await requester.get('/me/permissions')).body;
        ctx.expect.equal(
          (perms.sources as Json[]).some((s) => s.role?.id === role.id),
          false,
          'my access no longer shows the role',
        );
      });
    }

    await ctx.step('the admin retires the role', async () => {
      ctx.expect.ok(
        await admin.put(`/roles/${role.id}/request-settings`, {
          requestable: false,
          riskLevel: risk,
          ownerId: null,
          maxDurationDays: null,
          requestWorkflowId: null,
        }),
      );
    });
  },
});

/* ───────────────────────────── form-request-config-change ───────────────────────────── */

const CONFIG_CHANGE_FORM = 'config-change';

export const configChangeRequest = defineFlow({
  name: 'form-request-config-change',
  area: 'core',
  description:
    'Configuration change request form → manager, CI support groups (+ CAB) → the ITSM change is raised',
  personas: ['itstaff', 'itlead', 'approver', 'cab', 'admin'],
  timeoutMs: 240_000,
  async run(ctx) {
    const requester = ctx.as('itstaff');
    const requesterName = ctx.personaOf(ctx.user('itstaff').id)!;
    const sfx = ctx.rand.suffix();

    const form = await ctx.step('the requester opens the form', async () => {
      const catalog = ctx.expect.ok(await requester.get('/forms/catalog')).body.items as Json[];
      ctx.expect.find(catalog, (f) => f.key === CONFIG_CHANGE_FORM, 'the form is in their catalog');
      const f = await ctx.forms.published(CONFIG_CHANGE_FORM, 'itstaff');
      const keys = (f.schema.elements as Json[]).map((e) => e.key).filter(Boolean);
      for (const k of ['cis', 'title', 'changeType', 'risk', 'plannedStart', 'plannedEnd'])
        ctx.expect.truthy(keys.includes(k), `the form has the ${k} field`);
      return f;
    });
    const cisField = (form.schema.elements as Json[]).find((e) => e.key === 'cis');

    const risk = ctx.rand.weighted([
      ['low', 3],
      ['medium', 3],
      ['high', 2],
    ] as const);
    const changeType = ctx.rand.weighted([
      ['normal', 4],
      ['emergency', 1],
    ] as const);
    const { start, end } = ctx.rand.dateRange({ startIn: [2, 30], length: [0, 5] });
    const title = `Sim change ${sfx}: ${ctx.rand.words(2, 5)}`.slice(0, 200);
    const backoutPlan = risk === 'high' || ctx.rand.bool(0.5) ? ctx.rand.sentence(6, 14) : undefined;
    const answersFor = (picked: Json[]) =>
      ctx.forms.answers(form.schema, {
        cis: picked.map((r) => `${r.type}:${r.id}`),
        title,
        changeType,
        risk,
        plannedStart: start,
        plannedEnd: end,
        backoutPlan,
      });
    ctx.tag(`risk ${risk}`);

    // Items are shared: a configuration item another flow of this run created may be deleted meanwhile, so the run's own
    // are never picked. The CI support groups approve: a pick whose owners no persona can act for is picked again.
    const { cis, data, preview, owner } = await ctx.step(
      'the requester picks configuration items',
      async () => {
        const search = async (q: string) =>
          ctx.expect.ok(
            await requester.get('/records/search', {
              query: {
                q,
                types: (cisField.record.types as string[]).join(','),
                limit: 25,
                where: cisField.record.where ? JSON.stringify(cisField.record.where) : undefined,
              },
            }),
          ).body.items as Json[];
        const shared = (items: Json[]) => items.filter((r) => !String(r.title).includes(ctx.runToken));
        for (let attempt = 1; ; attempt++) {
          // Words of the seed's configuration items (the run's own are named after services, apps and servers: a word
          // they share would list those first, and a search shows 25 at a time).
          const q = ctx.rand.pick([
            'erp',
            'erp',
            'mail',
            'vpn',
            'nas',
            'portal',
            'file',
            'rack',
            'gw',
            'wlc',
            'intranet',
            'taipei',
            '01',
          ]);
          const found = shared(await search(q));
          if (!found.length) {
            ctx.expect.truthy(attempt < 8, 'some configuration items can be picked');
            continue;
          }
          const picked = ctx.rand.sample(found, 1, 3);
          const refs = picked.map((r) => `${r.type}:${r.id}`);
          const resolved = ctx.expect.ok(
            await requester.get('/records/resolve', { query: { refs: refs.join(',') } }),
          ).body;
          ctx.expect.equal(
            [resolved.items.length, resolved.hidden],
            [refs.length, 0],
            'the picked CIs resolve',
          );
          const answers = answersFor(picked);
          const shown = ctx.expect.ok(
            await requester.post(`/forms/by-key/${CONFIG_CHANGE_FORM}/preview`, { data: answers }),
          ).body as Json;
          const owners = (((shown.steps as Json[]).find((s) => s.id === 'ci-owners')?.people ?? []) as Json[])
            .map((p) => ctx.personaOf(p.id as string))
            .filter((p): p is string => Boolean(p) && p !== requesterName);
          if (owners.length) return { cis: picked, data: answers, preview: shown, owner: owners[0]! };
          ctx.expect.truthy(attempt < 6, 'a configuration item whose CI support group a persona can act for');
          ctx.tag('owners no persona acts for');
        }
      },
    );

    if (ctx.rand.bool(0.15))
      await ctx.step('an end before the start is refused', async () => {
        const dayBefore = new Date(new Date(`${start}T00:00:00Z`).getTime() - 86_400_000)
          .toISOString()
          .slice(0, 10);
        const res = await requester.post(`/forms/by-key/${CONFIG_CHANGE_FORM}/submissions`, {
          data: { ...data, plannedEnd: dayBefore },
        });
        ctx.expect.code(res, 'VALIDATION_FAILED', 400);
        ctx.expect.truthy(
          JSON.stringify(res.body).includes('plannedEnd'),
          'the error points at the end date',
        );
      });
    if (risk === 'high' && ctx.rand.bool(0.15))
      await ctx.step('a high-risk change without a rollback plan is refused', async () => {
        const { backoutPlan: _omit, ...rest } = data;
        const res = await requester.post(`/forms/by-key/${CONFIG_CHANGE_FORM}/submissions`, { data: rest });
        ctx.expect.code(res, 'VALIDATION_FAILED', 400);
        ctx.expect.truthy(
          JSON.stringify(res.body).includes('backoutPlan'),
          'the error points at the rollback plan',
        );
      });

    await ctx.step('the preview shows who approves', async () => {
      const p = preview;
      const byId = new Map((p.steps as Json[]).map((s) => [s.id, s]));
      ctx.expect.equal(byId.get('manager')?.outcome, 'ask', 'the manager is asked');
      ctx.expect.find(
        byId.get('manager')!.people as Json[],
        (x) => x.id === ctx.user('itlead').id,
        'their manager',
      );
      ctx.expect.equal(byId.get('ci-owners')?.outcome, 'ask', 'the CI support groups are asked');
      if (risk === 'high')
        ctx.expect.equal(byId.get('cab')?.outcome, 'ask', 'the CAB is asked for a high risk');
    });

    const submission = await ctx.step('the requester submits it', async () => {
      const res = ctx.expect.status(
        await requester.post(`/forms/by-key/${CONFIG_CHANGE_FORM}/submissions`, { data }),
        201,
      );
      ctx.expect.equal(res.body.status, 'pending', 'status');
      ctx.expect.match(res.body.reference, REQUEST_REF, 'reference');
      ctx.expect.truthy(res.body.workflow?.id, 'an approval started');
      return res.body as Json;
    });
    const instanceId = submission.workflow.id as string;

    const rejectAt = ctx.rand.bool(0.15) ? ctx.rand.pick(['manager', 'ci-owners'] as const) : null;
    ctx.tag(rejectAt ? `rejected at ${rejectAt}` : 'approved');

    await ctx.step('the manager decides', async () => {
      const { stepId } = await ctx.approvals.taskOf(instanceId, 'itlead');
      ctx.expect.equal(stepId, 'manager', 'the first step');
      const twice = ctx.rand.bool(0.15);
      if (twice) ctx.tag('double decision');
      const outcome = await ctx.approvals.decide(
        instanceId,
        'itlead',
        rejectAt === 'manager' ? 'reject' : 'approve',
        {
          twice,
        },
      );
      ctx.expect.equal(outcome, rejectAt === 'manager' ? 'rejected' : 'running', 'outcome');
    });

    if (rejectAt === 'ci-owners')
      await ctx.step('the CI support group rejects it', async () => {
        // A person the preview names for the CI support groups (not every CI's owners are the approver persona).
        const outcome = await ctx.approvals.decide(instanceId, owner, 'reject');
        ctx.expect.equal(outcome, 'rejected', 'outcome');
      });

    if (rejectAt) {
      await ctx.step('the request is rejected and nothing raised', async () => {
        const done = await ctx.eventually(
          () => requester.get(`/form-submissions/${submission.id}`),
          (r) => r.body?.status === 'rejected',
          { label: 'the rejection' },
        );
        ctx.expect.equal(
          (done.body.actions as Json[]).filter((a) => a.status === 'succeeded' && a.on === 'approved').length,
          0,
          'approved actions run',
        );
      });
      return;
    }

    await ctx.step('the CI support groups (and the CAB) approve', async () => {
      const { status, decisions } = await ctx.approvals.approveAll(instanceId, {
        avoid: [requesterName],
        prefer: ['approver', 'cab'],
      });
      ctx.expect.equal(status, 'approved', 'workflow outcome');
      ctx.expect.truthy(
        decisions.some((d) => d.stepId === 'ci-owners'),
        'a CI support group decided',
      );
      if (risk === 'high')
        ctx.expect.truthy(
          decisions.some((d) => d.stepId === 'cab'),
          'the CAB decided',
        );
      if (decisions.some((d) => d.stepId === 'cab')) ctx.tag('cab');
    });

    const change = await ctx.step('the process action raises the change', async () => {
      const done = await ctx.eventually(
        () => requester.get(`/form-submissions/${submission.id}`),
        (r) =>
          r.body?.status === 'approved' &&
          (r.body.actions as Json[]).length > 0 &&
          (r.body.actions as Json[]).every((a) => ['succeeded', 'failed', 'skipped'].includes(a.status)),
        { label: 'the process action', timeoutMs: 60_000 },
      );
      const runs = (done.body.actions as Json[]).filter((a) => a.actionId === 'raise-change');
      ctx.expect.equal(runs.length, 1, 'runs of the action');
      const run = runs[0]!;
      ctx.expect.equal(run.status, 'succeeded', 'the action succeeded');
      ctx.expect.match(run.result?.reference, /^CHG-\d+$/, 'the change reference');
      return run.result as Json;
    });

    await ctx.step('the change is in ITSM, linked to the CIs', async () => {
      const t = ctx.expect.ok(await requester.get(`/itsm/tickets/${change.reference}`)).body;
      ctx.expect.equal(t.type, 'change', 'type');
      ctx.expect.truthy(String(t.title).includes(submission.reference), 'the title names the request');
      ctx.expect.equal(t.status, 'authorization', 'submitted for authorization');
      const ids = new Set((t.cis as Json[]).map((c) => c.id));
      for (const c of cis) ctx.expect.truthy(ids.has(c.id), `the change is linked to ${c.title}`);
    });

    await ctx.step('the request page shows what happened next', async () => {
      const page = ctx.expect.ok(await requester.get(`/requests/${submission.reference}`)).body;
      ctx.expect.equal(page.kind, 'form', 'kind');
      const actions = page.submission.actions as Json[];
      ctx.expect.truthy(actions.length > 0, 'there are runs');
      ctx.expect.equal(
        actions.map((a) => [a.actionId, a.status, a.error]),
        actions.map((a) => [a.actionId, 'succeeded', null]),
        'every run succeeded',
      );
      ctx.expect.truthy((page.submission.decisions as Json[]).length >= 2, 'the decisions are listed');
    });

    await ctx.step('the requester is told once', async () => {
      const about = (n: Json) =>
        n.type === 'core.form-submission.approved' && JSON.stringify(n).includes(submission.reference);
      const seen = await ctx.eventually(
        () => requester.get('/me/notifications', { query: { pageSize: 100 } }),
        (r) => ((r.body?.items ?? []) as Json[]).some(about),
        { label: 'the approved notification' },
      );
      ctx.expect.equal((seen.body.items as Json[]).filter(about).length, 1, '"approved" notifications');
    });
  },
});

/* ───────────────────────────── ticket-lifecycle ───────────────────────────── */

const RESOLUTIONS = ['solved', 'workaround', 'user_error', 'no_fault_found', 'not_reproducible'];

export const ticketLifecycle = defineFlow({
  name: 'ticket-lifecycle',
  area: 'itsm',
  description:
    'Employee raises an incident → agent takes, comments, resolves (sign-off when bound) → confirmed',
  personas: ['employee', 'agent', 'itlead'],
  async run(ctx) {
    const requester = ctx.as('employee');
    const agent = ctx.as('agent');
    const agentName = ctx.personaOf(ctx.user('agent').id)!;
    const sfx = ctx.rand.suffix();
    const T = '/itsm/tickets';

    const ticket = await ctx.step('the employee raises an incident', async () => {
      const res = ctx.expect.status(
        await requester.post(T, {
          type: 'incident',
          title: `${ctx.rand.words(2, 6)} ${sfx}`,
          description: ctx.rand.paragraph(1, 3),
          urgency: ctx.rand.int(1, 3),
        }),
        201,
      );
      const t = res.body;
      ctx.expect.equal(
        [t.type, t.status, t.viewer?.role],
        ['incident', 'new', 'requester'],
        'type, status, viewer',
      );
      ctx.expect.match(t.reference, /^INC-\d+$/, 'reference');
      ctx.expect.equal(t.requester?.id, ctx.user('employee').id, 'requester');
      return t as Json;
    });
    const ref = ticket.reference as string;

    await ctx.step('it shows in their tickets and requests', async () => {
      const mine = ctx.expect.ok(await requester.get(T, { query: { view: 'mine', q: sfx } })).body.items;
      ctx.expect.find(mine as Json[], (t) => t.reference === ref, 'my tickets list it');
      const requests = ctx.expect.ok(await requester.get('/me/requests', { query: { q: sfx } })).body.items;
      ctx.expect.find(requests as Json[], (r) => r.reference === ref, 'My requests lists it');
    });

    await ctx.step('an agent finds it in the queue and takes it', async () => {
      const view = ctx.rand.pick(['unassigned', 'groups', 'all']);
      const queue = ctx.expect.ok(await agent.get(T, { query: { view, q: sfx } })).body.items;
      ctx.expect.find(queue as Json[], (t) => t.reference === ref, `the ${view} queue lists it`);
      if (ctx.rand.bool(0.15)) {
        // Two agents take it at the same moment: whoever is last owns it, and the ticket says so consistently.
        ctx.tag('two agents take it');
        const other = ctx.as(
          ctx.rand.pick(['helpdesk', ...['agent1', 'agent2', 'agent3'].filter((a) => a !== agentName)]),
        );
        const both = await Promise.all([
          agent.post(`${T}/${ref}/assign-to-me`),
          other.post(`${T}/${ref}/assign-to-me`),
        ]);
        for (const r of both) ctx.expect.ok(r, 'taking a ticket');
        const after = ctx.expect.ok(await agent.get(`${T}/${ref}`)).body;
        ctx.expect.truthy(
          [ctx.user('agent').id, other.userId].includes(after.assignee?.id),
          'the ticket is assigned to one of them',
        );
      }
      const taken = ctx.expect.ok(await agent.post(`${T}/${ref}/assign-to-me`)).body;
      ctx.expect.equal(taken.assignee?.id, ctx.user('agent').id, 'assignee');
    });

    await ctx.step('the agent replies', async () => {
      const reply = ctx.expect.status(
        await agent.post(`${T}/${ref}/comments`, { body: ctx.rand.sentence() }),
        201,
      );
      ctx.expect.equal([reply.body.kind, reply.body.public], ['comment', true], 'a public reply');
      if (ctx.rand.bool(0.5)) {
        const note = ctx.expect.status(
          await agent.post(`${T}/${ref}/comments`, { body: ctx.rand.sentence(), public: false }),
          201,
        );
        ctx.expect.equal(note.body.kind, 'work_note', 'a work note');
      }
    });

    if (ctx.rand.bool(0.5))
      await ctx.step('the requester answers', async () => {
        ctx.expect.status(await requester.post(`${T}/${ref}/comments`, { body: ctx.rand.sentence() }), 201);
      });

    await ctx.step('the requester never sees work notes', async () => {
      const acts = ctx.expect.ok(await requester.get(`${T}/${ref}/activities`, { query: { pageSize: 100 } }))
        .body.items as Json[];
      ctx.expect.equal(
        acts.filter((a) => a.kind === 'work_note').length,
        0,
        'work notes shown to the requester',
      );
    });

    if (ctx.rand.bool(0.5))
      await ctx.step('the agent starts work', async () => {
        const t = ctx.expect.ok(await agent.post(`${T}/${ref}/transition`, { status: 'in_progress' })).body;
        ctx.expect.equal(t.status, 'in_progress', 'status');
      });

    const resolve = async (round: number) =>
      ctx.step(round === 1 ? 'the agent resolves it' : 'the agent resolves it again', async () => {
        const body = {
          status: 'resolved',
          resolutionCode: ctx.rand.pick(RESOLUTIONS),
          resolutionNotes: ctx.rand.sentence(4, 12),
        };
        let res: Json;
        if (ctx.rand.bool(0.15)) {
          ctx.tag('double resolve');
          const both = await Promise.all([1, 2].map(() => agent.post(`${T}/${ref}/transition`, body)));
          res = ctx.expect.oneOk(both, 'one resolution goes through', [409]).body;
        } else res = ctx.expect.ok(await agent.post(`${T}/${ref}/transition`, body)).body;
        if (res.status === 'pending_approval') {
          ctx.tag('sign-off');
          ctx.expect.truthy(res.signOff?.instanceId, 'the sign-off instance');
          const { status } = await ctx.approvals.approveAll(res.signOff.instanceId, { avoid: [agentName] });
          ctx.expect.equal(status, 'approved', 'the sign-off');
          await ctx.eventually(
            () => agent.get(`${T}/${ref}`),
            (r) => r.body?.status === 'resolved',
            { label: 'the signed-off resolution' },
          );
        } else ctx.expect.equal(res.status, 'resolved', 'status');
      });
    await resolve(1);

    await ctx.step('the requester sees it resolved', async () => {
      const t = ctx.expect.ok(await requester.get(`${T}/${ref}`)).body;
      ctx.expect.equal(t.status, 'resolved', 'status');
      ctx.expect.truthy(t.resolutionCode, 'the resolution');
      ctx.expect.equal([t.viewer?.canConfirm, t.viewer?.canReopen], [true, true], 'confirm or reopen');
    });

    const next = ctx.rand.weighted([
      ['confirm', 6],
      ['reopen', 2],
      ['leave', 2],
    ] as const);
    ctx.tag(next);
    if (next === 'reopen') {
      await ctx.step('the requester reopens it', async () => {
        const t = ctx.expect.ok(
          await requester.post(`${T}/${ref}/reopen`, { reason: ctx.rand.sentence(3, 8) }),
        ).body;
        ctx.expect.equal([t.status, t.resolutionCode], ['in_progress', null], 'back in progress');
      });
      await resolve(2);
    }
    if (next !== 'leave')
      await ctx.step('the requester confirms the fix', async () => {
        const rating = ctx.rand.int(1, 5);
        const t = ctx.expect.ok(
          await requester.post(`${T}/${ref}/confirm`, {
            rating,
            ...(ctx.rand.bool() ? { comment: ctx.rand.sentence(2, 8) } : {}),
          }),
        ).body;
        ctx.expect.equal([t.status, t.satisfaction], ['closed', rating], 'closed with the rating');
        const requests = ctx.expect.ok(await requester.get('/me/requests', { query: { q: sfx } })).body.items;
        const row = ctx.expect.find(requests as Json[], (r) => r.reference === ref, 'My requests lists it');
        // The requester's words for the status (`itsm.requesterStatus.*`), not the agent's queue vocabulary.
        ctx.expect.equal(row.statusKey, 'itsm.requesterStatus.closed', 'My requests shows it closed');
      });

    await ctx.step('the requester was told of each resolution once', async () => {
      const resolutions = next === 'reopen' ? 2 : 1;
      const about = (n: Json) => n.type === 'itsm.ticket.resolved' && JSON.stringify(n).includes(ref);
      // Newest first: a page of 100 holds this run's notifications even with other runs for the same person.
      const seen = await ctx.eventually(
        () => requester.get('/me/notifications', { query: { pageSize: 100 } }),
        (r) => ((r.body?.items ?? []) as Json[]).filter(about).length >= resolutions,
        { label: 'the resolved notifications' },
      );
      const told = (seen.body.items as Json[]).filter(about);
      ctx.expect.equal(told.length, resolutions, '"resolved" notifications');
      ctx.expect.ok(await requester.post('/me/notifications/read', { ids: told.map((n) => n.id) }));
    });
  },
});
