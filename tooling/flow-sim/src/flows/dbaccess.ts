/**
 * Database access (module `dbaccess`): a person requests a role on a registered server → their manager, the role
 * owner (and information security for high-risk roles) approve → the worker provisions the account and the
 * membership on the real server → one-time password reveal → revoked, relinquished or kept; and access review
 * campaigns whose revoke decisions are applied when they close.
 *
 * The target. The seed's demo server (`contoso-erp-admin` on `isbp_demo`) shares its logins with every other stack
 * on the same PostgreSQL cluster: whichever stack seeded last holds their passwords, so it is not reliably usable from
 * the simulator. The flows therefore use a target of their own, set up once (idempotently) as a DBA and an
 * administrator would: NOLOGIN group roles `sim_dbx_*` and a least-privilege CREATEROLE login `sim_dbx_admin` holding
 * ADMIN OPTION on them (on the simulator's database, created with the cluster's superuser from `SIM_PG`), registered
 * under Administration → Database connections (`sim-dbaccess-target`), configured as a Database access server with
 * accounts `sim_dbx_u_<username>`, synced, and its roles made requestable with `dataowner` as their owner. The login's
 * password is random and kept only in `.state/` (mode 600). Memberships are checked on the server itself
 * (`pg_auth_members`, read-only).
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Json } from '../client';
import { defineFlow, type FlowContext } from '../flow';
import { assertSimDatabase } from '../safety';
import { addDays, notificationsAbout, todayIn, withExclusive } from './asset-support';

const DB_REQUEST_REF = /^DBR-\d{5,}$/;
const DB_USERS = ['dbuser1', 'dbuser2', 'dbuser3', 'dbuser4'] as const;

/* ───────────────────────────── the simulator's target ───────────────────────────── */

const SIM_PG = process.env.SIM_PG ?? 'postgres://isbp:isbp@localhost:5432';
const SIM_DB_NAME = process.env.SIM_DB_NAME ?? 'isbp_sim';
const CONNECTION_KEY = 'sim-dbaccess-target';
const ADMIN_LOGIN = 'sim_dbx_admin';
const ACCOUNT_PATTERN = 'sim_dbx_u_{username}';

type RoleKey = 'reader' | 'analyst' | 'hi';
interface RoleSpec {
  key: RoleKey;
  roleName: string;
  name: { en: string; 'zh-TW': string; 'ja-JP': string };
  risk: 'low' | 'medium' | 'high';
  defaultDays: number | null;
  maxDays: number | null;
  allowPermanent: boolean;
  justificationRequired: boolean;
}

const ROLES: RoleSpec[] = [
  {
    key: 'reader',
    roleName: 'sim_dbx_reader',
    name: { en: 'Sim reporting reader', 'zh-TW': 'Sim 報表讀取', 'ja-JP': 'Sim レポート閲覧' },
    risk: 'low',
    defaultDays: 30,
    maxDays: 90,
    allowPermanent: false,
    justificationRequired: true,
  },
  {
    key: 'analyst',
    roleName: 'sim_dbx_analyst',
    name: { en: 'Sim analyst', 'zh-TW': 'Sim 分析師', 'ja-JP': 'Sim アナリスト' },
    risk: 'medium',
    defaultDays: null,
    maxDays: null,
    allowPermanent: true,
    justificationRequired: false,
  },
  {
    key: 'hi',
    roleName: 'sim_dbx_hi',
    name: {
      en: 'Sim data fix (high risk)',
      'zh-TW': 'Sim 資料修正（高風險）',
      'ja-JP': 'Sim データ修正 (高リスク)',
    },
    risk: 'high',
    defaultDays: 7,
    maxDays: 14,
    allowPermanent: false,
    justificationRequired: true,
  },
];

export interface DbTarget {
  serverId: string;
  roles: Record<RoleKey, { id: string; spec: RoleSpec }>;
}

const STATE_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.state',
  'dbaccess-target.json',
);

function superuserUrl(): string {
  assertSimDatabase(SIM_DB_NAME);
  const url = new URL(SIM_PG);
  url.pathname = `/${SIM_DB_NAME}`;
  return url.toString();
}

async function withSuperuser<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: superuserUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** DDL built on the server from bound parameters (`format('%I', '%L')`), like the seed does. */
async function exec(client: pg.Client, template: string, ...args: string[]) {
  const { rows } = await client.query<{ stmt: string }>(
    `SELECT format($1, ${args.map((_, i) => `$${i + 2}::text`).join(', ')}) AS stmt`,
    [template, ...args],
  );
  await client.query(rows[0]!.stmt);
}

/** The group roles and the admin login on the server (a DBA's part, outside the platform). */
async function ensureServerRoles(): Promise<string> {
  let stored: { password?: string } = {};
  if (existsSync(STATE_FILE))
    try {
      stored = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch {
      stored = {};
    }
  const password = stored.password ?? `Sim-${randomBytes(18).toString('base64url')}`;
  await withSuperuser(async (c) => {
    const exists = async (name: string) =>
      (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name])).rows.length > 0;
    for (const r of ROLES)
      if (!(await exists(r.roleName))) await exec(c, 'CREATE ROLE %I NOLOGIN', r.roleName);
    if (!(await exists(ADMIN_LOGIN)))
      await exec(c, 'CREATE ROLE %I LOGIN CREATEROLE PASSWORD %L', ADMIN_LOGIN, password);
    else if (!stored.password)
      await exec(c, 'ALTER ROLE %I WITH LOGIN CREATEROLE PASSWORD %L', ADMIN_LOGIN, password);
    for (const r of ROLES) await exec(c, 'GRANT %I TO %I WITH ADMIN OPTION', r.roleName, ADMIN_LOGIN);
  });
  if (!stored.password) {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, `${JSON.stringify({ password }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(STATE_FILE, 0o600);
  }
  return password;
}

let target: Promise<DbTarget> | null = null;

/** The simulator's Database access server, set up once per process (and once per database). */
export function dbTarget(ctx: FlowContext): Promise<DbTarget> {
  target ??= setUpTarget(ctx).catch((err) => {
    target = null;
    throw err;
  });
  return target;
}

async function setUpTarget(ctx: FlowContext): Promise<DbTarget> {
  const password = await ensureServerRoles();
  const admin = ctx.as('admin');
  const dba = ctx.as('dba');
  const url = new URL(SIM_PG);

  // The connection (Administration → Database connections).
  const list = ctx.expect.ok(await admin.get('/databases'), 'list database connections').body.items as Json[];
  let conn = list.find((c) => c.key === CONNECTION_KEY);
  if (!conn) {
    conn = ctx.expect.status(
      await admin.post('/databases', {
        key: CONNECTION_KEY,
        name: 'Flow simulation – account administration',
        description: 'CREATEROLE login with admin option on the sim_dbx_* roles (tooling/flow-sim)',
        engine: 'postgres',
        host: url.hostname,
        port: Number(url.port || 5432),
        database: SIM_DB_NAME,
        username: ADMIN_LOGIN,
        password,
        options: { tls: 'off', ca: null, instanceName: null, domain: null },
        purposes: ['admin'],
        readOnly: false,
      }),
      201,
      'register the simulator’s database connection',
    ).body;
  } else {
    const test = ctx.expect.ok(
      await admin.post(`/databases/${conn.id}/test`, {}),
      'test the connection',
    ).body;
    if (!test.ok)
      ctx.expect.ok(await admin.patch(`/databases/${conn.id}`, { password }), 'store the login’s password');
  }

  // The Database access server on it, synced, with its requestable roles.
  const servers = ctx.expect.ok(await dba.get('/dbaccess/servers'), 'list servers').body.items as Json[];
  let server = servers.find((s) => s.connectionId === conn.id || s.connection?.id === conn.id);
  if (!server)
    server = ctx.expect.status(
      await dba.post('/dbaccess/servers', {
        connectionId: conn.id,
        displayName: 'Flow simulation (PostgreSQL)',
        environment: 'test',
        accountPattern: ACCOUNT_PATTERN,
        authMode: 'password',
        autoSync: true,
      }),
      201,
      'configure the server',
    ).body;
  ctx.expect.ok(await dba.post(`/dbaccess/servers/${server.id}/sync`, {}), 'sync the inventory');
  const owner = ctx.user('dataowner').id;
  const existing = ctx.expect.ok(await dba.get(`/dbaccess/servers/${server.id}/roles`), 'list roles').body
    .items as Json[];
  const roles = {} as DbTarget['roles'];
  for (const spec of ROLES) {
    const fields = {
      name: spec.name,
      description: { en: 'Requested by the flow simulator' },
      ownerUserId: owner,
      ownerGroupId: null,
      risk: spec.risk,
      defaultDays: spec.defaultDays,
      maxDays: spec.maxDays,
      allowPermanent: spec.allowPermanent,
      justificationRequired: spec.justificationRequired,
      active: true,
    };
    const found = existing.find((r) => r.roleName === spec.roleName);
    const row = found
      ? ctx.expect.ok(await dba.patch(`/dbaccess/roles/${found.id}`, fields), `update ${spec.roleName}`).body
      : ctx.expect.status(
          await dba.post(`/dbaccess/servers/${server.id}/roles`, { roleName: spec.roleName, ...fields }),
          201,
          `make ${spec.roleName} requestable`,
        ).body;
    roles[spec.key] = { id: row.id, spec };
  }
  return { serverId: server.id, roles };
}

/** On the server itself: is the account a member of the role, and may it sign in? (read-only) */
async function onServer(account: string, roleName: string) {
  return withSuperuser(async (c) => {
    const member = await c.query(
      `SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
        WHERE r.rolname = $1 AND u.rolname = $2`,
      [roleName, account],
    );
    const login = await c.query<{ rolcanlogin: boolean; valid: boolean }>(
      `SELECT rolcanlogin, (rolvaliduntil IS NULL OR rolvaliduntil > now()) AS valid FROM pg_roles WHERE rolname = $1`,
      [account],
    );
    return {
      member: member.rows.length > 0,
      exists: login.rows.length > 0,
      canLogin: Boolean(login.rows[0]?.rolcanlogin && login.rows[0]?.valid),
    };
  });
}

/* ───────────────────────────── shared steps ───────────────────────────── */

interface Requested {
  request: Json;
  role: { id: string; spec: RoleSpec };
  user: string;
  expiresOn: string | null;
}

/** The requester asks for the role (sometimes twice at once). */
async function requestRole(ctx: FlowContext, user: string, role: Requested['role']): Promise<Requested> {
  const me = ctx.as(user);
  const today = todayIn();
  const { spec } = role;
  const permanent = spec.allowPermanent && ctx.rand.bool(0.4);
  const expiresOn = permanent ? null : addDays(today, ctx.rand.int(1, spec.maxDays ?? 120));
  const justification = spec.justificationRequired || ctx.rand.bool(0.5) ? ctx.rand.sentence(4, 12) : '';
  const body = { items: [{ roleId: role.id, expiresOn }], justification };
  const request = await ctx.step('the requester asks for the role', async () => {
    let res;
    if (ctx.rand.bool(0.15)) {
      ctx.tag('double submit');
      const both = await Promise.all([
        me.post('/dbaccess/requests', body),
        me.post('/dbaccess/requests', body),
      ]);
      res = ctx.expect.oneOk(both, 'one request is made', [409]);
    } else res = ctx.expect.status(await me.post('/dbaccess/requests', body), 201);
    const items = res.body.items as Json[];
    ctx.expect.equal(items.length, 1, 'requests made');
    const r = items[0]!;
    ctx.expect.equal(r.status, 'pending', 'status');
    ctx.expect.match(r.reference, DB_REQUEST_REF, 'reference');
    ctx.expect.truthy(r.instanceId, 'an approval started');
    return r;
  });
  return { request, role, user, expiresOn };
}

/** Manager, role owner and (high risk) information security approve; returns the active grant. */
async function approveAndProvision(ctx: FlowContext, r: Requested): Promise<Json> {
  const me = ctx.as(r.user);
  await ctx.step('the manager, the role owner (and security) approve', async () => {
    const twice = ctx.rand.bool(0.1);
    if (twice) ctx.tag('double approve');
    const first = await ctx.approvals.decide(r.request.instanceId, 'manager', 'approve', {
      viaInbox: r.request.reference,
      twice,
    });
    ctx.expect.equal(first, 'running', 'the owner follows');
    const owner = await ctx.approvals.decide(r.request.instanceId, 'dataowner', 'approve');
    if (r.role.spec.risk === 'high') {
      ctx.expect.equal(owner, 'running', 'information security follows for a high-risk role');
      const { status, decisions } = await ctx.approvals.approveAll(r.request.instanceId, {
        prefer: ['infosec'],
        avoid: [r.user],
      });
      ctx.expect.equal(status, 'approved', 'outcome');
      ctx.expect.equal(
        decisions.map((d) => d.stepId),
        ['security'],
        'steps decided after the owner',
      );
    } else ctx.expect.equal(owner, 'approved', 'outcome');
  });
  return ctx.step('the grant is provisioned on the server', async () => {
    const approved = await ctx.eventually(
      () => me.get(`/dbaccess/requests/${r.request.reference}`),
      (x) => x.status === 200 && Boolean(x.body.grant),
      { label: 'the approved request' },
    );
    ctx.expect.equal(approved.body.status, 'approved', 'request status');
    const grantId = approved.body.grant.id as string;
    const g = await ctx.eventually(
      () => ctx.as('dba').get(`/dbaccess/grants/${grantId}`),
      (x) => x.status === 200 && ['active', 'failed'].includes(x.body.status),
      { label: 'provisioning', timeoutMs: 60_000 },
    );
    if (g.body.status === 'failed') ctx.fail('provisioning failed', { lastError: g.body.lastError });
    const account = `sim_dbx_u_${ctx.user(r.user).username.replace(/[^a-z0-9_]/g, '_')}`;
    ctx.expect.equal(
      [g.body.accountName, g.body.source, g.body.grantee?.id],
      [account, 'request', ctx.user(r.user).id],
      'account, source, grantee',
    );
    if (r.expiresOn) {
      ctx.expect.truthy(g.body.expiresAt, 'a time-bound grant ends');
      const end = new Date(g.body.expiresAt).getTime();
      const day = Date.parse(`${r.expiresOn}T00:00:00Z`);
      ctx.expect.truthy(
        end > day - 86_400_000 && end < day + 2 * 86_400_000,
        `it ends on ${r.expiresOn} (got ${g.body.expiresAt})`,
      );
    } else ctx.expect.equal(g.body.expiresAt, null, 'a permanent grant has no end');
    const state = await onServer(account, r.role.spec.roleName);
    ctx.expect.equal(state, { member: true, exists: true, canLogin: true }, `${account} on the server`);
    return g.body as Json;
  });
}

/** Ends the grant one way or another; checks the server and the grantee's view. */
async function endGrant(ctx: FlowContext, r: Requested, grant: Json) {
  const me = ctx.as(r.user);
  const how = ctx.rand.weighted([
    ['owner revokes', 4],
    ['grantee relinquishes', 3],
    ['DBA revokes', 2],
  ] as const);
  ctx.tag(how);
  const reason = `${ctx.rand.sentence(3, 8)} (${ctx.rand.suffix()})`;
  await ctx.step(`the ${how.split(' ')[0]} ends it`, async () => {
    if (how === 'grantee relinquishes') {
      const res = ctx.expect.ok(await me.post(`/dbaccess/grants/${grant.id}/relinquish`, { reason }));
      ctx.expect.truthy(['revoking', 'revoked'].includes(res.body.status), `status ${res.body.status}`);
      return;
    }
    const who = how === 'owner revokes' ? 'dataowner' : 'dba';
    ctx.expect.status(
      await ctx
        .as(ctx.rand.pick(['employee', r.user]))
        .post(`/dbaccess/grants/${grant.id}/revoke`, { reason }),
      [403, 404],
      'someone else may not revoke it',
    );
    if (ctx.rand.bool(0.15)) {
      ctx.tag('double revoke');
      const both = await Promise.all(
        [1, 2].map(() => ctx.as(who).post(`/dbaccess/grants/${grant.id}/revoke`, { reason })),
      );
      ctx.expect.oneOk(both, 'one revocation goes through', [409]);
    } else {
      const res = ctx.expect.ok(await ctx.as(who).post(`/dbaccess/grants/${grant.id}/revoke`, { reason }));
      ctx.expect.truthy(['revoking', 'revoked'].includes(res.body.status), `status ${res.body.status}`);
    }
  });
  await ctx.step('the membership is gone', async () => {
    const g = await ctx.eventually(
      () => ctx.as('dba').get(`/dbaccess/grants/${grant.id}`),
      (x) => x.status === 200 && ['revoked', 'failed'].includes(x.body.status),
      { label: 'the revocation', timeoutMs: 60_000 },
    );
    if (g.body.status === 'failed') ctx.fail('revoking failed', { lastError: g.body.lastError });
    ctx.expect.equal(
      g.body.endReason,
      how === 'grantee relinquishes' ? 'relinquished' : 'revoked',
      'end reason',
    );
    const state = await onServer(grant.accountName, r.role.spec.roleName);
    ctx.expect.equal(state.member, false, `${grant.accountName} is no longer a member`);
    const mine = ctx.expect.ok(await me.get('/dbaccess/me/access')).body;
    const row = (mine.grants as Json[]).find((x) => x.id === grant.id);
    ctx.expect.truthy(
      !row || !['active', 'provisioning'].includes(row.status),
      'my access no longer lists it as live',
    );
    const catalog = ctx.expect.ok(await me.get('/dbaccess/catalog', { query: { serverId: grant.server.id } }))
      .body.items as Json[];
    ctx.expect.equal(
      ctx.expect.find(catalog, (i) => i.id === r.role.id, 'still in the catalog').heldGrantId,
      null,
      'held',
    );
  });
  if (how !== 'grantee relinquishes')
    await ctx.step('the grantee is told', async () => {
      await ctx.eventually(
        // In the grantee's language: the reason given is what identifies it.
        () => notificationsAbout(ctx, r.user, 'dbaccess.grant.revoked', reason),
        (n) => n.length > 0,
        { label: 'the revoked notification' },
      );
    });
}

/** A person × role that no other run of this process is using (one live request or grant at a time). */
function pairsFor(roleKey: RoleKey) {
  return DB_USERS.map((u) => `${u}:${roleKey}`);
}

/* ───────────────────────────── dbaccess-request ───────────────────────────── */

export const dbaccessRequest = defineFlow({
  name: 'dbaccess-request',
  area: 'dbaccess',
  description:
    'Request a database role → manager, owner (+ security) approve, or reject/cancel → provisioned → reveal → revoked',
  personas: [...DB_USERS, 'manager', 'dataowner', 'infosec', 'dba', 'admin', 'employee'],
  timeoutMs: 240_000,
  async run(ctx) {
    const t = await ctx.step('the simulator’s server is ready', () => dbTarget(ctx));
    const roleKey = ctx.rand.weighted([
      ['reader', 4],
      ['analyst', 3],
      ['hi', 2],
    ] as const);
    ctx.tag(`risk ${t.roles[roleKey].spec.risk}`);
    await withExclusive(ctx, pairsFor(roleKey), async (pair) => {
      const user = pair.split(':')[0]!;
      const me = ctx.as(user);
      const role = t.roles[roleKey];
      const today = todayIn();

      await ctx.step('the requester finds the role in the catalog', async () => {
        const items = ctx.expect.ok(await me.get('/dbaccess/catalog', { query: { serverId: t.serverId } }))
          .body.items as Json[];
        const item = ctx.expect.find(items, (i) => i.id === role.id, 'the role is offered');
        ctx.expect.equal([item.heldGrantId, item.pendingRequest], [null, null], 'held, pending');
        ctx.expect.equal(item.risk, role.spec.risk, 'risk');
      });

      if (ctx.rand.bool(0.25))
        await ctx.step('requests the role does not allow are refused', async () => {
          if (role.spec.maxDays) {
            const tooLong = await me.post('/dbaccess/requests', {
              items: [
                { roleId: role.id, expiresOn: addDays(today, role.spec.maxDays + ctx.rand.int(1, 60)) },
              ],
              justification: ctx.rand.sentence(),
            });
            ctx.expect.code(tooLong, 'DURATION_TOO_LONG', 409);
          }
          if (!role.spec.allowPermanent)
            ctx.expect.code(
              await me.post('/dbaccess/requests', {
                items: [{ roleId: role.id, expiresOn: null }],
                justification: ctx.rand.sentence(),
              }),
              'DURATION_TOO_LONG',
            );
          if (role.spec.justificationRequired)
            ctx.expect.status(
              await me.post('/dbaccess/requests', {
                items: [{ roleId: role.id, expiresOn: addDays(today, 5) }],
              }),
              400,
              'a request without a justification is refused',
            );
        });

      const r = await requestRole(ctx, user, role);
      const ref = r.request.reference as string;

      await ctx.step('only the people in it see the request', async () => {
        ctx.expect.ok(await ctx.as('manager').get(`/dbaccess/requests/${ref}`), 'the manager sees it');
        ctx.expect.status(
          await ctx.as('employee').get(`/dbaccess/requests/${ref}`),
          [403, 404],
          'an outsider',
        );
        const again = await me.post('/dbaccess/requests', {
          items: [{ roleId: role.id, expiresOn: r.expiresOn }],
          justification: ctx.rand.sentence(),
        });
        ctx.expect.code(again, 'DUPLICATE_REQUEST', 409);
        const items = ctx.expect.ok(await me.get('/dbaccess/catalog', { query: { serverId: t.serverId } }))
          .body.items as Json[];
        ctx.expect.equal(
          ctx.expect.find(items, (i) => i.id === role.id, 'the role').pendingRequest?.reference,
          ref,
          'the catalog shows the pending request',
        );
      });

      const outcome = ctx.rand.weighted([
        ['approved', 7],
        ['manager rejects', 1],
        ['owner rejects', 1],
        ['cancelled', 1],
      ] as const);
      ctx.tag(outcome);

      if (outcome === 'cancelled') {
        await ctx.step('the requester cancels it', async () => {
          const res = ctx.expect.ok(await me.post(`/dbaccess/requests/${ref}/cancel`, {}));
          ctx.expect.equal(res.body.status, 'cancelled', 'status');
          ctx.expect.status(
            await me.post(`/dbaccess/requests/${ref}/cancel`, {}),
            [409],
            'cancelling twice is refused',
          );
          const inst = await ctx.approvals.instance(r.request.instanceId);
          ctx.expect.truthy(inst.status !== 'running', `the approval stopped (${inst.status})`);
        });
        return;
      }
      if (outcome !== 'approved') {
        await ctx.step(`the ${outcome.split(' ')[0]} rejects it`, async () => {
          if (outcome === 'owner rejects')
            await ctx.approvals.decide(r.request.instanceId, 'manager', 'approve', { viaInbox: ref });
          const who = outcome === 'owner rejects' ? 'dataowner' : 'manager';
          const res = await ctx.approvals.decide(r.request.instanceId, who, 'reject', {
            comment: ctx.rand.sentence(3, 8),
          });
          ctx.expect.equal(res, 'rejected', 'outcome');
          const done = await ctx.eventually(
            () => me.get(`/dbaccess/requests/${ref}`),
            (x) => x.body?.status === 'rejected',
            { label: 'the rejection' },
          );
          ctx.expect.equal(done.body.grant, null, 'no grant');
          await ctx.eventually(
            () => notificationsAbout(ctx, user, 'dbaccess.request.rejected', ref),
            (n) => n.length === 1,
            { label: 'the rejected notification' },
          );
        });
        return;
      }

      const grant = await approveAndProvision(ctx, r);

      await ctx.step('the password is shown once, to the grantee only', async () => {
        const mine = ctx.expect.ok(await me.get('/dbaccess/me/access')).body;
        const g = ctx.expect.find(
          mine.grants as Json[],
          (x) => x.id === grant.id,
          'my access lists the grant',
        );
        if (!g.reveal?.available) {
          // The account already held another role: its password did not change.
          ctx.tag('no reveal (account in use)');
          return;
        }
        ctx.expect.status(
          await ctx.as('employee').post(`/dbaccess/reveals/${g.reveal.id}`, {}),
          [403, 404],
          'someone else may not reveal it',
        );
        const first = ctx.expect.ok(await me.post(`/dbaccess/reveals/${g.reveal.id}`, {}), 'reveal');
        ctx.expect.equal(first.body.accountName, grant.accountName, 'the account');
        ctx.expect.truthy(
          typeof first.body.password === 'string' && first.body.password.length >= 16,
          'a generated password',
        );
        ctx.expect.code(await me.post(`/dbaccess/reveals/${g.reveal.id}`, {}), 'REVEAL_EXPIRED', 410);
      });

      await ctx.step('a second request is refused while it is held', async () => {
        const again = await me.post('/dbaccess/requests', {
          items: [{ roleId: role.id, expiresOn: r.expiresOn }],
          justification: ctx.rand.sentence(),
        });
        ctx.expect.code(again, 'ALREADY_GRANTED');
        const owned = ctx.expect.ok(
          await ctx.as('dataowner').get('/dbaccess/grants', { query: { status: 'live', roleId: role.id } }),
        ).body.items as Json[];
        ctx.expect.find(owned, (x) => x.id === grant.id, 'the owner sees the grant of their role');
        ctx.expect.status(await me.get('/dbaccess/grants'), 403, 'the grantee may not list all access');
        ctx.expect.ok(
          await ctx.as('manager').get(`/dbaccess/people/${ctx.user(user).id}/access`),
          'their manager sees it',
        );
      });

      await endGrant(ctx, r, grant);
    });
  },
});

/* ───────────────────────────── dbaccess-review ───────────────────────────── */

export const dbaccessReview = defineFlow({
  name: 'dbaccess-review',
  area: 'dbaccess',
  description:
    'Access review campaign over the server: the role owner keeps or revokes the run’s grant → close → applied',
  personas: [...DB_USERS, 'manager', 'dataowner', 'infosec', 'dba', 'admin', 'employee'],
  timeoutMs: 240_000,
  async run(ctx) {
    const t = await ctx.step('the simulator’s server is ready', () => dbTarget(ctx));
    const roleKey = ctx.rand.pick(['reader', 'analyst'] as const);
    await withExclusive(ctx, pairsFor(roleKey), async (pair) => {
      const user = pair.split(':')[0]!;
      const sfx = ctx.rand.suffix();
      const r = await requestRole(ctx, user, t.roles[roleKey]);
      const grant = await approveAndProvision(ctx, r);
      const reviewer = ctx.as('infosec');
      const today = todayIn();

      const review = await ctx.step('information security opens a campaign over the server', async () => {
        ctx.expect.status(
          await ctx.as('dataowner').post('/dbaccess/reviews', { name: `x ${sfx}`, dueOn: addDays(today, 7) }),
          403,
          'a role owner may not open one',
        );
        const res = ctx.expect.status(
          await reviewer.post('/dbaccess/reviews', {
            name: `Sim access review ${sfx}`,
            serverIds: [t.serverId],
            dueOn: addDays(today, ctx.rand.int(3, 30)),
            reviewerRule: 'owner',
            policy: 'keep',
            recurrence: 'none',
          }),
          201,
        ).body;
        ctx.expect.equal(res.status, 'active', 'status');
        ctx.expect.truthy(res.totals.items >= 1, 'it has items');
        return res as Json;
      });

      const item = await ctx.step('the role owner finds their item', async () => {
        const mine = ctx.expect.ok(
          await ctx.as('dataowner').get(`/dbaccess/reviews/${review.id}/items`, {
            query: { view: 'mine', pageSize: 200 },
          }),
        ).body.items as Json[];
        const it = ctx.expect.find(mine, (i) => i.grantId === grant.id, 'the run’s grant is under review');
        ctx.expect.equal([it.canDecide, it.reviewer?.id], [true, ctx.user('dataowner').id], 'reviewer');
        ctx.expect.status(
          await ctx.as(user).post(`/dbaccess/reviews/${review.id}/decisions`, {
            itemIds: [it.id],
            decision: 'keep',
          }),
          [403, 404],
          'the grantee may not decide their own access',
        );
        ctx.expect.status(
          await ctx.as('dataowner').post(`/dbaccess/reviews/${review.id}/decisions`, {
            itemIds: [it.id],
            decision: 'revoke',
          }),
          400,
          'revoking needs a reason',
        );
        return it;
      });

      const revoke = ctx.rand.bool(0.6);
      ctx.tag(revoke ? 'revoked in review' : 'kept in review');
      const comment = ctx.rand.sentence(3, 10);
      await ctx.step(revoke ? 'the owner revokes it' : 'the owner keeps it', async () => {
        const res = ctx.expect.ok(
          await ctx.as('dataowner').post(`/dbaccess/reviews/${review.id}/decisions`, {
            itemIds: [item.id],
            decision: revoke ? 'revoke' : 'keep',
            comment,
          }),
        );
        ctx.expect.equal(res.body.updated, 1, 'items decided');
      });

      await ctx.step('information security closes the campaign', async () => {
        let res;
        if (ctx.rand.bool(0.15)) {
          ctx.tag('double close');
          const both = await Promise.all(
            [1, 2].map(() => reviewer.post(`/dbaccess/reviews/${review.id}/close`, {})),
          );
          res = ctx.expect.oneOk(both, 'one close goes through', [409]);
        } else res = ctx.expect.ok(await reviewer.post(`/dbaccess/reviews/${review.id}/close`, {}));
        ctx.expect.equal(res.body.status, 'closed', 'status');
        ctx.expect.code(
          await reviewer.post(`/dbaccess/reviews/${review.id}/close`, {}),
          'REVIEW_CLOSED',
          409,
        );
        ctx.expect.code(
          await ctx.as('dataowner').post(`/dbaccess/reviews/${review.id}/decisions`, {
            itemIds: [item.id],
            decision: 'keep',
          }),
          'REVIEW_CLOSED',
          409,
        );
      });

      await ctx.step('the decision is applied', async () => {
        if (revoke) {
          const g = await ctx.eventually(
            () => ctx.as('dba').get(`/dbaccess/grants/${grant.id}`),
            (x) => x.status === 200 && ['revoked', 'failed'].includes(x.body.status),
            { label: 'the review revocation', timeoutMs: 60_000 },
          );
          ctx.expect.equal([g.body.status, g.body.endReason], ['revoked', 'review'], 'status, end reason');
          const state = await onServer(grant.accountName, r.role.spec.roleName);
          ctx.expect.equal(state.member, false, 'no longer a member');
        } else {
          const g = ctx.expect.ok(await ctx.as('dba').get(`/dbaccess/grants/${grant.id}`)).body;
          ctx.expect.equal(g.status, 'active', 'kept');
        }
        const items = ctx.expect.ok(
          await reviewer.get(`/dbaccess/reviews/${review.id}/items`, {
            query: { view: 'decided', pageSize: 200 },
          }),
        ).body.items as Json[];
        const it = ctx.expect.find(items, (i) => i.id === item.id, 'the decided item');
        ctx.expect.equal(it.outcome, revoke ? 'revoked' : 'kept', 'outcome');
        const csv = await reviewer.get(`/dbaccess/reviews/${review.id}/report.csv`);
        ctx.expect.ok(csv, 'the report');
        ctx.expect.truthy(
          typeof csv.body === 'string' && csv.body.includes(grant.accountName) && csv.body.includes(comment),
          'the report names the account and the reason',
        );
      });

      if (!revoke)
        await ctx.step('the grantee gives it back', async () => {
          ctx.expect.ok(
            await ctx
              .as(user)
              .post(`/dbaccess/grants/${grant.id}/relinquish`, { reason: ctx.rand.sentence(3, 6) }),
          );
          await ctx.eventually(
            () => ctx.as('dba').get(`/dbaccess/grants/${grant.id}`),
            (x) => x.body?.status === 'revoked',
            { label: 'the relinquished grant', timeoutMs: 60_000 },
          );
        });
    });
  },
});
