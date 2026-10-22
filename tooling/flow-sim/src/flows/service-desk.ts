/**
 * Service desk flows: incidents worked against their SLA timers (attachments, triage, CIs), service requests from the
 * catalog, problems and their known-error articles, changes (normal through the CAB, standard, emergency), the
 * knowledge base, the CMDB, Ask IS (helpdesk-ai in builtin mode) and announcements.
 */
import type { ApiClient, ApiResponse, Json } from '../client';
import { defineFlow, type FlowContext } from '../flow';

const T = '/itsm/tickets';
export const EMPLOYEES = ['employee1', 'employee2', 'employee3', 'employee4'] as const;
const AGENTS = ['agent1', 'agent2', 'agent3'] as const;
const RESOLUTIONS = ['solved', 'workaround', 'user_error', 'no_fault_found', 'not_reproducible'] as const;
const LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;
const MINUTE = 60_000;
const DAY = 86_400_000;
/** A 1×1 PNG: the "screenshot" a requester attaches. */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

export const itemsOf = (res: ApiResponse): Json[] => (res.body?.items ?? []) as Json[];

/** ITIL impact × urgency → priority (the contracts' `priorityFor`). */
const priorityFor = (impact: number, urgency: number) =>
  [
    [1, 2, 3],
    [2, 3, 4],
    [3, 4, 4],
  ][impact - 1]![urgency - 1]!;

/** A pool member other than the run's own: someone who must not see the run's records. */
export function outsiderOf(ctx: FlowContext, pool: string, members: readonly string[]): string {
  const mine = ctx.personaOf(ctx.user(pool).id);
  return ctx.rand.pick(members.filter((m) => m !== mine));
}

/** Refused without a 5xx: 403 or 404 (whichever the route uses to hide the record). */
export function refused(
  ctx: FlowContext,
  res: ApiResponse,
  what: string,
  statuses: readonly number[] = [403, 404],
) {
  ctx.expect.status(res, statuses, `${what}: expected ${statuses.join('/')}, got ${res.status}`);
}

export const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();

/** How many audit entries `action` has for `entityId` (the auditor reads the trail): side effects that happen once. */
export async function auditCount(ctx: FlowContext, action: string, entityId: string): Promise<number> {
  const res = ctx.expect.ok(
    await ctx.as('auditor').get('/audit-logs', { query: { action, entityId, pageSize: 50 } }),
    'the auditor reads the audit trail',
  );
  return res.body.total as number;
}

/* ───────────────────────────── SLA checks ───────────────────────────── */

interface SlaSetup {
  policies: Json[];
  alwaysOpen: Set<string>;
}

async function slaSetup(ctx: FlowContext): Promise<SlaSetup> {
  const admin = ctx.as('admin');
  const policies = itemsOf(ctx.expect.ok(await admin.get('/itsm/sla-policies'), 'the SLA policies'));
  const calendars = itemsOf(ctx.expect.ok(await admin.get('/itsm/calendars'), 'the business calendars'));
  return { policies, alwaysOpen: new Set(calendars.filter((c) => c.alwaysOpen).map((c) => c.id as string)) };
}

/** The policy a new ticket gets (null: none; undefined: a condition this flow doesn't evaluate). */
function policyFor(setup: SlaSetup, type: string, priority: number): Json | null | undefined {
  for (const p of setup.policies) {
    if (!p.active || !(p.ticketTypes as string[]).includes(type)) continue;
    const c = p.condition;
    if (!c) return p;
    if (c.fact === 'ticket.priority' && c.op === 'eq') {
      if (c.value === priority) return p;
      continue;
    }
    return undefined;
  }
  return null;
}

const slaOf = (t: Json, metric: string): Json | undefined =>
  (t.slas as Json[]).find((s) => s.metric === metric);

/** The timers of a ticket just raised (as an agent sees it): the right policy, targets and deadlines. */
function expectFreshSlas(ctx: FlowContext, t: Json, setup: SlaSetup, priority: number): Json | null {
  const policy = policyFor(setup, t.type, priority);
  if (policy === undefined) return null;
  if (policy === null) {
    ctx.expect.equal(t.slas, [], 'no SLA policy applies, so no timers');
    return null;
  }
  const target = policy.targets[String(priority)] as Json;
  const metrics = ['response', 'resolution'].filter((m) => target?.[`${m}Minutes`]);
  // A policy's name is LocalizedText in the policy list; a ticket's timer names it in plain English (`name`) and
  // in every language (`label`).
  const policyName = policy.name as Record<string, string>;
  ctx.expect.equal(
    (t.slas as Json[]).map((s) => s.metric).sort(),
    [...metrics].sort(),
    `the SLA timers of "${policyName.en}"`,
  );
  for (const m of metrics) {
    const s = slaOf(t, m)!;
    const minutes = target[`${m}Minutes`] as number;
    const start = Date.parse(s.startedAt);
    const due = Date.parse(s.dueAt);
    ctx.expect.equal(s.policy?.id, policy.id, `the ${m} timer's policy`);
    ctx.expect.equal(s.policy?.name, policyName.en, `the ${m} timer's policy, in English`);
    ctx.expect.equal(s.policy?.label, policyName, `the ${m} timer's policy, in every language`);
    ctx.expect.truthy(['running', 'paused'].includes(s.status), `the ${m} timer runs (${s.status})`);
    ctx.expect.equal(s.stoppedAt, null, `the ${m} timer has not stopped`);
    ctx.expect.truthy(
      Math.abs(start - Date.parse(t.createdAt)) < 5_000,
      `the ${m} timer starts when the ticket is raised (${s.startedAt} vs ${t.createdAt})`,
    );
    ctx.expect.truthy(
      due - start >= minutes * MINUTE - 2_000,
      `the ${m} deadline is at least ${minutes} min after the start (${s.startedAt} → ${s.dueAt})`,
    );
    if (setup.alwaysOpen.has(policy.calendarId))
      ctx.expect.truthy(
        Math.abs(due - start - minutes * MINUTE) < 2_000,
        `on a 24×7 calendar the ${m} deadline is exactly ${minutes} min later`,
      );
    ctx.expect.truthy(
      typeof s.elapsedRatio === 'number' && s.elapsedRatio >= 0 && s.elapsedRatio < 1,
      `a fresh ${m} timer is not elapsed (${s.elapsedRatio})`,
    );
  }
  const response = slaOf(t, 'response');
  const resolution = slaOf(t, 'resolution');
  if (response && resolution)
    ctx.expect.truthy(
      Date.parse(response.dueAt) <= Date.parse(resolution.dueAt),
      'the response is due before the resolution',
    );
  ctx.expect.truthy(t.sla, 'the list badge shows the most urgent timer');
  return policy;
}

/* ───────────────────────────── shared ITSM steps ───────────────────────────── */

/**
 * Resolves (or fulfils) a ticket as `client`: when a resolution sign-off is bound, the sign-off is approved by
 * whoever it asks (never the resolver) and the ticket ends up solved. Optionally sent twice at once.
 */
async function solve(
  ctx: FlowContext,
  client: ApiClient,
  ref: string,
  body: Json,
  opts: { twice?: boolean; resolver: string },
): Promise<Json> {
  let res: Json;
  if (opts.twice) {
    ctx.tag('double resolve');
    const both = await Promise.all([1, 2].map(() => client.post(`${T}/${ref}/transition`, body)));
    res = ctx.expect.oneOk(both, 'one resolution goes through', [409]).body;
  } else res = ctx.expect.ok(await client.post(`${T}/${ref}/transition`, body)).body;
  if (res.status === 'pending_approval' && res.signOff?.instanceId) {
    ctx.tag('sign-off');
    const { status } = await ctx.approvals.approveAll(res.signOff.instanceId, { avoid: [opts.resolver] });
    ctx.expect.equal(status, 'approved', 'the sign-off');
    const done = await ctx.eventually(
      () => client.get(`${T}/${ref}`),
      (r) => r.body?.status === body.status,
      { label: 'the signed-off resolution' },
    );
    return done.body;
  }
  ctx.expect.equal(res.status, body.status, 'status');
  return res;
}

/** Notifications of `type` that mention `needle`, as `client` sees them (newest first). */
export async function notificationsAbout(client: ApiClient, type: string, needle: string): Promise<Json[]> {
  const res = await client.get('/me/notifications', { query: { pageSize: 100 } });
  return ((res.body?.items ?? []) as Json[]).filter(
    (n) => n.type === type && JSON.stringify(n).includes(needle),
  );
}

/* ───────────────────────────── incident-desk ───────────────────────────── */

export const incidentDesk = defineFlow({
  name: 'incident-desk',
  area: 'itsm',
  description:
    'Incident with attachments → agent triages (priority, category, CI) against its SLA timers, holds it, resolves or cancels → confirmed or reopened',
  personas: ['employee', 'agent', 'admin', 'itlead'],
  async run(ctx) {
    const requester = ctx.as('employee');
    const me = ctx.user('employee');
    const agent = ctx.as('agent');
    const agentName = ctx.personaOf(ctx.user('agent').id)!;
    const stranger = ctx.as(outsiderOf(ctx, 'employee', EMPLOYEES));
    const sfx = ctx.rand.suffix();
    const setup = await ctx.step('the SLA policies', () => slaSetup(ctx));
    const urgency = ctx.rand.int(1, 3);

    const ticket = await ctx.step('the employee raises an incident', async () => {
      // Requesters may set the urgency only: agent fields they send are ignored.
      const extra = ctx.rand.bool(0.3) ? { impact: 1, major: true } : {};
      const t = ctx.expect.status(
        await requester.post(T, {
          type: 'incident',
          title: `${ctx.rand.words(2, 6)} ${sfx}`,
          description: ctx.rand.paragraph(1, 3),
          urgency,
          ...extra,
        }),
        201,
      ).body;
      ctx.expect.equal(
        [t.type, t.status, t.channel, t.viewer?.role, t.requester?.id],
        ['incident', 'new', 'portal', 'requester', me.id],
        'type, status, channel, viewer, requester',
      );
      ctx.expect.equal(
        [t.impact, t.urgency, t.priority, t.major],
        [2, urgency, priorityFor(2, urgency), false],
        'impact, urgency, priority, major',
      );
      ctx.expect.equal([t.slas, t.sla], [[], null], 'requesters see no SLA timers');
      return t as Json;
    });
    const ref = ticket.reference as string;
    const files = `/records/itsm.ticket/${ticket.id}/files`;

    const attachment = await ctx.step('the employee attaches a screenshot or a log', async () => {
      const png = ctx.rand.bool(0.4);
      const content = `${new Date().toISOString()} ERROR ${ctx.rand.words(3, 8)}\nref ${sfx}\n`;
      const file = png
        ? { name: `screenshot-${sfx}.png`, contentType: 'image/png', data: PNG }
        : { name: `client-${sfx}.log`, contentType: 'text/plain', data: content };
      const up = ctx.expect.status(await requester.upload(files, file), 201, 'the upload').body;
      ctx.expect.equal(
        [up.name, up.size, up.previewable, up.record?.id],
        [file.name, png ? PNG.length : Buffer.byteLength(content), png, ticket.id],
        'name, size, previewable, record',
      );
      const list = ctx.expect.ok(await requester.get(files)).body;
      ctx.expect.equal(list.record?.editable, true, 'the requester may attach to their open ticket');
      ctx.expect.find(list.files as Json[], (f) => f.id === up.id, 'the attachment is listed');
      if (ctx.rand.bool(0.15)) {
        ctx.tag('blocked upload');
        const html = await requester.upload(files, {
          name: `page-${sfx}.html`,
          contentType: 'text/html',
          data: '<!doctype html><html><body><script>alert(1)</script></body></html>',
        });
        ctx.expect.code(html, 'FILE_REJECTED', 422);
      }
      return { ...up, content: png ? null : content } as Json;
    });

    await ctx.step('another employee sees nothing of it', async () => {
      refused(ctx, await stranger.get(`${T}/${ref}`), 'reading the ticket', [404]);
      const theirs = ctx.expect.ok(await stranger.get(T, { query: { q: sfx } })).body.items as Json[];
      ctx.expect.equal(theirs.filter((x) => x.id === ticket.id).length, 0, 'their ticket list');
      refused(ctx, await stranger.get(files), 'listing its files', [404]);
      refused(ctx, await stranger.get(`/files/${attachment.id}`), 'downloading the attachment', [404]);
      refused(ctx, await stranger.post(`${T}/${ref}/comments`, { body: 'me too' }), 'commenting');
      refused(
        ctx,
        await stranger.upload(files, { name: 'x.txt', contentType: 'text/plain', data: 'x' }),
        'attaching',
      );
    });

    await ctx.step('the requester cannot work their own ticket', async () => {
      refused(
        ctx,
        await requester.post(`${T}/${ref}/transition`, { status: 'in_progress' }),
        'a transition',
        [403],
      );
      refused(
        ctx,
        await requester.post(`${T}/${ref}/comments`, { body: 'x', public: false }),
        'a work note',
        [403],
      );
      refused(ctx, await requester.patch(`${T}/${ref}`, { impact: 1 }), 'a classification', [403]);
    });

    const policy = await ctx.step('the agent sees it with sane SLA timers', async () => {
      const t = ctx.expect.ok(await agent.get(`${T}/${ref}`)).body;
      ctx.expect.equal([t.viewer?.role, t.viewer?.canEdit], ['agent', true], 'the agent may work it');
      return expectFreshSlas(ctx, t, setup, t.priority);
    });

    await ctx.step('the agent takes it', async () => {
      const queue = ctx.expect.ok(await agent.get(T, { query: { view: 'unassigned', q: sfx } })).body.items;
      ctx.expect.find(queue as Json[], (x) => x.reference === ref, 'the unassigned queue lists it');
      if (ctx.rand.bool(0.15)) {
        ctx.tag('double take');
        const both = await Promise.all([1, 2].map(() => agent.post(`${T}/${ref}/assign-to-me`)));
        for (const r of both) ctx.expect.ok(r, 'taking it (double click)');
      }
      const t = ctx.expect.ok(await agent.post(`${T}/${ref}/assign-to-me`)).body;
      ctx.expect.equal(t.assignee?.id, ctx.user('agent').id, 'assignee');
    });

    const ci = await ctx.step('the agent triages it (category, impact, priority, CI)', async () => {
      const before = ctx.expect.ok(await agent.get(`${T}/${ref}`)).body;
      const cats = itemsOf(ctx.expect.ok(await agent.get('/itsm/categories'))).filter(
        (c) => c.active !== false && (c.ticketTypes as string[]).includes('incident'),
      );
      const category = ctx.rand.pick(cats);
      const impact = ctx.rand.int(1, 3);
      const override = ctx.rand.bool(0.25) ? ctx.rand.int(1, 4) : undefined;
      let ciRow: Json = null;
      if (ctx.rand.bool(0.6)) {
        const view = ctx.rand.pick(['services', 'applications', 'infrastructure']);
        const cis = itemsOf(
          ctx.expect.ok(await agent.get('/cmdb/cis', { query: { view, status: 'in_use', pageSize: 50 } })),
        );
        if (cis.length) ciRow = ctx.rand.pick(cis);
      }
      const body = {
        categoryId: category.id,
        impact,
        ...(override ? { priority: override } : {}),
        ...(ciRow ? { ciIds: [ciRow.id] } : {}),
      };
      let t: Json;
      if (ctx.rand.bool(0.2)) {
        // Two agents classify at the same moment: one sets the impact, the other the urgency.
        ctx.tag('two agents classify at once');
        const other = ctx.as(ctx.rand.pick(AGENTS.filter((a) => a !== agentName)));
        const urgency2 = ctx.rand.int(1, 3);
        const both = await Promise.all([
          agent.patch(`${T}/${ref}`, { impact }),
          other.patch(`${T}/${ref}`, { urgency: urgency2 }),
        ]);
        for (const r of both) ctx.expect.ok(r, 'a concurrent classification');
        const now = ctx.expect.ok(await agent.get(`${T}/${ref}`)).body;
        ctx.expect.equal(
          [now.impact, now.urgency, now.priority],
          [impact, urgency2, priorityFor(impact, urgency2)],
          'both changes kept and the priority follows impact × urgency',
        );
        t = ctx.expect.ok(await agent.patch(`${T}/${ref}`, body)).body;
      } else t = ctx.expect.ok(await agent.patch(`${T}/${ref}`, body)).body;
      ctx.expect.equal(t.category?.id, category.id, 'category');
      ctx.expect.equal(t.impact, impact, 'impact');
      ctx.expect.equal(t.priority, override ?? priorityFor(impact, t.urgency), 'priority');
      if (ciRow) ctx.expect.find(t.cis as Json[], (c) => c.id === ciRow.id, 'the CI is linked');
      // Timers move to the policy's target for the new priority (business time: never the other way).
      if (policy && t.priority !== before.priority) {
        const oldRes = slaOf(before, 'resolution');
        const newRes = slaOf(t, 'resolution');
        const target = (p: number) => policy.targets[String(p)]?.resolutionMinutes as number;
        if (oldRes && newRes && newRes.status === 'running') {
          const diff = Date.parse(newRes.dueAt) - Date.parse(oldRes.dueAt);
          const want = Math.sign(target(t.priority) - target(before.priority));
          ctx.expect.truthy(
            want === 0 ? Math.abs(diff) < 2_000 : Math.sign(diff) === want || Math.abs(diff) < 2_000,
            `P${before.priority} → P${t.priority} moves the resolution deadline the right way (${oldRes.dueAt} → ${newRes.dueAt})`,
          );
        }
      }
      const acts = itemsOf(
        ctx.expect.ok(await agent.get(`${T}/${ref}/activities`, { query: { pageSize: 100 } })),
      );
      ctx.expect.find(acts, (a) => a.kind === 'field', 'the timeline records the triage');
      return ciRow;
    });

    if (ci)
      await ctx.step('the CI shows the ticket, the requester sees the CI', async () => {
        const byCi = ctx.expect.ok(await agent.get(T, { query: { ciId: ci.id, q: sfx } })).body.items;
        ctx.expect.find(byCi as Json[], (x) => x.reference === ref, 'tickets of the CI');
        const theirs = ctx.expect.ok(await requester.get(`${T}/${ref}`)).body;
        ctx.expect.find(theirs.cis as Json[], (c) => c.id === ci.id, 'the requester sees the affected CI');
      });

    await ctx.step('the agent replies (the response target is met) and notes', async () => {
      const reply = ctx.expect.status(
        await agent.post(`${T}/${ref}/comments`, { body: `${ctx.rand.sentence()} (${sfx})` }),
        201,
      ).body;
      ctx.expect.equal([reply.kind, reply.public], ['comment', true], 'a public reply');
      if (ctx.rand.bool(0.5)) {
        const note = ctx.expect.status(
          await agent.post(`${T}/${ref}/comments`, { body: ctx.rand.sentence(), public: false }),
          201,
        ).body;
        ctx.expect.equal(note.kind, 'work_note', 'a work note');
      }
      const t = ctx.expect.ok(await agent.get(`${T}/${ref}`)).body;
      ctx.expect.truthy(t.firstResponseAt, 'the first response is recorded');
      const response = slaOf(t, 'response');
      if (response) {
        ctx.expect.equal(response.status, 'met', 'the response timer');
        ctx.expect.truthy(response.stoppedAt, 'the response timer stopped');
      }
    });

    await ctx.step('the requester sees the reply, never work notes, and is told once', async () => {
      const acts = itemsOf(
        ctx.expect.ok(await requester.get(`${T}/${ref}/activities`, { query: { pageSize: 100 } })),
      );
      ctx.expect.equal(
        acts.filter((a) => a.kind === 'work_note').length,
        0,
        'work notes shown to the requester',
      );
      ctx.expect.find(acts, (a) => a.kind === 'comment' && String(a.body).includes(sfx), 'the reply');
      const told = await ctx.eventually(
        () => notificationsAbout(requester, 'itsm.ticket.commented', ref),
        (n) => n.length >= 1,
        { label: 'the reply notification' },
      );
      ctx.expect.equal(told.length, 1, '"commented" notifications');
    });

    await ctx.step('the agent opens the attachment', async () => {
      const dl = ctx.expect.ok(await agent.get(`/files/${attachment.id}`));
      if (attachment.content) ctx.expect.equal(dl.body, attachment.content, 'the downloaded log');
      if (ctx.rand.bool(0.3)) {
        const up = ctx.expect.status(
          await agent.upload(files, {
            name: `fix-${sfx}.txt`,
            contentType: 'text/plain',
            data: `steps ${sfx}`,
          }),
          201,
        ).body;
        const seen = ctx.expect.ok(await requester.get(files)).body.files as Json[];
        ctx.expect.find(seen, (f) => f.id === up.id, "the requester sees the agent's attachment");
      }
    });

    if (ctx.rand.bool(0.3))
      await ctx.step('the agent puts it on hold and resumes', async () => {
        ctx.tag('on hold');
        const before = ctx.expect.ok(await agent.get(`${T}/${ref}`)).body;
        const held = ctx.expect.ok(await agent.post(`${T}/${ref}/transition`, { status: 'on_hold' })).body;
        ctx.expect.equal(held.status, 'on_hold', 'status');
        const res = slaOf(held, 'resolution');
        const policyRow = res && setup.policies.find((p) => p.id === res.policy?.id);
        if (res && policyRow && res.status !== 'breached')
          ctx.expect.equal(
            res.status,
            (policyRow.pauseStatuses as string[]).includes('on_hold') ? 'paused' : 'running',
            'the resolution timer on hold',
          );
        const resumed = ctx.expect.ok(
          await agent.post(`${T}/${ref}/transition`, { status: 'in_progress' }),
        ).body;
        const after = slaOf(resumed, 'resolution');
        const was = slaOf(before, 'resolution');
        if (after && was && after.status === 'running')
          ctx.expect.truthy(
            Date.parse(after.dueAt) >= Date.parse(was.dueAt) - 1_000,
            'resuming never brings the deadline forward',
          );
      });

    if (ctx.rand.bool(0.1)) {
      ctx.tag('cancelled');
      await ctx.step('the agent cancels it (the requester withdrew it)', async () => {
        ctx.expect.code(
          await agent.post(`${T}/${ref}/transition`, { status: 'cancelled' }),
          'RESOLUTION_REQUIRED',
          400,
        );
        const t = ctx.expect.ok(
          await agent.post(`${T}/${ref}/transition`, {
            status: 'cancelled',
            resolutionCode: 'cancelled_by_requester',
            resolutionNotes: ctx.rand.sentence(3, 8),
          }),
        ).body;
        ctx.expect.equal(t.status, 'cancelled', 'status');
        for (const s of t.slas as Json[])
          ctx.expect.truthy(
            ['met', 'cancelled', 'breached'].includes(s.status),
            `the ${s.metric} timer stopped (${s.status})`,
          );
        const theirs = ctx.expect.ok(await requester.get(`${T}/${ref}`)).body;
        ctx.expect.equal(
          [theirs.viewer?.canComment, theirs.viewer?.canConfirm],
          [false, false],
          'nothing left to do',
        );
        refused(
          ctx,
          await requester.upload(files, { name: 'late.txt', contentType: 'text/plain', data: 'x' }),
          'attaching to a cancelled ticket',
          [403],
        );
      });
      return;
    }

    await ctx.step('a bad resolution is refused', async () => {
      ctx.expect.code(
        await agent.post(`${T}/${ref}/transition`, { status: 'resolved' }),
        'RESOLUTION_REQUIRED',
        400,
      );
      ctx.expect.code(
        await agent.post(`${T}/${ref}/transition`, { status: 'closed' }),
        'INVALID_TRANSITION',
        409,
      );
    });

    const resolve = (round: number) =>
      ctx.step(round === 1 ? 'the agent resolves it' : 'the agent resolves it again', async () => {
        const t = await solve(
          ctx,
          agent,
          ref,
          {
            status: 'resolved',
            resolutionCode: ctx.rand.pick(RESOLUTIONS),
            resolutionNotes: ctx.rand.sentence(4, 12),
          },
          { twice: ctx.rand.bool(0.15), resolver: agentName },
        );
        const fresh = ctx.expect.ok(await agent.get(`${T}/${ref}`)).body;
        const res = slaOf(fresh, 'resolution');
        if (res)
          ctx.expect.truthy(
            ['met', 'breached'].includes(res.status),
            `the resolution timer stopped (${res.status})`,
          );
        ctx.expect.truthy(t.resolvedAt, 'resolved at');
      });
    await resolve(1);

    const next = ctx.rand.weighted([
      ['confirm', 6],
      ['reopen', 2],
      ['leave', 2],
    ] as const);
    ctx.tag(next);
    if (next === 'reopen') {
      await ctx.step('the requester reopens it (the timer picks up again)', async () => {
        ctx.expect.code(
          await requester.post(`${T}/${ref}/reopen`, { reason: 'x' }),
          'VALIDATION_FAILED',
          400,
        );
        const t = ctx.expect.ok(
          await requester.post(`${T}/${ref}/reopen`, { reason: ctx.rand.sentence(3, 8) }),
        ).body;
        ctx.expect.equal([t.status, t.resolutionCode], ['in_progress', null], 'back in progress');
        const asAgent = ctx.expect.ok(await agent.get(`${T}/${ref}`)).body;
        const res = slaOf(asAgent, 'resolution');
        if (res && res.status !== 'breached') ctx.expect.equal(res.status, 'running', 'the resolution timer');
      });
      await resolve(2);
    }
    if (next !== 'leave')
      await ctx.step('the requester confirms the fix', async () => {
        const rating = ctx.rand.int(1, 5);
        const body = { rating, ...(ctx.rand.bool() ? { comment: ctx.rand.sentence(2, 8) } : {}) };
        let t: Json;
        if (ctx.rand.bool(0.15)) {
          ctx.tag('double confirm');
          const both = await Promise.all([1, 2].map(() => requester.post(`${T}/${ref}/confirm`, body)));
          t = ctx.expect.oneOk(both, 'one confirmation goes through', [409]).body;
        } else t = ctx.expect.ok(await requester.post(`${T}/${ref}/confirm`, body)).body;
        ctx.expect.equal([t.status, t.satisfaction], ['closed', rating], 'closed with the rating');
        const rows = ctx.expect.ok(await requester.get('/me/requests', { query: { q: sfx } })).body
          .items as Json[];
        const row = ctx.expect.find(rows, (r) => r.reference === ref, 'My requests lists it');
        ctx.expect.match(row.statusKey, /\.closed$/, 'My requests shows it closed');
        refused(
          ctx,
          await requester.upload(files, { name: 'late.txt', contentType: 'text/plain', data: 'x' }),
          'attaching to a closed ticket',
          [403],
        );
        refused(
          ctx,
          await requester.post(`${T}/${ref}/comments`, { body: 'thanks' }),
          'commenting on a closed ticket',
          [403, 409],
        );
      });
  },
});

/* ───────────────────────────── service-request-catalog ───────────────────────────── */

const CATALOG = ['lost-device', 'software-request', 'equipment-request'] as const;

export const serviceRequestCatalog = defineFlow({
  name: 'service-request-catalog',
  area: 'itsm',
  description:
    'Employee requests a catalog item (approved first when it needs it) → exactly one service request → fulfilled or cancelled → confirmed',
  personas: ['employee', 'agent', 'manager', 'approver', 'admin'],
  timeoutMs: 240_000,
  async run(ctx) {
    const requester = ctx.as('employee');
    const me = ctx.user('employee');
    const meName = ctx.personaOf(me.id)!;
    const agent = ctx.as('agent');
    const agentName = ctx.personaOf(ctx.user('agent').id)!;
    const stranger = ctx.as(outsiderOf(ctx, 'employee', EMPLOYEES));
    const sfx = ctx.rand.suffix();
    const key = ctx.rand.pick(CATALOG);
    ctx.tag(key);

    const item = await ctx.step('the catalog item (as configured)', async () => {
      const cat = itemsOf(ctx.expect.ok(await ctx.as('admin').get('/itsm/catalog')));
      const it = ctx.expect.find(cat, (c) => c.formKey === key, `the catalog has ${key}`);
      ctx.expect.truthy(it.fulfilment?.active, `${key} is fulfilled by the service desk`);
      return it;
    });

    const form = await ctx.step('the employee opens the form from the catalog', async () => {
      const catalog = itemsOf(ctx.expect.ok(await requester.get('/forms/catalog')));
      ctx.expect.find(catalog, (f) => f.key === key, 'the form is in their catalog');
      return ctx.forms.published(key, 'employee');
    });

    const overrides: Record<string, unknown> =
      key === 'lost-device'
        ? { lostOn: ctx.rand.date(-14, 0), details: `${ctx.rand.sentence(4, 10)} ${sfx}` }
        : key === 'software-request'
          ? { softwareName: `Sim tool ${sfx}`, purpose: `${ctx.rand.sentence(6, 12)} ${sfx}` }
          : {
              forSomeoneElse: false,
              recipient: undefined,
              justification: `${ctx.rand.sentence(6, 12)} ${sfx}`,
            };
    const data = ctx.forms.answers(form.schema, overrides);

    const submission = await ctx.step('the employee submits it', async () => {
      const res = ctx.expect.status(
        await requester.post(`/forms/by-key/${key}/submissions`, { data }),
        201,
      ).body;
      ctx.expect.match(res.reference, /^REQ-\d{5,}$/, 'reference');
      if (item.hasApproval) ctx.expect.truthy(res.workflow?.id, 'an approval started');
      return res as Json;
    });
    const S = `/form-submissions/${submission.id}`;

    await ctx.step('another employee cannot see the request', async () => {
      refused(ctx, await stranger.get(S), 'reading the submission');
    });

    if (item.hasApproval) {
      const reject = ctx.rand.bool(0.15);
      ctx.tag(reject ? 'rejected' : 'approved');
      if (reject) {
        await ctx.step('the manager rejects it', async () => {
          const outcome = await ctx.approvals.decide(submission.workflow.id, 'manager', 'reject', {
            viaInbox: submission.reference,
          });
          ctx.expect.equal(outcome, 'rejected', 'outcome');
        });
        await ctx.step('no service request is opened', async () => {
          const done = await ctx.eventually(
            () => requester.get(S),
            (r) => r.body?.status === 'rejected',
            { label: 'the rejection' },
          );
          ctx.expect.equal(done.body.fulfilment ?? null, null, 'fulfilment of a rejected request');
          const srs = ctx.expect.ok(
            await agent.get(T, { query: { type: 'service_request', q: submission.reference } }),
          ).body.items as Json[];
          ctx.expect.equal(srs.length, 0, 'service requests for the rejected request');
        });
        return;
      }
      await ctx.step('the approvers approve', async () => {
        const { status } = await ctx.approvals.approveAll(submission.workflow.id, {
          avoid: [meName],
          prefer: ['manager', 'approver'],
        });
        ctx.expect.equal(status, 'approved', 'workflow outcome');
      });
    }

    const sr = await ctx.step('exactly one service request opens', async () => {
      const done = await ctx.eventually(
        () => requester.get(S),
        (r) => Boolean(r.body?.fulfilment?.reference),
        { label: 'the service request', timeoutMs: 45_000 },
      );
      const f = done.body.fulfilment;
      ctx.expect.equal([f.moduleId, f.state], ['itsm', 'open'], 'fulfilment');
      ctx.expect.match(f.reference, /^SR-\d+$/, 'reference');
      const t = ctx.expect.ok(await requester.get(`${T}/${f.reference}`)).body;
      ctx.expect.equal(
        [t.type, t.channel, t.requester?.id, t.source?.formKey, t.priority],
        ['service_request', 'form', me.id, key, item.fulfilment.priority],
        'type, channel, requester, form, priority',
      );
      ctx.expect.truthy((t.answers as Json[])?.length, 'the answers are on the ticket');
      const same = ctx.expect.ok(await agent.get(T, { query: { type: 'service_request', q: f.reference } }))
        .body.items as Json[];
      ctx.expect.equal(
        same.filter((x) => x.reference === f.reference).length,
        1,
        'service requests with that reference',
      );
      return t as Json;
    });
    const ref = sr.reference as string;

    await ctx.step('the agent takes it', async () => {
      refused(ctx, await stranger.get(`${T}/${ref}`), 'another employee reading it', [404]);
      const t = ctx.expect.ok(await agent.post(`${T}/${ref}/assign-to-me`)).body;
      ctx.expect.equal(t.assignee?.id, ctx.user('agent').id, 'assignee');
      ctx.expect.truthy((t.slas as Json[]).length, 'the service request has SLA timers');
      if (ctx.rand.bool(0.5))
        ctx.expect.ok(await agent.post(`${T}/${ref}/transition`, { status: 'in_progress' }));
    });

    const cancel = ctx.rand.bool(0.12);
    if (cancel) {
      ctx.tag('cancelled');
      await ctx.step('the agent cancels it', async () => {
        const t = ctx.expect.ok(
          await agent.post(`${T}/${ref}/transition`, {
            status: 'cancelled',
            resolutionCode: 'cancelled_by_requester',
            resolutionNotes: ctx.rand.sentence(3, 8),
          }),
        ).body;
        ctx.expect.equal(t.status, 'cancelled', 'status');
        const sub = ctx.expect.ok(await requester.get(S)).body;
        ctx.expect.equal(sub.fulfilment?.state, 'cancelled', 'the request shows it cancelled');
      });
      return;
    }

    await ctx.step('the agent fulfils it', async () => {
      await solve(
        ctx,
        agent,
        ref,
        {
          status: 'fulfilled',
          resolutionCode: 'solved',
          resolutionNotes: `${ctx.rand.sentence(3, 8)} ${sfx}`,
        },
        { twice: ctx.rand.bool(0.15), resolver: agentName },
      );
      const sub = ctx.expect.ok(await requester.get(S)).body;
      ctx.expect.equal(sub.fulfilment?.state, 'done', 'the request shows it done');
      ctx.expect.match(sub.fulfilment?.statusKey, /fulfilled$/, 'the fulfilment status');
    });

    if (ctx.rand.bool(0.7))
      await ctx.step('the requester confirms it', async () => {
        const t = ctx.expect.ok(
          await requester.post(`${T}/${ref}/confirm`, { rating: ctx.rand.int(1, 5) }),
        ).body;
        ctx.expect.equal(t.status, 'closed', 'status');
        const sub = ctx.expect.ok(await requester.get(S)).body;
        ctx.expect.equal(sub.fulfilment?.state, 'done', 'still done');
      });
  },
});

/* ───────────────────────────── problem-known-error ───────────────────────────── */

export const problemKnownError = defineFlow({
  name: 'problem-known-error',
  area: 'itsm',
  description:
    'Recurring incidents → problem linked to them → root cause, workaround, known error → its article reviewed and published for agents → incidents and problem resolved',
  personas: ['employee', 'agent', 'problemmgr', 'kbeditor'],
  timeoutMs: 240_000,
  async run(ctx) {
    const requester = ctx.as('employee');
    const agent = ctx.as('agent');
    const agentName = ctx.personaOf(ctx.user('agent').id)!;
    const pm = ctx.as('problemmgr');
    const editor = ctx.as('kbeditor');
    const sfx = ctx.rand.suffix();
    const topic = ctx.rand.words(2, 3);

    const incidents = await ctx.step('the employee raises recurring incidents', async () => {
      const n = ctx.rand.int(2, 4);
      const out: Json[] = [];
      for (let i = 0; i < n; i++)
        out.push(
          ctx.expect.status(
            await requester.post(T, {
              type: 'incident',
              title: `${topic} ${ctx.rand.words(1, 3)} ${sfx}`,
              description: ctx.rand.sentence(),
              urgency: ctx.rand.int(1, 3),
            }),
            201,
          ).body,
        );
      return out;
    });

    await ctx.step('people without the problem role cannot raise or manage problems', async () => {
      refused(
        ctx,
        await requester.post(T, { type: 'problem', title: `Problem ${sfx}` }),
        'an employee raising a problem',
        [403],
      );
    });

    const problem = await ctx.step('the problem manager raises a problem', async () => {
      const found = ctx.expect.ok(await pm.get(T, { query: { type: 'incident', q: sfx } })).body
        .items as Json[];
      for (const i of incidents)
        ctx.expect.find(found, (x) => x.id === i.id, `the problem manager finds ${i.reference}`);
      const p = ctx.expect.status(
        await pm.post(T, {
          type: 'problem',
          title: `Recurring: ${topic} ${sfx}`,
          description: ctx.rand.paragraph(1, 2),
          impact: ctx.rand.int(1, 3),
          urgency: ctx.rand.int(1, 3),
        }),
        201,
      ).body;
      ctx.expect.match(p.reference, /^PRB-\d+$/, 'reference');
      ctx.expect.equal([p.status, p.viewer?.role], ['new', 'agent'], 'status, viewer');
      return p as Json;
    });
    const P = `${T}/${problem.reference}`;

    await ctx.step('the incidents are linked to it (once each)', async () => {
      for (const inc of incidents) {
        const body = { target: problem.reference, type: 'caused_by' };
        if (ctx.rand.bool(0.2)) {
          ctx.tag('double link');
          const both = await Promise.all([1, 2].map(() => pm.post(`${T}/${inc.reference}/links`, body)));
          ctx.expect.oneOk(both, 'one link is made', [409]);
        } else ctx.expect.ok(await pm.post(`${T}/${inc.reference}/links`, body));
      }
      ctx.expect.code(
        await pm.post(`${T}/${incidents[0]!.reference}/links`, {
          target: problem.reference,
          type: 'caused_by',
        }),
        'RELATIONSHIP_INVALID',
        409,
      );
      // A problem is not caused by an incident.
      ctx.expect.code(
        await pm.post(`${P}/links`, { target: incidents[0]!.reference, type: 'caused_by' }),
        'RELATIONSHIP_INVALID',
        409,
      );
      const p = ctx.expect.ok(await pm.get(P)).body;
      const linked = (p.links as Json[]).filter((l) => l.type === 'caused_by');
      ctx.expect.equal(linked.length, incidents.length, 'incidents linked to the problem');
      ctx.expect.truthy(
        linked.every((l) => l.direction === 'incoming'),
        'the incidents point at the problem',
      );
      for (const inc of incidents) {
        const t = ctx.expect.ok(await agent.get(`${T}/${inc.reference}`)).body;
        const l = ctx.expect.find(
          t.links as Json[],
          (x) => x.ticket?.id === problem.id,
          `${inc.reference} shows the problem`,
        );
        ctx.expect.equal([l.type, l.direction], ['caused_by', 'outgoing'], 'the incident is caused by it');
        const theirs = ctx.expect.ok(await requester.get(`${T}/${inc.reference}`)).body;
        ctx.expect.equal(theirs.links, [], 'requesters see no links');
      }
      refused(ctx, await requester.get(P), 'the employee reading the problem', [404]);
    });

    await ctx.step('an agent cannot record root causes', async () => {
      refused(
        ctx,
        await agent.patch(`${P}/problem`, { rootCause: 'x' }),
        'an agent editing the problem',
        [403],
      );
    });

    const knownErrorViaFlag = ctx.rand.bool(0.6);
    await ctx.step('the problem manager investigates and records the known error', async () => {
      const t = ctx.expect.ok(await pm.post(`${P}/transition`, { status: 'investigating' })).body;
      ctx.expect.equal(t.status, 'investigating', 'status');
      const rootCause = `${ctx.rand.sentence(5, 12)} ${sfx}`;
      const workaround = `${ctx.rand.sentence(5, 12)} ${sfx}`;
      const p = ctx.expect.ok(await pm.patch(`${P}/problem`, { rootCause, workaround })).body;
      ctx.expect.equal(
        [p.problem?.rootCause, p.problem?.workaround],
        [rootCause, workaround],
        'root cause and workaround',
      );
      if (knownErrorViaFlag) {
        ctx.tag('known error flagged');
        const k = ctx.expect.ok(await pm.patch(`${P}/problem`, { knownError: true })).body;
        ctx.expect.equal(
          [k.status, k.problem?.knownError],
          ['known_error', true],
          'flagging moves it to known error',
        );
      } else {
        const k = ctx.expect.ok(await pm.post(`${P}/transition`, { status: 'known_error' })).body;
        ctx.expect.equal(k.status, 'known_error', 'status');
      }
    });

    const locale = ctx.rand.pick(LOCALES);
    const article = await ctx.step('the problem manager writes the known-error article', async () => {
      const title = `Known error: ${topic} ${sfx}`;
      const content = {
        title,
        summary: ctx.rand.sentence(4, 10),
        body: `## Symptoms\n${ctx.rand.paragraph(1, 2)}\n\n## Workaround\n${ctx.rand.paragraph(1, 2)}`,
        locale,
      };
      const res = await pm.post(`${P}/problem/article`, content);
      let ref: string;
      if (res.status === 404) {
        // Builds without "Write the known-error article": written in the knowledge base, then set on the problem.
        ctx.tag('article written in the knowledge base');
        const a = ctx.expect.status(
          await pm.post('/knowledge/articles', {
            ...content,
            audience: 'agents',
            source: { type: 'itsm.problem', id: problem.id, reference: problem.reference },
          }),
          201,
        ).body;
        const p = ctx.expect.ok(await pm.patch(`${P}/problem`, { kbArticleId: a.id })).body;
        ctx.expect.equal(p.problem?.kbArticle?.id, a.id, "the problem's article");
        ref = a.reference;
      } else {
        const r = ctx.expect.status(res, 201, 'writing the known-error article').body;
        ctx.expect.match(r.article?.reference, /^KB-\d+$/, 'the article reference');
        const p = ctx.expect.ok(await pm.get(P)).body;
        ctx.expect.equal(p.problem?.kbArticle?.id, r.article.id, "the problem's article");
        const links = ctx.expect.ok(await pm.get(`/records/itsm.ticket/${problem.id}/links`)).body;
        ctx.expect.truthy(
          JSON.stringify(links.links).includes(r.article.id),
          'the problem is linked to the article',
        );
        ref = r.article.reference;
      }
      const a = ctx.expect.ok(await pm.get(`/knowledge/articles/${ref}`)).body;
      ctx.expect.equal(
        [a.status, a.audience, a.source?.reference, a.locale],
        ['draft', 'agents', problem.reference, locale],
        'a draft for agents, from the problem',
      );
      return { ...a, title } as Json;
    });
    const A = `/knowledge/articles/${article.reference}`;

    await ctx.step('the article is reviewed and published for agents', async () => {
      refused(ctx, await requester.get(A), 'the employee reading the draft', [404]);
      const submitted = ctx.expect.ok(await pm.post(`${A}/submit`)).body;
      if (submitted.status === 'in_review' && submitted.awaitingApproval) {
        ctx.tag('article approval');
        const { status } = await ctx.approvals.approveAll(submitted.reviewInstanceId, {
          avoid: ['problemmgr'],
          prefer: ['kbeditor'],
        });
        ctx.expect.equal(status, 'approved', 'the review');
      } else {
        ctx.expect.equal(submitted.status, 'in_review', 'status after submitting');
        refused(ctx, await pm.post(`${A}/publish`), 'the author publishing it', [403]);
        if (ctx.rand.bool(0.5)) {
          const classes = itemsOf(ctx.expect.ok(await editor.get('/knowledge/classifications')));
          const c = ctx.rand.pick(classes).key;
          const a = ctx.expect.ok(await editor.patch(A, { classification: c })).body;
          ctx.expect.equal(a.classification, c, 'classification');
        }
        const a = ctx.expect.ok(await editor.post(`${A}/publish`)).body;
        ctx.expect.equal(a.status, 'published', 'status');
      }
      const done = await ctx.eventually(
        () => agent.get(A),
        (r) => r.body?.status === 'published',
        { label: 'the published article' },
      );
      ctx.expect.equal(done.body.audience, 'agents', 'audience');
      refused(ctx, await requester.get(A), 'the employee reading an agents-only article', [404]);
    });

    await ctx.step('agents find it, employees never do', async () => {
      await ctx.eventually(
        () => agent.get('/knowledge/search', { query: { q: article.title, limit: 20, locale } }),
        (r) => itemsOf(r).some((x) => x.id === article.id),
        { label: 'the article in the agent search', timeoutMs: 45_000 },
      );
      const theirs = ctx.expect.ok(
        await requester.get('/knowledge/search', { query: { q: article.title, limit: 20, locale } }),
      );
      ctx.expect.equal(itemsOf(theirs).filter((x) => x.id === article.id).length, 0, 'employee search hits');
    });

    await ctx.step('the agent resolves the incidents with the workaround', async () => {
      for (const inc of incidents) {
        const body: Json = {
          status: 'resolved',
          resolutionCode: 'workaround',
          resolutionNotes: `Workaround from ${problem.reference}`,
          ...(ctx.rand.bool(0.5) ? { articleId: article.id } : {}),
        };
        await solve(ctx, agent, inc.reference, body, { resolver: agentName });
      }
    });

    await ctx.step('the problem is resolved (and closed)', async () => {
      await solve(
        ctx,
        pm,
        problem.reference,
        {
          status: 'resolved',
          resolutionCode: 'solved',
          resolutionNotes: `Fixed: ${ctx.rand.sentence(3, 8)}`,
        },
        { resolver: 'problemmgr' },
      );
      if (ctx.rand.bool(0.5)) {
        const t = ctx.expect.ok(await pm.post(`${P}/transition`, { status: 'closed' })).body;
        ctx.expect.equal(t.status, 'closed', 'status');
      }
    });
  },
});

/* ───────────────────────────── change-normal-cab ───────────────────────────── */

/** An agent raises a change for `requesterId` on `ciIds`; returns the ticket. */
export async function raiseChange(
  ctx: FlowContext,
  client: ApiClient,
  body: { title: string; requesterId?: string; ciIds?: string[]; change: Json },
): Promise<Json> {
  const t = ctx.expect.status(
    await client.post(T, { type: 'change', description: ctx.rand.paragraph(1, 2), ...body }),
    201,
  ).body;
  ctx.expect.match(t.reference, /^CHG-\d+$/, 'reference');
  ctx.expect.equal([t.status, t.change?.changeType], ['draft', body.change.changeType], 'status and type');
  return t;
}

/** Implements a scheduled change, asks its requester for acceptance and closes it. */
export async function implementAndClose(
  ctx: FlowContext,
  ref: string,
  opts: { worker: ApiClient; requester?: ApiClient; stranger?: ApiClient },
) {
  await ctx.step('the change is implemented and reviewed', async () => {
    const now = ctx.expect.ok(await opts.worker.get(`${T}/${ref}`)).body;
    const impl =
      now.status === 'implementing'
        ? now
        : ctx.expect.ok(await opts.worker.post(`${T}/${ref}/transition`, { status: 'implementing' })).body;
    ctx.expect.equal(impl.status, 'implementing', 'status');
    const review = ctx.expect.ok(
      await opts.worker.post(`${T}/${ref}/transition`, { status: 'review', note: ctx.rand.sentence(3, 8) }),
    ).body;
    ctx.expect.equal(review.status, 'review', 'status');
  });
  const requester = opts.requester;
  if (requester) {
    const accepted = ctx.rand.bool(0.8);
    ctx.tag(accepted ? 'accepted' : 'problem reported');
    await ctx.step(
      accepted ? 'the requester accepts the change' : 'the requester reports a problem',
      async () => {
        const t = ctx.expect.ok(await requester.get(`${T}/${ref}`)).body;
        ctx.expect.equal([t.viewer?.canAccept, t.acceptance?.state], [true, 'pending'], 'asked to accept');
        if (opts.stranger)
          refused(
            ctx,
            await opts.stranger.post(`${T}/${ref}/acceptance`, { accepted: true }),
            'someone else accepting it',
            [404],
          );
        if (!accepted)
          ctx.expect.code(
            await requester.post(`${T}/${ref}/acceptance`, { accepted: false }),
            'VALIDATION_FAILED',
            400,
          );
        const after = ctx.expect.ok(
          await requester.post(
            `${T}/${ref}/acceptance`,
            accepted ? { accepted: true } : { accepted: false, note: ctx.rand.sentence(3, 8) },
          ),
        ).body;
        ctx.expect.equal(after.acceptance?.state, accepted ? 'accepted' : 'problem', 'the acceptance');
        const told = await ctx.eventually(
          () => notificationsAbout(requester, 'itsm.change.acceptance_requested', ref),
          (n) => n.length >= 1,
          { label: 'the acceptance request notification' },
        );
        ctx.expect.equal(told.length, 1, '"acceptance requested" notifications');
      },
    );
  }
  await ctx.step('the change is closed', async () => {
    const t = ctx.expect.ok(await opts.worker.post(`${T}/${ref}/transition`, { status: 'closed' })).body;
    ctx.expect.equal(t.status, 'closed', 'status');
    ctx.expect.equal(t.viewer?.transitions, [], 'nothing left to do');
  });
}

export const changeNormalCab = defineFlow({
  name: 'change-normal-cab',
  area: 'itsm',
  description:
    'Agent raises a normal change for an employee → change manager plans it → CAB authorization (change manager, + CAB when risky) → implemented → requester accepts → closed',
  personas: ['agent', 'changemgr', 'cab', 'employee', 'admin'],
  timeoutMs: 240_000,
  async run(ctx) {
    const agent = ctx.as('agent');
    const cm = ctx.as('changemgr');
    const requester = ctx.as('employee');
    const me = ctx.user('employee');
    const stranger = ctx.as(outsiderOf(ctx, 'employee', EMPLOYEES));
    const sfx = ctx.rand.suffix();
    const risk = ctx.rand.weighted([
      ['low', 3],
      ['medium', 3],
      ['high', 2],
    ] as const);
    ctx.tag(`risk ${risk}`);
    const startIn = ctx.rand.int(1, 20) * DAY + ctx.rand.int(0, 600) * MINUTE;
    const plannedStart = isoIn(startIn);
    const plannedEnd = isoIn(startIn + ctx.rand.int(30, 600) * MINUTE);

    const cis = await ctx.step('the agent picks the affected CIs', async () => {
      const list = itemsOf(
        ctx.expect.ok(
          await agent.get('/cmdb/cis', {
            query: { view: 'infrastructure', status: 'in_use', pageSize: 100 },
          }),
        ),
      );
      return ctx.rand.sample(list, 0, 2);
    });
    const critical = cis.some((c) => c.criticality === 'critical');

    const change = await ctx.step('the agent raises the change for the employee', async () => {
      const pastWindow = ctx.rand.bool(0.1);
      const t = await raiseChange(ctx, agent, {
        title: `Change ${sfx}: ${ctx.rand.words(2, 5)}`.slice(0, 200),
        requesterId: me.id,
        ciIds: cis.map((c) => c.id),
        change: {
          changeType: 'normal',
          risk,
          reason: ctx.rand.sentence(),
          ...(pastWindow ? { plannedStart: isoIn(-2 * DAY), plannedEnd: isoIn(-2 * DAY + 3_600_000) } : {}),
        },
      });
      ctx.expect.equal(t.requester?.id, me.id, 'requester');
      ctx.expect.ok(
        await agent.post(`${T}/${t.reference}/transition`, { status: 'assessment' }),
        'into assessment',
      );
      if (pastWindow) {
        ctx.tag('window in the past');
        ctx.expect.code(
          await agent.post(`${T}/${t.reference}/transition`, { status: 'authorization' }),
          'SCHEDULE_CONFLICT',
          409,
        );
      }
      return t;
    });
    const ref = change.reference as string;

    await ctx.step('who may see and plan it', async () => {
      const theirs = ctx.expect.ok(await requester.get(`${T}/${ref}`)).body;
      ctx.expect.equal(theirs.viewer?.role, 'requester', 'the employee follows their change');
      refused(ctx, await stranger.get(`${T}/${ref}`), 'another employee reading it', [404]);
      refused(ctx, await agent.patch(`${T}/${ref}/change`, { risk: 'low' }), 'an agent planning it', [403]);
      refused(
        ctx,
        await requester.patch(`${T}/${ref}/change`, { risk: 'low' }),
        'the requester planning it',
        [403],
      );
    });

    await ctx.step('the change manager plans the window', async () => {
      if (ctx.rand.bool(0.3))
        ctx.expect.code(
          await cm.patch(`${T}/${ref}/change`, { plannedStart: plannedEnd, plannedEnd: plannedStart }),
          'VALIDATION_FAILED',
          400,
        );
      const t = ctx.expect.ok(
        await cm.patch(`${T}/${ref}/change`, {
          plannedStart,
          plannedEnd,
          implementationPlan: ctx.rand.paragraph(1, 2),
          backoutPlan: ctx.rand.sentence(),
          testPlan: ctx.rand.sentence(),
        }),
      ).body;
      ctx.expect.equal(
        [Date.parse(t.change.plannedStart), Date.parse(t.change.plannedEnd)],
        [Date.parse(plannedStart), Date.parse(plannedEnd)],
        'the window',
      );
    });

    const submitted = await ctx.step('the agent submits it for authorization', async () => {
      let t: Json;
      if (ctx.rand.bool(0.15)) {
        ctx.tag('double submit');
        const both = await Promise.all(
          [1, 2].map(() => agent.post(`${T}/${ref}/transition`, { status: 'authorization' })),
        );
        t = ctx.expect.oneOk(both, 'one submission goes through', [409]).body;
      } else t = ctx.expect.ok(await agent.post(`${T}/${ref}/transition`, { status: 'authorization' })).body;
      ctx.expect.equal(t.status, 'authorization', 'status');
      ctx.expect.truthy(t.change?.approvalInstanceId, 'the CAB workflow started');
      ctx.expect.equal(t.viewer?.transitions, ['cancelled'], 'only cancelling is left by hand');
      return t;
    });
    const instanceId = submitted.change.approvalInstanceId as string;

    await ctx.step('the change calendar shows it', async () => {
      // The calendar pages its changes by start, and other runs plan many in the same window: follow `nextCursor`
      // until this change turns up or the window's changes run out.
      const query = { from: isoIn(startIn - 30 * MINUTE), to: isoIn(startIn + 90 * MINUTE), limit: 200 };
      const listed: Json[] = [];
      let cursor: string | undefined;
      for (let page = 1; page <= 100; page++) {
        const cal = ctx.expect.ok(
          await agent.get('/itsm/changes/calendar', { query: { ...query, cursor } }),
        ).body;
        listed.push(...(cal.items as Json[]));
        cursor = (cal.nextCursor as string | null) ?? undefined;
        if (!cursor || listed.some((c) => c.reference === ref)) break;
      }
      ctx.expect.find(listed, (c) => c.reference === ref, 'the calendar lists it');
    });

    const outcome = ctx.rand.weighted([
      ['approve', 7],
      ['reject', 2],
      ['cancel', 1],
    ] as const);
    ctx.tag(outcome);

    if (outcome === 'cancel') {
      await ctx.step('the agent cancels it while it waits for the CAB', async () => {
        const t = ctx.expect.ok(
          await agent.post(`${T}/${ref}/transition`, {
            status: 'cancelled',
            resolutionCode: 'cancelled_by_requester',
            resolutionNotes: ctx.rand.sentence(3, 8),
          }),
        ).body;
        ctx.expect.equal(t.status, 'cancelled', 'status');
        await ctx.eventually(
          () => ctx.as('admin').get(`/workflow-instances/${instanceId}`),
          (r) => r.body?.status === 'cancelled',
          { label: 'the cancelled CAB workflow' },
        );
        const inbox = ctx.expect.ok(await cm.get('/me/approvals', { query: { q: ref, pageSize: 50 } })).body
          .items as Json[];
        ctx.expect.equal(
          inbox.filter((i) => i.instance?.id === instanceId && i.task?.status === 'pending').length,
          0,
          "pending tasks left in the change manager's inbox",
        );
      });
      return;
    }

    if (outcome === 'reject') {
      await ctx.step('the change manager (or the CAB) rejects it', async () => {
        const cabStep = (risk === 'high' || critical) && ctx.rand.bool(0.5);
        if (cabStep) {
          ctx.expect.equal(
            await ctx.approvals.decide(instanceId, 'changemgr', 'approve'),
            'running',
            'the CAB follows',
          );
          ctx.expect.equal(await ctx.approvals.decide(instanceId, 'cab', 'reject'), 'rejected', 'outcome');
        } else {
          ctx.expect.code(
            await cm.post(
              `/approvals/${(await ctx.approvals.taskOf(instanceId, 'changemgr')).id}/reject`,
              {},
            ),
            'COMMENT_REQUIRED',
            400,
          );
          ctx.expect.equal(
            await ctx.approvals.decide(instanceId, 'changemgr', 'reject'),
            'rejected',
            'outcome',
          );
        }
        const t = await ctx.eventually(
          () => agent.get(`${T}/${ref}`),
          (r) => r.body?.status === 'rejected',
          { label: 'the rejected change' },
        );
        ctx.expect.equal(t.body.viewer?.transitions, ['draft'], 'back to the drawing board');
        const back = ctx.expect.ok(await agent.post(`${T}/${ref}/transition`, { status: 'draft' })).body;
        ctx.expect.equal(back.status, 'draft', 'status');
        ctx.expect.ok(
          await agent.post(`${T}/${ref}/transition`, {
            status: 'cancelled',
            resolutionCode: 'cancelled_by_requester',
            resolutionNotes: 'Rejected by the CAB',
          }),
        );
      });
      return;
    }

    await ctx.step('the change manager (and the CAB) authorize it', async () => {
      const twice = ctx.rand.bool(0.15);
      if (twice) ctx.tag('double approve');
      const first = await ctx.approvals.decide(instanceId, 'changemgr', 'approve', { twice, viaInbox: ref });
      if (risk === 'high' || critical) {
        ctx.expect.equal(first, 'running', 'the CAB is asked for a risky change');
        ctx.tag('cab');
      }
      const { status } = await ctx.approvals.approveAll(instanceId, {
        prefer: ['cab', 'changemgr'],
        avoid: ['admin'],
      });
      ctx.expect.equal(status, 'approved', 'the CAB workflow');
      const t = await ctx.eventually(
        () => agent.get(`${T}/${ref}`),
        (r) => r.body?.status === 'scheduled',
        { label: 'the scheduled change' },
      );
      ctx.expect.equal(t.body.viewer?.transitions, ['implementing', 'cancelled'], 'what can happen next');
    });

    await implementAndClose(ctx, ref, { worker: agent, requester, stranger });
  },
});

/* ───────────────────────────── change-standard-emergency ───────────────────────────── */

export const changeStandardEmergency = defineFlow({
  name: 'change-standard-emergency',
  area: 'itsm',
  description:
    'Standard changes (pre-approved, overlapping windows flagged as conflicts on a CI) or an emergency change through the emergency CAB',
  personas: ['agent', 'cab', 'cmdbmgr', 'employee', 'admin'],
  timeoutMs: 240_000,
  async run(ctx) {
    const agent = ctx.as('agent');
    const requester = ctx.as('employee');
    const me = ctx.user('employee');
    const sfx = ctx.rand.suffix();
    const kind = ctx.rand.weighted([
      ['standard', 3],
      ['emergency', 2],
    ] as const);
    ctx.tag(kind);

    const ci = await ctx.step('a CI of its own', async () => {
      const c = ctx.expect.status(
        await ctx.as('cmdbmgr').post('/cmdb/cis', {
          name: `sim-srv-${sfx}`,
          classKey: 'server',
          environment: 'production',
          criticality: ctx.rand.pick(['high', 'medium', 'low']),
          tags: ['flow-sim'],
        }),
        201,
      ).body;
      return c as Json;
    });

    if (kind === 'standard') {
      const startIn = ctx.rand.int(1, 15) * DAY;
      const windows = [0, 1].map((i) => {
        const s = startIn + i * ctx.rand.int(10, 50) * MINUTE;
        return { plannedStart: isoIn(s), plannedEnd: isoIn(s + 90 * MINUTE) };
      });
      const changes = await ctx.step('two standard changes on the CI are pre-approved', async () => {
        const out: Json[] = [];
        for (const w of windows) {
          const t = await raiseChange(ctx, agent, {
            title: `Standard ${sfx}: ${ctx.rand.words(2, 4)}`,
            ciIds: [ci.id],
            change: { changeType: 'standard', risk: 'low', ...w, implementationPlan: ctx.rand.sentence() },
          });
          ctx.expect.ok(await agent.post(`${T}/${t.reference}/transition`, { status: 'assessment' }));
          const done = ctx.expect.ok(
            await agent.post(`${T}/${t.reference}/transition`, { status: 'authorization' }),
          ).body;
          ctx.expect.equal(done.status, 'scheduled', 'a standard change is scheduled straight away');
          out.push(done);
        }
        return out;
      });
      await ctx.step('the overlap is flagged as a conflict', async () => {
        const second = ctx.expect.ok(await agent.get(`${T}/${changes[1]!.reference}`)).body;
        ctx.expect.equal(
          (second.change.conflicts as Json[]).map((c) => c.id),
          [changes[0]!.id],
          'conflicts of the second change',
        );
        const res = ctx.expect.ok(
          await agent.get('/itsm/changes/conflicts', {
            query: {
              ...{ start: windows[1]!.plannedStart, end: windows[1]!.plannedEnd },
              ciIds: ci.id,
              exclude: changes[1]!.id,
            },
          }),
        ).body;
        const hit = ctx.expect.find(
          res.items as Json[],
          (c) => c.id === changes[0]!.id,
          'the conflict check finds the first',
        );
        ctx.expect.equal(
          (hit.sharedCis as Json[]).map((c) => c.id),
          [ci.id],
          'the shared CI',
        );
      });
      await implementAndClose(ctx, changes[0]!.reference, { worker: agent });
      await ctx.step('the second is cancelled', async () => {
        const t = ctx.expect.ok(
          await agent.post(`${T}/${changes[1]!.reference}/transition`, {
            status: 'cancelled',
            resolutionCode: 'duplicate',
            resolutionNotes: `Done with ${changes[0]!.reference}`,
          }),
        ).body;
        ctx.expect.equal(t.status, 'cancelled', 'status');
      });
    } else {
      const change = await ctx.step(
        'the agent raises an emergency change (window already open)',
        async () => {
          const t = await raiseChange(ctx, agent, {
            title: `Emergency ${sfx}: ${ctx.rand.words(2, 4)}`,
            requesterId: me.id,
            ciIds: [ci.id],
            change: {
              changeType: 'emergency',
              risk: ctx.rand.pick(['medium', 'high']),
              reason: ctx.rand.sentence(),
              plannedStart: isoIn(-ctx.rand.int(1, 30) * MINUTE),
              plannedEnd: isoIn(ctx.rand.int(60, 240) * MINUTE),
              backoutPlan: ctx.rand.sentence(),
            },
          });
          ctx.expect.ok(await agent.post(`${T}/${t.reference}/transition`, { status: 'assessment' }));
          const s = ctx.expect.ok(
            await agent.post(`${T}/${t.reference}/transition`, { status: 'authorization' }),
          ).body;
          ctx.expect.equal(s.status, 'authorization', 'an emergency still needs the emergency CAB');
          ctx.expect.truthy(s.change?.approvalInstanceId, 'the emergency CAB is asked');
          return s;
        },
      );
      const ref = change.reference as string;
      const reject = ctx.rand.bool(0.15);
      await ctx.step(reject ? 'the emergency CAB rejects it' : 'the emergency CAB approves it', async () => {
        const inst = await ctx.approvals.instance(change.change.approvalInstanceId);
        ctx.expect.truthy(
          (inst.currentSteps as Json[] | undefined)?.some?.((s) => (s.id ?? s) === 'ecab') ?? true,
          'the ECAB step',
        );
        const outcome = await ctx.approvals.decide(
          change.change.approvalInstanceId,
          'cab',
          reject ? 'reject' : 'approve',
        );
        ctx.expect.equal(outcome, reject ? 'rejected' : 'approved', 'outcome');
        await ctx.eventually(
          () => agent.get(`${T}/${ref}`),
          (r) => r.body?.status === (reject ? 'rejected' : 'scheduled'),
          { label: reject ? 'the rejected change' : 'the scheduled change' },
        );
      });
      if (reject) ctx.tag('rejected');
      else
        await implementAndClose(ctx, ref, {
          worker: agent,
          requester,
          stranger: ctx.as(outsiderOf(ctx, 'employee', EMPLOYEES)),
        });
    }

    await ctx.step('a CI with changes cannot be deleted, only retired', async () => {
      const cmdb = ctx.as('cmdbmgr');
      ctx.expect.code(await cmdb.delete(`/cmdb/cis/${ci.id}`), 'IN_USE', 409);
      const r = ctx.expect.ok(await cmdb.post(`/cmdb/cis/${ci.id}/retire`)).body;
      ctx.expect.equal(r.status, 'retired', 'status');
    });
  },
});

/* ───────────────────────────── knowledge-article ───────────────────────────── */

export const knowledgeArticle = defineFlow({
  name: 'knowledge-article',
  area: 'knowledge',
  description:
    'Agent drafts an article → submits → editor classifies and publishes → readers find it (or not: agents only) → feedback, new version, retired',
  personas: ['agent', 'kbeditor', 'employee', 'auditor'],
  async run(ctx) {
    const author = ctx.as('agent');
    const authorName = ctx.personaOf(ctx.user('agent').id)!;
    const editor = ctx.as('kbeditor');
    const employee = ctx.as('employee');
    const sfx = ctx.rand.suffix();
    const audience = ctx.rand.weighted([
      ['everyone', 3],
      ['agents', 2],
    ] as const);
    ctx.tag(`audience ${audience}`);
    const locale = ctx.rand.pick(LOCALES);
    const reader = audience === 'everyone' ? employee : author;

    await ctx.step('employees cannot write articles', async () => {
      refused(
        ctx,
        await employee.post('/knowledge/articles', { title: `x ${sfx}`, body: 'x' }),
        'an employee writing',
        [403],
      );
    });

    const draft = await ctx.step('the agent drafts an article', async () => {
      const cats = itemsOf(ctx.expect.ok(await author.get('/knowledge/categories')));
      const title = `${ctx.rand.words(3, 6)} ${sfx}`;
      const tags = ctx.rand.sample(['VPN', 'Outlook', 'Printer', 'MFA', 'Wi-Fi', 'Teams', 'Laptop'], 0, 3);
      const a = ctx.expect.status(
        await author.post('/knowledge/articles', {
          title,
          summary: ctx.rand.sentence(4, 10),
          body: `## Steps\n${ctx.rand.paragraph(2, 4)}`,
          categoryId: cats.length && ctx.rand.bool(0.8) ? ctx.rand.pick(cats).id : null,
          tags,
          locale,
          audience,
        }),
        201,
      ).body;
      ctx.expect.equal(
        [a.status, a.audience, a.locale, a.canEdit],
        ['draft', audience, locale, true],
        'a draft',
      );
      ctx.expect.match(a.reference, /^KB-\d+$/, 'reference');
      ctx.expect.equal(a.tags, [...new Set(tags.map((t) => t.toLowerCase()))], 'tags are lowercased');
      return { ...a, title } as Json;
    });
    const A = `/knowledge/articles/${draft.reference}`;

    await ctx.step('nobody else sees the draft', async () => {
      refused(ctx, await employee.get(A), 'an employee reading the draft', [404]);
      refused(
        ctx,
        await employee.get('/knowledge/articles', { query: { status: 'draft' } }),
        'an employee listing drafts',
        [403],
      );
    });

    await ctx.step('the agent edits it and cannot publish it', async () => {
      const a = ctx.expect.ok(
        await author.patch(A, { body: `## Steps\n${ctx.rand.paragraph(2, 4)}\n\n${sfx}` }),
      ).body;
      ctx.expect.equal(a.status, 'draft', 'status');
      refused(ctx, await author.post(`${A}/publish`), 'the author publishing', [403]);
    });

    const withdraw = ctx.rand.bool(0.1);
    await ctx.step('the agent submits it for review', async () => {
      let a: Json;
      if (ctx.rand.bool(0.15)) {
        ctx.tag('double submit');
        const both = await Promise.all([1, 2].map(() => author.post(`${A}/submit`)));
        for (const r of both) ctx.expect.status(r, [200, 409], 'submitting twice at once');
        ctx.expect.equal(
          [
            both.filter((r) => r.status === 200).length,
            await auditCount(ctx, 'knowledge.article.submitted', draft.id),
          ],
          [1, 1],
          'a double click submits once (successes, audit entries)',
        );
        a = both.find((r) => r.status === 200)!.body;
      } else a = ctx.expect.ok(await author.post(`${A}/submit`)).body;
      ctx.expect.equal(a.status, 'in_review', 'status');
      if (a.awaitingApproval) {
        ctx.tag('review workflow');
        const { status } = await ctx.approvals.approveAll(a.reviewInstanceId, {
          avoid: [authorName],
          prefer: ['kbeditor'],
        });
        ctx.expect.equal(status, 'approved', 'the review');
      }
    });

    if (withdraw) {
      ctx.tag('withdrawn');
      await ctx.step('the agent withdraws and deletes it', async () => {
        const now = ctx.expect.ok(await author.get(A)).body;
        if (now.status === 'in_review') {
          const a = ctx.expect.ok(await author.post(`${A}/withdraw`)).body;
          ctx.expect.equal(a.status, 'draft', 'status');
          ctx.expect.status(await author.delete(A), 204);
          refused(ctx, await author.get(A), 'reading a deleted article', [404]);
        }
      });
      return;
    }

    const article = await ctx.step('the editor classifies and publishes it', async () => {
      const now = ctx.expect.ok(await editor.get(A)).body;
      if (now.status === 'in_review') {
        const classes = itemsOf(ctx.expect.ok(await editor.get('/knowledge/classifications')));
        if (ctx.rand.bool(0.6)) {
          const c = ctx.rand.pick(classes).key;
          ctx.expect.equal(
            ctx.expect.ok(await editor.patch(A, { classification: c })).body.classification,
            c,
            'classification',
          );
        }
        ctx.expect.code(await editor.patch(A, { classification: `no-such-${sfx}` }), 'BAD_REQUEST', 400);
        let a: Json;
        if (ctx.rand.bool(0.15)) {
          ctx.tag('double publish');
          const both = await Promise.all([1, 2].map(() => editor.post(`${A}/publish`)));
          for (const r of both) ctx.expect.status(r, [200, 409], 'publishing twice at once');
          const fresh = ctx.expect.ok(await editor.get(A)).body;
          const versions = itemsOf(ctx.expect.ok(await editor.get(`${A}/versions`)));
          ctx.expect.equal(
            [
              both.filter((r) => r.status === 200).length,
              fresh.publishedVersion,
              versions.length,
              await auditCount(ctx, 'knowledge.article.published', draft.id),
            ],
            [1, 1, 1, 1],
            'a double click publishes once (successes, published version, versions, audit entries)',
          );
          a = both.find((r) => r.status === 200)!.body;
        } else a = ctx.expect.ok(await editor.post(`${A}/publish`)).body;
        ctx.expect.equal([a.status, a.publishedVersion], ['published', 1], 'published, version 1');
        const fresh = ctx.expect.ok(await editor.get(A)).body;
        ctx.expect.equal(fresh.publishedVersion, 1, 'published once (version)');
        ctx.expect.equal(
          await auditCount(ctx, 'knowledge.article.published', a.id),
          1,
          'publications recorded',
        );
        ctx.expect.match(a.reviewAt, /^\d{4}-\d{2}-\d{2}$/, 'a review date');
        return a;
      }
      ctx.expect.equal(now.status, 'published', 'published by its review');
      return now;
    });

    await ctx.step('the right people can read it', async () => {
      ctx.expect.equal(ctx.expect.ok(await reader.get(A)).body.status, 'published', 'the reader opens it');
      if (audience === 'agents')
        refused(ctx, await employee.get(A), 'an employee reading an agents-only article', [404]);
      const list = ctx.expect.ok(await reader.get('/knowledge/articles', { query: { q: sfx } })).body
        .items as Json[];
      ctx.expect.find(list, (x) => x.id === article.id, 'the article list finds it');
    });

    await ctx.step('search finds it for its readers only', async () => {
      await ctx.eventually(
        () => reader.get('/knowledge/search', { query: { q: draft.title, limit: 20, locale } }),
        (r) => itemsOf(r).some((x) => x.id === article.id),
        { label: 'the article in search', timeoutMs: 45_000 },
      );
      if (audience === 'agents') {
        const theirs = ctx.expect.ok(
          await employee.get('/knowledge/search', { query: { q: draft.title, limit: 20, locale } }),
        );
        ctx.expect.equal(
          itemsOf(theirs).filter((x) => x.id === article.id).length,
          0,
          'employee search hits',
        );
      }
    });

    await ctx.step('a reader gives feedback', async () => {
      const helpful = ctx.rand.bool(0.7);
      const f = ctx.expect.ok(
        await reader.post(`${A}/feedback`, {
          helpful,
          ...(ctx.rand.bool(0.4) ? { comment: ctx.rand.sentence(3, 8) } : {}),
        }),
      ).body;
      ctx.expect.equal([f.helpfulCount, f.notHelpfulCount], helpful ? [1, 0] : [0, 1], 'feedback counts');
      const again = ctx.expect.ok(await reader.post(`${A}/feedback`, { helpful })).body;
      ctx.expect.equal(
        [again.helpfulCount, again.notHelpfulCount],
        helpful ? [1, 0] : [0, 1],
        'the same reader counts once',
      );
    });

    if (ctx.rand.bool(0.4))
      await ctx.step('the editor publishes a new version', async () => {
        const a = ctx.expect.ok(await editor.patch(A, { summary: ctx.rand.sentence(4, 10) })).body;
        ctx.expect.equal(a.publishedVersion, 2, 'version');
        const versions = ctx.expect.ok(await editor.get(`${A}/versions`)).body.items as Json[];
        ctx.expect.equal(
          versions.map((v) => [v.version, v.current]),
          [
            [2, true],
            [1, false],
          ],
          'versions',
        );
        refused(
          ctx,
          await author.patch(A, { summary: 'x' }),
          'the author editing a published article',
          [403],
        );
      });

    if (ctx.rand.bool(0.5))
      await ctx.step('the editor retires it', async () => {
        ctx.tag('retired');
        refused(ctx, await author.post(`${A}/retire`), 'the author retiring it', [403]);
        const a = ctx.expect.ok(await editor.post(`${A}/retire`)).body;
        ctx.expect.equal(a.status, 'retired', 'status');
        if (audience === 'everyone')
          refused(ctx, await employee.get(A), 'an employee reading a retired article', [404]);
        const hits = itemsOf(
          ctx.expect.ok(
            await reader.get('/knowledge/search', { query: { q: draft.title, limit: 20, locale } }),
          ),
        );
        ctx.expect.equal(
          hits.filter((x) => x.id === article.id).length,
          0,
          'search hits of a retired article',
        );
      });
  },
});

/* ───────────────────────────── cmdb-ci-impact ───────────────────────────── */

export const cmdbImpact = defineFlow({
  name: 'cmdb-ci-impact',
  area: 'cmdb',
  description:
    'Configuration manager records a service, its application, servers and a database with relationships → impact both ways → refusals → retired',
  personas: ['cmdbmgr', 'agent', 'employee', 'auditor'],
  async run(ctx) {
    const cmdb = ctx.as('cmdbmgr');
    const agent = ctx.as('agent');
    const employee = ctx.as('employee');
    const sfx = ctx.rand.suffix();

    // The groups other flows of this run created may be deleted meanwhile (a CI must not name a missing group).
    const groups = await ctx.step('the support groups', async () =>
      itemsOf(ctx.expect.ok(await cmdb.get('/cmdb/lookups/groups'))).filter(
        (g) => !`${g.key ?? ''} ${g.name ?? ''}`.includes(ctx.runToken),
      ),
    );

    const make = async (name: string, classKey: string, extra: Json = {}) => {
      const body = {
        name: `${name}-${sfx}`,
        classKey,
        environment: ctx.rand.pick(['production', 'staging', 'test', null]),
        criticality: ctx.rand.pick(['critical', 'high', 'medium', 'low']),
        supportGroupId: groups.length && ctx.rand.bool(0.7) ? ctx.rand.pick(groups).id : null,
        tags: ctx.rand.sample(['flow-sim', 'linux', 'windows', 'tier-1', 'dmz'], 1, 3),
        description: ctx.rand.sentence(),
        ...extra,
      };
      const c = ctx.expect.status(await cmdb.post('/cmdb/cis', body), 201).body;
      ctx.expect.match(c.reference, /^CI-\d+$/, 'reference');
      ctx.expect.equal(
        [c.status, c.class?.key, c.canManage],
        [extra.status ?? 'in_use', classKey, true],
        'status, class, canManage',
      );
      return c as Json;
    };

    const cis = await ctx.step('the configuration manager records the CIs', async () => {
      const service = await make('svc', 'business-service');
      const app = await make('app', 'application');
      const servers = [await make('srv-a', 'server')];
      if (ctx.rand.bool(0.5)) servers.push(await make('srv-b', 'server'));
      const db = ctx.rand.bool(0.7) ? await make('db', 'database') : null;
      return { service, app, servers, db };
    });

    const link = (sourceId: string, targetId: string, type: string) =>
      cmdb.post('/cmdb/relationships', {
        sourceId,
        targetId,
        type,
        note: ctx.rand.bool(0.3) ? ctx.rand.sentence(2, 5) : null,
      });

    await ctx.step('and how they depend on each other', async () => {
      ctx.expect.status(await link(cis.service.id, cis.app.id, 'depends_on'), 201);
      for (const s of cis.servers) ctx.expect.status(await link(cis.app.id, s.id, 'runs_on'), 201);
      if (cis.db) {
        ctx.expect.status(await link(cis.app.id, cis.db.id, 'depends_on'), 201);
        ctx.expect.status(await link(cis.db.id, cis.servers[0]!.id, 'runs_on'), 201);
      }
      if (ctx.rand.bool(0.2)) {
        ctx.tag('double relationship');
        const both = await Promise.all(
          [1, 2].map(() => link(cis.servers.at(-1)!.id, cis.app.id, 'connects_to')),
        );
        ctx.expect.oneOk(both, 'one relationship is made', [409]);
      }
      const dup = await link(cis.service.id, cis.app.id, 'depends_on');
      ctx.expect.code(dup, 'RELATIONSHIP_INVALID', 409);
      ctx.expect.equal(dup.body.error?.details?.reason, 'duplicate', 'reason');
      ctx.expect.equal(
        (await link(cis.app.id, cis.app.id, 'depends_on')).body.error?.details?.reason,
        'self',
        'self link refused',
      );
      const rels = ctx.expect.ok(await cmdb.get(`/cmdb/cis/${cis.app.id}/relationships`)).body
        .items as Json[];
      ctx.expect.find(
        rels,
        (r) => r.direction === 'incoming' && r.ci?.id === cis.service.id && r.type === 'depends_on',
        'used by the service',
      );
      for (const s of cis.servers)
        ctx.expect.find(
          rels,
          (r) => r.direction === 'outgoing' && r.ci?.id === s.id && r.type === 'runs_on',
          `runs on ${s.name}`,
        );
    });

    await ctx.step('impact: what breaks when a server fails, what the service needs', async () => {
      const server = cis.servers[0]!;
      const imp = ctx.expect.ok(
        await agent.get(`/cmdb/cis/${server.id}/impact`, { query: { depth: 3 } }),
      ).body;
      const at = (nodes: Json[], id: string) => nodes.find((n) => n.ci?.id === id);
      const app = ctx.expect.truthy(at(imp.impacted, cis.app.id), 'the application is impacted');
      ctx.expect.equal(app.depth, 1, 'the application depends on the server directly');
      const svc = ctx.expect.truthy(at(imp.impacted, cis.service.id), 'the service is impacted');
      ctx.expect.equal([svc.depth, svc.isService], [2, true], 'the service, two hops away');
      ctx.expect.truthy(imp.impactedServices >= 1, 'impacted services counted');
      const ids = (imp.impacted as Json[]).map((n) => n.ci.id);
      ctx.expect.equal(ids.length, new Set(ids).size, 'each CI once');
      const needs = ctx.expect.ok(
        await agent.get(`/cmdb/cis/${cis.service.id}/impact`, { query: { depth: 5 } }),
      ).body;
      ctx.expect.equal(needs.impacted, [], 'nothing depends on the service');
      for (const s of cis.servers)
        ctx.expect.truthy(at(needs.dependsOn, s.id), `the service needs ${s.name}`);
      if (cis.db) ctx.expect.equal(at(needs.dependsOn, cis.db.id)?.depth, 2, 'the database, two hops down');
      const shallow = ctx.expect.ok(
        await agent.get(`/cmdb/cis/${server.id}/impact`, { query: { depth: 1 } }),
      ).body;
      ctx.expect.truthy(
        (shallow.impacted as Json[]).every((n) => n.depth === 1),
        'depth 1 stays at depth 1',
      );
      ctx.expect.code(
        await agent.get(`/cmdb/cis/${server.id}/impact`, { query: { depth: 6 } }),
        'VALIDATION_FAILED',
        400,
      );
    });

    await ctx.step('readers read, only the configuration manager writes', async () => {
      const c = ctx.expect.ok(await agent.get(`/cmdb/cis/${cis.app.reference}`)).body;
      ctx.expect.equal(c.canManage, false, 'an agent reads only');
      refused(
        ctx,
        await agent.post('/cmdb/cis', { name: `x-${sfx}`, classKey: 'server' }),
        'an agent creating a CI',
        [403],
      );
      refused(
        ctx,
        await agent.patch(`/cmdb/cis/${cis.app.id}`, { criticality: 'low' }),
        'an agent editing a CI',
        [403],
      );
      refused(ctx, await employee.get(`/cmdb/cis/${cis.app.id}`), 'an employee reading a CI', [403]);
      refused(
        ctx,
        await employee.get(`/cmdb/cis/${cis.app.id}/impact`),
        'an employee reading the impact',
        [403],
      );
      const services = ctx.expect.ok(await employee.get('/cmdb/services', { query: { q: sfx } })).body
        .items as Json[];
      ctx.expect.equal(
        services.map((s) => s.id),
        [cis.service.id],
        'employees see the business service',
      );
      const found = ctx.expect.ok(await agent.get('/cmdb/cis', { query: { q: sfx, pageSize: 50 } })).body;
      ctx.expect.equal(found.total, 2 + cis.servers.length + (cis.db ? 1 : 0), 'the CIs of this run');
    });

    await ctx.step('the configuration manager updates and retires a server', async () => {
      const s = cis.servers.at(-1)!;
      const p = ctx.expect.ok(
        await cmdb.patch(`/cmdb/cis/${s.id}`, { criticality: 'critical', status: 'maintenance' }),
      ).body;
      ctx.expect.equal([p.criticality, p.status], ['critical', 'maintenance'], 'criticality and status');
      let r: Json;
      if (ctx.rand.bool(0.15)) {
        ctx.tag('double retire');
        // At once both may succeed (the second finds it retired) or the second is refused: retired exactly once.
        const both = await Promise.all([1, 2].map(() => cmdb.post(`/cmdb/cis/${s.id}/retire`)));
        for (const x of both) ctx.expect.status(x, [200, 409], 'retiring twice at once');
        r = ctx.expect.ok(await cmdb.get(`/cmdb/cis/${s.id}`)).body;
      } else r = ctx.expect.ok(await cmdb.post(`/cmdb/cis/${s.id}/retire`)).body;
      ctx.expect.equal(r.status, 'retired', 'status');
      ctx.expect.equal(await auditCount(ctx, 'cmdb.ci.retired', s.id), 1, 'retirements recorded');
      ctx.expect.code(await cmdb.post(`/cmdb/cis/${s.id}/retire`), 'INVALID_TRANSITION', 409);
    });

    if (ctx.rand.bool(0.5))
      await ctx.step('the configuration manager removes the application', async () => {
        // Another flow's request in approval may name it: then the delete is refused, listing it (decision 93).
        const res = await cmdb.delete(`/cmdb/cis/${cis.app.id}`);
        if (res.status === 409) {
          ctx.expect.code(res, 'IN_USE', 409, 'deleting a CI a request still names');
          ctx.expect.truthy(res.body.error.details?.references?.length, 'the refusal lists what uses it');
          return ctx.tag('still named by a request');
        }
        ctx.tag('deleted');
        ctx.expect.status(res, 204);
        refused(ctx, await cmdb.get(`/cmdb/cis/${cis.app.id}`), 'reading a deleted CI', [404]);
        const rels = ctx.expect.ok(await cmdb.get(`/cmdb/cis/${cis.service.id}/relationships`)).body
          .items as Json[];
        ctx.expect.equal(rels.length, 0, "the service's relationships after the delete");
      });
  },
});

/* ───────────────────────────── ask-it ───────────────────────────── */

/** Server-sent events of a streamed answer. */
function sseEvents(text: unknown): { event: string; data: Json }[] {
  if (typeof text !== 'string') return [];
  const out: { event: string; data: Json }[] = [];
  for (const block of text.split(/\n\n+/)) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (!data.length) continue;
    let parsed: Json = data.join('\n');
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // not JSON
    }
    out.push({ event, data: parsed });
  }
  return out;
}

const QUESTIONS = {
  incident: [
    'My VPN keeps disconnecting every few minutes',
    'Outlook keeps asking for my password',
    'The printer on my floor shows offline',
    'Teams calls freeze when I share my screen',
    '我的筆電無法連上 Wi-Fi',
    'プリンターから印刷できません',
  ],
  service_request: [
    'I need access to the finance share',
    'Please install Visio on my laptop',
    'I would like to order a new laptop',
    'I need a new account for an intern',
  ],
} as const;

export const askIt = defineFlow({
  name: 'ask-it',
  area: 'helpdesk-ai',
  description:
    'Employee asks Ask IS (builtin mode) → answer with a ticket proposal → solved it, or escalated to exactly one linked ticket (retries return it)',
  personas: ['employee', 'agent'],
  async run(ctx) {
    const me = ctx.as('employee');
    const meId = ctx.user('employee').id;
    const stranger = ctx.as(outsiderOf(ctx, 'employee', EMPLOYEES));
    const sfx = ctx.rand.suffix();
    const kind = ctx.rand.weighted([
      ['incident', 3],
      ['service_request', 2],
    ] as const);
    const question = `${ctx.rand.pick(QUESTIONS[kind])} (${sfx})`;

    await ctx.step('Ask IS is in builtin mode', async () => {
      const s = ctx.expect.ok(await me.get('/helpdesk-ai/status')).body;
      ctx.expect.equal([s.ai?.mode, s.virtualAgentEnabled], ['builtin', true], 'mode and availability');
    });

    const conv = await ctx.step('the employee starts a conversation', async () => {
      const c = ctx.expect.status(
        await me.post('/helpdesk-ai/conversations', { locale: ctx.rand.pick(LOCALES) }),
        201,
      ).body;
      ctx.expect.truthy(c.id, 'conversation id');
      return c as Json;
    });
    const C = `/helpdesk-ai/conversations/${conv.id}`;

    const proposal = await ctx.step('and asks a question', async () => {
      ctx.expect.code(await me.post(`${C}/messages`, { content: '' }), 'VALIDATION_FAILED', 400);
      const res = ctx.expect.ok(await me.post(`${C}/messages`, { content: question }, { timeoutMs: 60_000 }));
      const events = sseEvents(res.body);
      const names = events.map((e) => e.event);
      ctx.expect.truthy(names.includes('delta'), `the answer streams (${names.join(',')})`);
      ctx.expect.equal(names.at(-1), 'done', 'the stream ends with done');
      ctx.expect.equal(names.includes('error'), false, 'no error event');
      const done = events.at(-1)!.data;
      ctx.expect.equal(done.mode, 'builtin', 'answered in builtin mode');
      const p = ctx.expect.truthy(events.find((e) => e.event === 'proposal')?.data, 'a ticket proposal');
      ctx.expect.truthy(
        String(p.title).includes(sfx),
        `the proposal is titled after the question (${p.title})`,
      );
      ctx.expect.truthy(['incident', 'service_request'].includes(p.type), 'proposal type');
      ctx.expect.truthy([1, 2, 3].includes(p.urgency), 'proposal urgency');
      return p as Json;
    });

    await ctx.step('the conversation is theirs alone', async () => {
      const c = ctx.expect.ok(await me.get(C)).body;
      ctx.expect.equal(
        [c.status, c.messageCount, (c.messages as Json[]).map((m) => m.role)],
        ['open', 2, ['user', 'assistant']],
        'status, messages',
      );
      ctx.expect.truthy(String(c.title).includes(sfx), 'titled after the question');
      refused(ctx, await stranger.get(C), 'another employee reading it', [404]);
      refused(
        ctx,
        await stranger.post(`${C}/messages`, { content: 'hi' }),
        'another employee posting',
        [404],
      );
      refused(ctx, await stranger.post(`${C}/escalate`, proposal), 'another employee escalating', [404]);
      refused(ctx, await stranger.post(`${C}/resolve`), 'another employee resolving', [404]);
      refused(
        ctx,
        await me.get('/helpdesk-ai/conversations', { query: { scope: 'all' } }),
        'listing everyone’s',
        [403],
      );
      const mine = ctx.expect.ok(await me.get('/helpdesk-ai/conversations', { query: { q: sfx } })).body
        .items as Json[];
      ctx.expect.find(mine, (x) => x.id === conv.id, 'my conversations list it');
    });

    const outcome = ctx.rand.weighted([
      ['escalate', 6],
      ['solved', 3],
    ] as const);
    ctx.tag(outcome);

    if (outcome === 'solved') {
      await ctx.step('"that solved it"', async () => {
        const c = ctx.expect.ok(await me.post(`${C}/resolve`)).body;
        ctx.expect.equal([c.status, c.deflected], ['resolved', true], 'deflected');
        const again = ctx.expect.ok(await me.post(`${C}/resolve`)).body;
        ctx.expect.equal(again.status, 'resolved', 'resolving again changes nothing');
      });
      return;
    }

    if (ctx.rand.bool(0.3))
      await ctx.step('a follow-up question first', async () => {
        const res = ctx.expect.ok(
          await me.post(`${C}/messages`, { content: ctx.rand.sentence(4, 10) }, { timeoutMs: 60_000 }),
        );
        ctx.expect.equal(sseEvents(res.body).at(-1)?.event, 'done', 'the stream ends with done');
      });

    const ticket = await ctx.step('the employee escalates to a ticket', async () => {
      const body = { ...proposal, title: String(proposal.title).slice(0, 200) };
      let res: Json;
      if (ctx.rand.bool(0.2)) {
        ctx.tag('double escalate');
        const both = await Promise.all([1, 2].map(() => me.post(`${C}/escalate`, body)));
        for (const r of both) {
          ctx.expect.truthy(r.status < 500, `no 5xx on a double escalation (${r.status})`);
          if (r.status !== 200)
            ctx.expect.code(r, 'INVALID_STATE', 409, 'a concurrent escalation is "in progress"');
        }
        const oks = both.filter((r) => r.status === 200);
        ctx.expect.truthy(oks.length >= 1, 'one escalation went through');
        if (oks.length === 2)
          ctx.expect.equal(
            oks[0]!.body.ticket?.reference,
            oks[1]!.body.ticket?.reference,
            'both return the same ticket',
          );
        res = oks[0]!.body;
      } else res = ctx.expect.ok(await me.post(`${C}/escalate`, body)).body;
      ctx.expect.match(
        res.ticket?.reference,
        proposal.type === 'incident' ? /^INC-\d+$/ : /^SR-\d+$/,
        'ticket reference',
      );
      ctx.expect.equal(
        [res.conversation?.status, res.conversation?.ticketRef, res.warning ?? null],
        ['escalated', res.ticket.reference, null],
        'the conversation links its ticket',
      );
      return res.ticket as Json;
    });

    await ctx.step('an escalated conversation cannot be marked solved', async () => {
      ctx.expect.code(await me.post(`${C}/resolve`), 'INVALID_STATE', 409);
    });

    await ctx.step('exactly one ticket, raised from the chat for the employee', async () => {
      const t = ctx.expect.ok(await me.get(`${T}/${ticket.reference}`)).body;
      ctx.expect.equal(
        [t.channel, t.requester?.id, t.type, t.viewer?.role],
        ['chat', meId, proposal.type, 'requester'],
        'channel, requester, type, viewer',
      );
      const mine = ctx.expect.ok(await me.get(T, { query: { view: 'mine', q: sfx } })).body.items as Json[];
      ctx.expect.equal(mine.length, 1, 'tickets raised from this conversation');
      const c = ctx.expect.ok(await me.get(C)).body;
      ctx.expect.equal(
        [c.status, c.ticketRef, c.ticketId],
        ['escalated', ticket.reference, ticket.id],
        'the conversation',
      );
      const raised = (c.messages as Json[]).filter(
        (m) => m.role === 'assistant' && String(m.content).includes(ticket.reference),
      );
      ctx.expect.equal(raised.length, 1, 'the "I raised it" message, once');
      const agentView = ctx.expect.ok(await ctx.as('agent').get(`${T}/${ticket.reference}`)).body;
      ctx.expect.equal(agentView.viewer?.role, 'agent', 'the service desk works it');
      refused(
        ctx,
        await stranger.get(`${T}/${ticket.reference}`),
        'another employee reading the ticket',
        [404],
      );
    });

    if (ctx.rand.bool(0.3))
      await ctx.step('later answers propose no second ticket', async () => {
        const res = ctx.expect.ok(
          await me.post(`${C}/messages`, { content: ctx.rand.sentence(3, 8) }, { timeoutMs: 60_000 }),
        );
        const events = sseEvents(res.body);
        ctx.expect.equal(events.at(-1)?.event, 'done', 'the stream ends with done');
        ctx.expect.equal(
          events.some((e) => e.event === 'proposal'),
          false,
          'no proposal once escalated',
        );
      });

    // Last, so a refused retry doesn't hide the checks above.
    await ctx.step('a retried escalation returns the same ticket', async () => {
      const retry = await me.post(`${C}/escalate`, {
        title: `Retry ${sfx}`,
        description: '',
        urgency: 3,
        type: 'incident',
      });
      ctx.expect.ok(
        retry,
        `a retried escalation is not refused (${retry.status} ${retry.body?.error?.code ?? ''})`,
      );
      ctx.expect.equal(retry.body.ticket?.reference, ticket.reference, 'the same ticket');
      const mine = ctx.expect.ok(await me.get(T, { query: { view: 'mine', q: sfx } })).body.items as Json[];
      ctx.expect.equal(mine.length, 1, 'tickets after the retry');
    });
  },
});

/* ───────────────────────────── announcement-publish ───────────────────────────── */

export const announcementPublish = defineFlow({
  name: 'announcement-publish',
  area: 'announcements',
  description:
    'IS communications drafts an announcement → published (once, even on a double click) → every employee sees it → edited → archived',
  personas: ['comms', 'employee', 'auditor', 'admin'],
  async run(ctx) {
    const comms = ctx.as('comms');
    const employee = ctx.as('employee');
    const sfx = ctx.rand.suffix();
    const severity = ctx.rand.pick(['info', 'maintenance', 'incident']);
    ctx.tag(severity);
    const P = '/announcements/posts';

    await ctx.step('employees read but do not post', async () => {
      refused(ctx, await employee.post(P, { title: `x ${sfx}` }), 'an employee posting', [403]);
      refused(ctx, await employee.get(P, { query: { view: 'drafts' } }), 'an employee listing drafts', [403]);
    });

    const windowed = ctx.rand.bool(0.4);
    const post = await ctx.step('the editor drafts an announcement', async () => {
      if (ctx.rand.bool(0.15))
        ctx.expect.code(
          await comms.post(P, { title: `Bad window ${sfx}`, startsAt: isoIn(DAY), endsAt: isoIn(-DAY) }),
          'VALIDATION_FAILED',
          400,
        );
      const p = ctx.expect.status(
        await comms.post(P, {
          title: `${ctx.rand.words(2, 6)} ${sfx}`,
          body: ctx.rand.paragraph(1, 3),
          severity,
          ...(windowed ? { startsAt: isoIn(-MINUTE), endsAt: isoIn(ctx.rand.int(1, 14) * DAY) } : {}),
        }),
        201,
      ).body;
      ctx.expect.equal([p.status, p.severity], ['draft', severity], 'a draft');
      return p as Json;
    });
    const one = `${P}/${post.id}`;

    await ctx.step('employees do not see the draft', async () => {
      refused(ctx, await employee.get(one), 'an employee reading the draft', [404]);
      const current = ctx.expect.ok(await employee.get(P, { query: { view: 'current', q: sfx } })).body
        .items as Json[];
      ctx.expect.equal(current.length, 0, 'current announcements');
    });

    await ctx.step('the editor publishes it', async () => {
      let p: Json;
      if (ctx.rand.bool(0.2)) {
        ctx.tag('double publish');
        const both = await Promise.all([1, 2].map(() => comms.post(`${one}/publish`)));
        for (const r of both) ctx.expect.ok(r, 'publishing (double click)');
        p = both[0]!.body;
      } else p = ctx.expect.ok(await comms.post(`${one}/publish`)).body;
      if (p.status === 'pending') {
        ctx.tag('review');
        const { status } = await ctx.approvals.approveAll(p.reviewInstanceId, { avoid: ['comms'] });
        ctx.expect.equal(status, 'approved', 'the review');
      }
      await ctx.eventually(
        () => comms.get(one),
        (r) => r.body?.status === 'published',
        { label: 'the published announcement' },
      );
    });

    await ctx.step('every employee sees it; it was published once', async () => {
      const p = ctx.expect.ok(await employee.get(one)).body;
      ctx.expect.equal(p.status, 'published', 'status');
      ctx.expect.truthy(p.publishedAt, 'published at');
      const current = ctx.expect.ok(await employee.get(P, { query: { view: 'current', q: sfx } })).body
        .items as Json[];
      ctx.expect.equal(
        current.map((x) => x.id),
        [post.id],
        'current announcements',
      );
      const other = ctx.as(outsiderOf(ctx, 'employee', EMPLOYEES));
      ctx.expect.equal(ctx.expect.ok(await other.get(one)).body.id, post.id, 'another employee sees it too');
      ctx.expect.equal(
        await auditCount(ctx, 'announcements.post.published', post.id),
        1,
        'publications recorded',
      );
    });

    if (ctx.rand.bool(0.4))
      await ctx.step('the editor corrects it', async () => {
        const title = `${ctx.rand.words(2, 6)} ${sfx} (updated)`;
        ctx.expect.ok(await comms.patch(one, { title }));
        ctx.expect.equal(
          ctx.expect.ok(await employee.get(one)).body.title,
          title,
          'employees see the correction',
        );
      });

    await ctx.step('the editor archives it', async () => {
      const a = ctx.expect.ok(await comms.post(`${one}/archive`)).body;
      ctx.expect.equal(a.status, 'archived', 'status');
      const current = ctx.expect.ok(await employee.get(P, { query: { view: 'current', q: sfx } })).body
        .items as Json[];
      ctx.expect.equal(current.length, 0, 'current announcements after archiving');
      const archive = ctx.expect.ok(await employee.get(P, { query: { view: 'archive', q: sfx } })).body
        .items as Json[];
      ctx.expect.find(archive, (x) => x.id === post.id, 'the archive lists it');
      if (ctx.rand.bool(0.3)) {
        ctx.tag('deleted');
        ctx.expect.status(await comms.delete(one), 204);
        refused(ctx, await employee.get(one), 'reading a deleted announcement', [404]);
      }
    });
  },
});
