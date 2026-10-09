/**
 * Delivery flows: a project from its proposal (approved by the owner's manager when it is large) through milestones,
 * tasks, health updates and membership to completion; and an application's release deployed through its
 * environments, production only with an authorized ITSM change, then rolled back.
 */
import { createHash } from 'node:crypto';
import type { Json } from '../client';
import { defineFlow } from '../flow';
import {
  EMPLOYEES,
  implementAndClose,
  isoIn,
  itemsOf,
  notificationsAbout,
  raiseChange,
  refused,
} from './service-desk';

const T = '/itsm/tickets';
const MINUTE = 60_000;
const DAY = 86_400_000;

/** `n` base-36 characters derived from a run suffix: unique keys where the suffix itself doesn't fit. */
const hashOf = (s: string, n: number) =>
  BigInt(`0x${createHash('sha256').update(s).digest('hex').slice(0, 16)}`)
    .toString(36)
    .padStart(n, '0')
    .slice(0, n);

const isoDate = (ms: number) => new Date(Date.now() + ms).toISOString().slice(0, 10);

/* ───────────────────────────── project-proposal ───────────────────────────── */

export const projectProposal = defineFlow({
  name: 'project-proposal',
  area: 'projects',
  description:
    'PM proposes a project → started (large ones approved or rejected by their manager) → members, milestones, tasks moved and completed, health update → completed',
  personas: ['pm', 'itlead', 'employee', 'admin'],
  timeoutMs: 240_000,
  async run(ctx) {
    const pm = ctx.as('pm');
    const pmId = ctx.user('pm').id;
    const member = ctx.as('employee');
    const memberId = ctx.user('employee').id;
    const others = EMPLOYEES.filter((e) => e !== ctx.personaOf(memberId));
    const [viewerName, outsiderName] = ctx.rand.shuffle(others);
    const viewer = ctx.as(viewerName!);
    const viewerId = ctx.user(viewerName!).id;
    const stranger = ctx.as(outsiderName!);
    const sfx = ctx.rand.suffix();
    const key = `S${hashOf(sfx, 9).toUpperCase()}`;
    const large = ctx.rand.bool(0.5);
    const budgetHours = large ? ctx.rand.int(401, 3000) : ctx.rand.pick([null, ctx.rand.int(0, 400)]);
    const visibility = ctx.rand.weighted([
      ['internal', 3],
      ['private', 2],
    ] as const);
    ctx.tag(large ? 'large' : 'small');
    ctx.tag(visibility);
    const P = `/projects/projects/${key}`;

    await ctx.step('an employee cannot propose projects', async () => {
      refused(
        ctx,
        await member.post('/projects/projects', {
          name: `x ${sfx}`,
          key: `X${hashOf(sfx, 5).toUpperCase()}`,
        }),
        'an employee proposing',
        [403],
      );
    });

    await ctx.step('the PM proposes the project', async () => {
      const start = ctx.rand.int(0, 30) * DAY;
      const body = {
        name: `${ctx.rand.words(2, 5)} ${sfx}`,
        key: ctx.rand.bool(0.3) ? key.toLowerCase() : key,
        description: ctx.rand.paragraph(1, 2),
        priority: ctx.rand.pick(['high', 'medium', 'low']),
        visibility,
        startDate: isoDate(start),
        targetDate: isoDate(start + ctx.rand.int(14, 200) * DAY),
        budgetHours,
      };
      if (ctx.rand.bool(0.1))
        ctx.expect.code(
          await pm.post('/projects/projects', {
            ...body,
            startDate: body.targetDate,
            targetDate: body.startDate,
          }),
          'VALIDATION_FAILED',
          400,
        );
      const p = ctx.expect.status(await pm.post('/projects/projects', body), 201).body;
      ctx.expect.equal(
        [p.key, p.status, p.owner?.id, p.myRole, p.viewer?.canStart, p.visibility],
        [key, 'proposed', pmId, 'manager', true, visibility],
        'key, status, owner, role, can start, visibility',
      );
      ctx.expect.equal(
        (p.members as Json[]).map((m) => [m.userId, m.role, m.isOwner]),
        [[pmId, 'manager', true]],
        'the PM is the only member',
      );
      if (ctx.rand.bool(0.1)) ctx.expect.code(await pm.post('/projects/projects', body), 'CONFLICT', 409);
      return p as Json;
    });

    const started = await ctx.step('the PM starts it (submits the proposal)', async () => {
      let p: Json;
      if (ctx.rand.bool(0.15)) {
        ctx.tag('double start');
        const both = await Promise.all([1, 2].map(() => pm.post(`${P}/start`)));
        p = ctx.expect.oneOk(both, 'one submission goes through', [409]).body;
      } else p = ctx.expect.ok(await pm.post(`${P}/start`)).body;
      if (large) {
        ctx.expect.equal(
          [p.status, p.approval?.status, p.viewer?.canStart],
          ['proposed', 'pending', false],
          'waiting for approval',
        );
        ctx.expect.truthy(p.approval?.instanceId, 'the approval');
      } else
        ctx.expect.equal(
          [p.status, p.approval?.status],
          ['active', 'approved'],
          'a small project starts at once',
        );
      return p;
    });

    if (large) {
      const instanceId = started.approval.instanceId as string;
      const reject = ctx.rand.bool(0.2);
      if (reject) {
        ctx.tag('rejected');
        const comment = ctx.rand.sentence(3, 8);
        await ctx.step('their manager rejects it', async () => {
          ctx.expect.equal(
            await ctx.approvals.decide(instanceId, 'itlead', 'reject', { comment }),
            'rejected',
            'outcome',
          );
          const p = await ctx.eventually(
            () => pm.get(P),
            (r) => r.body?.approval?.status === 'rejected',
            { label: 'the rejected proposal' },
          );
          ctx.expect.equal(
            [p.body.status, p.body.approval?.comment, p.body.viewer?.canStart],
            ['proposed', comment, true],
            'still proposed, with the reason',
          );
        });
        await ctx.step('the PM cuts it down and starts it again', async () => {
          ctx.expect.ok(await pm.patch(P, { budgetHours: ctx.rand.int(10, 400) }));
          const p = ctx.expect.ok(await pm.post(`${P}/start`)).body;
          ctx.expect.equal(
            [p.status, p.approval?.status],
            ['active', 'approved'],
            'now small enough to start',
          );
        });
      } else {
        await ctx.step('their manager approves it', async () => {
          const twice = ctx.rand.bool(0.15);
          if (twice) ctx.tag('double approve');
          ctx.expect.equal(
            await ctx.approvals.decide(instanceId, 'itlead', 'approve', { twice }),
            'approved',
            'outcome',
          );
          const p = await ctx.eventually(
            () => pm.get(P),
            (r) => {
              // The page reads the project twice (not in one snapshot): mid-commit it can show both states mixed.
              if (r.body?.status === 'active' && r.body?.approval?.status === 'pending')
                ctx.tag('active but approval pending (read skew)');
              return r.body?.status === 'active' && r.body?.approval?.status === 'approved';
            },
            { label: 'the active project' },
          );
          ctx.expect.equal(p.body.approval?.status, 'approved', 'approval');
          const told = await ctx.eventually(
            () => notificationsAbout(pm, 'projects.proposal.decided', key),
            (n) => n.length >= 1,
            { label: 'the decision notification' },
          );
          ctx.expect.equal(told.length, 1, '"proposal decided" notifications');
        });
      }
    }

    await ctx.step('the PM adds a member and a viewer', async () => {
      const m = ctx.expect.status(
        await pm.post(`${P}/members`, {
          userId: memberId,
          role: 'member',
          allocationPct: ctx.rand.pick([25, 50, 100]),
        }),
        201,
      ).body;
      ctx.expect.find(m.items as Json[], (x) => x.userId === memberId && x.role === 'member', 'the member');
      ctx.expect.status(
        await pm.post(`${P}/members`, { userId: viewerId, role: 'viewer', allocationPct: 0 }),
        201,
      );
      ctx.expect.code(await pm.post(`${P}/members`, { userId: memberId, role: 'member' }), 'CONFLICT', 409);
      refused(
        ctx,
        await member.post(`${P}/members`, { userId: viewerId, role: 'manager' }),
        'a member adding people',
        [403],
      );
    });

    await ctx.step(
      visibility === 'private' ? 'outsiders cannot find it' : 'outsiders read it only',
      async () => {
        if (visibility === 'private') {
          refused(ctx, await stranger.get(P), 'an outsider reading a private project', [404]);
          const list = ctx.expect.ok(await stranger.get('/projects/projects', { query: { q: sfx } })).body
            .items as Json[];
          ctx.expect.equal(list.length, 0, 'private projects an outsider lists');
        } else {
          const p = ctx.expect.ok(await stranger.get(P)).body;
          ctx.expect.equal(
            [p.viewer?.role, p.viewer?.canEditTasks, p.viewer?.canComment],
            [null, false, false],
            'read only',
          );
        }
        refused(ctx, await stranger.post(`${P}/tasks`, { title: 'x' }), 'an outsider adding a task');
      },
    );

    const milestones = await ctx.step('the PM plans milestones', async () => {
      const n = ctx.rand.int(1, 3);
      let items: Json[] = [];
      for (let i = 0; i < n; i++)
        items = ctx.expect.status(
          await pm.post(`${P}/milestones`, {
            name: `M${i + 1} ${ctx.rand.words(1, 3)}`,
            dueDate: isoDate((i + 1) * 14 * DAY),
          }),
          201,
        ).body.items as Json[];
      ctx.expect.equal(items.length, n, 'milestones');
      refused(ctx, await member.post(`${P}/milestones`, { name: 'x' }), 'a member adding a milestone', [403]);
      return items;
    });

    const tasks = await ctx.step('the PM creates and assigns tasks (some at once)', async () => {
      const n = ctx.rand.int(2, 5);
      const bodies = Array.from({ length: n }, () => ({
        title: `${ctx.rand.words(2, 5)} ${sfx}`,
        type: ctx.rand.pick(['task', 'story', 'bug', 'feature']),
        priority: ctx.rand.pick(['urgent', 'high', 'medium', 'low']),
        assigneeId: ctx.rand.pick([memberId, pmId, null]),
        milestoneId: ctx.rand.pick(milestones).id,
        estimateHours: ctx.rand.int(1, 40),
        dueDate: ctx.rand.bool(0.5) ? isoDate(ctx.rand.int(1, 60) * DAY) : undefined,
      }));
      const created = ctx.rand.bool(0.4)
        ? (ctx.tag('tasks created at once'), await Promise.all(bodies.map((b) => pm.post(`${P}/tasks`, b))))
        : await (async () => {
            const out = [];
            for (const b of bodies) out.push(await pm.post(`${P}/tasks`, b));
            return out;
          })();
      const rows = created.map((r) => ctx.expect.status(r, 201, 'a new task').body);
      const refs = rows.map((r) => r.reference as string);
      ctx.expect.equal(new Set(refs).size, n, 'task references are unique');
      for (const r of refs) ctx.expect.match(r, new RegExp(`^${key}-\\d+$`), 'task reference');
      ctx.expect.code(
        await pm.post(`${P}/tasks`, { title: `x ${sfx}`, assigneeId: viewerId }),
        'VALIDATION_FAILED',
        400,
      );
      return rows as Json[];
    });

    await ctx.step('the member works the tasks; the viewer comments only', async () => {
      const first = tasks[0]!;
      if (tasks.length >= 2 && ctx.rand.bool(0.3)) {
        ctx.tag('blocked task');
        const [a, b] = [tasks[0]!, tasks[1]!];
        ctx.expect.status(
          await member.post(`/projects/tasks/${b.reference}/dependencies`, { dependsOn: a.reference }),
          201,
        );
        const blocked = await member.post(`/projects/tasks/${b.reference}/move`, { status: 'in_progress' });
        ctx.expect.code(blocked, 'INVALID_STATE', 409);
        ctx.expect.equal(blocked.body.error?.details?.reason, 'blocked', 'reason');
      }
      const moved = ctx.expect.ok(
        await member.post(`/projects/tasks/${first.reference}/move`, { status: 'in_progress' }),
      ).body;
      ctx.expect.equal(moved.status, 'in_progress', 'status');
      ctx.expect.status(
        await member.post(`/projects/tasks/${first.reference}/comments`, { body: ctx.rand.sentence() }),
        201,
      );
      ctx.expect.status(
        await viewer.post(`/projects/tasks/${first.reference}/comments`, { body: ctx.rand.sentence() }),
        201,
      );
      refused(
        ctx,
        await viewer.patch(`/projects/tasks/${first.reference}`, { title: 'x' }),
        'the viewer editing a task',
        [403],
      );
      refused(ctx, await viewer.post(`${P}/tasks`, { title: 'x' }), 'the viewer adding a task', [403]);
      const board = ctx.expect.ok(await member.get(`${P}/board`)).body;
      const col = ctx.expect.find(
        board.columns as Json[],
        (c) => c.status === 'in_progress',
        'the in-progress column',
      );
      ctx.expect.find(
        col.tasks as Json[],
        (t) => t.reference === first.reference,
        'the board shows it in progress',
      );
    });

    const doneCount = await ctx.step('tasks are completed', async () => {
      const done = ctx.rand.sample(tasks, 1, tasks.length);
      for (const t of done) {
        const r = ctx.expect.ok(
          await member.post(`/projects/tasks/${t.reference}/move`, { status: 'done' }),
        ).body;
        ctx.expect.equal(r.status, 'done', 'status');
        const d = ctx.expect.ok(await member.get(`/projects/tasks/${t.reference}`)).body;
        ctx.expect.truthy(d.completedAt, 'completed at');
      }
      const p = ctx.expect.ok(await pm.get(P)).body;
      ctx.expect.equal([p.totalTasks, p.doneTasks], [tasks.length, done.length], 'task counts');
      return done.length;
    });

    await ctx.step('the PM reports the health', async () => {
      const health = ctx.rand.pick(['at_risk', 'off_track', 'on_track']);
      const note = ctx.rand.sentence(3, 10);
      refused(ctx, await member.post(`${P}/health`, { health, note }), 'a member reporting health', [403]);
      ctx.expect.code(await pm.post(`${P}/health`, { health }), 'VALIDATION_FAILED', 400);
      const p = ctx.expect.ok(await pm.post(`${P}/health`, { health, note })).body;
      ctx.expect.equal(
        [p.health, p.healthNote, p.updates?.[0]?.kind],
        [health, note, 'health'],
        'health and update',
      );
      if (health !== 'on_track') {
        ctx.tag(`health ${health}`);
        const told = await ctx.eventually(
          () => notificationsAbout(member, 'projects.project.health_changed', key),
          (n) => n.length >= 1,
          { label: 'the health notification' },
        );
        ctx.expect.equal(told.length, 1, 'health notifications to the member');
      }
    });

    const leaves = ctx.rand.bool(0.3);
    if (leaves)
      await ctx.step('the member leaves; their open tasks are unassigned', async () => {
        ctx.tag('member leaves');
        ctx.expect.status(await member.delete(`${P}/members/${memberId}`), 204);
        const open = itemsOf(
          ctx.expect.ok(
            await pm.get('/projects/tasks', { query: { project: key, status: 'open', pageSize: 50 } }),
          ),
        );
        ctx.expect.equal(
          open.filter((t) => t.assignee?.id === memberId).length,
          0,
          'open tasks still assigned to them',
        );
        ctx.expect.code(await pm.delete(`${P}/members/${pmId}`), 'INVALID_STATE', 409);
      });

    await ctx.step('the PM completes the project', async () => {
      const open = tasks.length - doneCount;
      if (open > 0) {
        ctx.expect.code(await pm.post(`${P}/status`, { status: 'completed' }), 'INVALID_STATE', 409);
        ctx.expect.code(
          await pm.post(`${P}/status`, { status: 'completed', force: true }),
          'COMMENT_REQUIRED',
          400,
        );
      }
      if (ctx.rand.bool(0.3)) {
        ctx.tag('on hold');
        ctx.expect.equal(
          ctx.expect.ok(await pm.post(`${P}/status`, { status: 'on_hold' })).body.status,
          'on_hold',
          'status',
        );
        ctx.expect.code(await pm.post(`${P}/status`, { status: 'completed' }), 'INVALID_TRANSITION', 409);
        ctx.expect.ok(await pm.post(`${P}/status`, { status: 'active' }));
      }
      const p = ctx.expect.ok(
        await pm.post(`${P}/status`, {
          status: 'completed',
          ...(open > 0 ? { force: true, comment: ctx.rand.sentence(3, 8) } : {}),
        }),
      ).body;
      ctx.expect.equal(p.status, 'completed', 'status');
      ctx.expect.truthy(p.completedAt, 'completed at');
      ctx.expect.equal(p.viewer?.transitions ?? [], [], 'nothing follows completion');
    });
  },
});

/* ───────────────────────────── alm-release-deploy ───────────────────────────── */

export const almReleaseDeploy = defineFlow({
  name: 'alm-release-deploy',
  area: 'alm',
  description:
    'Release manager registers an application, environments and a release → test deployments → production needs an authorized change (CAB) → released → rolled back',
  personas: ['releasemgr', 'changemgr', 'cab', 'employee', 'admin'],
  timeoutMs: 240_000,
  async run(ctx) {
    const rm = ctx.as('releasemgr');
    const rmId = ctx.user('releasemgr').id;
    const cm = ctx.as('changemgr');
    const employee = ctx.as('employee');
    const sfx = ctx.rand.suffix();
    const code = `sim-${hashOf(sfx, 10)}`;
    const A = `/alm/applications/${code}`;

    await ctx.step('employees have no access to ALM', async () => {
      refused(ctx, await employee.get('/alm/applications'), 'an employee listing applications', [403]);
      refused(
        ctx,
        await employee.post('/alm/deployments', { application: code, environment: 'Test', version: '1.0.0' }),
        'an employee deploying',
        [403],
      );
    });

    await ctx.step('the release manager registers the application', async () => {
      const body = {
        code,
        name: `${ctx.rand.words(1, 3)} ${sfx}`,
        stage: 'development',
        criticality: ctx.rand.pick(['critical', 'high', 'medium', 'low']),
        hosting: ctx.rand.pick(['on_prem', 'cloud', 'saas', 'hybrid']),
        technicalOwnerId: rmId,
        techStack: ctx.rand.sample(['Java 21', 'PostgreSQL', 'React', 'Node.js', '.NET 9', 'Redis'], 1, 4),
      };
      const a = ctx.expect.status(await rm.post('/alm/applications', body), 201).body;
      ctx.expect.equal(
        [a.code, a.stage, a.viewer?.canEdit, a.productionVersion],
        [code, 'development', true, null],
        'the application',
      );
      if (ctx.rand.bool(0.1)) ctx.expect.code(await rm.post('/alm/applications', body), 'CONFLICT', 409);
      return a as Json;
    });

    await ctx.step('its environments', async () => {
      const envs: [string, string][] = [
        ['Development', 'development'],
        ['Test', 'test'],
        ...(ctx.rand.bool(0.6) ? ([['Staging', 'staging']] as [string, string][]) : []),
        ['Production', 'production'],
      ];
      for (const [name, kind] of envs) {
        const e = ctx.expect.status(
          await rm.post(`${A}/environments`, {
            name,
            kind,
            url: `https://${name.toLowerCase()}.${code}.example.com`,
          }),
          201,
        ).body;
        ctx.expect.equal([e.name, e.kind, e.currentVersion], [name, kind, null], 'environment');
      }
      ctx.expect.code(await rm.post(`${A}/environments`, { name: 'Test', kind: 'test' }), 'CONFLICT', 409);
      ctx.expect.code(
        await rm.post(`${A}/environments`, { name: 'Plain', kind: 'test', url: 'http://plain.example.com' }),
        'VALIDATION_FAILED',
        400,
      );
    });

    const release = await ctx.step('a release is planned', async () => {
      ctx.expect.code(await rm.post(`${A}/releases`, { version: 'bad version' }), 'VALIDATION_FAILED', 400);
      const r = ctx.expect.status(
        await rm.post(`${A}/releases`, {
          version: '1.0.0',
          name: ctx.rand.words(1, 3),
          plannedDate: isoDate(7 * DAY),
          notes: ctx.rand.paragraph(1, 2),
        }),
        201,
      ).body;
      ctx.expect.equal([r.status, r.readiness?.total, r.changes], ['planned', 4, []], 'a planned release');
      ctx.expect.code(await rm.post(`${A}/releases`, { version: '1.0.0' }), 'CONFLICT', 409);
      return r as Json;
    });

    const deploy = (environment: string, version: string, extra: Json = {}) =>
      rm.post('/alm/deployments', {
        application: code,
        environment,
        version,
        commitSha: hashOf(`${sfx}${version}`, 12).replace(/[^0-9a-f]/g, 'a'),
        ...extra,
      });

    await ctx.step('it is deployed to test (and staging)', async () => {
      for (const env of ['Test', 'Staging']) {
        const res = await deploy(env, '1.0.0');
        if (env === 'Staging' && res.status === 400) continue; // no staging environment this run
        const d = ctx.expect.status(res, 201, `deploying to ${env}`).body;
        ctx.expect.equal(
          [d.status, d.release?.id, d.policy?.outcome, d.policy?.applies, d.actor?.id],
          ['succeeded', release.id, 'allow', false, rmId],
          'a test deployment',
        );
      }
      const envs = itemsOf(ctx.expect.ok(await rm.get(`${A}/environments`)));
      ctx.expect.equal(
        envs.find((e) => e.name === 'Test')?.currentVersion,
        '1.0.0',
        'the test environment runs 1.0.0',
      );
    });

    await ctx.step('production refuses a deployment without a change', async () => {
      const res = await deploy('Production', '1.0.0');
      ctx.expect.code(res, 'CHANGE_REQUIRED', 409);
      ctx.expect.equal(
        [res.body.error?.details?.reason, res.body.error?.details?.canOverride],
        ['no_change', false],
        'reason',
      );
      ctx.expect.code(
        await deploy('Production', '1.0.0', { changeReference: 'CHG-99999999' }),
        'VALIDATION_FAILED',
        400,
      );
    });

    const type = ctx.rand.weighted([
      ['standard', 2],
      ['emergency', 2],
      ['normal', 1],
    ] as const);
    ctx.tag(`${type} change`);
    const change = await ctx.step(
      `the change manager raises a ${type} change for the deployment`,
      async () => {
        const window =
          type === 'emergency'
            ? { plannedStart: isoIn(-5 * MINUTE), plannedEnd: isoIn(3 * 60 * MINUTE) }
            : { plannedStart: isoIn(5 * MINUTE), plannedEnd: isoIn(3 * 60 * MINUTE) };
        const t = await raiseChange(ctx, cm, {
          title: `Deploy ${code} 1.0.0 to production`,
          change: {
            changeType: type,
            risk: 'low',
            reason: `Release 1.0.0 of ${code}`,
            ...window,
            backoutPlan: 'Redeploy the previous version',
          },
        });
        ctx.expect.ok(await cm.post(`${T}/${t.reference}/transition`, { status: 'assessment' }));
        const s = ctx.expect.ok(
          await cm.post(`${T}/${t.reference}/transition`, { status: 'authorization' }),
        ).body;
        ctx.expect.equal(s.status, type === 'standard' ? 'scheduled' : 'authorization', 'after submitting');
        return s as Json;
      },
    );

    await ctx.step('the release manager links the change to the release', async () => {
      refused(
        ctx,
        await employee.post(`/records/alm.release/${release.id}/links`, {
          to: { type: 'itsm.change', id: change.id },
        }),
        'an employee linking',
      );
      ctx.expect.status(
        await rm.post(`/records/alm.release/${release.id}/links`, {
          to: { type: 'itsm.change', id: change.id },
        }),
        201,
      );
      const r = await ctx.eventually(
        () => rm.get(`/alm/releases/${release.id}`),
        (x) => x.body?.status === 'in_progress',
        { label: 'the release in progress' },
      );
      ctx.expect.find(r.body.changes as Json[], (c) => c.id === change.id, 'the release lists its change');
    });

    if (type !== 'standard')
      await ctx.step('the change is authorized by the CAB', async () => {
        const res = await deploy('Production', '1.0.0');
        ctx.expect.code(res, 'CHANGE_REQUIRED', 409);
        ctx.expect.equal(res.body.error?.details?.reason, 'change_not_approved', 'not approved yet');
        const { status } = await ctx.approvals.approveAll(change.change.approvalInstanceId, {
          avoid: ['changemgr'],
          prefer: ['cab'],
        });
        ctx.expect.equal(status, 'approved', 'the CAB workflow');
        await ctx.eventually(
          () => rm.get(`${T}/${change.reference}`),
          (r) => r.body?.status === 'scheduled',
          { label: 'the scheduled change' },
        );
      });

    if (ctx.rand.bool(0.5))
      ctx.expect.ok(
        await cm.post(`${T}/${change.reference}/transition`, { status: 'implementing' }),
        'starting the change',
      );

    await ctx.step('production deploys with the authorized change; the release is released', async () => {
      const policy = ctx.expect.ok(
        await rm.get('/alm/deployments/policy', {
          query: { application: code, environment: 'Production', version: '1.0.0' },
        }),
      ).body;
      ctx.expect.truthy(
        ['allow', 'warn'].includes(policy.decision?.outcome),
        `the dry run allows it (${policy.decision?.outcome})`,
      );
      const inProgress = ctx.rand.bool(0.4);
      let d = ctx.expect.status(
        await deploy('Production', '1.0.0', inProgress ? { status: 'in_progress' } : {}),
        201,
      ).body;
      ctx.expect.equal(d.change?.id, change.id, 'the authorizing change is recorded');
      ctx.expect.truthy(
        ['allow', 'warn'].includes(d.policy?.outcome),
        `policy outcome (${d.policy?.outcome})`,
      );
      if (type === 'emergency') ctx.expect.equal(d.policy?.outcome, 'allow', 'inside the emergency window');
      if (inProgress) {
        ctx.expect.equal(d.finishedAt, null, 'still running');
        d = ctx.expect.ok(await rm.patch(`/alm/deployments/${d.id}`, { status: 'succeeded' })).body;
        ctx.expect.equal(typeof d.durationSeconds, 'number', 'duration');
      }
      const r = ctx.expect.ok(await rm.get(`${A}/releases/1.0.0`)).body;
      ctx.expect.equal(r.status, 'released', 'the release is released');
      ctx.expect.truthy(r.releasedAt, 'released at');
      const a = ctx.expect.ok(await rm.get(A)).body;
      ctx.expect.equal(a.productionVersion, '1.0.0', 'production runs 1.0.0');
      const byChange = ctx.expect.ok(await rm.get(`/alm/changes/${change.id}`)).body;
      ctx.expect.find(
        byChange.deployments as Json[],
        (x) => x.id === d.id,
        'the change lists the deployment',
      );
      ctx.expect.find(
        byChange.releases as Json[],
        (x) => x.id === release.id,
        'the change lists the release',
      );
    });

    if (ctx.rand.bool(0.6))
      await ctx.step('a hotfix goes to production and is rolled back', async () => {
        ctx.tag('rollback');
        ctx.expect.status(
          await rm.post(`${A}/releases`, { version: '1.0.1', notes: ctx.rand.sentence() }),
          201,
        );
        ctx.expect.status(await deploy('Test', '1.0.1'), 201);
        const d = ctx.expect.status(
          await deploy('Production', '1.0.1', { changeReference: change.reference }),
          201,
        ).body;
        ctx.expect.equal(d.change?.reference, change.reference, 'the named change');
        let rolled: Json;
        if (ctx.rand.bool(0.15)) {
          ctx.tag('double rollback');
          const both = await Promise.all(
            [1, 2].map(() =>
              rm.patch(`/alm/deployments/${d.id}`, { status: 'rolled_back', notes: 'Errors' }),
            ),
          );
          rolled = ctx.expect.oneOk(both, 'one rollback goes through', [409]).body;
        } else
          rolled = ctx.expect.ok(
            await rm.patch(`/alm/deployments/${d.id}`, { status: 'rolled_back', notes: 'Errors' }),
          ).body;
        ctx.expect.equal(rolled.status, 'rolled_back', 'status');
        ctx.expect.code(
          await rm.patch(`/alm/deployments/${d.id}`, { status: 'succeeded' }),
          'INVALID_TRANSITION',
          409,
        );
        const prod = itemsOf(ctx.expect.ok(await rm.get(`${A}/environments`))).find(
          (e) => e.kind === 'production',
        );
        ctx.expect.equal(
          [prod?.currentVersion, prod?.lastDeployment?.status],
          ['1.0.0', 'rolled_back'],
          'production is back on 1.0.0',
        );
        const ready = ctx.expect.ok(
          await rm.get(
            `/alm/releases/${(ctx.expect.ok(await rm.get(`${A}/releases/1.0.1`)).body as Json).id}/readiness`,
          ),
        ).body;
        ctx.expect.equal(
          (ready.checks as Json[]).find((c) => c.key === 'production')?.ok,
          false,
          'the rolled-back release is not production-ready',
        );
        const list = itemsOf(
          ctx.expect.ok(
            await rm.get('/alm/deployments', { query: { application: code, status: 'rolled_back' } }),
          ),
        );
        ctx.expect.equal(
          list.map((x) => x.version),
          ['1.0.1'],
          'rolled-back deployments',
        );
      });

    await implementAndClose(ctx, change.reference, { worker: cm });
  },
});
