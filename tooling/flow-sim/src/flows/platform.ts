/**
 * Platform core flows: the seeded request forms through their approvals (decisions, step fields, delegation,
 * reassignment, withdrawal), requests as records (files, links, the print view), process actions of a form built for
 * the run (notify, ticket, role, reminder; webhooks refused), and people (onboarding, groups, custom fields, a
 * department transfer, offboarding, notifications).
 */
import type { Json } from '../client';
import { defineFlow, type FlowContext } from '../flow';
import {
  colleague,
  day,
  noticesOf,
  REQUEST_REF,
  refused,
  routeMissing,
  settledRequest,
  SETTLED,
  text3,
} from './platform-kit';

/* ───────────────────────────── request-forms ───────────────────────────── */

/** `form-request-config-change` (core.ts) runs the configuration change form: it needs CIs picked from the CMDB. */
const COVERED_ELSEWHERE = new Set(['config-change']);
/** Forms the simulator's flows make for themselves (never the seed's). */
const simMade = (key: string) => /^(sim|isms)/.test(key) || /[0-9a-z]{6}-[0-9a-z]+-[0-9a-z]{3}/.test(key);
/** Personas who may take over an approval (none of them requests anything in this flow). */
const DELEGATES = ['itlead', 'approver', 'cab', 'roleowner', 'finance'];
/** A persona in each group a seeded form is offered to (sim.approver is in every CI support group). */
const AUDIENCE_PERSONA: Record<string, string> = {
  'it-admins': 'approver',
  'service-desk': 'approver',
  'network-team': 'approver',
  'security-team': 'approver',
  'dba-team': 'approver',
  'app-owners': 'approver',
  'finance-team': 'finance',
  cab: 'cab',
};

type Ending = 'approve' | 'reject' | 'withdraw' | 'admin-cancel';

/** Answers for the seed's forms that make their routes interesting; anything else is answered from its schema. */
function answersFor(ctx: FlowContext, form: Json, requesterId: string): Record<string, unknown> | null {
  const { rand } = ctx;
  const schema = form.schema as { elements: Json[] };
  const options = (key: string) =>
    ((schema.elements.find((e) => e.key === key)?.options ?? []) as Json[]).map((o) => o.value as string);
  const reason = () => `${rand.sentence(6, 14)} ${rand.suffix()}`;
  switch (form.key) {
    case 'laptop-request': {
      // Above 60 000 TWD IS asset management approves too.
      const amount = rand.bool(0.3) ? rand.int(60_001, 150_000) : rand.int(15_000, 60_000);
      if (amount > 60_000) ctx.tag('laptop over 60k');
      return ctx.forms.answers(schema, { amount, justification: reason() });
    }
    case 'equipment-request': {
      const itemType = rand.pick(options('itemType'));
      const forSomeoneElse = rand.bool(0.25);
      // Above 45 000 TWD the Finance Team approves too.
      const estimatedCost = rand.bool(0.3) ? rand.int(45_001, 270_000) : rand.int(600, 45_000);
      if (estimatedCost > 45_000) ctx.tag('equipment over 45k');
      if (forSomeoneElse) ctx.tag('for someone else');
      return ctx.forms.answers(schema, {
        itemType,
        laptopModel: itemType === 'laptop' ? rand.pick(options('laptopModel')) : undefined,
        otherItem: itemType === 'other' ? rand.words(2, 5) : undefined,
        quantity: rand.int(1, 4),
        estimatedCost,
        forSomeoneElse,
        recipient: forSomeoneElse ? ctx.user(colleague(ctx)).id : undefined,
        justification: reason(),
      });
    }
    case 'software-request': {
      const licenseType = rand.pick(options('licenseType'));
      const dataClassification = rand.pick(options('dataClassification'));
      if (licenseType !== 'free') ctx.tag('paid licence');
      if (['confidential', 'restricted'].includes(dataClassification)) ctx.tag('security review');
      return ctx.forms.answers(schema, {
        softwareName: `${rand.words(1, 3)} ${rand.suffix()}`.slice(0, 200),
        licenseType,
        dataClassification,
        seats: rand.int(1, 50),
        purpose: reason(),
      });
    }
    case 'lost-device': {
      const stolen = rand.bool(0.4);
      return ctx.forms.answers(schema, {
        stolen,
        policeReport: stolen ? `PR-${rand.int(10_000, 99_999)}` : undefined,
        lostOn: day(-rand.int(0, 10)),
        details: reason(),
      });
    }
    case 'server-room-inspection':
      return ctx.forms.answers(schema, {
        inspectedOn: day(0),
        temperature: rand.int(16, 30),
        humidity: rand.int(25, 70),
        findings: rand.bool(0.4) ? reason() : undefined,
      });
    default: {
      // A form the seed gained later: people pick themselves; forms that need records picked are left to others.
      const overrides: Record<string, unknown> = {};
      for (const el of schema.elements) {
        if (!el.key) continue;
        if (el.type === 'user') overrides[el.key] = el.required ? requesterId : undefined;
        if ((el.type === 'record' || el.type === 'rows') && el.required) return null;
        if (el.type === 'record' || el.type === 'rows') overrides[el.key] = undefined;
      }
      return ctx.forms.answers(schema, overrides);
    }
  }
}

export const requestForms = defineFlow({
  name: 'request-forms',
  area: 'platform',
  description:
    'A seeded request form → its approval: decisions with step fields, delegation, reassignment, withdrawal, rejection',
  personas: ['admin', 'employee', 'manager', 'itlead', 'approver', 'finance', 'assetmgr', 'cab', 'roleowner'],
  timeoutMs: 240_000,
  async run(ctx) {
    const admin = ctx.as('admin');

    const chosen = await ctx.step('pick a seeded request form', async () => {
      const all = ctx.expect.ok(await admin.get('/forms')).body.items as Json[];
      const seeded = all.filter(
        (f) =>
          f.active &&
          !f.archived &&
          f.publishedVersion &&
          !simMade(f.key) &&
          !COVERED_ELSEWHERE.has(f.key) &&
          f.key !== 'never-published',
      );
      ctx.expect.truthy(seeded.length, 'the seed has request forms');
      const f = ctx.rand.pick(seeded);
      const audience = (f.audience?.groupKeys ?? []) as string[];
      const persona =
        f.audience?.type === 'groups'
          ? (audience.map((g) => AUDIENCE_PERSONA[g]).find(Boolean) ?? null)
          : 'employee';
      return { form: f, persona };
    });
    ctx.tag(chosen.form.key);
    if (!chosen.persona) {
      ctx.tag('no persona in the audience');
      return;
    }
    const requesterName = chosen.persona;
    const requester = ctx.as(requesterName);
    const me = ctx.user(requesterName);
    const key = chosen.form.key as string;

    const form = await ctx.step('the requester opens the form from the catalog', async () => {
      const catalog = ctx.expect.ok(await requester.get('/forms/catalog')).body.items as Json[];
      ctx.expect.find(catalog, (f) => f.key === key, 'the catalog offers it');
      return ctx.forms.published(key, requesterName);
    });
    const data = answersFor(ctx, form, me.id);
    if (!data) {
      ctx.tag('needs records: skipped');
      return;
    }

    const required = (form.schema.elements as Json[]).filter(
      (e) => e.required && e.key && !e.visibleWhen && e.key in data,
    );
    if (required.length && ctx.rand.bool(0.15))
      await ctx.step('a missing answer is refused', async () => {
        const missing = ctx.rand.pick(required).key as string;
        const { [missing]: _drop, ...rest } = data;
        const res = await requester.post(`/forms/by-key/${key}/submissions`, { data: rest });
        ctx.expect.code(res, 'VALIDATION_FAILED', 400);
        ctx.expect.truthy(JSON.stringify(res.body).includes(`data.${missing}`), `the error names ${missing}`);
      });

    if (form.hasApproval)
      await ctx.step('the preview shows who approves', async () => {
        const p = ctx.expect.ok(await requester.post(`/forms/by-key/${key}/preview`, { data })).body;
        ctx.expect.truthy((p.steps as Json[]).length, 'the approval has steps');
      });

    const sub = await ctx.step('the requester sends it', async () => {
      const res = ctx.expect.status(await requester.post(`/forms/by-key/${key}/submissions`, { data }), 201);
      ctx.expect.match(res.body.reference, REQUEST_REF, 'reference');
      if (form.hasApproval) {
        ctx.expect.equal(res.body.status, 'pending', 'status');
        ctx.expect.truthy(res.body.workflow?.id, 'an approval started');
      }
      return res.body as Json;
    });
    const ref = sub.reference as string;

    await ctx.step('it shows in My requests, and nobody else sees it', async () => {
      // `q` matches form names (not a request's own reference): the newest page holds it.
      const mine = ctx.expect.ok(await requester.get('/me/requests', { query: { pageSize: 50 } })).body.items;
      ctx.expect.find(mine as Json[], (r) => r.reference === ref, 'My requests lists it');
      const stranger = ctx.as(colleague(ctx));
      refused(ctx, await stranger.get(`/requests/${ref}`), [403, 404], 'a colleague opens the request');
      refused(ctx, await stranger.get(`/form-submissions/${sub.id}`), [403, 404], 'a colleague reads it');
      if (sub.workflow?.id)
        refused(
          ctx,
          await stranger.get(`/workflow-instances/${sub.workflow.id}`),
          [403, 404],
          'a colleague reads its approval',
        );
    });

    let outcome: string;
    let decided: { persona: string; stepId: string; verdict: string }[] = [];
    if (!form.hasApproval) {
      outcome = (await settledRequest(ctx, requester, sub.id)).status;
      ctx.tag('no approval');
    } else {
      const ending = ctx.rand.weighted<Ending>([
        ['approve', 6],
        ['reject', 2],
        ['withdraw', 1.5],
        ['admin-cancel', 0.5],
      ]);
      ctx.tag(`wanted: ${ending}`);
      ({ outcome, decided } = await walkApprovals(ctx, {
        instanceId: sub.workflow.id,
        submissionId: sub.id,
        reference: ref,
        requester: requesterName,
        ending,
      }));
    }
    ctx.tag(`outcome ${outcome}`);

    const final = await ctx.step('the request reaches the outcome', async () => {
      const status =
        { approved: 'approved', rejected: 'rejected', cancelled: 'cancelled' }[outcome] ?? outcome;
      const done = await settledRequest(ctx, requester, sub.id, { status, label: `the ${status} request` });
      const approvals = decided.filter((d) => d.verdict === 'approve').length;
      const rejections = decided.filter((d) => d.verdict === 'reject').length;
      const listed = (done.decisions as Json[]).filter((d) => ['approved', 'rejected'].includes(d.status));
      ctx.expect.equal(
        [
          listed.filter((d) => d.status === 'approved').length,
          listed.filter((d) => d.status === 'rejected').length,
        ],
        [approvals, rejections],
        'the decisions the request lists',
      );
      ctx.expect.equal(
        (done.actions as Json[]).filter((a) => a.status === 'failed').map((a) => [a.actionId, a.error]),
        [],
        'failed process actions',
      );
      return done;
    });

    if (outcome === 'approved' || outcome === 'rejected')
      if (form.hasApproval)
        await ctx.step('the requester is told once', async () => {
          const type = `core.form-submission.${outcome}`;
          const about = (n: Json) => n.type === type && JSON.stringify(n).includes(ref);
          const told = await noticesOf(ctx, requesterName, about, `the ${outcome} notification`);
          ctx.expect.equal(told.length, 1, `"${outcome}" notifications`);
        });

    if (outcome !== 'cancelled' && final.canCancel === true)
      ctx.fail('a decided request can still be withdrawn', { status: final.status });

    if (outcome === 'approved' || outcome === 'rejected')
      await ctx.step('withdrawing a decided request is refused', async () => {
        refused(
          ctx,
          await requester.post(`/form-submissions/${sub.id}/cancel`, { reason: 'Too late' }),
          [400, 409],
          'withdrawing a decided request',
        );
      });

    await ctx.step('the print view opens for the requester and an approver', async () => {
      const page = ctx.expect.ok(await requester.get(`/requests/${ref}`)).body;
      ctx.expect.equal([page.kind, page.submission?.id], ['form', sub.id], 'the request page');
      ctx.expect.ok(await requester.get(`/records/core.request/${sub.id}/files`), 'its attachments');
      const approver = decided.find((d) => d.persona !== 'admin')?.persona;
      if (approver) ctx.expect.ok(await ctx.as(approver).get(`/requests/${ref}`), `${approver} opens it`);
    });
  },
});

/**
 * Decides an approval as the people it asks until it ends (or the requester or an administrator withdraws it): the
 * decisions fill the steps' fields, some are delegated or reassigned first, some sent twice at once, and outsiders
 * who try are refused.
 */
async function walkApprovals(
  ctx: FlowContext,
  o: { instanceId: string; submissionId: string; reference: string; requester: string; ending: Ending },
): Promise<{ outcome: string; decided: { persona: string; stepId: string; verdict: string }[] }> {
  const decided: { persona: string; stepId: string; verdict: string }[] = [];
  const rejectAt = o.ending === 'reject' ? ctx.rand.int(0, 1) : -1;
  const stopAt = o.ending === 'withdraw' || o.ending === 'admin-cancel' ? ctx.rand.int(0, 1) : -1;
  const requesterId = ctx.user(o.requester).id;
  for (let i = 0; i <= 12; i++) {
    let inst = await ctx.approvals.instance(o.instanceId);
    for (let w = 0; inst.status === 'running' && !(inst.pendingWith as Json[]).length && w < 40; w++) {
      await new Promise((r) => setTimeout(r, 250));
      inst = await ctx.approvals.instance(o.instanceId);
    }
    if (i === stopAt || (stopAt >= 0 && inst.status !== 'running'))
      return { outcome: await withdraw(ctx, o, inst, decided), decided };
    if (inst.status !== 'running') return { outcome: inst.status, decided };
    if (i === 12) ctx.fail('the approval was still running after 12 decisions', { decided });

    const asked = (inst.pendingWith as { id: string }[])
      .map((p) => ctx.personaOf(p.id))
      .filter((n): n is string => Boolean(n) && n !== o.requester);
    if (!asked.length)
      ctx.fail('the approval waits for people none of the personas is', {
        pendingWith: inst.pendingWith,
        currentSteps: inst.currentSteps,
      });
    let persona = ctx.rand.pick(
      asked.filter((p) => p !== 'admin').length ? asked.filter((p) => p !== 'admin') : asked,
    );
    const task = await ctx.approvals.taskOf(o.instanceId, persona);

    if (ctx.rand.bool(0.1))
      await ctx.step('someone who isn’t asked can’t decide', async () => {
        const outsider = ctx.rand.pick(DELEGATES.filter((p) => !asked.includes(p)));
        refused(
          ctx,
          await ctx.as(outsider).post(`/approvals/${task.id}/approve`, { comment: 'Not mine' }),
          [403, 404, 409],
          `${outsider} approves someone else’s task`,
        );
      });

    const handOver = ctx.rand.weighted([
      ['none', 7],
      ['delegate', 1.5],
      ['reassign', 1.5],
    ] as const);
    if (handOver !== 'none') {
      const target = ctx.rand.pick(DELEGATES.filter((p) => p !== persona && !asked.includes(p)));
      ctx.tag(handOver === 'delegate' ? 'delegated' : 'reassigned by admin');
      await ctx.step(
        handOver === 'delegate'
          ? `${persona} delegates to ${target}`
          : `an administrator reassigns to ${target}`,
        async () => {
          const by = ctx.as(handOver === 'delegate' ? persona : 'admin');
          if (ctx.rand.bool(0.25))
            ctx.expect.code(
              await by.post(`/approvals/${task.id}/delegate`, { userId: requesterId }),
              'INVALID_DELEGATE',
              409,
              'handing the approval to the requester is refused',
            );
          const body = { userId: ctx.user(target).id, comment: ctx.rand.sentence(2, 6) };
          if (ctx.rand.bool(0.15)) {
            ctx.tag('double delegate');
            const both = await Promise.all([1, 2].map(() => by.post(`/approvals/${task.id}/delegate`, body)));
            ctx.expect.oneOk(both, 'one hand-over goes through', [409]);
          } else ctx.expect.ok(await by.post(`/approvals/${task.id}/delegate`, body));
          await ctx.approvals.taskOf(o.instanceId, target);
          const before = ctx.expect.ok(await ctx.as(persona).get(`/workflow-instances/${o.instanceId}`)).body;
          ctx.expect.truthy(before.myTaskId !== task.id, `${persona} no longer holds the task`);
          refused(
            ctx,
            await ctx.as(persona).post(`/approvals/${task.id}/approve`, {}),
            [403, 404, 409],
            'the handed-over task can’t be decided',
          );
        },
      );
      persona = target;
    }

    const verdict = i === rejectAt ? 'reject' : 'approve';
    const twice = ctx.rand.bool(0.12);
    if (twice) ctx.tag('double decision');
    const { stepId } = await ctx.approvals.taskOf(o.instanceId, persona);
    await ctx.step(`${persona} ${verdict}s (step ${stepId})`, async () => {
      if (verdict === 'reject' && ctx.rand.bool(0.3)) {
        const t = await ctx.approvals.taskOf(o.instanceId, persona);
        ctx.expect.code(
          await ctx.as(persona).post(`/approvals/${t.id}/reject`, {}),
          'COMMENT_REQUIRED',
          undefined,
          'rejecting without a comment',
        );
      }
      await ctx.approvals.decide(o.instanceId, persona, verdict, {
        twice,
        viaInbox: ctx.rand.bool(0.5) ? o.reference : undefined,
        comment:
          verdict === 'reject'
            ? ctx.rand.sentence(3, 9)
            : ctx.rand.bool()
              ? ctx.rand.sentence(2, 6)
              : undefined,
      });
    });
    decided.push({ persona, stepId, verdict });
  }
  return { outcome: 'running', decided };
}

/** The requester withdraws the request, or an administrator cancels its approval. */
async function withdraw(
  ctx: FlowContext,
  o: { instanceId: string; submissionId: string; reference: string; requester: string; ending: Ending },
  inst: Json,
  decided: { persona: string; stepId: string; verdict: string }[],
): Promise<string> {
  const requester = ctx.as(o.requester);
  if (inst.status !== 'running') {
    // It ended before anyone withdrew it: withdrawing now is refused.
    ctx.tag('ended before the withdrawal');
    refused(
      ctx,
      await requester.post(`/form-submissions/${o.submissionId}/cancel`, { reason: 'Changed my mind' }),
      [400, 409],
      'withdrawing a decided request',
    );
    return inst.status;
  }
  const pending = (inst.pendingWith as { id: string }[])
    .map((p) => ctx.personaOf(p.id))
    .filter(Boolean) as string[];
  const waiting = pending.find((p) => p !== o.requester);
  const task = waiting ? await ctx.approvals.taskOf(o.instanceId, waiting) : null;
  await ctx.step(
    o.ending === 'withdraw' ? 'the requester withdraws it' : 'an administrator cancels the approval',
    async () => {
      const body = { reason: ctx.rand.sentence(2, 6) };
      if (o.ending === 'withdraw') {
        if (ctx.rand.bool(0.25)) {
          ctx.tag('double withdraw');
          const both = await Promise.all(
            [1, 2].map(() => requester.post(`/form-submissions/${o.submissionId}/cancel`, body)),
          );
          ctx.expect.oneOk(both, 'one withdrawal goes through', [409]);
        } else ctx.expect.ok(await requester.post(`/form-submissions/${o.submissionId}/cancel`, body));
      } else ctx.expect.ok(await ctx.as('admin').post(`/workflow-instances/${o.instanceId}/cancel`, body));
    },
  );
  await ctx.step('the approver can no longer decide it', async () => {
    const after = await ctx.eventually(
      () => ctx.approvals.instance(o.instanceId),
      (i) => i.status !== 'running',
      { label: 'the cancelled approval' },
    );
    ctx.expect.equal(after.status, 'cancelled', 'the approval');
    if (task && waiting) {
      refused(
        ctx,
        await ctx.as(waiting).post(`/approvals/${task.id}/approve`, {}),
        [403, 404, 409],
        'deciding a withdrawn request',
      );
      const inbox = ctx.expect.ok(
        await ctx.as(waiting).get('/me/approvals', { query: { q: o.reference, pageSize: 50 } }),
      ).body.items as Json[];
      ctx.expect.equal(
        inbox.filter((i) => i.instance?.id === o.instanceId && i.task?.status === 'pending').length,
        0,
        'pending tasks in the approver’s inbox',
      );
    }
  });
  void decided;
  return 'cancelled';
}

/* ───────────────────────────── request-records ───────────────────────────── */

const EQUIPMENT_FORM = 'equipment-request';

/** A cheap equipment request for oneself: the requester's manager approves it alone. */
async function equipmentRequest(ctx: FlowContext): Promise<Json> {
  const requester = ctx.as('employee');
  const form = await ctx.forms.published(EQUIPMENT_FORM, 'employee');
  const data = ctx.forms.answers(form.schema, {
    itemType: 'headset',
    laptopModel: undefined,
    otherItem: undefined,
    quantity: 1,
    estimatedCost: ctx.rand.int(20, 400),
    forSomeoneElse: false,
    recipient: undefined,
    justification: `${ctx.rand.sentence(6, 12)} ${ctx.rand.suffix()}`,
  });
  return ctx.expect.status(await requester.post(`/forms/by-key/${EQUIPMENT_FORM}/submissions`, { data }), 201)
    .body;
}

/** Bytes that sniff as a Windows executable, whatever the file is called. */
const EXECUTABLE = new Uint8Array([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff,
]);

export const requestRecords = defineFlow({
  name: 'request-records',
  area: 'platform',
  description:
    'Files and links on requests: the requester and approver attach, download and remove; strangers get 404; blocked types are refused',
  personas: ['employee', 'manager', 'admin'],
  async run(ctx) {
    const requester = ctx.as('employee');
    const manager = ctx.as('manager');
    const stranger = ctx.as(colleague(ctx));
    const sfx = ctx.rand.suffix();

    const [a, b] = await ctx.step('the requester makes two requests', async () => [
      await equipmentRequest(ctx),
      await equipmentRequest(ctx),
    ]);
    const files = (id: string) => `/records/core.request/${id}/files`;

    const mine = await ctx.step('the requester attaches evidence', async () => {
      const content = `Quote ${sfx}: ${ctx.rand.int(10, 999)} USD\n${ctx.rand.sentence()}`;
      const name = `quote-${sfx}.txt`;
      const res = ctx.expect.status(
        await requester.upload(files(a.id), { name, contentType: 'text/plain', data: content }),
        201,
      );
      ctx.expect.equal([res.body.name, res.body.contentType], [name, 'text/plain'], 'the file');
      if (ctx.rand.bool(0.3)) {
        ctx.tag('two uploads at once');
        const both = await Promise.all(
          [1, 2].map((n) =>
            requester.upload(files(a.id), {
              name: `extra-${n}-${sfx}.csv`,
              contentType: 'text/csv',
              data: `a,b\n${n},${ctx.rand.int(1, 9)}\n`,
            }),
          ),
        );
        for (const r of both) ctx.expect.status(r, 201, 'each upload is kept');
      }
      return { ...res.body, content } as Json;
    });

    await ctx.step('the approver adds a file and reads the requester’s', async () => {
      await ctx.approvals.taskOf(a.workflow.id, 'manager');
      ctx.expect.status(
        await manager.upload(files(a.id), {
          name: `evaluation-${sfx}.md`,
          contentType: 'text/markdown',
          data: `# Evaluation\n\n${ctx.rand.paragraph(1, 2)}`,
        }),
        201,
      );
      const list = ctx.expect.ok(await manager.get(files(a.id))).body;
      const names = (list.files as Json[]).map((f) => f.name);
      ctx.expect.truthy(names.includes(mine.name), 'the approver sees the requester’s file');
      const dl = ctx.expect.ok(await manager.get(mine.href), 'the approver downloads it');
      ctx.expect.equal(String(dl.body), mine.content, 'the downloaded content');
    });

    await ctx.step('a stranger sees nothing and changes nothing', async () => {
      refused(ctx, await stranger.get(files(a.id)), [404], 'a stranger lists the files');
      refused(ctx, await stranger.get(mine.href), [404], 'a stranger downloads');
      refused(ctx, await stranger.delete(mine.href), [404], 'a stranger deletes');
      refused(
        ctx,
        await stranger.upload(files(a.id), { name: 'spam.txt', contentType: 'text/plain', data: 'hello' }),
        [404],
        'a stranger uploads',
      );
      refused(ctx, await stranger.get(`/records/core.request/${a.id}`), [404], 'a stranger opens the record');
    });

    await ctx.step('a blocked file type is refused cleanly', async () => {
      const bad = ctx.rand.pick([
        { name: `setup-${sfx}.exe`, contentType: 'application/octet-stream', data: EXECUTABLE },
        { name: `page-${sfx}.html`, contentType: 'text/html', data: '<html><body>hi</body></html>' },
        { name: `notes-${sfx}.txt`, contentType: 'text/plain', data: EXECUTABLE },
        { name: `script-${sfx}.ps1`, contentType: 'text/plain', data: 'Write-Host hi' },
      ]);
      ctx.tag(`blocked ${bad.name.split('.').pop()}`);
      ctx.expect.code(await requester.upload(files(a.id), bad), 'FILE_REJECTED', 422);
      const list = ctx.expect.ok(await requester.get(files(a.id))).body.files as Json[];
      ctx.expect.equal(list.filter((f) => f.name === bad.name).length, 0, 'the refused file is not listed');
    });

    await ctx.step('the requester removes a file of theirs', async () => {
      const wrong = ctx.expect.status(
        await requester.upload(files(a.id), {
          name: `wrong-${sfx}.txt`,
          contentType: 'text/plain',
          data: 'Wrong file',
        }),
        201,
      ).body;
      ctx.expect.status(await requester.delete(wrong.href), 204);
      refused(ctx, await requester.get(wrong.href), [404], 'the removed file');
    });

    await ctx.step('the requester links the two requests', async () => {
      const link = ctx.expect.status(
        await requester.post(`/records/core.request/${a.id}/links`, {
          to: { type: 'core.request', id: b.id },
        }),
        [200, 201],
      ).body;
      const fromB = ctx.expect.ok(await requester.get(`/records/core.request/${b.id}/links`)).body;
      const back = ctx.expect.find(
        fromB.links as Json[],
        (l) => l.ref?.id === a.id,
        'the link shows from the other end',
      );
      ctx.expect.equal(back.record?.reference, a.reference, 'the linked request');
      refused(
        ctx,
        await stranger.post(`/records/core.request/${a.id}/links`, {
          to: { type: 'core.request', id: b.id },
        }),
        [404],
        'a stranger links',
      );
      refused(
        ctx,
        await stranger.delete(`/records/core.request/${a.id}/links/${link.id}`),
        [404],
        'a stranger unlinks',
      );
      if (ctx.rand.bool(0.5)) {
        ctx.tag('unlinked');
        ctx.expect.status(await requester.delete(`/records/core.request/${a.id}/links/${link.id}`), 204);
        const after = ctx.expect.ok(await requester.get(`/records/core.request/${b.id}/links`)).body;
        ctx.expect.equal(
          (after.links as Json[]).filter((l) => l.ref?.id === a.id).length,
          0,
          'links left from the other end',
        );
      }
    });

    await ctx.step('the print view shows the request with its files', async () => {
      for (const who of [requester, manager]) {
        const page = ctx.expect.ok(await who.get(`/requests/${a.reference}`)).body;
        ctx.expect.equal(page.submission?.id, a.id, 'the request');
        const list = ctx.expect.ok(await who.get(files(a.id))).body.files as Json[];
        ctx.expect.truthy(
          list.some((f) => f.name === mine.name),
          'the attachments are listed',
        );
      }
      refused(ctx, await stranger.get(`/requests/${a.reference}`), [403, 404], 'a stranger prints it');
    });

    await ctx.step('a withdrawn request keeps its files but takes no more', async () => {
      ctx.expect.ok(await requester.post(`/form-submissions/${b.id}/cancel`, { reason: 'Not needed' }));
      const rec = ctx.expect.ok(await requester.get(`/records/core.request/${b.id}`)).body;
      ctx.expect.equal(rec.editable, false, 'the withdrawn request is editable');
      refused(
        ctx,
        await requester.upload(files(b.id), {
          name: 'late.txt',
          contentType: 'text/plain',
          data: 'Too late',
        }),
        [403],
        'attaching to a withdrawn request',
      );
      // Leave nothing waiting in the manager's inbox.
      ctx.expect.ok(await requester.post(`/form-submissions/${a.id}/cancel`, { reason: 'Done testing' }));
    });
  },
});

/* ───────────────────────────── process-actions ───────────────────────────── */

export const processActions = defineFlow({
  name: 'process-actions',
  area: 'platform',
  description:
    'A form built for the run (approval with step fields; notify, ticket, role, reminder actions) → approved or rejected → its action runs',
  personas: ['admin', 'employee', 'itlead'],
  timeoutMs: 240_000,
  async run(ctx) {
    const admin = ctx.as('admin');
    const requester = ctx.as('employee');
    const me = ctx.user('employee');
    const sfx = ctx.rand.suffix();
    const key = `sim-pa-${sfx}`.slice(0, 64);
    const durationDays = ctx.rand.int(1, 30);
    const urgent = ctx.rand.bool(0.5);

    const role = await ctx.step('admin makes an empty role to hand out', async () => {
      const res = ctx.expect.status(
        await admin.post('/roles', {
          key: `sim-pa-${sfx}`.slice(0, 64),
          name: `Sim process role ${sfx}`,
          description: 'Handed out by the process-actions flow (no permissions)',
          permissions: [],
        }),
        201,
      );
      return res.body as Json;
    });

    const workflowId = await ctx.step('admin builds the approval with step fields', async () => {
      const wf = ctx.expect.status(
        await admin.post('/workflows', { name: `Sim review ${sfx}`, triggerKey: 'core.form-submission' }),
        201,
      ).body;
      const patched = ctx.expect.ok(
        await admin.patch(`/workflows/${wf.id}`, {
          draft: {
            steps: [
              {
                id: 'review',
                type: 'approval',
                name: text3('Sim review'),
                approvers: [{ type: 'user', userId: ctx.user('itlead').id }],
                mode: 'any',
                fields: [
                  {
                    key: 'result',
                    type: 'select',
                    label: text3('Result'),
                    required: true,
                    options: [
                      { value: 'ok', label: text3('OK') },
                      { value: 'later', label: text3('Later') },
                    ],
                  },
                  { key: 'checkedOn', type: 'date', label: text3('Checked on'), required: true },
                  { key: 'notes', type: 'textarea', label: text3('Notes') },
                ],
              },
            ],
          },
        }),
      ).body;
      ctx.expect.equal(patched.issues, [], 'workflow issues');
      ctx.expect.ok(await admin.post(`/workflows/${wf.id}/publish`));
      return wf.id as string;
    });

    const elements = [
      { id: 'what', key: 'what', type: 'text', label: text3('What'), required: true },
      { id: 'needBy', key: 'needBy', type: 'date', label: text3('Needed by'), required: true },
      {
        id: 'priority',
        key: 'priority',
        type: 'select',
        label: text3('Priority'),
        options: [
          { value: 'normal', label: text3('Normal') },
          { value: 'high', label: text3('High') },
        ],
      },
    ];
    const actions = [
      {
        id: 'received',
        on: 'submitted',
        type: 'core.notify',
        config: { toRequester: true, title: `Received {{request.reference}} ${sfx}`, message: 'We got it' },
      },
      {
        id: 'ticket',
        on: 'approved',
        type: 'itsm.create-ticket',
        config: {
          type: 'service_request',
          priority: String(ctx.rand.int(2, 4)),
          title: 'Sim PA {{data.what}} ({{request.reference}})',
        },
      },
      {
        id: 'grant',
        on: 'approved',
        type: 'core.grant-role',
        config: { roleId: role.id, person: 'requester', durationDays },
      },
      {
        id: 'result',
        on: 'approved',
        type: 'core.notify',
        config: {
          toRequester: true,
          title: `Result {{steps.review.result}} for {{request.reference}} ${sfx}`,
          message: 'Checked on {{steps.review.checkedOn}}. {{steps.review.notes}}',
        },
      },
      {
        id: 'remind',
        on: 'approved',
        type: 'core.remind',
        config: {
          dateFrom: 'field:needBy',
          offsetDays: -1,
          onlyFuture: true,
          toRequester: true,
          title: `Due soon: {{request.reference}} ${sfx}`,
        },
      },
      {
        id: 'urgent',
        on: 'approved',
        type: 'core.notify',
        when: { fact: 'data.priority', op: 'eq', value: 'high' },
        config: { toRequester: true, title: `Urgent {{request.reference}} ${sfx}` },
      },
      {
        id: 'declined',
        on: 'rejected',
        type: 'core.notify',
        config: { toRequester: true, title: `Declined {{request.reference}} ${sfx}` },
      },
    ];

    const form = await ctx.step('admin builds the form with its actions', async () => {
      const created = ctx.expect.status(
        await admin.post('/forms', { key, name: text3(`Sim process actions ${sfx}`), icon: 'zap' }),
        201,
      ).body;
      // Webhooks go to HTTPS hosts on the allow-list only: the stand-ins (plain HTTP) are refused when saving.
      const hook = (url: string) => ({
        id: 'hook',
        on: 'approved',
        type: 'core.webhook',
        config: {
          url,
          headerName: 'X-Sim',
          headerValue: `v-${sfx}`,
          body: '{"ref":"{{request.reference}}"}',
        },
      });
      const plain = await admin.patch(`/forms/${created.id}`, {
        draft: { elements, actions: [...actions, hook('http://127.0.0.1:4110/_mock/health')] },
        workflowDefinitionId: workflowId,
      });
      ctx.expect.code(plain, 'VALIDATION_FAILED', 400, 'a plain-HTTP webhook is refused');
      ctx.expect.truthy(JSON.stringify(plain.body).includes('"https"'), 'it says HTTPS');
      const offList = await admin.patch(`/forms/${created.id}`, {
        draft: { elements, actions: [...actions, hook('https://127.0.0.1:4110/_mock/health')] },
        workflowDefinitionId: workflowId,
      });
      ctx.expect.code(offList, 'VALIDATION_FAILED', 400, 'a webhook host off the allow-list is refused');
      ctx.expect.truthy(JSON.stringify(offList.body).includes('"host"'), 'it names the host');
      ctx.expect.ok(
        await admin.patch(`/forms/${created.id}`, {
          draft: { elements, actions },
          workflowDefinitionId: workflowId,
        }),
      );
      ctx.expect.ok(await admin.post(`/forms/${created.id}/publish`));
      return created as Json;
    });

    await ctx.step('people without form rights can’t see or change the actions', async () => {
      refused(ctx, await requester.get('/forms/process-actions'), [403], 'listing process actions');
      refused(
        ctx,
        await requester.patch(`/forms/${form.id}`, { draft: { elements } }),
        [403],
        'editing the form',
      );
    });

    const needBy = day(ctx.rand.int(3, 40));
    const sub = await ctx.step('the requester sends it', async () => {
      const res = ctx.expect.status(
        await requester.post(`/forms/by-key/${key}/submissions`, {
          data: { what: `${ctx.rand.words(2, 4)} ${sfx}`, needBy, priority: urgent ? 'high' : 'normal' },
        }),
        201,
      );
      ctx.expect.equal(res.body.status, 'pending', 'status');
      return res.body as Json;
    });

    await ctx.step('the "submitted" action runs at once', async () => {
      const done = await ctx.eventually(
        () => requester.get(`/form-submissions/${sub.id}`),
        (r) =>
          ((r.body?.actions ?? []) as Json[]).some(
            (a) => a.actionId === 'received' && SETTLED.includes(a.status),
          ),
        { label: 'the submitted action' },
      );
      const run = (done.body.actions as Json[]).find((a) => a.actionId === 'received');
      ctx.expect.equal(run.status, 'succeeded', 'the submitted action');
      await noticesOf(
        ctx,
        'employee',
        (n) => n.type === 'core.process-action.message' && n.title === `Received ${sub.reference} ${sfx}`,
        'the "received" message',
      );
    });

    const reject = ctx.rand.bool(0.25);
    ctx.tag(reject ? 'rejected' : 'approved');
    if (urgent) ctx.tag('urgent');
    const stepData = { result: ctx.rand.pick(['ok', 'later']), checkedOn: day(0), notes: `Checked ${sfx}` };

    await ctx.step(
      reject ? 'the reviewer rejects it' : 'the reviewer approves with the step’s fields',
      async () => {
        const task = await ctx.approvals.taskOf(sub.workflow.id, 'itlead');
        if (!reject) {
          const missing = await ctx.as('itlead').post(`/approvals/${task.id}/approve`, { comment: 'ok' });
          ctx.expect.code(missing, 'VALIDATION_FAILED', 400, 'approving without the step’s fields');
        }
        const outcome = await ctx.approvals.decide(sub.workflow.id, 'itlead', reject ? 'reject' : 'approve', {
          data: reject ? undefined : stepData,
          twice: ctx.rand.bool(0.1),
        });
        ctx.expect.equal(outcome, reject ? 'rejected' : 'approved', 'outcome');
      },
    );

    const done = await ctx.step('the decided actions run', async () =>
      settledRequest(ctx, requester, sub.id, {
        status: reject ? 'rejected' : 'approved',
        count: reject ? 2 : 6,
        label: 'the decided actions',
      }),
    );
    const runs = new Map((done.actions as Json[]).map((a) => [a.actionId, a]));

    if (reject) {
      await ctx.step('only the rejection runs', async () => {
        ctx.expect.equal(
          [...runs.values()].map((r) => [r.actionId, r.status]).sort(),
          [
            ['declined', 'succeeded'],
            ['received', 'succeeded'],
          ],
          'runs',
        );
        const grants = ctx.expect.ok(
          await admin.get('/role-assignments', { query: { userId: me.id, roleId: role.id } }),
        ).body.items as Json[];
        ctx.expect.equal(grants.length, 0, 'role assignments');
      });
    } else {
      await ctx.step('every approved action did its part', async () => {
        for (const id of ['ticket', 'grant', 'result', 'remind'])
          ctx.expect.equal(
            [id, runs.get(id)?.status, runs.get(id)?.error],
            [id, 'succeeded', null],
            `the ${id} run`,
          );
        ctx.expect.equal(
          runs.get('urgent')?.status,
          urgent ? 'succeeded' : 'skipped',
          'the conditional action',
        );
        ctx.expect.equal(runs.has('declined'), false, 'the rejection ran');

        const ticketRef = runs.get('ticket').result?.reference as string;
        ctx.expect.match(ticketRef, /^[A-Z]+-\d+$/, 'the ticket reference');
        const t = ctx.expect.ok(
          await requester.get(`/itsm/tickets/${ticketRef}`),
          'the requester opens the ticket',
        ).body;
        ctx.expect.truthy(String(t.title).includes(sub.reference), 'the ticket names the request');
        ctx.expect.equal(t.type, 'service_request', 'ticket type');

        const grants = ctx.expect.ok(
          await admin.get('/role-assignments', { query: { userId: me.id, roleId: role.id } }),
        ).body.items as Json[];
        ctx.expect.equal(grants.length, 1, 'exactly one role assignment');
        const days = (new Date(grants[0].expiresAt).getTime() - Date.now()) / 86_400_000;
        ctx.expect.truthy(
          Math.abs(days - durationDays) < 0.2,
          `it ends in ${durationDays} days (${days.toFixed(2)})`,
        );
        ctx.expect.ok(await admin.delete(`/role-assignments/${grants[0].id}`));

        const reminders = done.reminders as Json[];
        ctx.expect.equal(reminders.length, 1, 'reminders scheduled');
        await noticesOf(
          ctx,
          'employee',
          (n) =>
            n.type === 'core.process-action.message' &&
            n.title === `Result ${stepData.result} for ${sub.reference} ${sfx}`,
          'the result message (with the step’s field)',
        );
        const decision = ctx.expect.find(
          done.decisions as Json[],
          (d) => d.stepId === 'review',
          'the review decision is listed',
        );
        ctx.expect.equal(decision.data?.result, stepData.result, 'the step field kept with the decision');
      });
    }

    await ctx.step('admin retires the form, the workflow and the role', async () => {
      ctx.expect.ok(await admin.post(`/forms/${form.id}/archive`));
      ctx.expect.ok(await admin.post(`/workflows/${workflowId}/archive`));
      ctx.expect.status(await admin.delete(`/roles/${role.id}`), [200, 204]);
    });
  },
});

/* ───────────────────────────── people-lifecycle ───────────────────────────── */

export const peopleLifecycle = defineFlow({
  name: 'people-lifecycle',
  area: 'platform',
  description:
    'Onboard a person with custom fields and groups → department transfer (both managers told) → offboard; notifications read',
  personas: ['admin', 'manager', 'itlead', 'employee', 'hr.partner'],
  async run(ctx) {
    const admin = ctx.as('admin');
    const sfx = ctx.rand.suffix();
    const depts = ctx.expect.ok(await admin.get('/departments')).body.items as Json[];
    const biz = ctx.expect.find(depts, (d) => d.code === 'SIM-BIZ', 'the simulator’s business department');
    const simIt = ctx.expect.find(depts, (d) => d.code === 'SIM-IS', 'the simulator’s IS department');

    const dept = await ctx.step('admin opens a department with custom fields', async () => {
      const body = {
        code: `SIMP-${sfx}`.slice(0, 64),
        name: `Sim team ${sfx}`,
        parentId: simIt.id,
        managerId: ctx.user('itlead').id,
        attributes: { costCenter: `CC-${ctx.rand.int(1000, 9999)}`, headcountBudget: ctx.rand.int(1, 40) },
      };
      if (ctx.rand.bool(0.2)) {
        ctx.tag('bad department field');
        ctx.expect.code(
          await admin.post('/departments', { ...body, attributes: { costCenter: 'nope' } }),
          'VALIDATION_FAILED',
          400,
        );
      }
      return ctx.expect.status(await admin.post('/departments', body), 201).body as Json;
    });

    const pending = ctx.rand.bool(0.5);
    const lineManager = ctx.rand.bool(0.5);
    const employment = ctx.rand.pick(['employee', 'contractor', 'intern']);
    const displayName = `Sim Person ${sfx}`;
    const person = await ctx.step('admin creates the person', async () => {
      const attributes: Record<string, unknown> = {
        costCenter: `CC-${ctx.rand.int(1000, 9999)}`,
        employmentType: employment,
        office: ctx.rand.pick(['tpe-hq', 'hsinchu', 'tokyo', 'london', 'remote']),
        ...(employment !== 'employee' ? { contractEnd: day(ctx.rand.int(30, 400)) } : {}),
      };
      const body = {
        email: `sim.p.${sfx}@sim.isbp.example`,
        username: `sim.p.${sfx}`,
        displayName,
        jobTitle: ctx.rand.pick(['Analyst', 'Engineer', 'Coordinator']),
        departmentId: biz.id,
        managerId: lineManager ? ctx.user('manager').id : null,
        locale: ctx.rand.pick(['en', 'zh-TW', 'ja-JP']),
        status: pending ? 'pending' : 'active',
        attributes,
      };
      if (ctx.rand.bool(0.2)) {
        ctx.tag('bad person field');
        const bad = await admin.post('/users', {
          ...body,
          username: `sim.bad.${sfx}`,
          email: `sim.bad.${sfx}@sim.isbp.example`,
          attributes: { ...attributes, costCenter: 'CC-12' },
        });
        ctx.expect.code(bad, 'VALIDATION_FAILED', 400, 'a cost center in the wrong format');
      }
      const res = ctx.expect.status(await admin.post('/users', body), 201).body;
      ctx.expect.equal(res.status, pending ? 'pending' : 'active', 'status');
      refused(
        ctx,
        await admin.post('/users', { ...body, displayName: 'Dup' }),
        [409],
        'the same username again',
      );
      return res as Json;
    });
    ctx.tag(pending ? 'pre-boarded' : 'active at once');

    if (pending)
      await ctx.step('admin onboards them', async () => {
        const res = ctx.expect.ok(await admin.post(`/users/${person.id}/onboard`)).body;
        ctx.expect.equal(res.status, 'active', 'status after onboarding');
      });

    await ctx.step('people without the rights are refused', async () => {
      refused(
        ctx,
        await ctx.as('employee').get(`/users/${person.id}`),
        [403, 404],
        'an employee opens the person',
      );
      refused(ctx, await ctx.as('employee').get('/users'), [403], 'an employee lists people');
      // The HR partner looks after Sales only.
      refused(
        ctx,
        await ctx.as('hr.partner').post(`/users/${person.id}/offboard`, { reason: 'x' }),
        [403, 404],
        'an HR partner of another department offboards',
      );
    });

    const groups = await ctx.step('admin adds them to groups', async () => {
      const list = ctx.expect.ok(await admin.get('/groups', { query: { pageSize: 100 } })).body
        .items as Json[];
      const plain = list.filter(
        (g) =>
          !g.isSystem && g.source === 'local' && ['vpn-users', 'pmo', 'hr-team', 'dev-team'].includes(g.key),
      );
      ctx.expect.truthy(plain.length, 'groups to join');
      const picked = ctx.rand.sample(plain, 1, 2);
      const res = await admin.post(`/users/${person.id}/groups`, { add: picked.map((g) => g.id) });
      if (routeMissing(res)) {
        // A build from before "change a person's groups in one go": through each group instead.
        ctx.tag('older build: groups one by one');
        for (const g of picked)
          ctx.expect.ok(await admin.post(`/groups/${g.id}/members`, { userIds: [person.id] }));
      } else ctx.expect.ok(res);
      const detail = ctx.expect.ok(await admin.get(`/users/${person.id}`)).body;
      const ids = new Set((detail.groups as Json[]).map((g) => g.id));
      for (const g of picked) ctx.expect.truthy(ids.has(g.id), `they are in ${g.key}`);
      return picked;
    });

    await ctx.step('admin updates a custom field', async () => {
      // `attributes` replaces the person's active custom fields: send them all, as the edit form does.
      const before = ctx.expect.ok(await admin.get(`/users/${person.id}`)).body;
      const office = ctx.rand.pick(['tokyo', 'london', 'remote']);
      ctx.expect.ok(
        await admin.patch(`/users/${person.id}`, { attributes: { ...before.attributes, office } }),
      );
      const detail = ctx.expect.ok(await admin.get(`/users/${person.id}`)).body;
      ctx.expect.equal(detail.attributes?.office, office, 'the office');
      ctx.expect.equal(detail.attributes?.employmentType, employment, 'the other fields are kept');
    });

    await ctx.step('admin moves them to the new department', async () => {
      const options = await admin.get(`/users/${person.id}/transfer`, { query: { departmentId: dept.id } });
      if (routeMissing(options)) {
        // A build from before the transfer wizard: the department change on the person (same event and notices).
        ctx.tag('older build: transfer by editing the person');
        if (ctx.rand.bool(0.2)) {
          ctx.tag('double transfer');
          const both = await Promise.all(
            [1, 2].map(() => admin.patch(`/users/${person.id}`, { departmentId: dept.id })),
          );
          for (const r of both) ctx.expect.ok(r, 'saving the same department twice');
        } else ctx.expect.ok(await admin.patch(`/users/${person.id}`, { departmentId: dept.id }));
      } else {
        ctx.expect.ok(options);
        ctx.expect.equal(
          options.body.department?.manager?.id,
          ctx.user('itlead').id,
          'the new department’s manager',
        );
        const body = {
          departmentId: dept.id,
          leaveGroupIds: options.body.leave,
          joinGroupIds: options.body.join,
        };
        if (ctx.rand.bool(0.2)) {
          ctx.tag('double transfer');
          const both = await Promise.all([1, 2].map(() => admin.post(`/users/${person.id}/transfer`, body)));
          ctx.expect.oneOk(both, 'one move goes through', [400, 409]);
        } else ctx.expect.ok(await admin.post(`/users/${person.id}/transfer`, body));
        refused(
          ctx,
          await admin.post(`/users/${person.id}/transfer`, { departmentId: dept.id }),
          [400, 409],
          'moving to the department they are in',
        );
      }
      const detail = ctx.expect.ok(await admin.get(`/users/${person.id}`)).body;
      ctx.expect.equal(detail.department?.id, dept.id, 'their department');
    });

    // The old side is their line manager when they have one (sim.manager), else the old department's head (also
    // sim.manager); the new side is the new department's manager (sim.itlead).
    const about = (n: Json) => n.type === 'core.user.transferred' && JSON.stringify(n).includes(displayName);
    for (const who of ['manager', 'itlead'])
      await ctx.step(`${who} is asked to review their access, once`, async () => {
        const told = await noticesOf(ctx, who, about, `the transfer notice to ${who}`);
        ctx.expect.equal(told.length, 1, `transfer notices to ${who}`);
        if (ctx.rand.bool(0.6)) {
          ctx.tag(`${who} reads it`);
          ctx.expect.ok(await ctx.as(who).post('/me/notifications/read', { ids: [told[0].id] }));
          // Other runs notify the same person meanwhile, so the unread count is not compared between two reads: the
          // notice itself is what reading it changes.
          const after = ctx.expect.ok(
            await ctx.as(who).get('/me/notifications', { query: { pageSize: 100 } }),
          ).body;
          const n = (after.items as Json[]).find((x) => x.id === told[0].id);
          ctx.expect.truthy(n?.readAt, 'the notice is read');
          ctx.expect.truthy(typeof after.unread === 'number', 'the unread count is shown');
          ctx.expect.ok(await ctx.as(who).get('/me/badges'));
        }
      });

    await ctx.step('admin records the department’s new budget', async () => {
      const budget = ctx.rand.int(1, 80);
      ctx.expect.ok(
        await admin.patch(`/departments/${dept.id}`, {
          attributes: { ...dept.attributes, headcountBudget: budget },
        }),
      );
      const list = ctx.expect.ok(await admin.get('/departments')).body.items as Json[];
      const d = ctx.expect.find(list, (x) => x.id === dept.id, 'the department');
      ctx.expect.equal(d.attributes?.headcountBudget, budget, 'the budget');
      ctx.expect.equal(d.attributes?.costCenter, dept.attributes?.costCenter, 'the cost center is kept');
    });

    await ctx.step('admin offboards them', async () => {
      const res = ctx.expect.ok(
        await admin.post(`/users/${person.id}/offboard`, { reason: `Left ${sfx}` }),
      ).body;
      ctx.expect.truthy(typeof res.revokedSessions === 'number', 'sessions revoked');
      const detail = ctx.expect.ok(await admin.get(`/users/${person.id}`)).body;
      ctx.expect.equal(detail.status, 'offboarded', 'status');
      const left = new Set(groups.map((g) => g.id));
      ctx.expect.equal(
        (detail.groups as Json[]).filter((g) => left.has(g.id)).length,
        0,
        'groups they are still in',
      );
      const move = await admin.post(`/users/${person.id}/transfer`, { departmentId: biz.id });
      if (!routeMissing(move)) refused(ctx, move, [409], 'moving someone offboarded');
    });
  },
});
