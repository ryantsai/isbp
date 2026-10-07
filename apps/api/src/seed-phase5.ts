/**
 * Phase 5 demo data: the Integrations Hub connected to the stand-in ServiceDesk Plus and Azure DevOps Server
 * (`tooling/integration-mocks`, started by `pnpm dev:services`).
 *
 * - `seedPhase5` grants the hub's roles to demo groups.
 * - `seedPhase5Links` (after every module seed) creates the two connections and their sync profiles, runs a
 *   first sync of each (so tickets, assets, articles, tasks and repositories are linked), registers the
 *   webhooks with the stand-ins, and leaves one open conflict to resolve.
 *
 * Connections are only created when `INTEGRATION_MOCKS_URL` is set (it defaults to http://localhost:4100
 * outside production) and the stand-ins answer. Production seeds create none.
 */
import { users } from '@isbp/db/schema';
import { MOCK_CREDENTIALS } from '@isbp/integration-mocks/credentials';
import type { AuthContext } from '@isbp/sdk/server';
import { eq, sql } from 'drizzle-orm';
import { buildAuthContext } from './kernel/http/auth';
import type { Kernel } from './kernel/kernel';
import { toSessionUser } from './kernel/sessions';
import { type Grant, grantDemoRoles } from './seed-phase2';

const GRANTS: Grant[] = [
  { role: 'integrations-admin', groups: ['it-admins'] },
  { role: 'integrations-viewer', groups: ['service-desk', 'dev-team', 'pmo'] },
];

export const DEMO_SDP_CONNECTION = 'Contoso ServiceDesk Plus';
export const DEMO_ADO_CONNECTION = 'Contoso Azure DevOps Server';

export async function seedPhase5(kernel: Kernel): Promise<void> {
  if (!kernel.registry.get('integrations')) return;
  await grantDemoRoles(kernel, GRANTS, 'Phase 5 demo access');
}

/** The stand-ins' base URL, or null when the demo connections shouldn't be created. */
async function mocksUrl(kernel: Kernel): Promise<string | null> {
  const configured =
    process.env.INTEGRATION_MOCKS_URL ?? (kernel.config.isProd ? undefined : 'http://localhost:4100');
  if (!configured) return null;
  const base = configured.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/_mock/health`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) return base;
  } catch {
    // not running
  }
  kernel.logger.warn(
    { url: base },
    'integration stand-ins are not reachable: skipping the demo integrations (start `pnpm dev:services`)',
  );
  return null;
}

async function mock(base: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
}

async function idOf(kernel: Kernel, query: ReturnType<typeof sql>): Promise<string | null> {
  const { rows } = await kernel.db.execute<{ id: string }>(query);
  return rows[0]?.id ?? null;
}

export async function seedPhase5Links(kernel: Kernel): Promise<void> {
  if (!kernel.registry.get('integrations') || !kernel.registry.get('sdp') || !kernel.registry.get('azdo'))
    return;
  const integrations = await import('@isbp/module-integrations/server');
  const ctx = kernel.registry.context('integrations');
  // The demo admin sets the integrations up, as a person would (profiles need to see their containers).
  const [admin] = await kernel.db.select().from(users).where(eq(users.username, 'admin'));
  if (!admin) return;
  const auth: AuthContext = buildAuthContext(
    { type: 'user', id: admin.id, name: admin.displayName },
    toSessionUser(admin),
    null,
    await kernel.rbac.permissionsFor(admin.id),
  );
  // Name the profile in seed failures (the API's validation details are otherwise lost in the log).
  const hub = {
    ...integrations,
    createConnection: (c: typeof ctx, input: Parameters<typeof integrations.createConnection>[1]) =>
      integrations.createConnection(c, input, auth),
    createProfile: async (c: typeof ctx, input: Parameters<typeof integrations.createProfile>[1]) => {
      try {
        return await integrations.createProfile(c, input, auth);
      } catch (err) {
        throw new Error(
          `demo profile "${input.name}": ${(err as Error).message} ${JSON.stringify((err as { details?: unknown }).details ?? '')}`,
          { cause: err },
        );
      }
    },
  };
  if (await hub.connectionByName(ctx, DEMO_SDP_CONNECTION)) return;
  const base = await mocksUrl(kernel);
  if (!base) return;
  const log = kernel.logger;

  // A fresh ISBP database starts from a fresh stand-in, so earlier demo pushes don't come back as new records.
  await mock(base, '/_mock/reset', {});

  /* ── ServiceDesk Plus ── */
  const { connection: sdp } = await hub.createConnection(ctx, {
    name: DEMO_SDP_CONNECTION,
    type: 'sdp.server',
    config: { baseUrl: `${base}/sdp` },
    secrets: { apiKey: MOCK_CREDENTIALS.sdp.apiKey },
  });
  const requests = await hub.createProfile(ctx, {
    connectionId: sdp.id,
    name: 'Requests ↔ tickets',
    objectType: 'request',
    entity: 'itsm.ticket',
    direction: 'both',
    createLocal: true,
    conflictPolicy: 'manual',
    comments: true,
    intervalMinutes: 15,
  });
  const problems = await hub.createProfile(ctx, {
    connectionId: sdp.id,
    name: 'Problems → tickets',
    objectType: 'problem',
    entity: 'itsm.ticket',
    direction: 'pull',
    intervalMinutes: 30,
  });
  const changes = await hub.createProfile(ctx, {
    connectionId: sdp.id,
    name: 'Changes → changes',
    objectType: 'change',
    entity: 'itsm.change',
    direction: 'pull',
    intervalMinutes: 30,
  });
  const assets = await hub.createProfile(ctx, {
    connectionId: sdp.id,
    name: 'Assets ↔ assets',
    objectType: 'asset',
    entity: 'itam.asset',
    direction: 'both',
    matchRule: { local: 'serialNumber', remote: 'serial_number' },
    // ServiceDesk Plus keeps the asset register: where both sides differ, its values win.
    conflictPolicy: 'remote',
    intervalMinutes: 60,
  });
  const solutions = await hub.createProfile(ctx, {
    connectionId: sdp.id,
    name: 'Solutions → knowledge',
    objectType: 'solution',
    entity: 'knowledge.article',
    direction: 'pull',
    matchRule: { local: 'title', remote: 'title' },
    intervalMinutes: 60,
  });

  /* ── Azure DevOps Server ── */
  const { connection: ado } = await hub.createConnection(ctx, {
    name: DEMO_ADO_CONNECTION,
    type: 'azdo.server',
    config: { collectionUrl: `${base}/ado/${MOCK_CREDENTIALS.ado.collection}`, apiVersion: '7.2' },
    secrets: { pat: MOCK_CREDENTIALS.ado.pat },
  });
  const scopes = await kernel.registry
    .context('integrations')
    .connectors.open('azdo.server', {
      id: ado.id,
      config: ado.config,
      secrets: { pat: MOCK_CREDENTIALS.ado.pat },
    })
    .scopes('work-item');
  const scope = (name: string) => scopes.find((s) => s.name === name)?.id ?? name;
  const erp = await idOf(kernel, sql`select id from projects.projects where name = 'ERP upgrade to v12'`);
  const network = await idOf(
    kernel,
    sql`select id from projects.projects where name = 'Network refresh 2026'`,
  );
  const financeErp = await idOf(kernel, sql`select id from alm.applications where name = 'Finance ERP'`);
  const vpn = await idOf(kernel, sql`select id from alm.applications where name = 'Remote Access VPN'`);

  const teamProjects = await hub.createProfile(ctx, {
    connectionId: ado.id,
    name: 'Team projects → projects',
    objectType: 'project',
    entity: 'projects.project',
    direction: 'pull',
    createLocal: false,
    matchRule: { local: 'name', remote: 'name' },
    intervalMinutes: 240,
  });
  const profiles = [requests, problems, changes, assets, solutions, teamProjects];
  if (erp) {
    profiles.push(
      await hub.createProfile(ctx, {
        connectionId: ado.id,
        name: 'ERP work items ↔ tasks',
        objectType: 'work-item',
        remoteScope: scope('ERP'),
        entity: 'projects.task',
        containerId: erp,
        direction: 'both',
        createLocal: true,
        createRemote: true,
        matchRule: { local: 'title', remote: 'System.Title' },
        // The team plans in Azure DevOps: where both sides differ, its values win.
        conflictPolicy: 'remote',
        comments: true,
        intervalMinutes: 10,
      }),
    );
  }
  if (network) {
    profiles.push(
      await hub.createProfile(ctx, {
        connectionId: ado.id,
        name: 'Network work items → tasks',
        objectType: 'work-item',
        remoteScope: scope('Network'),
        entity: 'projects.task',
        containerId: network,
        direction: 'pull',
        matchRule: { local: 'title', remote: 'System.Title' },
        intervalMinutes: 30,
      }),
    );
  }
  for (const [project, app] of [
    ['ERP', financeErp],
    ['Network', vpn],
  ] as const) {
    if (!app) continue;
    profiles.push(
      await hub.createProfile(ctx, {
        connectionId: ado.id,
        name: `${project} repositories → applications`,
        objectType: 'repository',
        remoteScope: scope(project),
        entity: 'alm.repository',
        containerId: app,
        direction: 'pull',
        createLocal: false,
        matchRule: { local: 'url', remote: 'url' },
        intervalMinutes: 15,
      }),
    );
  }

  // A first sync of everything (parents before children: projects before work items).
  for (const p of profiles) {
    const run = await hub.runPullNow(ctx, p.id);
    log.info({ profile: p.name, status: run.status, counts: run.counts }, 'demo sync run');
  }

  // Someone in ISBP and someone in ServiceDesk Plus retitle the same ticket: one open conflict to resolve.
  const { rows } = await kernel.db.execute<{ local_id: string; remote_id: string }>(
    sql`select local_id, remote_id from integrations.links
        where profile_id = ${requests.id} and state = 'ok' and local_id is not null
        order by remote_id limit 1`,
  );
  const link = rows[0];
  if (link) {
    await kernel.db.execute(
      sql`update itsm.tickets set title = title || ' (escalated)', updated_at = now() where id = ${link.local_id}`,
    );
    await mock(base, `/_mock/sdp/requests/${link.remote_id}`, {
      subject: 'Escalated: VPN drops for the whole finance floor',
      _silent: true,
    });
    await hub.runPullNow(ctx, requests.id);
  }

  // Live updates: the stand-ins call the API like the real servers' webhooks would.
  const api = process.env.INTEGRATION_WEBHOOK_BASE_URL ?? `http://127.0.0.1:${kernel.config.PORT}`;
  for (const [connection, system] of [
    [sdp, 'sdp'],
    [ado, 'ado'],
  ] as const) {
    const hook = await hub.registerDemoWebhook(ctx, connection.id);
    await mock(base, '/_mock/webhooks', {
      system,
      url: `${api}${hook.path}`,
      headers: { 'X-ISBP-Webhook-Secret': hook.secret },
    });
  }
  log.info({ connections: 2, profiles: profiles.length }, 'integrations demo data created');
}
