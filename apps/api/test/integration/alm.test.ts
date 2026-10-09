import {
  auditLogs,
  groupMembers,
  groups,
  notifications,
  recordLinks,
  roleAssignments,
  roles,
  users,
} from '@isbp/db/schema';
import { manifest as almManifest } from '@isbp/module-alm/manifest';
import { applications, deployments, environments, releases } from '@isbp/module-alm/schema';
import { cis } from '@isbp/module-cmdb/schema';
import { changes } from '@isbp/module-itsm/schema';
import type { AuthContext } from '@isbp/sdk/server';
import { and, count, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthContext } from '../../src/kernel/http/auth';
import { hashPassword } from '../../src/kernel/passwords';
import { toSessionUser } from '../../src/kernel/sessions';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/** Only this module and its dependencies (other Phase 3 modules may be mid-change); restored after setup. */
const MODULES = process.env.ISBP_TEST_MODULES;

let h: Harness;
let stopWorker: () => Promise<void>;
const s: Record<string, Session> = {};
const ids = {} as Record<'owner' | 'member' | 'viewer' | 'relman' | 'deployer' | 'cm' | 'devTeam', string>;
let appId: string;
const env = {} as Record<'dev' | 'test' | 'staging' | 'prod', string>;
let ciApp: string;
let ciServer: string;

const API = '/api/v1/alm';
const DAY = 86_400_000;
const HOUR = 3_600_000;

async function eventually<T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function mkUser(username: string) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: `${username[0]!.toUpperCase()}${username.slice(1)}`,
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  return u!.id;
}

const roleId = async (key: string) =>
  (await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;

async function authFor(userId: string): Promise<AuthContext> {
  const [u] = await h.kernel.db.select().from(users).where(eq(users.id, userId));
  return buildAuthContext(
    { type: 'user', id: u!.id, name: u!.displayName },
    toSessionUser(u!),
    null,
    await h.kernel.rbac.permissionsFor(u!.id),
  );
}

const notificationsOf = (userId: string, type: string) =>
  h.kernel.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

const auditOf = (action: string) => h.kernel.db.select().from(auditLogs).where(eq(auditLogs.action, action));

const setPolicy = (values: Record<string, boolean>) => h.kernel.settings.update(almManifest, values, null);

/** Records a deployment as `who`. */
const deploy = (who: string, body: Record<string, unknown>) =>
  h.call(s[who]!, 'POST', `${API}/deployments`, { application: 'payroll', ...body });

/**
 * A standard change (pre-approved) with a planned window; `scheduled` unless `draft`. ITSM refuses to
 * schedule a window that already started, so it is scheduled for later and then moved to `start…end`.
 */
async function standardChange(title: string, start: Date, end: Date, opts: { draft?: boolean } = {}) {
  const later = new Date(Date.now() + 30 * DAY);
  const created = await h.call(s.admin!, 'POST', '/api/v1/itsm/tickets', {
    type: 'change',
    title,
    description: 'Deployment change',
    change: {
      changeType: 'standard',
      risk: 'low',
      plannedStart: later.toISOString(),
      plannedEnd: new Date(later.getTime() + HOUR).toISOString(),
      implementationPlan: 'Run the pipeline',
    },
  });
  expect(created.status).toBe(201);
  const ref = created.body.reference as string;
  if (!opts.draft) {
    await h.call(s.admin!, 'POST', `/api/v1/itsm/tickets/${ref}/transition`, { status: 'assessment' });
    const done = await h.call(s.admin!, 'POST', `/api/v1/itsm/tickets/${ref}/transition`, {
      status: 'authorization',
    });
    expect(done.body.status, JSON.stringify(done.body)).toBe('scheduled');
  }
  await h.kernel.db
    .update(changes)
    .set({ plannedStart: start, plannedEnd: end })
    .where(eq(changes.ticketId, created.body.id));
  return { id: created.body.id as string, reference: ref };
}

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES = MODULES ?? 'cmdb,itsm,alm';
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  stopWorker = await startWorker(h.kernel);
  const db = h.kernel.db;
  ids.owner = await mkUser('owner'); // technical owner of "payroll"
  ids.member = await mkUser('member'); // in the delivery team
  ids.viewer = await mkUser('viewer'); // alm-viewer, nothing else
  ids.relman = await mkUser('relman'); // alm-release-manager
  ids.deployer = await mkUser('deployer'); // alm-pipeline (a person running pipelines by hand)
  ids.cm = await mkUser('cm'); // ITSM change manager
  const [team] = await db
    .insert(groups)
    .values({ key: 'dev-team', name: 'Application Development' })
    .returning();
  ids.devTeam = team!.id;
  await db.insert(groupMembers).values({ groupId: team!.id, userId: ids.member });
  await db.insert(roleAssignments).values([
    { roleId: await roleId('alm-viewer'), userId: ids.owner },
    { roleId: await roleId('alm-viewer'), userId: ids.member },
    { roleId: await roleId('alm-viewer'), userId: ids.viewer },
    { roleId: await roleId('alm-release-manager'), userId: ids.relman },
    { roleId: await roleId('alm-pipeline'), userId: ids.deployer },
    { roleId: await roleId('itsm-change-manager'), userId: ids.cm },
  ]);
  await h.kernel.rbac.bump();
  for (const u of ['admin', 'owner', 'member', 'viewer', 'relman', 'deployer', 'cm', 'outsider'])
    s[u] = await h.login(u);

  const [app] = await db
    .insert(cis)
    .values({ name: 'Payroll Application', classKey: 'application', criticality: 'high' })
    .returning();
  const [server] = await db
    .insert(cis)
    .values({ name: 'pay-app-01', classKey: 'server', criticality: 'high' })
    .returning();
  ciApp = app!.id;
  ciServer = server!.id;
}, 120_000);

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('applications and the ownership rule', () => {
  it('creates an application (alm.apps.manage) with validated references and codes', async () => {
    const bad = await h.call(s.admin!, 'POST', `${API}/applications`, { code: 'Pay_Roll', name: 'x' });
    expect(bad.status).toBe(400);
    const reserved = await h.call(s.admin!, 'POST', `${API}/applications`, { code: 'releases', name: 'x' });
    expect(reserved.status).toBe(400);
    const unknownCi = await h.call(s.admin!, 'POST', `${API}/applications`, {
      code: 'payroll',
      name: 'Payroll',
      ciId: '0190a1b2-0000-7000-8000-000000000000',
    });
    expect(unknownCi.body.error).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(unknownCi.body.error.details.issues[0].path).toBe('ciId');

    const denied = await h.call(s.viewer!, 'POST', `${API}/applications`, {
      code: 'payroll',
      name: 'Payroll',
    });
    expect(denied.status).toBe(403);

    const created = await h.call(s.admin!, 'POST', `${API}/applications`, {
      code: 'payroll',
      name: 'Payroll',
      description: '**Monthly** payroll for Taiwan and Japan.',
      stage: 'development',
      criticality: 'high',
      hosting: 'on_prem',
      technicalOwnerId: ids.owner,
      teamGroupId: ids.devTeam,
      ciId: ciApp,
      techStack: ['Java 21', 'Java 21', 'PostgreSQL'],
      documentationUrl: 'https://wiki.example.com/payroll',
    });
    expect(created.status).toBe(201);
    appId = created.body.id;
    expect(created.body).toMatchObject({
      code: 'payroll',
      stage: 'development',
      technicalOwner: { id: ids.owner, displayName: 'Owner' },
      team: { id: ids.devTeam, name: 'Application Development' },
      ci: { id: ciApp, name: 'Payroll Application', reference: expect.stringMatching(/^CI-/) },
      techStack: ['Java 21', 'PostgreSQL'],
      productionVersion: null,
      lastDeployment: null,
      viewer: { canEdit: true, canManageReleases: true, canDeploy: true, canOverride: true },
    });
    const dup = await h.call(s.admin!, 'POST', `${API}/applications`, { code: 'payroll', name: 'Again' });
    expect(dup.status).toBe(409);
    expect((await auditOf('alm.application.created')).map((a) => a.entityId)).toContain(appId);
  });

  it('lets owners and team members edit with alm.apps.read only; others get 403', async () => {
    const asViewer = await h.call(s.viewer!, 'GET', `${API}/applications/payroll`);
    expect(asViewer.status).toBe(200);
    expect(asViewer.body.viewer).toMatchObject({ canEdit: false, isOwner: false, canDeploy: false });
    expect((await h.call(s.viewer!, 'PATCH', `${API}/applications/payroll`, { name: 'Hacked' })).status).toBe(
      403,
    );
    expect((await h.call(s.outsider!, 'GET', `${API}/applications/payroll`)).status).toBe(403);
    const denials = await h.kernel.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'core.access.denied'), eq(auditLogs.actorId, ids.viewer)));
    expect(denials.length).toBeGreaterThan(0);

    const byOwner = await h.call(s.owner!, 'PATCH', `${API}/applications/payroll`, {
      vendor: 'In-house',
      stage: 'production',
      goLiveDate: '2026-01-05',
    });
    expect(byOwner.status).toBe(200);
    expect(byOwner.body).toMatchObject({ stage: 'production', vendor: 'In-house', goLiveDate: '2026-01-05' });
    expect(byOwner.body.viewer).toMatchObject({ isOwner: true, canEdit: true, canDeploy: false });
    const badDates = await h.call(s.owner!, 'PATCH', `${API}/applications/payroll`, {
      retireDate: '2025-01-01',
    });
    expect(badDates.body.error.code).toBe('VALIDATION_FAILED');

    const byMember = await h.call(s.member!, 'PATCH', `${API}/applications/${appId}`, {
      businessOwnerId: ids.viewer,
    });
    expect(byMember.status).toBe(200);
    expect(byMember.body.businessOwner.id).toBe(ids.viewer);
    // Now the viewer is the business owner: an owner too.
    expect((await h.call(s.viewer!, 'GET', `${API}/applications/payroll`)).body.viewer.isOwner).toBe(true);
    await h.call(s.admin!, 'PATCH', `${API}/applications/payroll`, { businessOwnerId: null });

    const stage = await h.kernel.db
      .select({ changes: auditLogs.changes })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'alm.application.updated'), eq(auditLogs.entityId, appId)));
    expect(stage.some((a) => (a.changes as LooseJson)?.stage?.[1] === 'production')).toBe(true);
  });

  it('lists with filters, owner=me and search', async () => {
    await h.call(s.admin!, 'POST', `${API}/applications`, {
      code: 'old-crm',
      name: 'Old CRM',
      stage: 'retired',
      criticality: 'low',
    });
    const all = await h.call(s.viewer!, 'GET', `${API}/applications?sort=code`);
    expect(all.body.items.map((a: LooseJson) => a.code)).toEqual(['old-crm', 'payroll']);
    const retired = await h.call(s.viewer!, 'GET', `${API}/applications?stage=sunsetting,retired`);
    expect(retired.body.items.map((a: LooseJson) => a.code)).toEqual(['old-crm']);
    expect((await h.call(s.viewer!, 'GET', `${API}/applications?stage=nope`)).status).toBe(400);
    const mine = await h.call(s.member!, 'GET', `${API}/applications?owner=me`);
    expect(mine.body.items.map((a: LooseJson) => a.code)).toEqual(['payroll']);
    const found = await h.call(s.viewer!, 'GET', `${API}/applications?q=PAY`);
    expect(found.body.total).toBe(1);
  });
});

describe('environments and repositories', () => {
  it('manages environments (unique names, reorder) and repositories (http(s), unique URL)', async () => {
    const add = (body: Record<string, unknown>) =>
      h.call(s.owner!, 'POST', `${API}/applications/payroll/environments`, body);
    const prod = await add({
      name: 'Production',
      kind: 'production',
      url: 'https://pay.example.com',
      ciId: ciServer,
    });
    expect(prod.status).toBe(201);
    expect(prod.body).toMatchObject({
      sort: 0,
      ci: { id: ciServer },
      currentVersion: null,
      deploymentCount: 0,
    });
    const dev = await add({ name: 'Development', kind: 'development' });
    const test = await add({ name: 'Test', kind: 'test' });
    const staging = await add({ name: 'Staging', kind: 'staging' });
    env.prod = prod.body.id;
    env.dev = dev.body.id;
    env.test = test.body.id;
    env.staging = staging.body.id;
    expect((await add({ name: 'Production', kind: 'production' })).status).toBe(409);
    expect((await add({ name: 'QA', kind: 'test', url: 'http://qa.example.com' })).status).toBe(400);
    expect(
      (
        await h.call(s.viewer!, 'POST', `${API}/applications/payroll/environments`, {
          name: 'X',
          kind: 'test',
        })
      ).status,
    ).toBe(403);

    const order = [env.dev, env.test, env.staging, env.prod];
    const reordered = await h.call(s.member!, 'POST', `${API}/applications/payroll/environments/reorder`, {
      ids: order,
    });
    expect(reordered.body.items.map((e: LooseJson) => e.name)).toEqual([
      'Development',
      'Test',
      'Staging',
      'Production',
    ]);
    expect(
      (
        await h.call(s.member!, 'POST', `${API}/applications/payroll/environments/reorder`, {
          ids: [env.dev],
        })
      ).status,
    ).toBe(400);
    const renamed = await h.call(
      s.owner!,
      'PATCH',
      `${API}/applications/payroll/environments/${env.staging}`,
      {
        url: 'https://pay-stg.example.com',
      },
    );
    expect(renamed.body.url).toBe('https://pay-stg.example.com');

    const repo = await h.call(s.owner!, 'POST', `${API}/applications/payroll/repositories`, {
      name: 'payroll',
      url: 'https://devops.example.com/DefaultCollection/HR/_git/payroll',
    });
    expect(repo.status).toBe(201);
    expect(repo.body).toMatchObject({ provider: 'azure_devops', defaultBranch: 'main', lastCommit: null });
    expect(
      (
        await h.call(s.owner!, 'POST', `${API}/applications/payroll/repositories`, {
          name: 'dup',
          url: 'https://devops.example.com/DefaultCollection/HR/_git/payroll',
        })
      ).status,
    ).toBe(409);
    // Plain http is allowed for on-premises Git servers without TLS; other schemes never.
    for (const url of ['javascript:alert(1)', 'file:///srv/git/payroll', 'ftp://git.example.com/payroll'])
      expect(
        (
          await h.call(s.owner!, 'POST', `${API}/applications/payroll/repositories`, {
            name: 'insecure',
            url,
          })
        ).status,
        url,
      ).toBe(400);
    const plain = await h.call(s.owner!, 'POST', `${API}/applications/payroll/repositories`, {
      name: 'payroll-legacy',
      url: 'http://git.example.com/payroll',
    });
    expect(plain.status).toBe(201);
    expect(
      (await h.call(s.owner!, 'DELETE', `${API}/applications/payroll/repositories/${plain.body.id}`)).status,
    ).toBe(204);
    const other = await h.call(s.owner!, 'POST', `${API}/applications/payroll/repositories`, {
      name: 'payroll-reports',
      url: 'https://github.com/example/payroll-reports',
      provider: 'github',
    });
    expect(
      (await h.call(s.owner!, 'DELETE', `${API}/applications/payroll/repositories/${other.body.id}`)).status,
    ).toBe(204);
    const list = await h.call(s.viewer!, 'GET', `${API}/applications/payroll/repositories`);
    expect(list.body.items.map((r: LooseJson) => r.name)).toEqual(['payroll']);
  });
});

describe('releases', () => {
  it('lets owners and release managers plan releases; versions are unique', async () => {
    const byMember = await h.call(s.member!, 'POST', `${API}/applications/payroll/releases`, {
      version: '1.0.0',
      name: 'First release',
      plannedDate: '2026-11-02',
    });
    expect(byMember.status).toBe(201);
    expect(byMember.body).toMatchObject({
      version: '1.0.0',
      status: 'planned',
      application: { code: 'payroll' },
      readiness: { passed: 1, total: 4, ready: false },
      changes: [],
      transitions: ['in_progress', 'ready', 'released', 'cancelled'],
    });
    expect(
      (await h.call(s.member!, 'POST', `${API}/applications/payroll/releases`, { version: '1.0.0' })).status,
    ).toBe(409);
    expect(
      (await h.call(s.viewer!, 'POST', `${API}/applications/payroll/releases`, { version: '1.1.0' })).status,
    ).toBe(403);
    expect(
      (await h.call(s.member!, 'POST', `${API}/applications/payroll/releases`, { version: 'bad version' }))
        .status,
    ).toBe(400);
    const byRelman = await h.call(s.relman!, 'POST', `${API}/applications/old-crm/releases`, {
      version: '9.9',
    });
    expect(byRelman.status).toBe(201);

    const list = await h.call(s.viewer!, 'GET', `${API}/applications/payroll/releases`);
    expect(list.body.items.map((r: LooseJson) => r.version)).toEqual(['1.0.0']);
  });

  it('moves through its lifecycle and refuses illegal transitions', async () => {
    const [r] = await h.kernel.db.select().from(releases).where(eq(releases.version, '9.9'));
    const cancelled = await h.call(s.relman!, 'POST', `${API}/releases/${r!.id}/status`, {
      status: 'cancelled',
    });
    expect(cancelled.body.status).toBe('cancelled');
    const bad = await h.call(s.relman!, 'POST', `${API}/releases/${r!.id}/status`, { status: 'released' });
    expect(bad.status).toBe(409);
    expect(bad.body.error).toMatchObject({ code: 'INVALID_TRANSITION', details: { from: 'cancelled' } });
    expect(
      (await h.call(s.viewer!, 'POST', `${API}/releases/${r!.id}/status`, { status: 'planned' })).status,
    ).toBe(403);
    const statusAudit = await auditOf('alm.release.status_changed');
    expect(statusAudit.some((a) => a.entityId === r!.id)).toBe(true);
  });
});

describe('deployments and the change policy', () => {
  let releaseId: string;

  it('records non-production deployments without a change', async () => {
    const [r] = await h.kernel.db.select().from(releases).where(eq(releases.version, '1.0.0'));
    releaseId = r!.id;
    const toTest = await deploy('deployer', {
      environment: 'test',
      version: '1.0.0',
      status: 'succeeded',
      commitSha: 'a1b2c3d4e5f6',
      pipelineUrl: 'https://devops.example.com/DefaultCollection/HR/_build/results?buildId=1',
    });
    expect(toTest.status).toBe(201);
    expect(toTest.body).toMatchObject({
      environment: { name: 'Test', kind: 'test' },
      release: { id: releaseId, version: '1.0.0' },
      status: 'succeeded',
      actor: { id: ids.deployer, name: 'Deployer' },
      source: 'manual',
      change: null,
      policy: { outcome: 'allow', applies: false },
    });
    const [testEnv] = await h.kernel.db.select().from(environments).where(eq(environments.id, env.test));
    expect(testEnv).toMatchObject({
      currentVersion: '1.0.0',
      currentReleaseId: releaseId,
      lastStatus: 'succeeded',
    });
    // By name, case-insensitive; unknown environments are a validation error.
    expect((await deploy('deployer', { environment: 'staging', version: '1.0.0' })).status).toBe(201);
    expect((await deploy('deployer', { environment: 'Nope', version: '1.0.0' })).status).toBe(400);
    // Owners without alm.deployments.create can't record deployments.
    expect((await deploy('owner', { environment: 'test', version: '1.0.0' })).status).toBe(403);
    const repo = await h.call(s.viewer!, 'GET', `${API}/applications/payroll/repositories`);
    expect(repo.body.items[0].lastCommit).toMatchObject({ sha: 'a1b2c3d4e5f6' });
  });

  it('refuses production without a change (no_change) or with an unapproved one', async () => {
    const none = await deploy('deployer', { environment: 'Production', version: '1.0.0' });
    expect(none.status).toBe(409);
    expect(none.body.error).toMatchObject({
      code: 'CHANGE_REQUIRED',
      details: { reason: 'no_change', change: null, canOverride: false },
    });
    const unknown = await deploy('deployer', {
      environment: 'production',
      version: '1.0.0',
      changeReference: 'CHG-99999',
    });
    expect(unknown.body.error).toMatchObject({ code: 'VALIDATION_FAILED' });

    const draft = await standardChange(
      'Draft change',
      new Date(Date.now() - HOUR),
      new Date(Date.now() + HOUR),
      {
        draft: true,
      },
    );
    const notApproved = await deploy('deployer', {
      environment: 'production',
      version: '1.0.0',
      changeReference: draft.reference,
    });
    expect(notApproved.status).toBe(409);
    expect(notApproved.body.error.details).toMatchObject({
      reason: 'change_not_approved',
      change: { reference: draft.reference, status: 'draft', authorized: false },
    });
  });

  it('accepts a scheduled change in its window, warns or refuses outside it', async () => {
    const later = await standardChange(
      'Payroll 1.0.0 next week',
      new Date(Date.now() + 7 * DAY),
      new Date(Date.now() + 7 * DAY + 2 * HOUR),
    );
    const warned = await deploy('deployer', {
      environment: 'production',
      version: '0.9.0',
      changeReference: later.reference,
      status: 'in_progress',
    });
    expect(warned.status).toBe(201);
    expect(warned.body).toMatchObject({
      policy: { outcome: 'warn', warning: 'outside_window' },
      policyWarning: 'outside_window',
      change: { id: later.id, reference: later.reference },
      status: 'in_progress',
      finishedAt: null,
    });
    // Finish it; finishing twice is refused.
    const finished = await h.call(s.deployer!, 'PATCH', `${API}/deployments/${warned.body.id}`, {
      status: 'succeeded',
    });
    expect(finished.body).toMatchObject({ status: 'succeeded', durationSeconds: expect.any(Number) });
    expect(
      (await h.call(s.deployer!, 'PATCH', `${API}/deployments/${warned.body.id}`, { status: 'failed' }))
        .status,
    ).toBe(409);

    await setPolicy({ 'policy.enforceWindow': true });
    const outside = await deploy('deployer', {
      environment: 'production',
      version: '0.9.1',
      changeReference: later.reference,
    });
    expect(outside.body.error.details).toMatchObject({
      reason: 'outside_window',
      change: { reference: later.reference },
    });

    const now = await standardChange(
      'Payroll hotfix window',
      new Date(Date.now() - HOUR),
      new Date(Date.now() + HOUR),
    );
    const ok = await deploy('deployer', {
      environment: 'production',
      version: '0.9.1',
      changeReference: now.reference,
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      policy: { outcome: 'allow', applies: true, warning: null },
      policyWarning: null,
    });
    await setPolicy({ 'policy.enforceWindow': false });
  });

  it('accepts a change linked to the release, then releases it on production success', async () => {
    const change = await standardChange(
      'Deploy Payroll 1.0.0 to production',
      new Date(Date.now() - HOUR),
      new Date(Date.now() + 3 * HOUR),
    );
    // Linking needs to see both records: the delivery team can't read ITSM changes, the admin can.
    expect(
      (
        await h.call(s.member!, 'POST', `/api/v1/records/alm.release/${releaseId}/links`, {
          to: { type: 'itsm.change', id: change.id },
        })
      ).status,
    ).toBe(404);
    const link = await h.call(s.admin!, 'POST', `/api/v1/records/alm.release/${releaseId}/links`, {
      to: { type: 'itsm.change', id: change.id },
    });
    expect(link.status).toBe(201);
    // The worker moves a planned release to in progress once a change is linked.
    const moved = await eventually(
      () => h.call(s.viewer!, 'GET', `${API}/releases/${releaseId}`),
      (r) => r.body.status === 'in_progress',
    );
    expect(moved.body.status).toBe('in_progress');
    expect(moved.body.changes).toEqual([
      expect.objectContaining({ id: change.id, status: 'scheduled', authorized: true, inWindow: true }),
    ]);

    // The "Record deployment" dialog's live check: production, this version, nothing named.
    const dry = await h.call(
      s.viewer!,
      'GET',
      `${API}/deployments/policy?application=payroll&environment=Production&version=1.0.0`,
    );
    expect(dry.body).toMatchObject({
      environment: { name: 'Production', kind: 'production' },
      release: { id: releaseId, version: '1.0.0' },
      decision: {
        outcome: 'allow',
        applies: true,
        change: { id: change.id, title: 'Deploy Payroll 1.0.0 to production' },
      },
      changes: [{ id: change.id }],
      named: null,
      namedNotFound: false,
      canOverride: false,
    });
    const dryNamed = await h.call(
      s.viewer!,
      'GET',
      `${API}/deployments/policy?application=payroll&environment=test&version=9.9.9&changeReference=CHG-77777`,
    );
    expect(dryNamed.body).toMatchObject({ decision: { applies: false }, release: null, namedNotFound: true });

    const readiness = await h.call(s.viewer!, 'GET', `${API}/releases/${releaseId}/readiness`);
    expect(readiness.body).toMatchObject({
      checks: [
        { key: 'change', ok: true },
        { key: 'tested', ok: true },
        { key: 'notes', ok: false },
        { key: 'production', ok: true },
      ],
      testedIn: ['Staging', 'Test'],
      policy: {
        requireChange: true,
        enforceWindow: false,
        production: { outcome: 'allow', change: { id: change.id } },
      },
      // Viewers and release managers read changes but can't raise them: no link to a form they won't get.
      raiseChangeHref: null,
    });
    const asRelman = await h.call(s.relman!, 'GET', `${API}/releases/${releaseId}/readiness`);
    expect(asRelman.body.raiseChangeHref).toBeNull();
    const asAdmin = await h.call(s.admin!, 'GET', `${API}/releases/${releaseId}/readiness`);
    expect(asAdmin.body.raiseChangeHref).toEqual(expect.stringContaining(`link=alm.release:${releaseId}`));
    expect(await notificationsOf(ids.owner, 'alm.release.ready')).toHaveLength(0);
    // Release notes complete readiness: the owners hear about it once.
    await h.call(s.owner!, 'PATCH', `${API}/releases/${releaseId}`, {
      notes: '## Payroll 1.0.0\n\n- First release',
    });
    const [ready] = await notificationsOf(ids.owner, 'alm.release.ready');
    expect(ready).toBeDefined();
    // The notification opens "Record deployment" for production on the release.
    expect((ready as { href: string | null }).href).toBe('/alm/payroll/releases/1.0.0?deploy=production');
    await h.call(s.owner!, 'PATCH', `${API}/releases/${releaseId}`, {
      notes: '## Payroll 1.0.0\n\n- First release!',
    });
    expect(await notificationsOf(ids.owner, 'alm.release.ready')).toHaveLength(1);

    const prod = await deploy('deployer', { environment: 'production', version: '1.0.0' });
    expect(prod.status).toBe(201);
    expect(prod.body).toMatchObject({
      change: { id: change.id, reference: change.reference },
      policy: { outcome: 'allow' },
    });
    const released = await h.call(s.viewer!, 'GET', `${API}/applications/payroll/releases/1.0.0`);
    expect(released.body.id).toBe(releaseId);
    expect((await h.call(s.viewer!, 'GET', `${API}/applications/payroll/releases/9.9.9`)).status).toBe(404);
    expect(released.body).toMatchObject({
      status: 'released',
      releasedAt: expect.any(String),
      transitions: [],
    });
    expect(
      released.body.pipeline.map((p: LooseJson) => [
        p.environment.name,
        p.deployment?.status ?? null,
        p.current,
      ]),
    ).toEqual([
      ['Development', null, false],
      ['Test', 'succeeded', true],
      ['Staging', 'succeeded', true],
      ['Production', 'succeeded', true],
    ]);
    const app = await h.call(s.viewer!, 'GET', `${API}/applications/payroll`);
    expect(app.body.productionVersion).toBe('1.0.0');
    expect(app.body.lastDeployment).toMatchObject({
      version: '1.0.0',
      status: 'succeeded',
      environment: { name: 'Production' },
    });

    // The ITSM change page slot: the release and the deployment that used the change.
    const usage = await h.call(s.viewer!, 'GET', `${API}/changes/${change.id}`);
    expect(usage.body.releases).toEqual([
      expect.objectContaining({ id: releaseId, version: '1.0.0', status: 'released' }),
    ]);
    expect(usage.body.deployments.map((d: LooseJson) => [d.environment.name, d.status])).toEqual([
      ['Production', 'succeeded'],
    ]);
  });

  it('tells the technical owner and the team about failures; a rollback restores the previous version', async () => {
    const change = await standardChange(
      'Payroll 1.0.1',
      new Date(Date.now() - HOUR),
      new Date(Date.now() + HOUR),
    );
    const failed = await deploy('deployer', {
      environment: 'production',
      version: '1.0.1',
      status: 'succeeded',
      changeReference: change.reference,
    });
    expect(failed.status).toBe(201);
    let [prodEnv] = await h.kernel.db.select().from(environments).where(eq(environments.id, env.prod));
    expect(prodEnv!.currentVersion).toBe('1.0.1');
    const rolledBack = await h.call(s.deployer!, 'PATCH', `${API}/deployments/${failed.body.id}`, {
      status: 'rolled_back',
      notes: 'Payslips rendered blank',
    });
    expect(rolledBack.body.status).toBe('rolled_back');
    [prodEnv] = await h.kernel.db.select().from(environments).where(eq(environments.id, env.prod));
    expect(prodEnv).toMatchObject({ currentVersion: '1.0.0', lastStatus: 'rolled_back' });
    expect(await notificationsOf(ids.owner, 'alm.deployment.failed')).toHaveLength(1);
    expect(await notificationsOf(ids.member, 'alm.deployment.failed')).toHaveLength(1);
    expect(await notificationsOf(ids.viewer, 'alm.deployment.failed')).toHaveLength(0);
    // An environment with deployments can't be deleted.
    const del = await h.call(s.owner!, 'DELETE', `${API}/applications/payroll/environments/${env.prod}`);
    expect(del.body.error.code).toBe('IN_USE');
  });

  it('overrides only with alm.deployments.override — audited and notified to change managers', async () => {
    const forbidden = await deploy('deployer', {
      environment: 'production',
      version: '1.0.2',
      override: { reason: 'Payroll run tonight, CAB unreachable' },
    });
    expect(forbidden.status).toBe(403);
    const short = await deploy('admin', {
      environment: 'production',
      version: '1.0.2',
      override: { reason: 'x' },
    });
    expect(short.status).toBe(400);
    const overridden = await deploy('admin', {
      environment: 'production',
      version: '1.0.2',
      override: { reason: 'Payroll run tonight, CAB unreachable' },
    });
    expect(overridden.status).toBe(201);
    expect(overridden.body).toMatchObject({
      overrideReason: 'Payroll run tonight, CAB unreachable',
      policy: { outcome: 'override', reason: 'no_change' },
    });
    const [audit] = await auditOf('alm.deployment.policy_overridden');
    expect(audit).toMatchObject({ category: 'security', entityId: overridden.body.id });
    expect(await notificationsOf(ids.cm, 'alm.deployment.overridden')).toHaveLength(1);
  });

  it('can switch the change requirement off', async () => {
    await setPolicy({ 'policy.requireChange': false });
    const free = await deploy('deployer', { environment: 'production', version: '1.0.3' });
    expect(free.body.policy).toMatchObject({ outcome: 'allow', applies: false });
    await setPolicy({ 'policy.requireChange': true });
  });

  it('works for CI/CD API clients (bearer key) with the alm-pipeline permissions', async () => {
    const created = await h.call(s.admin!, 'POST', '/api/v1/api-clients', {
      name: 'Azure DevOps Pipelines',
      permissions: ['alm.apps.read', 'alm.deployments.create'],
    });
    expect(created.status).toBe(201);
    const key = created.body.secret as string;
    const bearer = async (method: string, url: string, body?: unknown) => {
      const res = await h.app.inject({
        method: method as 'GET',
        url,
        payload: body as object | undefined,
        headers: { authorization: `Bearer ${key}` },
      });
      return { status: res.statusCode, body: res.json() as LooseJson };
    };
    const ok = await bearer('POST', `${API}/deployments`, {
      application: 'payroll',
      environment: 'Development',
      version: '1.1.0-ci.42',
      commitSha: 'deadbeefcafe',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ actor: { id: null, name: 'Azure DevOps Pipelines' }, source: 'api' });
    const prod = await bearer('POST', `${API}/deployments`, {
      application: 'payroll',
      environment: 'production',
      version: '1.1.0',
    });
    expect(prod.status).toBe(409);
    expect(prod.body.error.code).toBe('CHANGE_REQUIRED');
    expect(
      (await bearer('GET', `${API}/deployments?application=payroll&kind=production`)).body.total,
    ).toBeGreaterThan(3);
    expect((await bearer('PATCH', `${API}/applications/payroll`, { name: 'Nope' })).status).toBe(403);
  });

  it('lists the history with filters', async () => {
    const prod = await h.call(
      s.viewer!,
      'GET',
      `${API}/deployments?application=payroll&kind=production&sort=startedAt`,
    );
    expect(prod.body.items.every((d: LooseJson) => d.environment.kind === 'production')).toBe(true);
    const failed = await h.call(
      s.viewer!,
      'GET',
      `${API}/deployments?application=payroll&status=failed,rolled_back`,
    );
    expect(failed.body.items.map((d: LooseJson) => d.version)).toEqual(['1.0.1']);
    const byChange = await h.call(s.viewer!, 'GET', `${API}/deployments?q=CHG-`);
    expect(byChange.body.total).toBeGreaterThan(0);
  });
});

describe('metrics', () => {
  it('computes DORA metrics for production on fixtures', async () => {
    const db = h.kernel.db;
    const created = await h.call(s.admin!, 'POST', `${API}/applications`, {
      code: 'metrics',
      name: 'Metrics',
    });
    const id = created.body.id as string;
    const [prodEnv] = await db
      .insert(environments)
      .values({ applicationId: id, name: 'Production', kind: 'production', sort: 1 })
      .returning();
    const [testEnv] = await db
      .insert(environments)
      .values({ applicationId: id, name: 'Test', kind: 'test', sort: 0 })
      .returning();
    const now = Date.now();
    const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * HOUR);
    const rel = async (version: string, createdAt: Date) =>
      (
        await db
          .insert(releases)
          .values({ applicationId: id, version, status: 'released', createdAt })
          .returning()
      )[0]!.id;
    const r1 = await rel('1.0', ago(20));
    const r2 = await rel('2.0', ago(12));
    const r3 = await rel('3.0', ago(5));
    const d = (
      envId: string,
      version: string,
      status: string,
      startedAt: Date,
      releaseId: string | null,
    ) => ({
      applicationId: id,
      environmentId: envId,
      releaseId,
      version,
      status: status as 'succeeded',
      startedAt,
      finishedAt: startedAt,
      actorName: 'fixture',
    });
    await db.insert(deployments).values([
      d(prodEnv!.id, '1.0', 'succeeded', ago(18), r1), // lead time 2 days
      d(prodEnv!.id, '2.0', 'failed', ago(10), r2), // restore: 1 day later
      d(prodEnv!.id, '2.0', 'succeeded', ago(9), r2), // lead time 3 days
      d(prodEnv!.id, '3.0', 'rolled_back', ago(4), r3), // restore: 2 hours later
      d(prodEnv!.id, '3.0', 'succeeded', ago(4, -2), r3), // lead time 1 day + 2 hours = 26 h
      d(testEnv!.id, '3.0', 'failed', ago(6), r3), // not production: ignored
      d(prodEnv!.id, '0.9', 'succeeded', ago(40), null), // outside the window
    ]);
    const m = await h.call(s.viewer!, 'GET', `${API}/applications/metrics/metrics?days=28`);
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({
      days: 28,
      deploymentFrequency: { total: 3, perWeek: 0.8 },
      changeFailureRate: { failures: 2, finished: 5, rate: 0.4 },
      leadTime: { samples: 3, medianHours: 48 },
      timeToRestore: { samples: 2, medianHours: 13 }, // median of 24 h and 2 h
    });
    expect(m.body.weekly.length).toBeGreaterThanOrEqual(4);
    expect(m.body.weekly.reduce((n: number, w: LooseJson) => n + w.succeeded, 0)).toBe(3);
    expect(m.body.weekly.reduce((n: number, w: LooseJson) => n + w.failed, 0)).toBe(2);
    expect((await h.call(s.viewer!, 'GET', `${API}/applications/metrics/metrics?days=3`)).status).toBe(400);
  });

  it('summarizes the portfolio on the dashboard', async () => {
    const dash = await h.call(s.viewer!, 'GET', `${API}/dashboard`);
    expect(dash.body).toMatchObject({
      total: 3,
      byStage: { production: 1, retired: 1, planned: 1 },
      withoutCi: { total: 1, items: [{ code: 'metrics' }] },
    });
    expect(dash.body.week.total).toBeGreaterThan(5);
    expect(dash.body.withoutOwner.items.find((a: LooseJson) => a.code === 'payroll').missing).toEqual([
      'business',
    ]);
  });
});

describe('records, search, slots and AI tools', () => {
  it('resolves applications and releases for the record registry with the ownership rule', async () => {
    const ref = { type: 'alm.application', id: appId };
    const asOwner = await h.kernel.records.get(ref, await authFor(ids.owner));
    expect(asOwner).toMatchObject({
      reference: 'payroll',
      title: 'Payroll',
      href: '/alm/payroll',
      status: { key: 'alm.stage.production', tone: 'success' },
      editable: true,
    });
    expect((await h.kernel.records.get(ref, await authFor(ids.viewer)))?.editable).toBe(false);
    expect(await h.kernel.records.get(ref, await authFor(h.ids.outsider))).toBeNull();
    const [r] = await h.kernel.db.select().from(releases).where(eq(releases.version, '1.0.0'));
    const rel = await h.kernel.records.get({ type: 'alm.release', id: r!.id }, await authFor(ids.relman));
    expect(rel).toMatchObject({
      reference: 'payroll 1.0.0',
      href: '/alm/payroll/releases/1.0.0',
      status: { key: 'alm.releaseStatus.released' },
      editable: true,
    });
    const found = await h.kernel.records.search('payroll 1.0', {
      auth: await authFor(ids.viewer),
      types: ['alm.release'],
    });
    expect(found.map((x) => x.reference)).toContain('payroll 1.0.0');
    const recent = await h.kernel.records.search('', {
      auth: await authFor(ids.viewer),
      types: ['alm.application'],
    });
    expect(recent.length).toBe(3);
    const links = await h.call(s.viewer!, 'GET', `/api/v1/records/alm.release/${r!.id}/links`);
    expect(links.body.links.map((l: LooseJson) => l.ref.type)).toEqual(['itsm.change']);
  });

  it('feeds the global search: applications and "code version" releases', async () => {
    const hits = await h.kernel.search('payroll 1.0', await authFor(ids.viewer));
    expect(hits.some((x) => x.moduleId === 'alm' && x.href === '/alm/payroll/releases/1.0.0')).toBe(true);
    const apps = await h.kernel.search('payroll', await authFor(ids.viewer));
    expect(apps.find((x) => x.moduleId === 'alm')?.href).toBe('/alm/payroll');
    expect(
      (await h.kernel.search('payroll', await authFor(h.ids.outsider))).some((x) => x.moduleId === 'alm'),
    ).toBe(false);
  });

  it('serves the CMDB CI page slot', async () => {
    const byApp = await h.call(s.viewer!, 'GET', `${API}/cis/${ciApp}/applications`);
    expect(byApp.body.items).toEqual([expect.objectContaining({ code: 'payroll', roles: ['application'] })]);
    const byServer = await h.call(s.viewer!, 'GET', `${API}/cis/${ciServer}/applications`);
    expect(byServer.body.items[0]).toMatchObject({
      code: 'payroll',
      roles: ['environment'],
      environments: ['Production'],
    });
  });

  it('exposes AI tools; recording through AI meets the policy and cannot override', async () => {
    const ai = h.kernel.registry.context('alm').ai;
    const auth = await authFor(ids.deployer);
    const found = await ai.tools.invoke<LooseJson>('alm.find_applications', { query: 'pay' }, { auth });
    expect(found.applications[0]).toMatchObject({
      code: 'payroll',
      productionVersion: '1.0.3',
      href: '/alm/payroll',
    });
    const one = await ai.tools.invoke<LooseJson>('alm.get_application', { code: 'payroll' }, { auth });
    expect(one.environments.map((e: LooseJson) => e.name)).toEqual([
      'Development',
      'Test',
      'Staging',
      'Production',
    ]);
    expect(one.latestReleases[0]).toMatchObject({ version: '1.0.0', status: 'released' });
    const ready = await ai.tools.invoke<LooseJson>(
      'alm.release_readiness',
      { application: 'payroll', version: '1.0.0' },
      { auth },
    );
    expect(ready).toMatchObject({ passed: '4/4', ready: true, productionPolicy: { outcome: 'allow' } });
    await expect(
      ai.tools.invoke(
        'alm.record_deployment',
        { application: 'payroll', environment: 'production', version: '2.0.0' },
        { auth },
      ),
    ).rejects.toMatchObject({ code: 'CHANGE_REQUIRED' });
    const ok = await ai.tools.invoke<LooseJson>(
      'alm.record_deployment',
      { application: 'payroll', environment: 'test', version: '2.0.0', status: 'failed' },
      { auth },
    );
    expect(ok).toMatchObject({ environment: 'Test', status: 'failed', policy: { outcome: 'allow' } });
    await expect(
      ai.tools.invoke(
        'alm.record_deployment',
        { application: 'payroll', environment: 'test', version: '2.0.0' },
        {
          auth: await authFor(ids.viewer),
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('offboarding', () => {
  it('clears a leaver’s application ownership and audits it', async () => {
    const res = await h.call(s.admin!, 'POST', `/api/v1/users/${ids.owner}/offboard`, { reason: 'Left' });
    expect(res.status).toBe(200);
    const after = await eventually(
      () => h.call(s.admin!, 'GET', `${API}/applications/payroll`),
      (r) => r.body.technicalOwner === null,
    );
    expect(after.body.technicalOwner).toBeNull();
    expect((await auditOf('alm.application.owner_released')).map((a) => a.entityId)).toContain(appId);
  });
});

describe('seed', () => {
  it('creates a realistic portfolio once (idempotent)', async () => {
    const db = h.kernel.db;
    // A fresh portfolio: drop the test data, seed the CMDB (CIs the seed looks up by name), then ALM.
    await db.delete(recordLinks).where(inArray(recordLinks.aType, ['alm.application', 'alm.release']));
    await db.delete(deployments);
    await db.delete(releases);
    await db.delete(applications);
    await db.delete(cis);
    await h.kernel.registry.get('cmdb')!.seed!(h.kernel.registry.context('cmdb'));
    const alm = h.kernel.registry.get('alm')!;
    await alm.seed!(h.kernel.registry.context('alm'));
    const apps = await db.select().from(applications);
    expect(apps.length).toBeGreaterThanOrEqual(14);
    for (const code of [
      'erp',
      'hr-portal',
      'corp-web',
      'exchange',
      'vpn',
      'service-desk',
      'intranet',
      'data-warehouse',
      'mobile-app',
      'legacy-crm',
    ])
      expect(
        apps.some((a) => a.code === code),
        code,
      ).toBe(true);
    const erp = apps.find((a) => a.code === 'erp')!;
    expect(erp).toMatchObject({
      name: 'Finance ERP',
      stage: 'production',
      criticality: 'critical',
      hosting: 'on_prem',
    });
    expect(erp.ciId).not.toBeNull();
    expect(apps.find((a) => a.code === 'exchange')).toMatchObject({ hosting: 'saas', vendor: 'Microsoft' });
    expect(apps.find((a) => a.code === 'intranet')).toMatchObject({
      stage: 'sunsetting',
      disposition: 'migrate',
    });
    expect(apps.find((a) => a.code === 'legacy-crm')).toMatchObject({
      stage: 'retired',
      disposition: 'eliminate',
    });

    const rels = await db
      .select({
        code: applications.code,
        version: releases.version,
        status: releases.status,
        plannedDate: releases.plannedDate,
      })
      .from(releases)
      .innerJoin(applications, eq(applications.id, releases.applicationId));
    expect(rels.length).toBeGreaterThanOrEqual(35);
    const status = (code: string, version: string) =>
      rels.find((r) => r.code === code && r.version === version)?.status;
    expect(status('erp', '12.0.0')).toBe('released');
    expect(status('erp', '12.1.0')).toBe('in_progress');
    expect(status('hr-portal', '3.4.0')).toBe('ready');
    expect(status('corp-web', '2026.10')).toBe('planned');
    expect(status('service-desk', '3.0.0')).toBe('released');

    const n = (await db.select({ n: count() }).from(deployments))[0]!.n;
    expect(n).toBeGreaterThanOrEqual(200);
    expect(n).toBeLessThanOrEqual(320);
    const prodStatuses = await db
      .select({ status: deployments.status })
      .from(deployments)
      .innerJoin(environments, eq(environments.id, deployments.environmentId))
      .where(eq(environments.kind, 'production'));
    const failed = prodStatuses.filter((d) => d.status === 'failed' || d.status === 'rolled_back').length;
    expect(failed / prodStatuses.length).toBeGreaterThan(0.02);
    expect(failed / prodStatuses.length).toBeLessThan(0.2);
    expect(prodStatuses.some((d) => d.status === 'rolled_back')).toBe(true);

    const erpEnvs = await db.select().from(environments).where(eq(environments.applicationId, erp.id));
    expect(erpEnvs.map((e) => e.kind).sort()).toEqual(['development', 'dr', 'production', 'staging', 'test']);
    expect(erpEnvs.find((e) => e.kind === 'production')!.currentVersion).toBe('12.0.1');

    const metrics = await h.call(s.admin!, 'GET', `${API}/applications/corp-web/metrics`);
    expect(metrics.body.deploymentFrequency.perWeek).toBeGreaterThan(1);
    const readiness = await h.call(
      s.admin!,
      'GET',
      `${API}/releases/${
        (
          await db
            .select()
            .from(releases)
            .where(and(eq(releases.applicationId, erp.id), eq(releases.version, '12.1.0')))
        )[0]!.id
      }/readiness`,
    );
    expect(readiness.body.checks.find((c: LooseJson) => c.key === 'tested').ok).toBe(true);

    await alm.seed!(h.kernel.registry.context('alm'));
    expect((await db.select({ n: count() }).from(applications))[0]!.n).toBe(apps.length);
  });
});
