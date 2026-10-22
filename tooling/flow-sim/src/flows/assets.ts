/**
 * IT asset management (module `itam`): hardware from registration to disposal (assign, return, data wipe, retire, the
 * disposal approval with information security for data-bearing devices), devices handed out and taken back through
 * request forms (`itam.assign-asset`, `itam.return-asset`), licence seats and compliance, contracts and vendors (the
 * counts on vendor and model pages against the lists), and discovery (API reports, CSV imports, unmatched titles,
 * title rules, the approved-software list).
 */
import type { ApiClient, Json } from '../client';
import { defineFlow, type FlowContext } from '../flow';
import { addDays, addMonths, departmentIds, notificationsAbout, todayIn } from './asset-support';

const TAG = /^AST-\d{5,}$/;
const A = '/itam';

const DATA_BEARING = new Set(['laptop', 'desktop', 'server', 'storage', 'phone', 'tablet']);
const WIPE_METHODS = ['factory_reset', 'secure_erase', 'crypto_erase', 'physical_destruction', 'other'];

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function wipeStateOf(wipeDue: string | null, today: string): string {
  if (!wipeDue) return 'none';
  const d = daysBetween(today, wipeDue);
  if (d < 0) return 'overdue';
  return d <= 7 ? 'due' : 'scheduled';
}

/** The other asset manager of the pool (the one who did not ask). */
const otherManager = (ctx: FlowContext) =>
  ctx.personaOf(ctx.user('assetmgr').id) === 'assetmgr1' ? 'assetmgr2' : 'assetmgr1';

interface NewAsset {
  category?: string;
  assignee?: string | null;
  purchaseDaysAgo?: number;
  cost?: number | null;
  extra?: Record<string, unknown>;
}

/** An asset manager registers a device with a unique serial number. */
async function registerAsset(ctx: FlowContext, label: string, o: NewAsset = {}): Promise<Json> {
  const today = todayIn();
  const category = o.category ?? 'laptop';
  const serial = `SIM-${ctx.rand.suffix()}-${label}`.toUpperCase().slice(0, 100);
  const body = {
    name: `${category.toUpperCase().slice(0, 3)}-${label}-${ctx.rand.words(1, 2)}`.slice(0, 200),
    category,
    serialNumber: serial,
    purchaseDate: addDays(today, -(o.purchaseDaysAgo ?? ctx.rand.int(10, 600))),
    purchaseCost: o.cost === undefined ? ctx.rand.int(3_000, 95_000) : o.cost,
    warrantyEnd: ctx.rand.bool(0.7) ? addDays(today, ctx.rand.int(40, 900)) : null,
    location: ctx.rand.bool(0.5) ? `Sim floor ${ctx.rand.int(1, 20)}F` : null,
    ...(o.assignee ? { assigneeId: ctx.user(o.assignee).id } : {}),
    ...o.extra,
  };
  const res = ctx.expect.status(await ctx.as('assetmgr').post(`${A}/assets`, body), 201, `register ${label}`);
  ctx.expect.match(res.body.tag, TAG, 'asset tag');
  ctx.expect.equal(res.body.serialNumber, serial, 'serial number');
  return res.body;
}

/* ───────────────────────────── itam-hardware-lifecycle ───────────────────────────── */

export const itamHardwareLifecycle = defineFlow({
  name: 'itam-hardware-lifecycle',
  area: 'itam',
  description:
    'Register → assign → return (wipe due) → record wipe → retire → disposal approved (asset manager, + security) or rejected',
  personas: ['assetmgr1', 'assetmgr2', 'assetmgr', 'employee', 'assetviewer', 'infosec'],
  timeoutMs: 200_000,
  async run(ctx) {
    const am = ctx.as('assetmgr');
    const amName = ctx.personaOf(ctx.user('assetmgr').id)!;
    const employee = ctx.user('employee');
    const today = todayIn();
    const category = ctx.rand.weighted([
      ['laptop', 5],
      ['phone', 2],
      ['tablet', 1],
      ['desktop', 1],
      ['monitor', 2],
      ['peripheral', 1],
      ['network', 1],
      ['printer', 1],
    ] as const);
    const dataBearing = DATA_BEARING.has(category);
    const old = ctx.rand.bool(0.2);
    const deployAtOnce = ctx.rand.bool(0.3);
    ctx.tag(category);
    if (old) ctx.tag('fully depreciated, over 5 years');

    const asset = await ctx.step('the asset manager registers the device', async () => {
      const a = await registerAsset(ctx, 'hw', {
        category,
        purchaseDaysAgo: old ? ctx.rand.int(2_300, 2_900) : ctx.rand.int(10, 700),
        cost: ctx.rand.bool(0.15) ? null : ctx.rand.int(3_000, 95_000),
        assignee: deployAtOnce ? 'employee' : null,
      });
      ctx.expect.equal(
        [a.status, a.assignee?.id ?? null, a.dataBearing, a.viewer?.canManage],
        [deployAtOnce ? 'deployed' : 'in_stock', deployAtOnce ? employee.id : null, dataBearing, true],
        'status, assignee, data-bearing, manageable',
      );
      if (old) ctx.expect.equal(a.depreciation?.bookValue ?? 0, 0, 'fully depreciated');
      const dup = await am.post(`${A}/assets`, {
        name: 'duplicate',
        category,
        serialNumber: String(a.serialNumber).toLowerCase(),
      });
      ctx.expect.code(dup, 'CONFLICT', 409);
      return a;
    });
    const tag = asset.tag as string;

    await ctx.step('readers read, others are refused', async () => {
      const viewer = ctx.as('assetviewer');
      const seen = ctx.expect.ok(await viewer.get(`${A}/assets/${tag}`)).body;
      ctx.expect.equal([seen.id, seen.viewer?.canManage], [asset.id, false], 'the viewer sees it, read-only');
      const list = ctx.expect.ok(await viewer.get(`${A}/assets`, { query: { q: asset.serialNumber } })).body;
      ctx.expect.equal(
        (list.items as Json[]).map((x) => x.id),
        [asset.id],
        'a search by serial finds exactly it',
      );
      ctx.expect.status(
        await viewer.post(`${A}/assets/${tag}/assign`, { userId: employee.id }),
        403,
        'a viewer may not assign',
      );
      ctx.expect.status(
        await ctx.as('employee').get(`${A}/assets`),
        403,
        'an employee may not list hardware',
      );
      ctx.expect.status(
        await ctx.as('employee').post(`${A}/assets`, { name: 'x', category: 'other' }),
        403,
        'an employee may not register hardware',
      );
    });

    if (!deployAtOnce)
      await ctx.step('the asset manager hands it to the employee', async () => {
        const body = { userId: employee.id, note: ctx.rand.bool() ? ctx.rand.sentence(3, 8) : undefined };
        if (ctx.rand.bool(0.15)) {
          ctx.tag('double assign');
          const both = await Promise.all([1, 2].map(() => am.post(`${A}/assets/${tag}/assign`, body)));
          for (const r of both) ctx.expect.ok(r, 'assigning to the same person again is harmless');
        } else ctx.expect.ok(await am.post(`${A}/assets/${tag}/assign`, body));
        const a = ctx.expect.ok(await am.get(`${A}/assets/${tag}`)).body;
        ctx.expect.equal([a.status, a.assignee?.id], ['deployed', employee.id], 'deployed to the employee');
        const events = ctx.expect.ok(await am.get(`${A}/assets/${tag}/events`)).body.items as Json[];
        ctx.expect.equal(events.filter((e) => e.kind === 'assigned').length, 1, '"assigned" events');
      });

    await ctx.step('the employee sees their device and is told once', async () => {
      const mine = ctx.expect.ok(await ctx.as('employee').get(`${A}/me/assets`)).body;
      ctx.expect.find(mine.devices as Json[], (d) => d.id === asset.id, 'My devices lists it');
      ctx.expect.status(await ctx.as('employee').get(`${A}/assets/${tag}`), [403, 404], 'the hardware page');
      const told = await ctx.eventually(
        () => notificationsAbout(ctx, 'employee', 'itam.asset.assigned', tag),
        (n) => n.length > 0,
        { label: 'the assigned notification' },
      );
      ctx.expect.equal(told.length, 1, '"assigned" notifications');
    });

    await ctx.step('a deployed device cannot be retired or disposed of', async () => {
      const res = await am.post(`${A}/assets/${tag}/status`, { status: 'retired' });
      ctx.expect.code(res, 'INVALID_TRANSITION', 409);
      ctx.expect.equal(
        [...(res.body.error.details?.allowed ?? [])].sort(),
        ['in_repair', 'in_stock', 'lost'],
        'allowed transitions',
      );
      ctx.expect.code(await am.post(`${A}/assets/${tag}/dispose`, { note: 'x' }), 'INVALID_TRANSITION', 409);
    });

    if (ctx.rand.bool(0.2))
      await ctx.step('it is lost and found again', async () => {
        ctx.tag('lost and found');
        const lost = ctx.expect.ok(
          await am.post(`${A}/assets/${tag}/status`, { status: 'lost', note: ctx.rand.sentence(3, 6) }),
        ).body;
        ctx.expect.equal([lost.status, lost.assignee?.id], ['lost', employee.id], 'lost keeps who had it');
        ctx.expect.code(
          await am.post(`${A}/assets/${tag}/status`, { status: 'retired' }),
          'INVALID_TRANSITION',
          409,
        );
        const found = ctx.expect.ok(await am.post(`${A}/assets/${tag}/status`, { status: 'in_stock' })).body;
        ctx.expect.equal([found.status, found.assignee], ['in_stock', null], 'found: back in stock');
        const again = ctx.expect.ok(await am.post(`${A}/assets/${tag}/assign`, { userId: employee.id })).body;
        ctx.expect.equal(again.status, 'deployed', 'back with the employee');
      });

    const retain = ctx.rand.weighted([
      ['none', 3],
      ['future', 3],
      ['past', 2],
    ] as const);
    const retainUntil =
      retain === 'none'
        ? null
        : addDays(today, retain === 'future' ? ctx.rand.int(1, 120) : -ctx.rand.int(1, 120));
    const returned = await ctx.step('the employee hands it back', async () => {
      const a = ctx.expect.ok(
        await am.post(`${A}/assets/${tag}/return`, {
          note: ctx.rand.sentence(2, 6),
          toStatus: 'in_stock',
          dataRetainUntil: retainUntil,
        }),
      ).body;
      const wipeDue = dataBearing ? addMonths(retainUntil ?? today, 2) : null;
      ctx.expect.equal(
        [a.status, a.assignee, a.dataRetainUntil ?? null, a.wipeDue, a.wipeState],
        [
          'in_stock',
          null,
          dataBearing ? retainUntil : (a.dataRetainUntil ?? null),
          wipeDue,
          wipeStateOf(wipeDue, today),
        ],
        'status, assignee, retention, wipe due and state',
      );
      ctx.expect.equal(
        a.viewer?.canRecordWipe,
        dataBearing,
        'a wipe can be recorded for data-bearing devices',
      );
      ctx.expect.code(await am.post(`${A}/assets/${tag}/return`, {}), 'INVALID_STATE', 409);
      const mine = ctx.expect.ok(await ctx.as('employee').get(`${A}/me/assets`)).body;
      ctx.expect.equal(
        (mine.devices as Json[]).some((d) => d.id === asset.id),
        false,
        'My devices no longer lists it',
      );
      if (dataBearing) {
        const pending = ctx.expect.ok(
          await am.get(`${A}/assets`, { query: { wipe: 'pending', q: asset.serialNumber } }),
        ).body.items as Json[];
        ctx.expect.equal(
          pending.map((x) => x.id),
          [asset.id],
          'the pending-wipe filter lists it',
        );
      }
      return a;
    });

    if (dataBearing)
      await ctx.step('the asset manager records the data wipe', async () => {
        ctx.expect.status(
          await ctx.as('assetviewer').post(`${A}/assets/${tag}/wipe`, { method: 'secure_erase' }),
          403,
          'a viewer may not record a wipe',
        );
        ctx.expect.status(
          await am.post(`${A}/assets/${tag}/wipe`, {
            method: 'secure_erase',
            wipedAt: new Date(Date.now() + 86_400_000).toISOString(),
          }),
          400,
          'a wipe in the future is refused',
        );
        const method = ctx.rand.pick(WIPE_METHODS);
        const a = ctx.expect.ok(
          await am.post(`${A}/assets/${tag}/wipe`, { method, note: ctx.rand.sentence(2, 6) }),
        ).body;
        ctx.expect.equal(
          [a.wipeDue, a.wipeState, a.lastWipe?.method, a.lastWipe?.by?.id],
          [null, 'none', method, ctx.user('assetmgr').id],
          'the wipe is recorded and the pending wipe cleared',
        );
        const events = ctx.expect.ok(await am.get(`${A}/assets/${tag}/events`)).body.items as Json[];
        ctx.expect.equal(events[0]?.kind, 'data_wiped', 'the latest event');
      });
    else ctx.expect.equal(returned.wipeDue, null, 'no wipe for a device without storage');

    await ctx.step('the asset manager retires it', async () => {
      const a = ctx.expect.ok(await am.post(`${A}/assets/${tag}/status`, { status: 'retired' })).body;
      ctx.expect.equal([a.status, a.viewer?.canDispose], ['retired', true], 'retired, disposable');
    });

    const security = dataBearing && !old;
    await ctx.step('the disposal preview names who approves', async () => {
      ctx.expect.status(
        await ctx.as('assetviewer').get(`${A}/assets/${tag}/disposal-preview`),
        403,
        'viewer',
      );
      const p = ctx.expect.ok(await am.get(`${A}/assets/${tag}/disposal-preview`)).body;
      ctx.expect.equal(
        [p.securitySignOff, (p.steps as Json[]).map((s) => s.id)],
        [security, security ? ['asset-manager', 'security'] : ['asset-manager']],
        'security sign-off and steps',
      );
      if (security) {
        const sec = (p.steps as Json[]).find((s) => s.id === 'security');
        ctx.expect.find(
          sec.people as Json[],
          (x) => x.id === ctx.user('infosec').id,
          'information security is asked',
        );
      }
    });

    const note = ctx.rand.sentence(3, 9);
    const instanceId = await ctx.step('the asset manager asks to dispose of it', async () => {
      ctx.expect.status(
        await ctx.as('assetviewer').post(`${A}/assets/${tag}/dispose`, { note }),
        403,
        'a viewer may not',
      );
      let res;
      if (ctx.rand.bool(0.2)) {
        ctx.tag('double dispose');
        const both = await Promise.all([1, 2].map(() => am.post(`${A}/assets/${tag}/dispose`, { note })));
        res = ctx.expect.oneOk(both, 'one disposal request', [409]);
      } else res = ctx.expect.ok(await am.post(`${A}/assets/${tag}/dispose`, { note }));
      ctx.expect.equal(
        [res.body.status, res.body.viewer?.canDispose],
        ['retired', false],
        'still retired, waiting for approval',
      );
      ctx.expect.truthy(res.body.disposalInstanceId, 'an approval started');
      ctx.expect.code(await am.post(`${A}/assets/${tag}/dispose`, { note }), 'INVALID_STATE', 409);
      return res.body.disposalInstanceId as string;
    });

    if (ctx.rand.bool(0.2)) {
      ctx.tag('rejected');
      await ctx.step('the other asset manager rejects it', async () => {
        const outcome = await ctx.approvals.decide(instanceId, otherManager(ctx), 'reject');
        ctx.expect.equal(outcome, 'rejected', 'outcome');
        const a = await ctx.eventually(
          () => am.get(`${A}/assets/${tag}`),
          (r) => r.body?.disposalInstanceId === null,
          { label: 'the rejected disposal' },
        );
        ctx.expect.equal(
          [a.body.status, a.body.viewer?.canDispose],
          ['retired', true],
          'retired, may ask again',
        );
      });
      return;
    }
    ctx.tag(security ? 'approved with security' : 'approved');

    await ctx.step('the approvers approve', async () => {
      const { status, decisions } = await ctx.approvals.approveAll(instanceId, {
        avoid: [amName],
        prefer: [otherManager(ctx), 'infosec'],
      });
      ctx.expect.equal(status, 'approved', 'outcome');
      ctx.expect.equal(
        decisions.map((d) => d.stepId),
        security ? ['asset-manager', 'security'] : ['asset-manager'],
        'steps decided',
      );
    });

    await ctx.step('the device is disposed of, for good', async () => {
      const a = await ctx.eventually(
        () => ctx.as('assetviewer').get(`${A}/assets/${tag}`),
        (r) => r.body?.status === 'disposed',
        { label: 'the disposal' },
      );
      ctx.expect.equal([a.body.disposalNote, a.body.disposalInstanceId], [note, null], 'note, instance');
      ctx.expect.truthy(a.body.disposedAt, 'disposed at');
      const events = ctx.expect.ok(await am.get(`${A}/assets/${tag}/events`)).body.items as Json[];
      ctx.expect.equal([events[0]?.kind, events[0]?.note], ['disposed', note], 'the latest event');
      ctx.expect.code(
        await am.post(`${A}/assets/${tag}/status`, { status: 'in_stock' }),
        'INVALID_TRANSITION',
        409,
      );
    });
  },
});

/* ───────────────────────────── itam-device-request ───────────────────────────── */

const CHECKOUT_FORM = 'sim-device-checkout';
const RETURN_FORM = 'sim-device-return';

interface DeviceForms {
  checkout: string;
  return: string;
}

let deviceForms: Promise<DeviceForms> | null = null;

/**
 * The simulator's device checkout and return request forms (created once, then reused): an asset manager approves
 * and picks the device (checkout) or enters the data retention date (return); `itam.assign-asset` and
 * `itam.return-asset` run on approval.
 */
function ensureDeviceForms(ctx: FlowContext): Promise<DeviceForms> {
  deviceForms ??= (async () => {
    const admin = ctx.as('admin');
    const workflow = async (name: string, stepId: string, fields: Json[]) => {
      const list = ctx.expect.ok(
        await admin.get('/workflows', { query: { triggerKey: 'core.form-submission', pageSize: 200 } }),
      ).body.items as Json[];
      const found = list.find((w) => w.name === name);
      if (found) return found.id as string;
      const wf = ctx.expect.status(
        await admin.post('/workflows', { name, triggerKey: 'core.form-submission' }),
        201,
        `create the workflow ${name}`,
      ).body;
      ctx.expect.ok(
        await admin.patch(`/workflows/${wf.id}`, {
          draft: {
            steps: [
              {
                id: stepId,
                type: 'approval',
                name: { en: 'IS asset desk', 'zh-TW': 'IS 資產窗口', 'ja-JP': 'IS 資産窓口' },
                approvers: [{ type: 'role', roleKey: 'itam-asset-manager' }],
                mode: 'any',
                fields,
              },
            ],
          },
        }),
        `save the workflow ${name}`,
      );
      ctx.expect.ok(await admin.post(`/workflows/${wf.id}/publish`), `publish the workflow ${name}`);
      return wf.id as string;
    };
    const form = async (key: string, name: string, draft: Json, workflowId: string) => {
      const list = ctx.expect.ok(await admin.get('/forms', { query: { q: key } })).body.items as Json[];
      let f = list.find((x) => x.key === key);
      if (f?.publishedVersion) return key;
      if (!f)
        f = ctx.expect.status(
          await admin.post('/forms', { key, name: { en: name }, icon: 'laptop' }),
          201,
          `create the form ${key}`,
        ).body;
      ctx.expect.ok(
        await admin.patch(`/forms/${f.id}`, { draft, workflowDefinitionId: workflowId }),
        `save ${key}`,
      );
      ctx.expect.ok(await admin.post(`/forms/${f.id}/publish`), `publish ${key}`);
      return key;
    };
    const checkoutWf = await workflow('Sim device checkout', 'issue', [
      {
        key: 'device',
        type: 'record',
        label: { en: 'Device' },
        required: true,
        record: { types: ['itam.asset'] },
      },
    ]);
    const returnWf = await workflow('Sim device return', 'receive', [
      { key: 'retainUntil', type: 'date', label: { en: 'Keep data until' }, required: true },
    ]);
    const checkout = await form(
      CHECKOUT_FORM,
      'Sim device checkout',
      {
        elements: [
          {
            id: 'agree',
            key: 'agree',
            type: 'boolean',
            label: { en: 'I agree to the device rules' },
            required: true,
          },
          { id: 'purpose', key: 'purpose', type: 'textarea', label: { en: 'What for' }, required: true },
        ],
        actions: [
          {
            id: 'assign',
            on: 'approved',
            type: 'itam.assign-asset',
            config: { assetField: 'step', assetStepField: 'issue.device', assignTo: 'requester' },
          },
        ],
      },
      checkoutWf,
    );
    const ret = await form(
      RETURN_FORM,
      'Sim device return',
      {
        elements: [
          {
            id: 'device',
            key: 'device',
            type: 'record',
            label: { en: 'Device' },
            required: true,
            record: { types: ['itam.asset'] },
          },
          { id: 'condition', key: 'condition', type: 'text', label: { en: 'Condition' }, required: true },
        ],
        actions: [
          {
            id: 'return',
            on: 'approved',
            type: 'itam.return-asset',
            config: {
              assetField: 'field:device',
              toStatus: 'in_stock',
              condition: 'Condition: {{data.condition}}',
              retentionFrom: 'step',
              retentionStepField: 'receive.retainUntil',
              wipeMonths: 2,
              scheduleWipe: true,
            },
          },
        ],
      },
      returnWf,
    );
    return { checkout, return: ret };
  })().catch((err) => {
    deviceForms = null;
    throw err;
  });
  return deviceForms;
}

/** Waits for a submission's process actions to settle and returns the run of `actionId`. */
async function settledRun(ctx: FlowContext, persona: string, submissionId: string, actionId: string) {
  const done = await ctx.eventually(
    () => ctx.as(persona).get(`/form-submissions/${submissionId}`),
    (r) =>
      r.body?.status === 'approved' &&
      (r.body.actions as Json[]).length > 0 &&
      (r.body.actions as Json[]).every((a) => ['succeeded', 'failed', 'skipped'].includes(a.status)),
    { label: 'the process action', timeoutMs: 60_000 },
  );
  const runs = (done.body.actions as Json[]).filter((a) => a.actionId === actionId);
  ctx.expect.equal(runs.length, 1, `runs of ${actionId}`);
  ctx.expect.equal([runs[0]!.status, runs[0]!.error ?? null], ['succeeded', null], `${actionId} succeeded`);
  return runs[0]!;
}

export const itamDeviceRequest = defineFlow({
  name: 'itam-device-request',
  area: 'itam',
  description:
    'Device checkout form → asset manager picks the device → itam.assign-asset; return form → retention → itam.return-asset',
  personas: ['assetmgr1', 'assetmgr2', 'assetmgr', 'employee', 'admin'],
  timeoutMs: 200_000,
  async run(ctx) {
    const forms = await ctx.step('the device request forms exist', () => ensureDeviceForms(ctx));
    const employee = ctx.as('employee');
    const me = ctx.user('employee');
    const desk = ctx.personaOf(ctx.user('assetmgr').id)!;
    const today = todayIn();

    const device = await ctx.step('a laptop is in stock', () =>
      registerAsset(ctx, 'checkout', { category: ctx.rand.pick(['laptop', 'tablet', 'phone']) }),
    );

    const sub = await ctx.step('the employee asks for a device', async () => {
      const f = await ctx.forms.published(forms.checkout, 'employee');
      const data = ctx.forms.answers(f.schema, { agree: true, purpose: ctx.rand.sentence(4, 10) });
      const res = ctx.expect.status(
        await employee.post(`/forms/by-key/${forms.checkout}/submissions`, { data }),
        201,
      );
      ctx.expect.truthy(res.body.workflow?.id, 'an approval started');
      return res.body as Json;
    });

    if (ctx.rand.bool(0.15)) {
      ctx.tag('checkout rejected');
      await ctx.step('the asset desk rejects it', async () => {
        ctx.expect.equal(
          await ctx.approvals.decide(sub.workflow.id, desk, 'reject', { data: {} }),
          'rejected',
          'outcome (no device needs picking to reject)',
        );
        await ctx.eventually(
          () => employee.get(`/form-submissions/${sub.id}`),
          (r) => r.body?.status === 'rejected',
          { label: 'the rejection' },
        );
        const a = ctx.expect.ok(await ctx.as('assetmgr').get(`${A}/assets/${device.tag}`)).body;
        ctx.expect.equal([a.status, a.assignee], ['in_stock', null], 'the device stays in stock');
      });
      return;
    }

    await ctx.step('the asset desk picks the device and approves', async () => {
      const twice = ctx.rand.bool(0.15);
      if (twice) ctx.tag('double approve');
      const outcome = await ctx.approvals.decide(sub.workflow.id, desk, 'approve', {
        data: { device: `itam.asset:${device.id}` },
        twice,
      });
      ctx.expect.equal(outcome, 'approved', 'outcome');
    });

    await ctx.step('itam.assign-asset hands it to the requester', async () => {
      const run = await settledRun(ctx, 'employee', sub.id, 'assign');
      ctx.expect.equal(run.result?.reference, device.tag, 'the action names the device');
      const a = ctx.expect.ok(await ctx.as('assetmgr').get(`${A}/assets/${device.tag}`)).body;
      ctx.expect.equal([a.status, a.assignee?.id], ['deployed', me.id], 'deployed to the requester');
      const events = ctx.expect.ok(await ctx.as('assetmgr').get(`${A}/assets/${device.tag}/events`)).body
        .items as Json[];
      const assigned = events.filter((e) => e.kind === 'assigned');
      ctx.expect.equal(assigned.length, 1, '"assigned" events');
      ctx.expect.equal(assigned[0]!.request?.reference, sub.reference, 'the history names the request');
      const mine = ctx.expect.ok(await employee.get(`${A}/me/assets`)).body;
      ctx.expect.find(mine.devices as Json[], (d) => d.id === device.id, 'My devices lists it');
    });

    if (ctx.rand.bool(0.2))
      await ctx.step('the employee cannot return someone else’s device', async () => {
        ctx.tag('foreign device refused');
        const other = await registerAsset(ctx, 'foreign', { assignee: 'assetmgr' });
        const res = await employee.post(`/forms/by-key/${forms.return}/submissions`, {
          data: { device: `itam.asset:${other.id}`, condition: 'fine' },
        });
        ctx.expect.status(res, [400, 403, 404], 'a device the requester cannot see is refused');
      });

    const sub2 = await ctx.step('the employee returns it', async () => {
      const res = ctx.expect.status(
        await employee.post(`/forms/by-key/${forms.return}/submissions`, {
          data: { device: `itam.asset:${device.id}`, condition: ctx.rand.words(2, 5) },
        }),
        201,
      );
      return res.body as Json;
    });

    const retainUntil = addDays(today, ctx.rand.int(-30, 90));
    await ctx.step('the asset desk enters how long the data is kept', async () => {
      const outcome = await ctx.approvals.decide(sub2.workflow.id, desk, 'approve', {
        data: { retainUntil },
      });
      ctx.expect.equal(outcome, 'approved', 'outcome');
    });

    await ctx.step('itam.return-asset takes it back and schedules the wipe', async () => {
      const run = await settledRun(ctx, 'employee', sub2.id, 'return');
      const due = addMonths(retainUntil, 2);
      ctx.expect.equal(run.result?.reference, device.tag, 'the action names the device');
      const a = ctx.expect.ok(await ctx.as('assetmgr').get(`${A}/assets/${device.tag}`)).body;
      ctx.expect.equal(
        [a.status, a.assignee, a.dataRetainUntil, a.wipeDue, a.wipeState],
        ['in_stock', null, retainUntil, due, wipeStateOf(due, today)],
        'status, assignee, retention, wipe',
      );
      const events = ctx.expect.ok(await ctx.as('assetmgr').get(`${A}/assets/${device.tag}/events`)).body
        .items as Json[];
      const ret = ctx.expect.find(events, (e) => e.kind === 'returned', 'the returned event');
      ctx.expect.equal(ret.request?.reference, sub2.reference, 'the history names the return request');
      ctx.expect.equal(events.filter((e) => e.kind === 'returned').length, 1, '"returned" events');
    });
  },
});

/* ───────────────────────────── itam-licence-seats ───────────────────────────── */

const SEAT_HOLDERS = [
  'employee1',
  'employee2',
  'employee3',
  'employee4',
  'custodian1',
  'custodian2',
  'custodian3',
  'accreviewer1',
  'dataowner',
  'dbuser1',
  'dbuser2',
  'itlead',
];

export const itamLicenceSeats = defineFlow({
  name: 'itam-licence-seats',
  area: 'itam',
  description:
    'Licence with a sealed key → seats assigned at once (over-allocation) → compliance and counts stay consistent',
  personas: ['assetmgr1', 'assetmgr2', 'assetmgr', 'assetviewer', ...SEAT_HOLDERS],
  async run(ctx) {
    const am = ctx.as('assetmgr');
    const sfx = ctx.rand.suffix();
    const today = todayIn();
    const perDevice = ctx.rand.bool(0.25);
    const quantity = ctx.rand.int(1, 6);
    const key = `SIMK-${ctx.rand.suffix().toUpperCase()}-${ctx.rand.int(1000, 9999)}`;
    ctx.tag(perDevice ? 'per device' : 'per user');

    const lic = await ctx.step('the asset manager records a licence with its key', async () => {
      const res = ctx.expect.status(
        await am.post(`${A}/licenses`, {
          product: `Sim Suite ${sfx}`,
          publisher: 'Sim Software',
          licenseType: perDevice ? 'per_device' : 'per_user',
          quantity,
          cost: ctx.rand.int(1_000, 50_000),
          billing: ctx.rand.pick(['annual', 'monthly', 'one_time']),
          endDate: ctx.rand.bool(0.5) ? addDays(today, ctx.rand.int(120, 700)) : null,
          licenseKey: key,
        }),
        201,
      ).body;
      ctx.expect.match(res.reference, /^LIC-\d+$/, 'reference');
      ctx.expect.equal(
        [res.used, res.complianceState, res.hasKey, res.keyHint],
        [0, 'compliant', true, key.slice(-4)],
        'used, compliance, key',
      );
      ctx.expect.truthy(!JSON.stringify(res).includes(key), 'the key is never returned');
      return res as Json;
    });
    const ref = lic.reference as string;

    await ctx.step('only key revealers see the key', async () => {
      const list = ctx.expect.ok(
        await ctx.as('assetviewer').get(`${A}/licenses`, { query: { q: sfx } }),
      ).body;
      ctx.expect.equal((list.items as Json[]).length, 1, 'the search finds it');
      ctx.expect.truthy(!JSON.stringify(list).includes(key), 'the list never shows the key');
      ctx.expect.status(await ctx.as('assetviewer').post(`${A}/licenses/${ref}/reveal-key`), 403, 'viewer');
      const revealed = ctx.expect.ok(await am.post(`${A}/licenses/${ref}/reveal-key`)).body;
      ctx.expect.truthy(revealed.key === key, 'the revealed key is the stored one');
    });

    if (perDevice) {
      await ctx.step('per-device seats go to devices', async () => {
        ctx.expect.code(
          await am.post(`${A}/licenses/${ref}/assignments`, { userId: ctx.user('employee1').id }),
          'VALIDATION_FAILED',
          400,
        );
        const servers = await Promise.all(
          [1, 2].map((n) => registerAsset(ctx, `srv${n}`, { category: 'server' })),
        );
        ctx.expect.status(
          await am.post(`${A}/licenses/${ref}/assignments`, { assetId: servers[0]!.id }),
          201,
          'a device seat',
        );
        // Both servers run it; one has a seat, the other counts as unlicensed use.
        for (const s of servers)
          ctx.expect.ok(
            await am.post(`${A}/discovery/software`, {
              assetId: s.id,
              products: [{ product: `Sim Suite ${sfx}` }],
            }),
          );
        const l = ctx.expect.ok(await am.get(`${A}/licenses/${ref}`)).body;
        ctx.expect.equal(
          [l.assigned, l.unlicensed, l.used, l.complianceState],
          [1, 1, 2, 2 > quantity ? 'over_deployed' : 'compliant'],
          'assigned, unlicensed, used, compliance',
        );
        const unlicensed = ctx.expect.ok(
          await am.get(`${A}/licenses/${ref}/installations`, { query: { unlicensed: true } }),
        ).body.items as Json[];
        ctx.expect.equal(
          unlicensed.map((i) => i.asset?.id),
          [servers[1]!.id],
          'the unlicensed install',
        );
      });
      return;
    }

    const holders = ctx.rand.sample(SEAT_HOLDERS, 1, Math.min(SEAT_HOLDERS.length, quantity + 3));
    const atOnce = holders.length > 1 && ctx.rand.bool(0.5);
    if (atOnce) ctx.tag('seats at once');
    await ctx.step(`${holders.length} seats are assigned${atOnce ? ' at once' : ''}`, async () => {
      const assign = (h: string) => am.post(`${A}/licenses/${ref}/assignments`, { userId: ctx.user(h).id });
      const res = atOnce ? await Promise.all(holders.map(assign)) : [];
      if (!atOnce) for (const h of holders) res.push(await assign(h));
      for (const r of res) ctx.expect.status(r, 201, 'a seat');
      const l = ctx.expect.ok(await am.get(`${A}/licenses/${ref}`)).body;
      const over = holders.length > quantity;
      ctx.expect.equal(
        [l.used, l.complianceState],
        [holders.length, over ? 'over_deployed' : 'compliant'],
        'used and compliance',
      );
      const seats = ctx.expect.ok(
        await am.get(`${A}/licenses/${ref}/assignments`, { query: { pageSize: 50 } }),
      ).body;
      ctx.expect.equal(seats.total, holders.length, 'the seat list total');
      ctx.expect.equal(
        (seats.items as Json[]).map((s) => s.user?.id).sort(),
        holders.map((h) => ctx.user(h).id).sort(),
        'the seat holders',
      );
      if (over) ctx.tag('over-deployed');
    });

    await ctx.step('a second seat for the same person is refused', async () => {
      ctx.expect.code(
        await am.post(`${A}/licenses/${ref}/assignments`, { userId: ctx.user(holders[0]!).id }),
        'CONFLICT',
        409,
      );
      const fresh = SEAT_HOLDERS.find((h) => !holders.includes(h));
      if (fresh && ctx.rand.bool(0.3)) {
        ctx.tag('double seat');
        const both = await Promise.all(
          [1, 2].map(() => am.post(`${A}/licenses/${ref}/assignments`, { userId: ctx.user(fresh).id })),
        );
        ctx.expect.oneOk(both, 'one seat for the double click', [409]);
        holders.push(fresh);
        const l = ctx.expect.ok(await am.get(`${A}/licenses/${ref}`)).body;
        ctx.expect.equal(l.used, holders.length, 'used after the double click');
      }
    });

    if (holders.length > quantity)
      await ctx.step('the asset managers are told once', async () => {
        for (const p of ['assetmgr1', 'assetmgr2']) {
          const n = await ctx.eventually(
            () => notificationsAbout(ctx, p, 'itam.license.non_compliant', `Sim Suite ${sfx}`),
            (x) => x.length > 0,
            { label: 'the non-compliance notification' },
          );
          ctx.expect.equal(n.length, 1, `${p}'s non-compliance notifications`);
        }
      });

    await ctx.step('seats are taken back until it complies', async () => {
      const seats = ctx.expect.ok(
        await am.get(`${A}/licenses/${ref}/assignments`, { query: { pageSize: 50 } }),
      ).body.items as Json[];
      const keep = ctx.rand.int(0, Math.min(quantity, seats.length));
      const remove = ctx.rand.shuffle(seats).slice(0, seats.length - keep);
      const res = await Promise.all(remove.map((s) => am.delete(`${A}/licenses/${ref}/assignments/${s.id}`)));
      for (const r of res) ctx.expect.status(r, 204, 'a seat removed');
      const l = ctx.expect.ok(await am.get(`${A}/licenses/${ref}`)).body;
      ctx.expect.equal([l.used, l.complianceState], [keep, 'compliant'], 'used and compliance');
      const after = ctx.expect.ok(
        await am.get(`${A}/licenses/${ref}/assignments`, { query: { pageSize: 50 } }),
      ).body;
      ctx.expect.equal(after.total, keep, 'the seat list total');
      const bigger = ctx.expect.ok(await am.patch(`${A}/licenses/${ref}`, { quantity: 20 })).body;
      ctx.expect.equal(
        [bigger.quantity, bigger.complianceState],
        [20, 'under_used'],
        'quantity 20 → under-used',
      );
      const back = ctx.expect.ok(await am.patch(`${A}/licenses/${ref}`, { quantity })).body;
      ctx.expect.equal(back.complianceState, 'compliant', 'back to compliant');
    });
  },
});

/* ───────────────────────────── itam-contracts-vendors ───────────────────────────── */

export const itamContractsVendors = defineFlow({
  name: 'itam-contracts-vendors',
  area: 'itam',
  description:
    'Vendor, model, assets, licences and contracts (draft, renew, cancel, items) → counts on vendor and model pages',
  personas: ['contractmgr', 'assetmgr', 'assetviewer', 'employee'],
  async run(ctx) {
    const cm = ctx.as('contractmgr');
    const am = ctx.as('assetmgr');
    const viewer = ctx.as('assetviewer');
    const sfx = ctx.rand.suffix();
    const today = todayIn();

    const vendor = await ctx.step('the contract manager adds a vendor', async () => {
      const name = `Sim Vendor ${sfx}`;
      const v = ctx.expect.status(
        await cm.post(`${A}/vendors`, {
          name,
          website: `https://${sfx}.example.com`,
          contactName: ctx.rand.words(2),
        }),
        201,
      ).body;
      ctx.expect.code(await cm.post(`${A}/vendors`, { name: name.toLowerCase() }), 'CONFLICT', 409);
      ctx.expect.status(
        await ctx.as('employee').get(`${A}/vendors`),
        403,
        'an employee may not list vendors',
      );
      return v as Json;
    });

    const category = ctx.rand.pick(['laptop', 'desktop', 'monitor', 'phone']);
    const model = await ctx.step(
      'the asset manager adds a model',
      async () =>
        ctx.expect.status(
          await am.post(`${A}/models`, { category, manufacturer: `SimMaker ${sfx}`, name: `Model ${sfx}` }),
          201,
        ).body as Json,
    );

    const nAssets = ctx.rand.int(0, 3);
    const assets = await ctx.step(`${nAssets} assets of the model from the vendor`, async () =>
      Promise.all(
        Array.from({ length: nAssets }, (_, i) =>
          registerAsset(ctx, `v${i}`, { category, extra: { modelId: model.id, vendorId: vendor.id } }),
        ),
      ),
    );
    const nLicences = ctx.rand.int(0, 2);
    const licences = await ctx.step(`${nLicences} licences from the vendor`, async () =>
      Promise.all(
        Array.from(
          { length: nLicences },
          async (_, i) =>
            ctx.expect.status(
              await am.post(`${A}/licenses`, {
                product: `Sim Vendor Product ${sfx} ${i}`,
                licenseType: 'subscription',
                vendorId: vendor.id,
                quantity: ctx.rand.int(5, 50),
              }),
              201,
            ).body as Json,
        ),
      ),
    );

    const kinds = ['maintenance', 'support', 'lease', 'subscription', 'warranty', 'service', 'other'];
    const shapes = ctx.rand.sample(['active', 'expiring', 'draft', 'expired', 'active'] as const, 1, 4);
    const contracts = await ctx.step(`${shapes.length} contracts with the vendor`, async () => {
      ctx.expect.status(
        await viewer.post(`${A}/contracts`, { title: 'x', kind: 'other' }),
        403,
        'a viewer may not add contracts',
      );
      ctx.expect.status(
        await cm.post(`${A}/contracts`, {
          title: 'backwards',
          kind: 'other',
          startDate: today,
          endDate: addDays(today, -1),
        }),
        400,
        'an end before the start is refused',
      );
      const out: Json[] = [];
      for (const [i, shape] of shapes.entries()) {
        const dates =
          shape === 'expiring'
            ? {
                startDate: addDays(today, -ctx.rand.int(100, 700)),
                endDate: addDays(today, ctx.rand.int(5, 50)),
              }
            : shape === 'expired'
              ? {
                  startDate: addDays(today, -ctx.rand.int(400, 900)),
                  endDate: addDays(today, -ctx.rand.int(1, 60)),
                }
              : {
                  startDate: addDays(today, -ctx.rand.int(1, 300)),
                  endDate: addDays(today, ctx.rand.int(120, 900)),
                };
        const c = ctx.expect.status(
          await cm.post(`${A}/contracts`, {
            title: `Sim contract ${sfx} ${i}`,
            kind: ctx.rand.pick(kinds),
            vendorId: vendor.id,
            cost: ctx.rand.int(10_000, 900_000),
            billing: ctx.rand.pick(['monthly', 'quarterly', 'annual', 'one_time']),
            ownerId: ctx.user('contractmgr').id,
            ...(shape === 'draft' ? { draft: true } : {}),
            ...dates,
          }),
          201,
        ).body;
        ctx.expect.match(c.reference, /^CTR-\d+$/, 'reference');
        ctx.expect.equal(c.status, shape, 'status follows the dates');
        out.push(c);
      }
      return out;
    });

    const live = contracts.filter((c) => ['active', 'expiring'].includes(c.status));
    await ctx.step('drafts are activated, one is renewed, one covers the assets', async () => {
      for (const c of contracts.filter((x) => x.status === 'draft')) {
        const res = ctx.expect.ok(await cm.patch(`${A}/contracts/${c.reference}`, { activate: true })).body;
        ctx.expect.truthy(['active', 'expiring'].includes(res.status), `activated (${res.status})`);
        c.status = res.status;
        live.push(c);
      }
      const expiring = contracts.find((c) => c.status === 'expiring');
      if (expiring) {
        const list = ctx.expect.ok(await viewer.get(`${A}/contracts`, { query: { renewal: '90d', q: sfx } }))
          .body.items as Json[];
        ctx.expect.find(list, (c) => c.id === expiring.id, 'the renewal view lists the expiring one');
      }
      if (live.length) {
        const c = live[0]!;
        ctx.expect.status(
          await cm.post(`${A}/contracts/${c.reference}/renew`, { endDate: addDays(c.endDate, -1) }),
          400,
          'renewing to before the end is refused',
        );
        const renewed = ctx.expect.ok(
          await cm.post(`${A}/contracts/${c.reference}/renew`, {
            endDate: addDays(c.endDate, 365),
            note: ctx.rand.sentence(2, 5),
          }),
        ).body;
        ctx.expect.equal(
          [renewed.startDate, renewed.endDate, renewed.status],
          [addDays(c.endDate, 1), addDays(c.endDate, 365), 'active'],
          'the renewed term',
        );
        if (assets.length || licences.length) {
          const covered = ctx.expect.ok(
            await cm.put(`${A}/contracts/${c.reference}/items`, {
              assetIds: assets.map((a) => a.id),
              licenseIds: licences.map((l) => l.id),
            }),
          ).body;
          ctx.expect.equal(covered.items.length, assets.length + licences.length, 'covered items');
          if (assets.length) {
            const of = ctx.expect.ok(await viewer.get(`${A}/assets/${assets[0]!.tag}/contracts`)).body
              .items as Json[];
            ctx.expect.equal(
              of.map((x) => x.id),
              [c.id],
              'the asset’s contracts',
            );
          }
        }
        const history = ctx.expect.ok(await viewer.get(`${A}/contracts/${c.reference}/history`)).body
          .items as Json[];
        ctx.expect.truthy(
          history.some((h) => h.action === 'itam.contract.renewed') &&
            history.some((h) => h.action === 'itam.contract.created'),
          'the history shows the renewal and the creation',
        );
      }
      if (live.length > 1 && ctx.rand.bool(0.6)) {
        const c = live[live.length - 1]!;
        const cancelled = ctx.expect.ok(
          await cm.post(`${A}/contracts/${c.reference}/cancel`, { note: 'Replaced' }),
        ).body;
        ctx.expect.equal(cancelled.status, 'cancelled', 'cancelled');
        ctx.expect.code(
          await cm.post(`${A}/contracts/${c.reference}/renew`, { endDate: addDays(today, 900) }),
          'INVALID_STATE',
          409,
        );
        ctx.tag('cancelled one');
      }
    });

    await ctx.step('the vendor and model pages count what the lists show', async () => {
      const total = async (path: string, query: Record<string, string>) =>
        ctx.expect.ok(await viewer.get(path, { query: { ...query, pageSize: 1 } })).body.total as number;
      const listed = {
        assets: await total(`${A}/assets`, { vendor: vendor.id }),
        licenses: await total(`${A}/licenses`, { vendor: vendor.id }),
        contracts: await total(`${A}/contracts`, { vendor: vendor.id, view: 'all' }),
      };
      ctx.expect.equal(
        listed,
        { assets: nAssets, licenses: nLicences, contracts: contracts.length },
        'the lists filtered by the vendor',
      );
      const detail = ctx.expect.ok(await viewer.get(`${A}/vendors/${vendor.id}`)).body;
      ctx.expect.equal(
        [detail.contracts.length, detail.licenses.length],
        [contracts.length, nLicences],
        'the vendor page’s contract and licence lists',
      );
      const row = ctx.expect.find(
        ctx.expect.ok(await viewer.get(`${A}/vendors`, { query: { q: sfx } })).body.items as Json[],
        (v) => v.id === vendor.id,
        'the vendor list shows it',
      );
      const modelRow = ctx.expect.find(
        ctx.expect.ok(await viewer.get(`${A}/models`, { query: { q: sfx } })).body.items as Json[],
        (m) => m.id === model.id,
        'the model list shows it',
      );
      ctx.expect.equal(
        {
          vendorList: row.counts,
          vendorPage: detail.counts,
          modelAssets: modelRow.assetCount,
          modelList: await total(`${A}/assets`, { model: model.id }),
        },
        { vendorList: listed, vendorPage: listed, modelAssets: nAssets, modelList: nAssets },
        'counts on the vendor list, the vendor page and the model list',
      );
    });
  },
});

/* ───────────────────────────── itam-discovery ───────────────────────────── */

interface Install {
  product: string;
  reportedAs: string | null;
  approval?: string;
  licensed?: boolean;
}

/**
 * Each device counts once for a licence: its usage and its licence page's Installations tab (one row per device and
 * product) list exactly these devices, however many titles each one reports.
 */
async function expectCountedOncePerDevice(ctx: FlowContext, am: ApiClient, lic: Json, devices: Json[]) {
  const l = ctx.expect.ok(await am.get(`/itam/licenses/${lic.reference}`)).body;
  ctx.expect.equal(l.unlicensed, devices.length, 'the licence counts each device once');
  const listed = ctx.expect.ok(
    await am.get(`/itam/licenses/${lic.reference}/installations`, { query: { pageSize: 100 } }),
  ).body;
  ctx.expect.equal(listed.total, devices.length, 'the licence lists each device once');
  ctx.expect.equal(
    (listed.items as Json[]).map((i) => i.asset?.id).sort(),
    devices.map((d) => d.id).sort(),
    'the devices the licence lists',
  );
}

export const itamDiscovery = defineFlow({
  name: 'itam-discovery',
  area: 'itam',
  description:
    'API report + CSV import → unmatched titles → approved-software list → map a title to a licence → unmap',
  personas: ['assetmgr', 'assetviewer', 'employee', 'admin'],
  timeoutMs: 200_000,
  async run(ctx) {
    const am = ctx.as('assetmgr');
    const sfx = ctx.rand.suffix();
    const depts = await departmentIds(ctx);
    const biz = ctx.expect.truthy(depts.get('SIM-BIZ'), 'the SIM-BIZ department');
    const it = ctx.expect.truthy(depts.get('SIM-IS'), 'the SIM-IS department');
    const T = `SimTool ${sfx}`; // a title no licence matches
    const P = `Sim Office ${sfx}`; // the licence's product
    const F = `SimFree ${sfx}`; // free software, for the approved-software list
    const B = `SimTorrent ${sfx}`; // to be blocked
    const both = ctx.rand.bool(0.5); // device 1 reports the title and the licence's product
    const reverse = ctx.rand.bool(0.3); // device 4 reports both while the rule maps the title
    if (both) ctx.tag('title and product on one device');
    if (reverse) ctx.tag('both reported after mapping');

    const softwareOf = async (tag: string): Promise<Install[]> =>
      ctx.expect.ok(await am.get(`${A}/assets/${tag}/software`)).body.installations as Install[];
    const products = (list: Install[]) => list.map((i) => i.product).sort();

    const [d1, d2, d3, d4] = await ctx.step('the asset manager registers the devices', async () =>
      Promise.all([
        registerAsset(ctx, 'd1', { assignee: 'employee' }),
        registerAsset(ctx, 'd2', { extra: { departmentId: biz } }),
        registerAsset(ctx, 'd3', { category: 'desktop', extra: { departmentId: it } }),
        registerAsset(ctx, 'd4', { extra: { departmentId: biz } }),
      ]),
    );
    const lic = await ctx.step(
      'a per-user licence for the product',
      async () =>
        ctx.expect.status(
          await am.post(`${A}/licenses`, { product: P, licenseType: 'per_user', quantity: 5 }),
          201,
        ).body as Json,
    );

    await ctx.step('an inventory agent reports device 1', async () => {
      const body = {
        assetSerial: String(d1!.serialNumber).toLowerCase(),
        source: 'api',
        products: [
          { product: T, version: `${ctx.rand.int(1, 9)}.${ctx.rand.int(0, 9)}` },
          ...(both ? [{ product: P, publisher: 'Sim Software' }] : []),
        ],
      };
      let res;
      if (ctx.rand.bool(0.15)) {
        ctx.tag('double report');
        const twice = await Promise.all([1, 2].map(() => am.post(`${A}/discovery/software`, body)));
        for (const r of twice) ctx.expect.ok(r, 'a report');
        res = twice[0]!;
      } else res = ctx.expect.ok(await am.post(`${A}/discovery/software`, body));
      ctx.expect.equal(res.body.unlicensed.includes(P), both, 'the product without a seat is unlicensed');
      ctx.expect.equal(products(await softwareOf(d1!.tag)), both ? [P, T].sort() : [T], 'device 1 installs');
      ctx.expect.status(
        await ctx.as('employee').post(`${A}/discovery/software`, { assetId: d1!.id, products: [] }),
        403,
        'an employee may not report',
      );
      ctx.expect.status(
        await am.post(`${A}/discovery/software`, { assetSerial: `NOPE-${sfx}`, products: [] }),
        404,
        'an unknown device',
      );
    });

    await ctx.step('a CSV export of the inventory tool is imported', async () => {
      const res = ctx.expect.ok(
        await am.post(`${A}/discovery/import`, {
          fileName: `sim-${sfx}.csv`,
          devices: [
            { assetTag: d2!.tag, products: [{ product: T }, { product: F }] },
            {
              assetSerial: String(d3!.serialNumber).toLowerCase(),
              products: [{ product: T }, { product: F }, { product: B }],
            },
            { assetSerial: `NOT-REGISTERED-${sfx}`, products: [{ product: F }] },
          ],
        }),
      ).body;
      ctx.expect.equal(
        (res.results as Json[]).map((r) => [r.status, r.added, r.asset?.id ?? null]),
        [
          ['imported', 2, d2!.id],
          ['imported', 3, d3!.id],
          ['not_found', 0, null],
        ],
        'import results',
      );
      const reports = ctx.expect.ok(
        await am.get(`${A}/discovery/reports`, { query: { source: 'import', q: `sim-${sfx}` } }),
      ).body.items as Json[];
      ctx.expect.equal(
        reports.map((r) => [r.asset?.id, r.fileName, r.added]).sort(),
        [
          [d2!.id, `sim-${sfx}.csv`, 2],
          [d3!.id, `sim-${sfx}.csv`, 3],
        ].sort(),
        'the import reports',
      );
      const viewer = ctx.as('assetviewer');
      ctx.expect.status(await viewer.get(`${A}/discovery/titles`), 403, 'a viewer may not review titles');
      ctx.expect.status(
        await viewer.post(`${A}/discovery/import`, { devices: [{ assetSerial: 'x', products: [] }] }),
        403,
        'a viewer may not import',
      );
    });

    const titles = async () =>
      new Map(
        (
          ctx.expect.ok(await am.get(`${A}/discovery/titles`, { query: { q: sfx, pageSize: 50 } })).body
            .items as Json[]
        ).map((t) => [t.title as string, t.devices as number]),
      );

    await ctx.step('titles that match no licence wait for review', async () => {
      ctx.expect.equal(
        Object.fromEntries(await titles()),
        { [T]: 3, [F]: 2, [B]: 1 },
        'unmatched titles and their devices',
      );
    });

    await ctx.step('the approved-software list decides what is allowed', async () => {
      const approval = async (tag: string, product: string) =>
        (await softwareOf(tag)).find((i) => i.product === product)?.approval;
      ctx.expect.equal(
        [await approval(d2!.tag, F), await approval(d3!.tag, F)],
        ['unapproved', 'unapproved'],
        'not on the list yet',
      );
      const departmental = ctx.rand.bool(0.5);
      ctx.expect.status(
        await am.post(`${A}/approved-software`, { title: F, licenseModel: 'free', scope: 'departments' }),
        400,
        'a departmental entry needs its departments',
      );
      const allowed = ctx.expect.status(
        await am.post(`${A}/approved-software`, {
          title: F,
          licenseModel: 'free',
          ...(departmental ? { scope: 'departments', departmentIds: [biz] } : {}),
        }),
        201,
      ).body;
      if (!departmental)
        ctx.expect.code(
          await am.post(`${A}/approved-software`, { title: F.toUpperCase(), licenseModel: 'free' }),
          'CONFLICT',
          409,
        );
      const blocked = ctx.expect.status(
        await am.post(`${A}/approved-software`, { title: B, licenseModel: 'free', status: 'blocked' }),
        201,
      ).body;
      ctx.expect.equal(
        [await approval(d2!.tag, F), await approval(d3!.tag, F), await approval(d3!.tag, B)],
        ['allowed', departmental ? 'unapproved' : 'allowed', 'blocked'],
        `allowed ${departmental ? 'for SIM-BIZ' : 'company-wide'}, blocked`,
      );
      const flagged = ctx.expect.ok(
        await am.get(`${A}/discovery/compliance`, { query: { approval: 'blocked', q: sfx, pageSize: 50 } }),
      ).body.items as Json[];
      ctx.expect.equal(
        flagged.map((i) => [i.asset?.id, i.product]),
        [[d3!.id, B]],
        'the blocked install on the compliance list',
      );
      ctx.expect.status(
        await ctx.as('assetviewer').post(`${A}/approved-software`, { title: 'x', licenseModel: 'free' }),
        403,
        'a viewer may not change the list',
      );
      for (const e of [allowed, blocked])
        ctx.expect.status(await am.delete(`${A}/approved-software/${e.id}`), 204, 'entry removed');
      ctx.expect.equal(await approval(d2!.tag, F), 'unapproved', 'unapproved again');
      ctx.tag(departmental ? 'departmental approval' : 'company approval');
    });

    const rule = await ctx.step('the title is mapped to the licence', async () => {
      ctx.expect.status(
        await ctx.as('assetviewer').post(`${A}/discovery/rules`, { title: T, licenseId: lic.id }),
        403,
        'a viewer may not map titles',
      );
      const r = ctx.expect.status(
        await am.post(`${A}/discovery/rules`, { title: T, licenseId: lic.id }),
        201,
      ).body;
      ctx.expect.equal(r.license?.id, lic.id, 'the rule’s licence');
      ctx.expect.code(
        await am.post(`${A}/discovery/rules`, { title: T.toUpperCase(), licenseId: null }),
        'CONFLICT',
        409,
      );
      ctx.expect.code(
        await am.post(`${A}/discovery/rules`, { title: P.toLowerCase(), licenseId: null }),
        'INVALID_STATE',
        409,
      );
      ctx.expect.equal((await titles()).has(T), false, 'the mapped title leaves the review list');
      // A device keeps one install per title it reports: the title (now the licence's product) and, when it also
      // reports the product, the product itself. Compliance and usage still count the device once.
      for (const d of [d1!, d2!, d3!])
        ctx.expect.equal(
          (await softwareOf(d.tag)).filter((i) => i.product === P).length,
          d === d1 && both ? 2 : 1,
          `${d.tag} keeps one install per reported title of the licence's product`,
        );
      await expectCountedOncePerDevice(ctx, am, lic, [d1!, d2!, d3!]);
      return r as Json;
    });

    if (reverse)
      await ctx.step('device 4 reports the title and the product while mapped', async () => {
        ctx.expect.ok(
          await am.post(`${A}/discovery/software`, {
            assetId: d4!.id,
            products: [{ product: T }, { product: P }],
          }),
        );
        const rows = (await softwareOf(d4!.tag)).filter((i) => i.product === P);
        ctx.expect.equal(
          rows.map((i) => i.reportedAs ?? i.product).sort(),
          [P, T].sort(),
          'device 4 keeps both installs: the product and the title it reports',
        );
        await expectCountedOncePerDevice(ctx, am, lic, [d1!, d2!, d3!, d4!]);
      });

    const expected: Record<string, string[]> = {
      [d1!.tag]: both ? [P, T].sort() : [T],
      [d2!.tag]: [F, T].sort(),
      [d3!.tag]: [B, F, T].sort(),
      ...(reverse ? { [d4!.tag]: [P, T].sort() } : {}),
    };
    const lost = await ctx.step('the mapping is removed', async () => {
      ctx.expect.status(await am.delete(`${A}/discovery/rules/${rule.id}`), 204, 'rule removed');
      const seen: Record<string, string[]> = {};
      for (const tag of Object.keys(expected)) seen[tag] = products(await softwareOf(tag));
      const missing = Object.entries(expected).flatMap(([tag, want]) =>
        want
          .filter((p) => !seen[tag]!.includes(p))
          .map((p) => `${tag}: ${p === T ? 'the title' : 'the product'}`),
      );
      for (const d of [d2!, d3!])
        ctx.expect.truthy(
          (await softwareOf(d.tag)).some((i) => i.product === T && i.reportedAs === null),
          `${d.tag} shows the reported title again`,
        );
      return { missing, titleDevices: (await titles()).get(T) ?? 0, seen };
    });

    if (!lost.missing.length) return;
    await ctx.step('the next reports bring the lost installs back', async () => {
      for (const [tag, want] of Object.entries(expected)) {
        if (want.every((p) => lost.seen[tag]!.includes(p))) continue;
        const res = ctx.expect.ok(
          await am.post(`${A}/discovery/software`, {
            assetTag: tag,
            products: want.map((p) => ({ product: p })),
          }),
        ).body;
        ctx.expect.equal(
          products(await softwareOf(tag)),
          want,
          `${tag} after its next report (added ${res.added})`,
        );
      }
      ctx.fail(
        `removing the title rule lost ${lost.missing.length} install(s) until the device's next report: ${lost.missing.join(', ')}`,
        { titleDevicesAfterUnmap: lost.titleDevices, expectedTitleDevices: 3 + (reverse ? 1 : 0) },
      );
    });
  },
});
