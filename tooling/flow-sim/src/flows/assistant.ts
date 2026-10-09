/**
 * Assistant flows (built-in mode, no chat model): a guided template → change set → dry run → apply → (a request
 * through what it made) → rollback; the ISMS process pack (`isms/isms-processes`) installed, applied, used and rolled
 * back under a lock; and the MCP endpoint for outside agents (an API client with `core.mcp.use`).
 */
import type { Json } from '../client';
import { defineFlow, type FlowContext } from '../flow';
import { exclusive } from '../lock';
import { day, MOCKS, refused, routeMissing, settledRequest } from './platform-kit';

const A = '/assistant';
/** Dry runs and applies of big change sets (the ISMS pack: 59 items) take long on a busy stack. */
const LONG = { timeoutMs: 180_000 };
/** An apply of the whole pack: one transaction of 59 items. */
const VERY_LONG = { timeoutMs: 600_000 };

/** Applies a draft change set as admin (sometimes twice at once: exactly one goes through). */
async function applySet(ctx: FlowContext, id: string): Promise<Json> {
  const admin = ctx.as('admin');
  if (ctx.rand.bool(0.2)) {
    ctx.tag('double apply');
    const both = await Promise.all(
      [1, 2].map(() => admin.post(`${A}/change-sets/${id}/apply`, { confirm: true }, VERY_LONG)),
    );
    return ctx.expect.oneOk(both, 'the change set is applied once', [409]).body;
  }
  return ctx.expect.ok(await admin.post(`${A}/change-sets/${id}/apply`, { confirm: true }, VERY_LONG)).body;
}

/** Rolls an applied change set back: unconfirmed is refused, then confirmed; a second rollback is refused. */
async function rollBack(ctx: FlowContext, id: string): Promise<Json> {
  const admin = ctx.as('admin');
  if (ctx.rand.bool(0.3))
    refused(
      ctx,
      await admin.post(`${A}/change-sets/${id}/rollback`, { confirm: false }, LONG),
      [409],
      'an unconfirmed rollback',
    );
  const res = ctx.expect.ok(
    await admin.post(`${A}/change-sets/${id}/rollback`, { confirm: true }, LONG),
    'the rollback',
  );
  ctx.expect.equal(res.body.status, 'rolled_back', 'status after the rollback');
  refused(
    ctx,
    await admin.post(`${A}/change-sets/${id}/rollback`, { confirm: true }, LONG),
    [409],
    'rolling back twice',
  );
  return res.body;
}

/* ───────────────────────────── assistant-guided-change ───────────────────────────── */

type Template = 'request-form' | 'approval-process' | 'approval-chain' | 'http-check' | 'field';

const KIND: Record<Template, string> = {
  'request-form': 'core.form',
  'approval-process': 'core.form',
  'approval-chain': 'core.workflow',
  'http-check': 'scheduler.job',
  field: 'core.custom-field',
};

/** The groups the run did not create: another flow of the run may delete its own, and a notice to a deleted group fails. */
async function sharedGroupIds(ctx: FlowContext): Promise<Set<string>> {
  const res = ctx.expect.ok(await ctx.as('admin').get('/groups', { query: { pageSize: 200 } }), 'the groups');
  const groups = (res.body.items ?? []) as Json[];
  return new Set(
    groups.filter((g) => !`${g.key ?? ''} ${g.name ?? ''}`.includes(ctx.runToken)).map((g) => g.id as string),
  );
}

/** Answers for a guided template (what a person would type), valid for its questions. */
function templateAnswers(
  ctx: FlowContext,
  t: Template,
  sfx: string,
  fields: Json[],
  sharedGroups: ReadonlySet<string>,
): Record<string, unknown> {
  const { rand } = ctx;
  const options = (key: string) =>
    ((fields.find((f) => f.key === key)?.options ?? []) as Json[]).map((o) => o.value as string);
  const question = (n: number) => {
    const type = rand.pick(['text', 'textarea', 'number', 'date', 'select']);
    return {
      [`q${n}Label`]: `${rand.words(2, 4)}?`,
      [`q${n}Type`]: type,
      [`q${n}Required`]: rand.bool(),
      ...(type === 'select'
        ? { [`q${n}Options`]: rand.sample(['Red', 'Green', 'Blue', 'Amber'], 2, 4).join('\n') }
        : {}),
    };
  };
  switch (t) {
    case 'request-form':
      return {
        name: `Sim guided form ${sfx}`,
        category: 'sim',
        ...question(1),
        ...(rand.bool() ? question(2) : {}),
      };
    case 'approval-process': {
      const groupApproves = rand.bool(0.4);
      // A category the template offers, or "something else" with a name of the person's own (the form's category).
      const choices = options('category').filter((c) => c !== '__new');
      const newCategory = !choices.length || rand.bool(0.3);
      // What happens once approved: nothing, a change, a ticket or a notice to groups the run did not create (whichever
      // the template offers).
      const notified = options('notifyGroups').filter((g) => sharedGroups.has(g));
      const offered = options('afterApproval').filter((a) => a !== 'notify' || notified.length > 0);
      const afterApproval = rand.pick(offered.length ? offered : ['nothing']);
      ctx.tag(`after approval: ${afterApproval}`);
      return {
        name: `Sim guided process ${sfx}`,
        ...(newCategory
          ? { category: '__new', newCategory: `Sim ${sfx}` }
          : { category: rand.pick(choices) }),
        ...question(1),
        ...(rand.bool() ? question(2) : {}),
        managerApproves: true,
        groupApproves,
        ...(groupApproves
          ? { group: rand.pick(['cab', 'it-admins'].filter((g) => options('group').includes(g))) }
          : {}),
        afterApproval,
        ...(afterApproval === 'ticket' && rand.bool(0.5) && options('ticketCategory').length
          ? { ticketCategory: rand.pick(options('ticketCategory')) }
          : {}),
        ...(afterApproval === 'notify'
          ? { notifyGroups: rand.sample(notified, 1, Math.min(2, notified.length)) }
          : {}),
      };
    }
    case 'approval-chain': {
      const first = rand.pick(
        ['manager', 'department-head', 'group', 'role'].filter((v) => options('firstApprover').includes(v)),
      );
      const second = rand.bool(0.4);
      return {
        trigger: 'core.form-submission',
        name: `Sim guided chain ${sfx}`,
        firstApprover: first,
        ...(first === 'group' ? { firstGroup: rand.pick(options('firstGroup')) } : {}),
        ...(first === 'role' ? { firstRole: rand.pick(options('firstRole')) } : {}),
        secondStep: second,
        ...(second
          ? {
              secondGroup: rand.pick(options('secondGroup')),
              onlyAbove: true,
              conditionFact: 'data.amount',
              conditionAmount: rand.int(100, 10_000),
            }
          : {}),
        // Never the default: other requests of the trigger must keep their own workflow.
        isDefault: false,
      };
    }
    case 'http-check':
      return {
        name: `Sim guided check ${sfx}`,
        url: `${MOCKS}/_mock/health`,
        everyMinutes: rand.pick([60, 240, 1440]),
      };
    case 'field': {
      const type = rand.pick(['text', 'number', 'boolean', 'date', 'select']);
      return {
        // Entities no other flow fills custom fields of; optional, so nobody's saves start failing.
        entityType: rand.pick(
          ['core.group', 'itam.contract', 'projects.project'].filter((v) =>
            options('entityType').includes(v),
          ),
        ),
        label: `Sim field ${sfx}`,
        type,
        required: false,
        ...(type === 'select' ? { options: 'One\nTwo\nThree' } : {}),
      };
    }
  }
}

export const assistantGuidedChange = defineFlow({
  name: 'assistant-guided-change',
  area: 'assistant',
  description:
    'A guided template (built-in mode) → change set → dry run → apply → used → rollback; drafts discarded; outsiders refused',
  personas: ['admin', 'employee', 'manager'],
  timeoutMs: 240_000,
  async run(ctx) {
    const admin = ctx.as('admin');
    const sfx = ctx.rand.suffix();
    const template = ctx.rand.weighted<Template>([
      ['request-form', 2],
      ['approval-process', 3],
      ['approval-chain', 2],
      ['http-check', 2],
      ['field', 1],
    ]);
    ctx.tag(template);
    const kind = KIND[template];

    await ctx.step('the assistant is in built-in mode, and closed to people without it', async () => {
      const status = ctx.expect.ok(await admin.get(`${A}/status`)).body;
      ctx.expect.equal(status.mode, 'builtin', 'mode');
      const k = ctx.expect.find(status.kinds as Json[], (x) => x.kind === kind, `the ${kind} kind`);
      ctx.expect.truthy(
        (k.templates as Json[]).some((x) => x.id === template),
        `the ${template} template`,
      );
      refused(ctx, await ctx.as('employee').get(`${A}/status`), [403], 'an employee opens the assistant');
    });

    const fields = ctx.expect.ok(await admin.get(`${A}/templates/${kind}/${template}`)).body.fields as Json[];
    const answers = templateAnswers(ctx, template, sfx, fields, await sharedGroupIds(ctx));

    if (ctx.rand.bool(0.15))
      await ctx.step('incomplete answers are refused', async () => {
        const required = fields.filter((f) => f.required && !f.visibleWhen).map((f) => f.key as string);
        const { [required[0]!]: _drop, ...rest } = answers;
        refused(
          ctx,
          await admin.post(`${A}/templates/build`, { kind, templateId: template, answers: rest }, LONG),
          [400, 422],
          'a template without its name',
        );
      });

    const set = await ctx.step('the template becomes a draft change set that dry-runs', async () => {
      const res = ctx.expect.ok(
        await admin.post(`${A}/templates/build`, { kind, templateId: template, answers }, LONG),
      ).body;
      ctx.expect.equal(res.status, 'draft', 'status');
      ctx.expect.match(res.reference, /^CS-\d+$/, 'reference');
      ctx.expect.equal(
        (res.items as Json[]).filter((i) => !i.check?.ok).map((i) => [i.label, i.check]),
        [],
        'items failing their dry run',
      );
      ctx.expect.equal(res.ready, true, 'ready');
      const check = ctx.expect.ok(await admin.post(`${A}/change-sets/${res.id}/check`, undefined, LONG)).body;
      ctx.expect.equal(check.ready, true, 'ready after a second dry run');
      refused(
        ctx,
        await ctx.as('employee').get(`${A}/change-sets/${res.id}`),
        [403, 404],
        'an employee opens it',
      );
      return res as Json;
    });

    if (ctx.rand.bool(0.1)) {
      ctx.tag('discarded');
      await ctx.step('admin discards the draft instead', async () => {
        const d = ctx.expect.ok(await admin.post(`${A}/change-sets/${set.id}/discard`)).body;
        ctx.expect.equal(d.status, 'discarded', 'status');
        refused(
          ctx,
          await admin.post(`${A}/change-sets/${set.id}/apply`, { confirm: true }),
          [409],
          'applying a discarded set',
        );
      });
      return;
    }

    const applied = await ctx.step('admin applies it', async () => {
      const res = await applySet(ctx, set.id);
      ctx.expect.equal(res.status, 'applied', 'status');
      for (const item of res.items as Json[]) ctx.expect.truthy(item.appliedId, `${item.label} was created`);
      return res;
    });
    const item = (k: string) => (applied.items as Json[]).find((i) => i.kind === k);

    let request: Json | null = null;
    await ctx.step('what it made is live', async () => {
      if (kind === 'core.form') {
        const form = ctx.expect.ok(await admin.get(`/forms/${item('core.form').appliedId}`)).body;
        ctx.expect.equal([form.active, form.archived, form.publishedVersion], [true, false, 1], 'the form');
        if (template === 'approval-process') {
          ctx.expect.truthy(form.workflow?.id, 'the form has its approval');
          // Someone uses it before the rollback: a rollback works as long as the objects are unchanged.
          const published = await ctx.forms.published(form.key, 'employee');
          const data = ctx.forms.answers(published.schema, {}, { requiredOnly: false, optionalRate: 1 });
          request = ctx.expect.status(
            await ctx.as('employee').post(`/forms/by-key/${form.key}/submissions`, { data }),
            201,
          ).body;
          ctx.tag('used before the rollback');
        }
      }
      if (kind === 'core.workflow') {
        const wf = ctx.expect.ok(await admin.get(`/workflows/${item(kind).appliedId}`)).body;
        ctx.expect.equal([wf.publishedVersion, wf.isDefault, wf.archived], [1, false, false], 'the workflow');
      }
      if (kind === 'scheduler.job') {
        const job = ctx.expect.ok(await admin.get(`/scheduler/jobs/${item(kind).appliedId}`)).body;
        ctx.expect.equal([job.type, job.enabled], ['scheduler.http', true], 'the job');
      }
      if (kind === 'core.custom-field') {
        const list = ctx.expect.ok(
          await admin.get('/custom-fields', { query: { entityType: answers.entityType as string } }),
        ).body.items as Json[];
        ctx.expect.find(list, (f) => f.id === item(kind).appliedId && !f.archived, 'the field');
      }
    });

    await ctx.step('admin rolls it back', async () => {
      await rollBack(ctx, set.id);
      if (kind === 'core.form') {
        const form = ctx.expect.ok(await admin.get(`/forms/${item('core.form').appliedId}`)).body;
        ctx.expect.equal(form.archived, true, 'the form is archived');
        const wfItem = item('core.workflow');
        if (wfItem)
          ctx.expect.equal(
            (await admin.get(`/workflows/${wfItem.appliedId}`)).body.archived,
            true,
            'its workflow',
          );
      }
      if (kind === 'core.workflow')
        ctx.expect.equal(
          (await admin.get(`/workflows/${item(kind).appliedId}`)).body.archived,
          true,
          'the workflow is archived',
        );
      if (kind === 'scheduler.job') {
        const job = await admin.get(`/scheduler/jobs/${item(kind).appliedId}`);
        ctx.expect.truthy(
          job.status === 404 || job.body.archived === true || job.body.enabled === false,
          'the job is gone',
        );
      }
      if (kind === 'core.custom-field') {
        const list = ctx.expect.ok(
          await admin.get('/custom-fields', { query: { entityType: answers.entityType as string } }),
        ).body.items as Json[];
        const f = list.find((x) => x.id === item(kind).appliedId);
        ctx.expect.truthy(!f || f.archived, 'the field is archived');
      }
    });

    if (request)
      await ctx.step('the request made before the rollback can still be decided', async () => {
        const r = request as Json;
        const outcome = await ctx.approvals.approveAll(r.workflow.id, {
          avoid: [ctx.personaOf(ctx.user('employee').id)!],
        });
        ctx.expect.equal(outcome.status, 'approved', 'its approval');
        await settledRequest(ctx, ctx.as('employee'), r.id, { status: 'approved' });
      });
  },
});

/* ───────────────────────────── isms-pack ───────────────────────────── */

const PACK = '/assistant/packages/isms/isms-processes';
const ISMS_GROUPS = ['authority', 'it', 'security-review', 'server-room'];

/**
 * The pack's keys made unique (`isms-…` → `isms<tag>-…`, the ticket field, job names), so its whole content can be
 * applied and rolled back again: archived forms, categories and fields keep their keys, which blocks a second install.
 */
function uniqueCopy(pkg: Json, tag: string): Json {
  const text = JSON.stringify(pkg)
    .replace(/\bisms-([a-z0-9-]+)/g, `isms${tag}-$1`)
    .replace(/\bdefaultPasswordsChanged\b/g, `defaultPasswordsChanged${tag}`)
    .replace(/"ISMS: ([^"]+)"/g, `"ISMS: $1 (${tag})"`);
  const copy = JSON.parse(text) as Json;
  for (const k of Object.keys(copy.title ?? {})) copy.title[k] = `${copy.title[k]} (${tag})`;
  return copy;
}

export const ismsPack = defineFlow({
  name: 'isms-pack',
  area: 'assistant',
  description:
    'ISMS process pack: install → dry run → apply → a security report and an account request → rollback (serialised)',
  personas: ['admin', 'employee', 'manager', 'ismsofficer'],
  // Runs one at a time (a lock): allow for the runs queued before this one.
  timeoutMs: 1_800_000,
  async run(ctx) {
    await exclusive('isms-pack', () => ismsPackRun(ctx));
  },
});

async function ismsPackRun(ctx: FlowContext) {
  const admin = ctx.as('admin');
  const sfx = ctx.rand.suffix();
  const tag = sfx.replace(/[^a-z0-9]/g, '').slice(-10);
  // Applying 59 items takes minutes on a busy stack and runs one at a time: most runs read or dry-run the pack.
  const depth = ctx.rand.weighted([
    ['preview', 5],
    ['install and discard', 3],
    ['apply and roll back', 2],
  ] as const);
  ctx.tag(depth);

  await ctx.step('admin reads what the pack holds', async () => {
    const list = ctx.expect.ok(await admin.get('/assistant/packages')).body.items as Json[];
    const pack = ctx.expect.find(
      list,
      (p) => p.moduleId === 'isms' && p.key === 'isms-processes',
      'the ISMS pack',
    );
    ctx.expect.equal(
      [pack.canPropose, pack.canApply, pack.itemCount],
      [true, true, 59],
      'may install, apply; items',
    );
    const detail = await admin.get(PACK);
    if (routeMissing(detail)) ctx.tag('older build: no package preview');
    else
      ctx.expect.truthy(
        JSON.stringify(ctx.expect.ok(detail).body).includes('isms-account-request'),
        'the preview lists its forms',
      );
    refused(ctx, await ctx.as('employee').post(`${PACK}/install`, {}), [403, 404], 'an employee installs it');
  });
  if (depth === 'preview') return;

  const installed = await ctx.step('admin installs the built-in pack as a draft', async () => {
    const res = ctx.expect.status(await admin.post(`${PACK}/install`, {}, LONG), 201).body;
    ctx.expect.equal(res.status, 'draft', 'status');
    return res as Json;
  });
  if (depth === 'install and discard') {
    await ctx.step('admin discards the draft', async () => {
      if (!installed.ready) {
        ctx.tag('reinstall blocked by archived keys');
        const failing = (installed.items as Json[]).filter((i) => !i.check?.ok);
        const codes = new Set(failing.flatMap((i) => ((i.check?.issues ?? []) as Json[]).map((x) => x.code)));
        ctx.expect.truthy(
          codes.has('duplicate_key'),
          `the failing items name taken keys (codes: ${[...codes].join(', ')})`,
        );
      }
      const d = ctx.expect.ok(
        await admin.post(`${A}/change-sets/${installed.id}/discard`, undefined, LONG),
      ).body;
      ctx.expect.equal(d.status, 'discarded', 'status');
    });
    return;
  }

  let setId: string;
  let firstInstall = false;
  if (installed.ready) {
    // This database never had it applied: the real thing.
    firstInstall = true;
    ctx.tag('first install: the built-in pack itself');
    setId = installed.id;
  } else {
    ctx.tag('reinstall blocked by archived keys');
    await ctx.step('a second install is blocked by the keys an earlier one left (documented)', async () => {
      const failing = (installed.items as Json[]).filter((i) => !i.check?.ok);
      const codes = new Set(failing.flatMap((i) => ((i.check?.issues ?? []) as Json[]).map((x) => x.code)));
      ctx.expect.truthy(
        codes.has('duplicate_key'),
        `the failing items name taken keys (codes: ${[...codes].join(', ')})`,
      );
    });
    setId = await ctx.step('admin applies a copy of the pack with keys of its own instead', async () => {
      const pkg = ctx.expect.ok(await admin.get(`${A}/change-sets/${installed.id}/export`, LONG)).body;
      ctx.expect.equal(pkg.format, 'isbp.change-set-package', 'the export');
      ctx.expect.ok(await admin.post(`${A}/change-sets/${installed.id}/discard`));
      const res = ctx.expect.status(
        await admin.post(`${A}/change-sets/import`, uniqueCopy(pkg, tag), LONG),
        201,
      ).body;
      ctx.expect.equal(
        (res.items as Json[])
          .filter((i) => !i.check?.ok)
          .map((i) => [i.label, i.check?.issues ?? i.check?.error]),
        [],
        'items of the copy failing their dry run',
      );
      ctx.expect.equal(res.ready, true, 'the copy is ready');
      return res.id as string;
    });
  }

  const draft = ctx.expect.ok(await admin.get(`${A}/change-sets/${setId}`, LONG)).body;
  const count = (kind: string) => (draft.items as Json[]).filter((i) => i.kind === kind).length;
  ctx.expect.equal(
    [count('core.group'), count('core.form'), count('core.workflow'), count('scheduler.job')],
    [5, 21, 21, 8],
    'groups, forms, workflows and jobs in the pack',
  );

  let rolledBack = false;
  try {
    const applied = await ctx.step('admin applies it', async () => {
      const res = await applySet(ctx, setId);
      ctx.expect.equal(res.status, 'applied', 'status');
      return res;
    });
    const byRef = new Map((applied.items as Json[]).map((i) => [i.ref, i]));
    const formKey = (ref: string) => byRef.get(ref)?.value?.key as string;

    await ctx.step('admin puts the ISMS officer in the pack’s groups', async () => {
      for (const g of ISMS_GROUPS) {
        const id = byRef.get(`group-${g}`)?.appliedId;
        ctx.expect.truthy(id, `the ${g} group`);
        ctx.expect.ok(await admin.post(`/groups/${id}/members`, { userIds: [ctx.user('ismsofficer').id] }));
      }
    });

    const employee = ctx.as('employee');
    // A failure here is reported after the rest of the run (the other request and the rollback) has been checked.
    let deferred: unknown = null;
    let incident: string | null = null;
    await ctx
      .step('an employee reports a security incident: a ticket for the reviewers', async () => {
        const key = formKey('form-security-report');
        const sub = ctx.expect.status(
          await employee.post(`/forms/by-key/${key}/submissions`, {
            data: {
              type: ctx.rand.pick([
                'suspicious_message',
                'system_error',
                'account_anomaly',
                'malware',
                'other',
              ]),
              occurredOn: day(0),
              occurredAt: `${String(ctx.rand.int(8, 17)).padStart(2, '0')}:${ctx.rand.pick(['00', '15', '30', '45'])}`,
              description: `${ctx.rand.sentence(6, 14)} ${sfx}`,
            },
          }),
          201,
        ).body;
        ctx.expect.equal(sub.workflow ?? null, null, 'it needs no approval');
        const done = await settledRequest(ctx, employee, sub.id, { count: 1 });
        const run = ctx.expect.find(
          done.actions as Json[],
          (a) => a.actionId === 'raise-incident',
          'the incident action',
        );
        ctx.expect.equal([run.status, run.error], ['succeeded', null], 'the incident action');
        const t = ctx.expect.ok(
          await employee.get(`/itsm/tickets/${run.result?.reference}`),
          'the reporter opens the ticket',
        ).body;
        ctx.expect.equal([t.type, t.priority], ['incident', 2], 'type, priority');
        incident = t.reference as string;
        ctx.expect.equal(
          t.assignmentGroup?.key,
          `isms${firstInstall ? '' : tag}-security-review`,
          'its group',
        );
      })
      .catch((err: unknown) => {
        deferred = err;
      });

    if (ctx.rand.bool(0.7))
      await ctx.step('an employee asks for a VPN account: manager, ISMS approver and IT', async () => {
        const key = formKey('form-account-request');
        const me = ctx.user('employee');
        const sub = ctx.expect.status(
          await employee.post(`/forms/by-key/${key}/submissions`, {
            data: {
              subject: me.id,
              reason: 'new_hire',
              newAccounts: [
                { system: 'vpn', target: 'Remote access', account: `sim-${tag}`, privilege: 'user' },
              ],
            },
          }),
          201,
        ).body;
        await ctx.approvals.decide(sub.workflow.id, 'manager', 'approve');
        await ctx.approvals.decide(sub.workflow.id, 'ismsofficer', 'approve');
        const it = await ctx.approvals.taskOf(sub.workflow.id, 'ismsofficer');
        ctx.expect.equal(it.stepId, 'it', 'IT handles it last (no administrator rights: no security review)');
        const outcome = await ctx.approvals.decide(sub.workflow.id, 'ismsofficer', 'approve', {
          data: { result: 'done', notes: `Created ${sfx}` },
        });
        ctx.expect.equal(outcome, 'approved', 'the approval');
        const done = await settledRequest(ctx, employee, sub.id, { status: 'approved' });
        const tell = (done.actions as Json[]).find((a) => a.actionId === 'tell-server-room');
        ctx.expect.equal(tell?.status, 'skipped', 'the server room is not told about a VPN account');
      });

    if (incident)
      await ctx.step('the rollback waits for the open incident: the desk cancels it', async () => {
        // Its group would vanish under the open ticket: refused, naming the ticket (decision 93).
        const res = await admin.post(`${A}/change-sets/${setId}/rollback`, { confirm: true }, LONG);
        ctx.expect.code(res, 'IN_USE', 409, 'a rollback under an open incident');
        const refs = (res.body.error.details.references ?? []) as Json[];
        ctx.expect.truthy(
          refs.some((r) => r.href === `/itsm/tickets/${incident}`),
          'the refusal names the incident',
        );
        ctx.expect.ok(
          await admin.post(`/itsm/tickets/${incident}/transition`, {
            status: 'cancelled',
            resolutionCode: 'no_fault_found',
            resolutionNotes: `Rolling the ISMS processes back ${sfx}`,
          }),
          'cancelling the incident',
        );
      });

    await ctx.step('admin rolls the pack back in one step', async () => {
      await rollBack(ctx, setId);
      rolledBack = true;
      const formId = byRef.get('form-security-report')?.appliedId;
      ctx.expect.equal((await admin.get(`/forms/${formId}`)).body.archived, true, 'its forms are archived');
      const groupId = byRef.get('group-authority')?.appliedId;
      refused(ctx, await admin.get(`/groups/${groupId}`), [404], 'its groups are deleted');
    });
    if (deferred) throw deferred;

    if (firstInstall)
      await ctx.step('installing it again is blocked by the archived keys (documented)', async () => {
        const again = ctx.expect.status(await admin.post(`${PACK}/install`, {}, LONG), 201).body;
        ctx.expect.equal(again.ready, false, 'ready');
        ctx.expect.ok(await admin.post(`${A}/change-sets/${again.id}/discard`));
      });
  } finally {
    // Never leave the pack applied for the other flows (its forms, groups, jobs and default sign-off).
    if (!rolledBack) await leaveNothingApplied(ctx, setId);
  }
}

/** Cancels the tickets and approvals an `IN_USE` refusal lists, so a cleanup rollback can go through. */
async function endOpenWork(ctx: FlowContext, refs: Json[]) {
  const admin = ctx.as('admin');
  for (const r of refs) {
    const ref = String(r.href ?? '')
      .split('/')
      .pop()!;
    if (r.kind === 'work' && String(r.href).startsWith('/itsm/tickets/'))
      await admin.post(`/itsm/tickets/${ref}/transition`, {
        status: 'cancelled',
        resolutionCode: 'no_fault_found',
        resolutionNotes: 'Cleaning up after a failed run',
      });
    else if (r.kind === 'request' || r.kind === 'approval') {
      const found = await admin.get(`/requests/${ref}`);
      const instance = found.body?.submission?.workflow?.id;
      if (instance) await admin.post(`/workflow-instances/${instance}/cancel`, { reason: 'Cleaning up' });
    }
  }
  ctx.log(`cleanup: ended ${refs.length} item(s) still using the pack`);
}

/**
 * After a failure: waits for an apply still running on the server (the request may have timed out) and rolls it
 * back, or discards the draft. Holds the lock meanwhile, so the next run starts clean.
 */
async function leaveNothingApplied(ctx: FlowContext, setId: string) {
  const admin = ctx.as('admin');
  const until = Date.now() + 15 * 60_000;
  while (Date.now() < until) {
    const set = await admin.get(`${A}/change-sets/${setId}`, LONG);
    const status = set.body?.status as string | undefined;
    if (status === 'applied') {
      const res = await admin.post(`${A}/change-sets/${setId}/rollback`, { confirm: true }, LONG);
      if (res.status === 200) return ctx.log('cleanup: rolled the pack back');
      ctx.log(`cleanup: rollback refused (${res.status} ${res.body?.error?.code ?? ''})`);
      if (res.body?.error?.code === 'CHANGE_SET_STALE') return;
      // Open work still uses its groups (decision 93): end what the refusal lists, then try again.
      if (res.body?.error?.code === 'IN_USE')
        await endOpenWork(ctx, res.body.error.details?.references ?? []);
    } else if (status === 'draft') {
      // Not applied (yet): an apply that is still running holds its transaction; give it time to land.
      await new Promise((r) => setTimeout(r, 5_000));
      const again = (await admin.get(`${A}/change-sets/${setId}`, LONG)).body?.status;
      if (again === 'draft') {
        await admin.post(`${A}/change-sets/${setId}/discard`, undefined, LONG);
        return ctx.log('cleanup: discarded the draft');
      }
    } else if (status && status !== 'in_review') return;
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

/* ───────────────────────────── mcp-endpoint ───────────────────────────── */

const MCP = '/mcp';
const ACCEPT = { accept: 'application/json, text/event-stream' };

export const mcpEndpoint = defineFlow({
  name: 'mcp-endpoint',
  area: 'assistant',
  description:
    'MCP for outside agents: an API client with core.mcp.use initialises, lists and calls read-only tools; others refused',
  personas: ['admin'],
  async run(ctx) {
    const admin = ctx.as('admin');
    const sfx = ctx.rand.suffix();

    const client = await ctx.step('admin registers an agent as an API client', async () => {
      const res = ctx.expect.status(
        await admin.post('/api-clients', {
          name: `Sim agent ${sfx}`,
          description: 'Flow simulation: an outside agent over MCP',
          permissions: ['core.mcp.use', 'assistant.agent.use', 'core.forms.read', 'core.workflows.read'],
        }),
        201,
      ).body;
      ctx.expect.truthy(res.secret, 'the key is shown once');
      return { id: res.client.id as string, key: res.secret as string };
    });
    const rpc = (body: Json, headers: Record<string, string> = {}, bearer: string = client.key) =>
      admin.post(MCP, body, { bearer, headers: { ...ACCEPT, ...headers } });

    let revoked = false;
    try {
      const legacy = ctx.rand.bool(0.5);
      ctx.tag(legacy ? 'initialize (2025-06-18)' : 'stateless (2026-07-28)');
      let tools: Json[];
      if (legacy) {
        tools = await ctx.step('initialize, then list the tools', async () => {
          const init = ctx.expect.ok(
            await rpc({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2025-06-18',
                capabilities: {},
                clientInfo: { name: 'flow-sim', version: '1' },
              },
            }),
          ).body;
          ctx.expect.equal(
            [init.result?.protocolVersion, init.result?.serverInfo?.name],
            ['2025-06-18', 'isbp'],
            'version, server',
          );
          const v = { 'mcp-protocol-version': '2025-06-18' };
          ctx.expect.status(await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, v), 202);
          const ping = ctx.expect.ok(await rpc({ jsonrpc: '2.0', id: 2, method: 'ping' }, v)).body;
          ctx.expect.equal(ping.result, {}, 'ping');
          return ctx.expect.ok(await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, v)).body.result
            .tools as Json[];
        });
      } else {
        const meta = {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        };
        const modern = (id: number, method: string, params: Json = {}, extra: Record<string, string> = {}) =>
          rpc(
            { jsonrpc: '2.0', id, method, params: { ...params, _meta: meta } },
            { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...extra },
          );
        tools = await ctx.step('discover the server, then list the tools', async () => {
          const d = ctx.expect.ok(await modern(1, 'server/discover')).body.result;
          ctx.expect.truthy(
            (d.supportedVersions as string[]).includes('2026-07-28'),
            'the newest version is offered',
          );
          const missing = await rpc(
            { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: meta } },
            { 'mcp-protocol-version': '2026-07-28' },
          );
          refused(ctx, missing, [400], 'a request without its method header');
          const list = ctx.expect.ok(await modern(3, 'tools/list')).body.result.tools as Json[];
          const call = ctx.expect.ok(
            await modern(
              4,
              'tools/call',
              { name: 'assistant__list_kinds', arguments: {} },
              { 'mcp-name': 'assistant__list_kinds' },
            ),
          ).body.result;
          ctx.expect.equal(call?.isError, false, 'a read-only tool answers');
          return list;
        });
      }

      await ctx.step('only tools the client may use, nothing destructive', async () => {
        const names = tools.map((t) => t.name as string);
        ctx.expect.truthy(names.length > 3, `tools listed (${names.length})`);
        ctx.expect.equal(names, [...names].sort(), 'tools are sorted');
        for (const n of ['assistant__apply_change_set', 'core__offboard_user'])
          ctx.expect.truthy(!names.includes(n), `${n} is not offered`);
        ctx.expect.equal(
          tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name),
          [],
          'destructive tools offered',
        );
        if (ctx.rand.bool(0.3)) {
          ctx.tag('three lists at once');
          const v = { 'mcp-protocol-version': '2025-06-18' };
          const all = await Promise.all(
            [1, 2, 3].map((id) => rpc({ jsonrpc: '2.0', id, method: 'tools/list' }, v)),
          );
          for (const r of all) ctx.expect.ok(r, 'each list');
        }
      });

      await ctx.step('people, unknown keys and clients without MCP are refused', async () => {
        refused(
          ctx,
          await admin.post(MCP, { jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: ACCEPT }),
          [403],
          'a person’s session',
        );
        refused(
          ctx,
          await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, `isbp_${sfx}_not-a-key`),
          [401],
          'an unknown key',
        );
        const plain = ctx.expect.status(
          await admin.post('/api-clients', {
            name: `Sim no-MCP ${sfx}`,
            permissions: ['assistant.agent.use'],
          }),
          201,
        ).body;
        refused(
          ctx,
          await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, plain.secret),
          [403],
          'a client without core.mcp.use',
        );
        ctx.expect.ok(await admin.post(`/api-clients/${plain.client.id}/revoke`));
        refused(
          ctx,
          await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' }),
          [403],
          'a foreign origin',
        );
      });
      await ctx.step('admin revokes the agent', async () => {
        ctx.expect.ok(await admin.post(`/api-clients/${client.id}/revoke`));
        revoked = true;
        refused(ctx, await rpc({ jsonrpc: '2.0', id: 9, method: 'ping' }), [401], 'a revoked key');
      });
    } finally {
      // The agent's key never outlives the run.
      if (!revoked) await admin.post(`/api-clients/${client.id}/revoke`);
    }
  },
});
