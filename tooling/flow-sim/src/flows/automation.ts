/**
 * Automation flows: recurring checklists (a scheduled `core.assign-form` job → to-dos → compliance per period),
 * scheduled jobs (HTTP checks against the integration stand-ins: run now, disable, runs and logs), Data APIs and ETL
 * pipelines (an API client's key, a pipeline run through Scheduled Jobs), and the integrations hub (ServiceDesk Plus
 * and Azure DevOps stand-ins: webhooks, runs, a conflict resolved).
 */
import type { Json } from '../client';
import { defineFlow, type FlowContext } from '../flow';
import { exclusive } from '../lock';
import { assertSimDatabase } from '../safety';
import { colleague, day, finishedRun, mock, MOCKS, noticesOf, refused, text3 } from './platform-kit';

/* ───────────────────────────── recurring-checklist ───────────────────────────── */

const TIMEZONES = ['Asia/Taipei', 'Asia/Tokyo', 'Europe/London', 'UTC'];

export const recurringChecklist = defineFlow({
  name: 'recurring-checklist',
  area: 'automation',
  description:
    'A scheduled "assign a form" job → run now (twice) → one to-do per period → the assignee fills it → compliance',
  personas: ['admin', 'employee', 'itlead'],
  timeoutMs: 240_000,
  async run(ctx) {
    const admin = ctx.as('admin');
    const sfx = ctx.rand.suffix();
    const key = `sim-check-${sfx}`.slice(0, 64);
    const period = ctx.rand.weighted([
      ['week', 1],
      ['month', 3],
      ['quarter', 2],
      ['year', 1],
    ] as const);
    const timezone = ctx.rand.pick(TIMEZONES);
    const toGroup = ctx.rand.bool(0.4);
    const first = 'employee';
    const second = colleague(ctx);
    ctx.tag(`each ${period}`);
    ctx.tag(toGroup ? 'to a group' : 'to a person');

    const form = await ctx.step('admin publishes a checklist for the IT admins', async () => {
      const created = ctx.expect.status(
        await admin.post('/forms', { key, name: text3(`Sim checklist ${sfx}`), icon: 'clipboard-check' }),
        201,
      ).body;
      ctx.expect.ok(
        await admin.patch(`/forms/${created.id}`, {
          // Offered to the IT admins only: the assignees open it through their assignment.
          audience: { type: 'groups', groupKeys: ['it-admins'] },
          draft: {
            elements: [
              { id: 'on', key: 'inspectedOn', type: 'date', label: text3('Inspected on'), required: true },
              {
                id: 't',
                key: 'temperature',
                type: 'number',
                label: text3('Temperature'),
                required: true,
                validation: { min: 5, max: 45 },
              },
              { id: 'ok', key: 'ok', type: 'boolean', label: text3('All normal') },
              { id: 'f', key: 'findings', type: 'textarea', label: text3('Findings') },
            ],
          },
        }),
      );
      ctx.expect.ok(await admin.post(`/forms/${created.id}/publish`));
      return created as Json;
    });

    const group = toGroup
      ? await ctx.step('admin makes a group of the two assignees', async () => {
          const g = ctx.expect.status(
            await admin.post('/groups', {
              key: `sim-check-${sfx}`.slice(0, 64),
              name: `Sim checklist ${sfx}`,
            }),
            201,
          ).body;
          ctx.expect.ok(
            await admin.post(`/groups/${g.id}/members`, {
              userIds: [ctx.user(first).id, ctx.user(second).id],
            }),
          );
          return g as Json;
        })
      : null;

    const job = await ctx.step('admin schedules the checklist', async () => {
      const config = {
        formKey: key,
        assignee: group
          ? { type: 'group', groupKey: group.key }
          : { type: 'user', userId: ctx.user(first).id },
        period,
        due: ctx.rand.bool(0.5) ? { type: 'end-of-period' } : { type: 'days', days: ctx.rand.int(3, 14) },
        title: `Sim checklist ${sfx} {{period}}`,
        note: ctx.rand.sentence(4, 10),
      };
      if (ctx.rand.bool(0.15)) {
        ctx.tag('bad form key refused');
        const bad = await admin.post('/scheduler/jobs', {
          name: `Sim checklist ${sfx} (bad)`,
          type: 'core.assign-form',
          config: { ...config, formKey: `sim-nope-${sfx}` },
          trigger: { kind: 'manual' },
        });
        ctx.expect.code(bad, 'VALIDATION_FAILED', 400);
      }
      return ctx.expect.status(
        await admin.post('/scheduler/jobs', {
          name: `Sim checklist ${sfx}`,
          type: 'core.assign-form',
          config,
          trigger: { kind: 'cron', cron: '0 9 1 * *', timezone },
          timeoutSeconds: 60,
        }),
        201,
      ).body as Json;
    });

    const runNow = async (label: string) => {
      const run = ctx.expect.status(await admin.post(`/scheduler/jobs/${job.id}/run`), 201).body;
      return finishedRun(ctx, admin, run.id, label);
    };

    const firstRun = await ctx.step('admin runs it now', async () => {
      if (ctx.rand.bool(0.25)) {
        ctx.tag('run now twice at once');
        const both = await Promise.all([1, 2].map(() => admin.post(`/scheduler/jobs/${job.id}/run`)));
        for (const r of both) ctx.expect.status(r, [201, 409], 'run now');
        const runs = await Promise.all(
          both.filter((r) => r.status === 201).map((r) => finishedRun(ctx, admin, r.body.id, 'the runs')),
        );
        for (const r of runs)
          ctx.expect.truthy(['succeeded', 'skipped'].includes(r.status), `run ${r.status}`);
        return runs.find((r) => r.status === 'succeeded') ?? runs[0];
      }
      const r = await runNow('the first run');
      ctx.expect.equal(r.status, 'succeeded', 'the run');
      // The run's summary is a catalog key with its parameters, shown in each reader's language.
      ctx.expect.equal(r.summary, 'core.taskTypes.assignForm.assigned', 'the run’s summary');
      ctx.expect.match(r.summaryParams?.title, new RegExp(`^Sim checklist ${sfx}`), 'the assigned title');
      return r;
    });

    await ctx.step('running it again in the same period assigns nothing more', async () => {
      const again = await runNow('the second run');
      ctx.expect.equal(again.status, 'succeeded', 'the second run');
      ctx.expect.equal(
        again.summary,
        'core.taskTypes.assignForm.alreadyAssigned',
        'the second run’s summary',
      );
      ctx.expect.truthy(again.summaryParams?.period, 'the period it found already assigned');
      const list = ctx.expect.ok(
        await admin.get(`/forms/${form.id}/assignments`, { query: { pageSize: 50 } }),
      ).body;
      ctx.expect.equal(list.total, 1, 'assignments of the form');
    });

    const todo = await ctx.step('the assignee finds the to-do and is told', async () => {
      const mine = await ctx.eventually(
        () => ctx.as(first).get('/me/form-assignments', { query: { status: 'open', q: sfx } }),
        (r) => r.status === 200 && (r.body.items as Json[]).some((i) => i.form?.key === key),
        { label: 'the to-do' },
      );
      const item = (mine.body.items as Json[]).find((i) => i.form?.key === key);
      ctx.expect.equal(item.source, { type: 'job', id: job.id }, 'it came from the job');
      ctx.expect.truthy(String(item.title).includes(sfx), 'its title');
      await noticesOf(
        ctx,
        first,
        (n) => n.type === 'core.form-assignment.assigned' && String(n.href ?? '').includes(item.id),
        'the "assigned" notification',
      );
      return item as Json;
    });

    await ctx.step('the form opens through the assignment only', async () => {
      refused(ctx, await ctx.as(first).get(`/forms/by-key/${key}`), [404], 'the form without the assignment');
      ctx.expect.ok(await ctx.as(first).get(`/forms/by-key/${key}`, { query: { assignment: todo.id } }));
      const outsider = ctx.as(group ? 'itlead' : second);
      refused(
        ctx,
        await outsider.get(`/me/form-assignments/${todo.id}`),
        [404],
        'someone else opens the assignment',
      );
      refused(
        ctx,
        await outsider.post(`/me/form-assignments/${todo.id}/submissions`, { data: { inspectedOn: day(0) } }),
        [403, 404],
        'someone else fills it in',
      );
    });

    const data = {
      inspectedOn: day(0),
      temperature: ctx.rand.int(15, 30),
      ok: ctx.rand.bool(0.8),
      findings: ctx.rand.bool(0.4) ? ctx.rand.sentence() : undefined,
    };
    await ctx.step('the assignee fills it in', async () => {
      if (ctx.rand.bool(0.2))
        ctx.expect.code(
          await ctx.as(first).post(`/me/form-assignments/${todo.id}/submissions`, {
            data: { ...data, temperature: 99 },
          }),
          'VALIDATION_FAILED',
          400,
          'a temperature out of range',
        );
      const body = { data };
      if (ctx.rand.bool(0.2)) {
        ctx.tag('double submit');
        const both = await Promise.all(
          [1, 2].map(() => ctx.as(first).post(`/me/form-assignments/${todo.id}/submissions`, body)),
        );
        ctx.expect.oneOk(both, 'the to-do is done once', [409]);
      } else
        ctx.expect.status(await ctx.as(first).post(`/me/form-assignments/${todo.id}/submissions`, body), 201);
      const view = ctx.expect.ok(await ctx.as(first).get(`/me/form-assignments/${todo.id}`)).body;
      ctx.expect.equal(view.state, 'done', 'the to-do');
      if (group) {
        const late = await ctx.as(second).post(`/me/form-assignments/${todo.id}/submissions`, body);
        ctx.expect.code(late, 'ASSIGNMENT_CLOSED', 409, 'the other member fills it in too');
      }
    });

    await ctx.step('the period is complete on time', async () => {
      const c = ctx.expect.ok(await admin.get(`/forms/${form.id}/assignments/compliance`)).body;
      const p = ctx.expect.find(
        c.periods as Json[],
        (x) => x.periodKey === todo.periodKey,
        `the period ${todo.periodKey}`,
      );
      ctx.expect.equal([p.total, p.onTime, p.open], [1, 1, 0], 'total, on time, open');
      void firstRun;
    });

    await ctx.step('admin disables and removes the job', async () => {
      const off = ctx.expect.ok(await admin.post(`/scheduler/jobs/${job.id}/disable`)).body;
      ctx.expect.equal(off.enabled, false, 'enabled');
      ctx.expect.status(await admin.delete(`/scheduler/jobs/${job.id}`), [200, 204]);
      refused(ctx, await admin.get(`/scheduler/jobs/${job.id}`), [404], 'the deleted job');
      ctx.expect.ok(await admin.post(`/forms/${form.id}/archive`));
      if (group) ctx.expect.status(await admin.delete(`/groups/${group.id}`), [200, 204, 409]);
    });
  },
});

/* ───────────────────────────── scheduled-jobs ───────────────────────────── */

export const scheduledJobs = defineFlow({
  name: 'scheduled-jobs',
  area: 'automation',
  description:
    'HTTP check jobs against the integration stand-ins: secrets masked, run now, failing checks, disable/enable, runs and logs',
  personas: ['admin', 'employee'],
  async run(ctx) {
    const admin = ctx.as('admin');
    const sfx = ctx.rand.suffix();
    const failing = ctx.rand.bool(0.25);
    const secret = `sim-${sfx}-${ctx.rand.int(100_000, 999_999)}`;
    ctx.tag(failing ? 'failing check' : 'healthy check');

    const job = await ctx.step('admin creates an HTTP check', async () => {
      const res = ctx.expect.status(
        await admin.post('/scheduler/jobs', {
          name: `Sim HTTP check ${sfx}`,
          description: 'The integration stand-ins answer (tooling/flow-sim)',
          type: 'scheduler.http',
          config: {
            method: 'GET',
            url: `${MOCKS}${failing ? `/_mock/nope-${sfx}` : '/_mock/health'}`,
            headers: [{ name: 'X-Sim-Key', value: secret, secret: true }],
            expectedStatus: ctx.rand.pick(['200', '200-299', '2xx']),
            timeoutSeconds: 10,
          },
          trigger: ctx.rand.bool(0.5)
            ? { kind: 'manual' }
            : { kind: 'interval', intervalMinutes: ctx.rand.pick([60, 240, 1440]) },
          retries: { maxAttempts: 1, backoff: 'fixed', delaySeconds: 60 },
          timeoutSeconds: 30,
        }),
        201,
      ).body;
      ctx.expect.match(res.reference, /^JOB-\d+$/, 'reference');
      ctx.expect.equal(res.config.headers[0].value, { secret: true, set: true }, 'the secret header');
      ctx.expect.truthy(!JSON.stringify(res).includes(secret), 'the secret is never returned');
      return res as Json;
    });

    await ctx.step('people without scheduler rights are refused', async () => {
      const employee = ctx.as('employee');
      refused(ctx, await employee.get(`/scheduler/jobs/${job.id}`), [403, 404], 'an employee opens the job');
      refused(ctx, await employee.post(`/scheduler/jobs/${job.id}/run`), [403, 404], 'an employee runs it');
    });

    const runIds: string[] = [];
    const run = await ctx.step('admin runs it now', async () => {
      let started;
      if (ctx.rand.bool(0.2)) {
        ctx.tag('run now twice at once');
        const both = await Promise.all([1, 2].map(() => admin.post(`/scheduler/jobs/${job.id}/run`)));
        for (const r of both) ctx.expect.status(r, [201, 409], 'run now');
        const ok = both.filter((r) => r.status === 201);
        const done = await Promise.all(ok.map((r) => finishedRun(ctx, admin, r.body.id)));
        // Concurrency "skip": the second is skipped while the first runs (or runs after it).
        started = done.find((r) => r.status !== 'skipped') ?? done[0];
        runIds.push(...done.map((r) => r.id as string));
      } else {
        const r = ctx.expect.status(await admin.post(`/scheduler/jobs/${job.id}/run`), 201).body;
        ctx.expect.equal(r.trigger, 'manual', 'trigger');
        started = await finishedRun(ctx, admin, r.id);
        runIds.push(r.id);
      }
      if (failing) {
        ctx.expect.equal(started.status, 'failed', 'the run of a failing check');
        ctx.expect.match(started.error, /404/, 'the error names the status');
      } else {
        ctx.expect.equal([started.status, started.error], ['succeeded', null], 'the run');
        // The summary is a catalog key with the answer as a parameter (the log keeps the plain line).
        ctx.expect.equal(started.summary, 'scheduler.results.http', 'the summary');
        ctx.expect.equal(started.summaryParams?.status, 200, 'the answer the check got');
      }
      return started as Json;
    });

    await ctx.step('the run is listed with its log, the secret masked', async () => {
      const runs = ctx.expect.ok(await admin.get('/scheduler/runs', { query: { jobId: job.id } })).body;
      ctx.expect.find(runs.items as Json[], (r) => r.id === run.id, 'the runs list it');
      const logs = ctx.expect.ok(
        await admin.get(`/scheduler/runs/${run.id}/logs`, { query: { after: 0 } }),
      ).body;
      const text = JSON.stringify(logs);
      ctx.expect.truthy(!text.includes(secret), 'the log never shows the secret');
      ctx.expect.truthy(text.includes(failing ? '404' : 'HTTP 200'), 'the log shows the answer');
      const detail = ctx.expect.ok(await admin.get(`/scheduler/jobs/${job.id}`)).body;
      ctx.expect.truthy(runIds.includes(detail.lastRun?.id), 'the job’s last run is one of its runs');
      ctx.expect.truthy(!JSON.stringify(detail).includes(secret), 'the job never shows the secret');
    });

    await ctx.step('admin disables it, and enables it again', async () => {
      const off = ctx.expect.ok(await admin.post(`/scheduler/jobs/${job.id}/disable`)).body;
      ctx.expect.equal([off.enabled, off.nextRunAt], [false, null], 'enabled, next run');
      const on = ctx.expect.ok(await admin.post(`/scheduler/jobs/${job.id}/enable`)).body;
      ctx.expect.equal(on.enabled, true, 'enabled');
      if (job.trigger.kind === 'interval')
        ctx.expect.truthy(on.nextRunAt, 'an interval job is scheduled again');
    });

    await ctx.step('admin deletes it', async () => {
      ctx.expect.status(await admin.delete(`/scheduler/jobs/${job.id}`), [200, 204]);
      refused(ctx, await admin.get(`/scheduler/jobs/${job.id}`), [404], 'the deleted job');
      refused(ctx, await admin.post(`/scheduler/jobs/${job.id}/run`), [404], 'running the deleted job');
    });
  },
});

/* ───────────────────────────── integration-sync ───────────────────────────── */

const SDP_TICKETS = 'Requests ↔ tickets';
const ADO_TASKS = 'ERP work items ↔ tasks';

export const integrationSync = defineFlow({
  name: 'integration-sync',
  area: 'automation',
  description:
    'ServiceDesk Plus request → ticket by webhook; edits both ways; a conflict resolved; Azure DevOps profile runs',
  personas: ['admin', 'employee'],
  async run(ctx) {
    const admin = ctx.as('admin');
    const sfx = ctx.rand.suffix();
    const profiles = ctx.expect.ok(await admin.get('/integrations/profiles')).body.items as Json[];
    const sdp = ctx.expect.find(
      profiles,
      (p) => p.name === SDP_TICKETS,
      'the ServiceDesk Plus tickets profile',
    );
    const ado = profiles.find((p) => p.name === ADO_TASKS);

    await ctx.step('people without integration rights are refused', async () => {
      refused(
        ctx,
        await ctx.as('employee').get('/integrations/connections'),
        [403],
        'an employee lists connections',
      );
      refused(
        ctx,
        await ctx.as('employee').post(`/integrations/profiles/${sdp.id}/run`),
        [403],
        'an employee runs it',
      );
    });

    const remote = await ctx.step('a technician logs a request in ServiceDesk Plus', async () => {
      const res = await mock('POST', '/_mock/sdp/requests', {
        subject: `Sim sync ${sfx}: ${ctx.rand.words(2, 5)}`,
        description: `<p>${ctx.rand.sentence()}</p>`,
        _by: 'helpdesk@isbp.example',
      });
      ctx.expect.equal(res.status, 201, 'the stand-in took the request');
      return res.body as Json;
    });

    const ticket = await ctx.step('the webhook brings it in as a ticket', async () => {
      if (ctx.rand.bool(0.3)) {
        ctx.tag('run now as well');
        const both = await Promise.all([1, 2].map(() => admin.post(`/integrations/profiles/${sdp.id}/run`)));
        for (const r of both) ctx.expect.status(r, [201, 409], 'run now');
      }
      const found = await ctx.eventually(
        () => admin.get('/itsm/tickets', { query: { q: sfx, view: 'all' } }),
        (r) => r.status === 200 && (r.body.items as Json[]).length > 0,
        { label: 'the synced ticket', timeoutMs: 60_000 },
      );
      const items = found.body.items as Json[];
      ctx.expect.equal(items.length, 1, 'tickets made from the request');
      const t = items[0];
      ctx.expect.equal([t.title, t.channel], [remote.subject, 'integration'], 'title, channel');
      const links = ctx.expect.ok(
        await admin.get('/integrations/links/by-record', { query: { entity: 'itsm.ticket', id: t.id } }),
      ).body.items as Json[];
      ctx.expect.equal(links.length, 1, 'links of the ticket');
      ctx.expect.equal(links[0].remoteRef, `#${remote.display_id}`, 'the remote reference');
      return t as Json;
    });

    const variant = ctx.rand.weighted([
      ['remote edit', 3],
      ['local edit', 3],
      ['conflict', 4],
    ] as const);
    ctx.tag(variant);

    if (variant === 'remote edit')
      await ctx.step('a technician renames it in ServiceDesk Plus; the ticket follows', async () => {
        const subject = `Sim sync ${sfx}: renamed remotely ${ctx.rand.int(1, 999)}`;
        ctx.expect.equal(
          (await mock('POST', `/_mock/sdp/requests/${remote.id}`, { subject })).status,
          200,
          'edit',
        );
        await ctx.eventually(
          () => admin.get(`/itsm/tickets/${ticket.reference}`),
          (r) => r.body?.title === subject,
          { label: 'the pulled title', timeoutMs: 60_000 },
        );
      });

    if (variant === 'local edit')
      await ctx.step('an agent renames the ticket; ServiceDesk Plus follows', async () => {
        const title = `Sim sync ${sfx}: renamed locally ${ctx.rand.int(1, 999)}`;
        ctx.expect.ok(await admin.patch(`/itsm/tickets/${ticket.reference}`, { title }));
        await ctx.eventually(
          () => mock('GET', `/_mock/sdp/requests/${remote.id}`),
          (r) => r.body?.subject === title,
          { label: 'the pushed subject', timeoutMs: 60_000 },
        );
      });

    if (variant === 'conflict') {
      const remoteTitle = `Sim sync ${sfx}: remote side`;
      const localTitle = `Sim sync ${sfx}: local side`;
      const conflict = await ctx.step(
        'both sides rename it before a sync',
        async (): Promise<Json | null> => {
          // The technician's edit fires no webhook (`_silent`), so the agent's push meets it.
          const edited = await mock('POST', `/_mock/sdp/requests/${remote.id}`, {
            subject: remoteTitle,
            _silent: true,
          });
          ctx.expect.equal(edited.status, 200, 'the remote edit');
          // A sync that runs between the two edits (a schedule) brings the remote edit in first: then ours follows it.
          const synced = (await admin.get(`/itsm/tickets/${ticket.reference}`)).body?.title === remoteTitle;
          ctx.expect.ok(await admin.patch(`/itsm/tickets/${ticket.reference}`, { title: localTitle }));
          // Either a conflict (the expected outcome), or one side's edit was silently overwritten.
          const seen = await ctx.eventually(
            async () => {
              const open = await admin.get('/integrations/conflicts', {
                query: { status: 'open', pageSize: 100 },
              });
              const c = ((open.body?.items ?? []) as Json[]).find((x) => x.local?.id === ticket.id);
              if (c) return { conflict: c, local: null, remote: null };
              return {
                conflict: null,
                local: (await admin.get(`/itsm/tickets/${ticket.reference}`)).body?.title as string,
                remote: (await mock('GET', `/_mock/sdp/requests/${remote.id}`)).body?.subject as string,
              };
            },
            (v) => Boolean(v.conflict) || (v.local === v.remote && Boolean(v.local)),
            { label: 'the conflict', timeoutMs: 60_000 },
          );
          if (!seen.conflict && !synced)
            ctx.fail(
              `both sides renamed it, and the ${seen.local === remoteTitle ? 'local' : 'remote'} edit was overwritten without a conflict`,
              {
                local: seen.local,
                remote: seen.remote,
                ticket: ticket.reference,
                remoteRef: remote.display_id,
              },
            );
          if (!seen.conflict) {
            ctx.tag('synced before the local edit');
            ctx.expect.equal(
              [seen.local, seen.remote],
              [localTitle, localTitle],
              'both sides hold the local edit',
            );
            return null;
          }
          const c = seen.conflict;
          ctx.expect.equal(c.fields, ['title'], 'the fields in conflict');
          const links = ctx.expect.ok(
            await admin.get('/integrations/links/by-record', {
              query: { entity: 'itsm.ticket', id: ticket.id },
            }),
          ).body.items as Json[];
          ctx.expect.equal(links[0]?.state, 'conflict', 'the link’s state');
          return c as Json;
        },
      );

      if (conflict) {
        const keep = ctx.rand.pick(['local', 'remote'] as const);
        ctx.tag(`keep ${keep}`);
        await ctx.step(`admin keeps the ${keep} title`, async () => {
          refused(
            ctx,
            await admin.post(`/integrations/conflicts/${conflict.id}/resolve`, { choices: {} }),
            [400, 422],
            'resolving without a choice',
          );
          const body = { choices: { title: keep } };
          if (ctx.rand.bool(0.25)) {
            ctx.tag('double resolve');
            const both = await Promise.all(
              [1, 2].map(() => admin.post(`/integrations/conflicts/${conflict.id}/resolve`, body)),
            );
            ctx.expect.oneOk(both, 'one resolution goes through', [409]);
          } else ctx.expect.ok(await admin.post(`/integrations/conflicts/${conflict.id}/resolve`, body));
          const want = keep === 'local' ? localTitle : remoteTitle;
          await ctx.eventually(
            async () => ({
              local: (await admin.get(`/itsm/tickets/${ticket.reference}`)).body?.title,
              remote: (await mock('GET', `/_mock/sdp/requests/${remote.id}`)).body?.subject,
            }),
            (v) => v.local === want && v.remote === want,
            { label: 'both sides agree', timeoutMs: 60_000 },
          );
          const links = ctx.expect.ok(
            await admin.get('/integrations/links/by-record', {
              query: { entity: 'itsm.ticket', id: ticket.id },
            }),
          ).body.items as Json[];
          ctx.expect.equal(links[0]?.state, 'ok', 'the link’s state');
        });
      }
    }

    if (ado)
      await ctx.step('the Azure DevOps work items profile runs', async () => {
        const res = await admin.post(`/integrations/profiles/${ado.id}/run`);
        ctx.expect.status(res, [201, 409], 'run now');
        if (res.status !== 201) return;
        const done = await ctx.eventually(
          () => admin.get(`/integrations/runs/${res.body.id}`),
          (r) => r.status === 200 && !['queued', 'running'].includes(r.body.status),
          { label: 'the Azure DevOps run', timeoutMs: 60_000 },
        );
        ctx.expect.truthy(['succeeded', 'partial'].includes(done.body.status), `the run ${done.body.status}`);
        ctx.expect.equal(done.body.errorCode, null, 'the run’s error');
      });
  },
});

/* ───────────────────────────── etl-data-api ───────────────────────────── */

/**
 * The simulator's own data connections, made once per database: the demo ERP read-only (`isbp_demo`, the stack's
 * Postgres login from `SIM_PG`, as stack.sh) and a warehouse table in the simulator's own database for pipelines to
 * load (`public.sim_etl_customers`). The seed's demo connections use logins whose passwords another stack's seed may
 * have rotated (the demo database and its roles are shared by every stack on the server).
 */
const SIM_PG = new URL(process.env.SIM_PG ?? 'postgres://isbp:isbp@localhost:5432');
const SIM_DB = process.env.SIM_DB_NAME ?? 'isbp_sim';
const TARGET_TABLE = 'sim_etl_customers';
let etlSetup: Promise<{ ro: string; dw: string }> | null = null;

function ensureEtl(ctx: FlowContext): Promise<{ ro: string; dw: string }> {
  etlSetup ??= exclusive('etl-setup', () => setUpEtl(ctx)).catch((err: unknown) => {
    etlSetup = null;
    throw err;
  });
  return etlSetup;
}

async function setUpEtl(ctx: FlowContext): Promise<{ ro: string; dw: string }> {
  assertSimDatabase(SIM_DB);
  const admin = ctx.as('admin');
  return ctx.step('admin sets up the simulator’s data connections (once)', async () => {
    const existing = ctx.expect.ok(await admin.get('/databases')).body.items as Json[];
    const connection = async (key: string, name: string, database: string, readOnly: boolean) => {
      const found = existing.find((c) => c.key === key);
      if (found) return found.id as string;
      const created = ctx.expect.status(
        await admin.post('/databases', {
          key,
          name,
          description: 'Flow simulation (tooling/flow-sim)',
          engine: 'postgres',
          host: SIM_PG.hostname,
          port: Number(SIM_PG.port || 5432),
          database,
          username: decodeURIComponent(SIM_PG.username),
          password: decodeURIComponent(SIM_PG.password),
          purposes: ['data'],
          readOnly,
          options: { tls: 'off', ca: null, instanceName: null, domain: null },
        }),
        201,
      ).body;
      const test = ctx.expect.ok(await admin.post(`/databases/${created.id}/test`)).body;
      ctx.expect.equal(test.ok, true, `the ${key} connection works`);
      return created.id as string;
    };
    const ro = await connection('sim-erp-ro', 'Flow simulation · ERP (read-only)', 'isbp_demo', true);
    const dw = await connection('sim-dw', 'Flow simulation · warehouse', SIM_DB, false);
    // The warehouse table, made by a one-off SQL job (one statement, idempotent).
    const job = ctx.expect.status(
      await admin.post('/scheduler/jobs', {
        name: 'Sim: warehouse table for pipelines',
        type: 'scheduler.sql',
        config: {
          connectionId: dw,
          mode: 'execute',
          statement: `CREATE TABLE IF NOT EXISTS public.${TARGET_TABLE} (run text NOT NULL, code text NOT NULL, name text, region text, PRIMARY KEY (run, code))`,
        },
        trigger: { kind: 'manual' },
        timeoutSeconds: 60,
      }),
      201,
    ).body;
    const run = ctx.expect.status(await admin.post(`/scheduler/jobs/${job.id}/run`), 201).body;
    const done = await finishedRun(ctx, admin, run.id, 'the table');
    ctx.expect.equal([done.status, done.error], ['succeeded', null], 'creating the warehouse table');
    ctx.expect.status(await admin.delete(`/scheduler/jobs/${job.id}`), [200, 204]);
    return { ro, dw };
  });
}

const REGIONS = ['north', 'south', 'east', 'west', 'central'];

export const etlDataApi = defineFlow({
  name: 'etl-data-api',
  area: 'automation',
  description:
    'A Data API (draft → test → publish) called with an API client’s key; a pipeline run (directly or as a scheduled job)',
  personas: ['admin', 'employee'],
  timeoutMs: 300_000,
  async run(ctx) {
    const admin = ctx.as('admin');
    const sfx = ctx.rand.suffix();
    const slug = `sim-cust-${sfx}`.slice(0, 60);
    const region = ctx.rand.pick(REGIONS);
    const { ro, dw } = await ensureEtl(ctx);

    await ctx.step('admin drafts, tests and publishes a Data API', async () => {
      ctx.expect.status(
        await admin.post('/etl/endpoints', { name: `Sim customers ${sfx}`, slug, connectionId: ro }),
        201,
      );
      const draft = {
        method: 'GET',
        connectionId: ro,
        kind: 'query',
        sql: 'SELECT code, name, region FROM erp.customers WHERE region = :region ORDER BY code LIMIT :limit',
        params: [
          { name: 'region', type: 'string', required: true, enum: REGIONS },
          { name: 'limit', type: 'integer', default: '10', min: 1, max: 100 },
        ],
        responseShape: 'rows',
        maxRows: 100,
        timeoutMs: 10_000,
        cacheTtlSeconds: ctx.rand.pick([0, 0, 30]),
      };
      ctx.expect.ok(await admin.patch(`/etl/endpoints/${slug}`, { draft }));
      ctx.expect.code(
        await admin.post(`/etl/endpoints/${slug}/publish`, {}),
        'TEST_REQUIRED',
        409,
        'publishing untested',
      );
      const test = ctx.expect.ok(
        await admin.post(`/etl/endpoints/${slug}/test`, { params: { region, limit: '5' } }),
      ).body;
      ctx.expect.equal(test.ok, true, 'the test');
      ctx.expect.truthy((test.rows as Json[]).length > 0, 'the test returns rows');
      const pub = ctx.expect.ok(
        await admin.post(`/etl/endpoints/${slug}/publish`, { note: `Sim ${sfx}` }),
      ).body;
      ctx.expect.equal(pub.latestVersion ?? pub.version, 1, 'the published version');
    });

    const client = await ctx.step('admin gives a reporting robot a key and allows it', async () => {
      const res = ctx.expect.status(
        await admin.post('/api-clients', { name: `Sim robot ${sfx}`, permissions: ['etl.endpoints.invoke'] }),
        201,
      ).body;
      refused(
        ctx,
        await admin.get(`/etl/data/${slug}`, { query: { region }, bearer: res.secret }),
        [403],
        'a client not allowed yet',
      );
      ctx.expect.ok(await admin.patch(`/etl/endpoints/${slug}`, { allowedClients: [res.client.id] }));
      return { id: res.client.id as string, key: res.secret as string };
    });

    await ctx.step('the robot calls it with its key', async () => {
      const limit = ctx.rand.int(1, 20);
      const call = () => admin.get(`/etl/data/${slug}`, { query: { region, limit }, bearer: client.key });
      const res = ctx.expect.ok(await call(), 'the call').body;
      ctx.expect.truthy(
        (res.data as Json[]).length > 0 && (res.data as Json[]).length <= limit,
        'rows within the limit',
      );
      ctx.expect.truthy(
        (res.data as Json[]).every((r) => r.region === region),
        'only the region asked for',
      );
      ctx.expect.equal(res.meta?.version, 1, 'the version answered');
      if (ctx.rand.bool(0.3)) {
        ctx.tag('three calls at once');
        for (const r of await Promise.all([1, 2, 3].map(call))) ctx.expect.ok(r, 'each call');
      }
      const bad = await admin.get(`/etl/data/${slug}`, {
        query: { region: 'nowhere', limit: 'x' },
        bearer: client.key,
      });
      ctx.expect.code(bad, 'VALIDATION_FAILED', 400, 'bad parameters');
      refused(
        ctx,
        await ctx.as('employee').get(`/etl/data/${slug}`, { query: { region } }),
        [403],
        'an employee calls it',
      );
      refused(
        ctx,
        await admin.get(`/etl/data/sim-nope-${sfx}`, { bearer: client.key }),
        [403, 404],
        'an unknown API',
      );
    });

    const viaJob = ctx.rand.bool(0.4);
    ctx.tag(viaJob ? 'pipeline as a scheduled job' : 'pipeline run now');
    const pipeline = await ctx.step('admin builds a pipeline into the warehouse', async () => {
      return ctx.expect.status(
        await admin.post('/etl/pipelines', {
          name: `Sim load ${sfx}`,
          description: 'Customers of a region into the simulator’s warehouse table',
          source: {
            connectionId: ro,
            sql: 'SELECT code, name, region, :tag::text AS run FROM erp.customers WHERE region = :region',
            params: { tag: sfx, region },
          },
          target: {
            connectionId: dw,
            schema: 'public',
            table: TARGET_TABLE,
            mode: 'upsert',
            keys: ['run', 'code'],
          },
          mappings: ['run', 'code', 'name', 'region'].map((c) => ({ source: c, target: c })),
          batchSize: ctx.rand.pick([50, 200, 500]),
        }),
        201,
      ).body as Json;
    });

    const pipelineRun = async (label: string) => {
      if (viaJob) {
        const job = ctx.expect.status(
          await admin.post('/scheduler/jobs', {
            name: `Sim pipeline ${sfx}`,
            type: 'etl.pipeline',
            config: { pipelineId: pipeline.id },
            trigger: { kind: 'manual' },
            timeoutSeconds: 120,
          }),
          201,
        ).body;
        const run = ctx.expect.status(await admin.post(`/scheduler/jobs/${job.id}/run`), 201).body;
        const done = await finishedRun(ctx, admin, run.id, label);
        ctx.expect.equal([done.status, done.error], ['succeeded', null], 'the job run');
        ctx.expect.status(await admin.delete(`/scheduler/jobs/${job.id}`), [200, 204]);
        const runs = ctx.expect.ok(await admin.get(`/etl/pipelines/${pipeline.id}/runs`)).body
          .items as Json[];
        return runs[0];
      }
      const both = ctx.rand.bool(0.25);
      if (both) ctx.tag('run twice at once');
      const started = await Promise.all(
        (both ? [1, 2] : [1]).map(() => admin.post(`/etl/pipelines/${pipeline.id}/run`)),
      );
      // "Run now" answers 202 (queued); the pipeline runs once at a time (409 JOB_RUNNING).
      const ok = both
        ? ctx.expect.oneOk(started, 'one run at a time', [409])
        : ctx.expect.status(started[0]!, [201, 202]);
      return (
        await ctx.eventually(
          () => admin.get(`/etl/pipelines/${pipeline.id}/runs/${ok.body.id}`),
          (r) => r.status === 200 && !['queued', 'running'].includes(r.body.status),
          { label, timeoutMs: 120_000 },
        )
      ).body;
    };

    // A failed load is reported after the cleanup below (the pipeline, the API and the key never outlive the run).
    let failure: unknown = null;
    await ctx
      .step('the pipeline loads the region, and loads it again unchanged', async () => {
        const first = await pipelineRun('the pipeline run');
        ctx.expect.equal([first.status, first.error], ['succeeded', null], 'the run');
        ctx.expect.truthy(first.rowsRead > 0, 'rows read');
        ctx.expect.equal([first.rowsWritten, first.rowsRejected], [first.rowsRead, 0], 'written, rejected');
        if (ctx.rand.bool(0.4)) {
          ctx.tag('second load');
          const second = await pipelineRun('the second run');
          ctx.expect.equal([second.status, second.rowsRead], ['succeeded', first.rowsRead], 'the second run');
        }
      })
      .catch((err: unknown) => {
        failure = err;
      });

    await ctx.step('admin removes the pipeline, the API and the key', async () => {
      // A pipeline that is running can't be deleted: wait for its runs to end.
      const gone = await ctx.eventually(
        () => admin.delete(`/etl/pipelines/${pipeline.id}`),
        (r) => r.status !== 409,
        { label: 'the pipeline’s runs to end', timeoutMs: 120_000, intervalMs: 1_000 },
      );
      ctx.expect.status(gone, [200, 204]);
      ctx.expect.status(await admin.delete(`/etl/endpoints/${slug}`), [200, 204]);
      ctx.expect.ok(await admin.post(`/api-clients/${client.id}/revoke`));
      refused(
        ctx,
        await admin.get(`/etl/data/${slug}`, { query: { region }, bearer: client.key }),
        [401, 403, 404],
        'the revoked key',
      );
    });
    if (failure) throw failure;
  },
});
