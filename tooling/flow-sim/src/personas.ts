/**
 * Who the flows act as. The seed's accounts (admin and the named demo users) sign in with the seed's passwords; the
 * simulator's own people (`sim.*`, in the "Flow simulation" departments) are created once per database through the
 * public admin API, as an administrator would: departments and managers, group memberships and role assignments.
 * Their passwords are random, set through `POST /users/:id/password`, and kept only in `.state/` (gitignored).
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ApiClient, type ApiResponse, type Credentials, signIn } from './client';

export const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe-2026!';
export const SEED_DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo-2026!pass';

export interface DepartmentSpec {
  code: string;
  name: string;
  parent: string | null;
  /** Persona name of the department's manager. */
  manager?: string;
}

export interface PersonaSpec {
  /** The name flows use: `ctx.as('agent')`. */
  name: string;
  /** Pool the persona belongs to: `ctx.as('employee')` picks one of the pool's members for the flow run. */
  pool?: string;
  username: string;
  /** Accounts the seed creates: their password comes from SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD. */
  seeded?: 'admin' | 'demo';
  displayName?: string;
  jobTitle?: string;
  department?: string;
  /** Persona name of their manager (or a seeded username, e.g. `admin`). */
  manager?: string;
  /** Group keys (groups the demo seed creates). */
  groups?: readonly string[];
  /** Global role assignments, by role key. */
  roles?: readonly string[];
  locale?: 'en' | 'zh-TW' | 'ja-JP';
  /** What the persona is for (README and `--list`). */
  about: string;
}

/** The simulator's departments (codes are unique; created under the root). */
export const DEPARTMENTS: DepartmentSpec[] = [
  { code: 'SIM', name: 'Flow simulation', parent: null, manager: 'itlead' },
  { code: 'SIM-BIZ', name: 'Flow simulation · Business', parent: 'SIM', manager: 'manager' },
  { code: 'SIM-IS', name: 'Flow simulation · IS', parent: 'SIM', manager: 'itlead' },
];

/** Groups the CMDB demo data names as CIs' support groups: the CI approver is in all of them. */
const SUPPORT_GROUPS = [
  'it-admins',
  'network-team',
  'security-team',
  'dba-team',
  'service-desk',
  'app-owners',
];
const LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;
const TIMEZONES: Record<(typeof LOCALES)[number], string> = {
  en: 'Europe/London',
  'zh-TW': 'Asia/Taipei',
  'ja-JP': 'Asia/Tokyo',
};

/** Managers come before the people who report to them. */
export const PERSONAS: PersonaSpec[] = [
  { name: 'admin', username: 'admin', seeded: 'admin', about: 'The seed’s platform administrator' },
  { name: 'helpdesk', username: 'helpdesk', seeded: 'demo', about: 'The seed’s service desk lead' },
  { name: 'hr.partner', username: 'hr.partner', seeded: 'demo', about: 'The seed’s HR partner (Sales)' },
  { name: 'auditor', username: 'auditor', seeded: 'demo', about: 'The seed’s security auditor' },
  {
    name: 'itlead',
    username: 'sim.itlead',
    displayName: 'Sim IS Lead',
    jobTitle: 'IS Manager',
    department: 'SIM-IS',
    manager: 'admin',
    locale: 'en',
    about: 'Manager of the IS staff and agents: approves their requests and signs off their resolutions',
  },
  {
    name: 'manager',
    username: 'sim.manager',
    displayName: 'Sim Business Manager',
    jobTitle: 'Operations Manager',
    department: 'SIM-BIZ',
    manager: 'admin',
    locale: 'zh-TW',
    about: 'Manager of the employees: approves their access requests',
  },
  ...[1, 2, 3, 4].map((n): PersonaSpec => ({
    name: `employee${n}`,
    pool: 'employee',
    username: `sim.employee${n}`,
    displayName: `Sim Employee ${n}`,
    jobTitle: 'Account Executive',
    department: 'SIM-BIZ',
    manager: 'manager',
    locale: LOCALES[(n - 1) % 3],
    about: 'An employee without IS roles: raises tickets',
  })),
  // Only the access-request flow uses them: it grants them roles, which would change what other flows see.
  ...[1, 2, 3].map((n): PersonaSpec => ({
    name: `requester${n}`,
    pool: 'requester',
    username: `sim.requester${n}`,
    displayName: `Sim Requester ${n}`,
    jobTitle: 'Financial Analyst',
    department: 'SIM-BIZ',
    manager: 'manager',
    locale: LOCALES[n % 3],
    about: 'Employees who request access (only the access-request flow: their roles change)',
  })),
  ...[1, 2, 3].map((n): PersonaSpec => ({
    name: `itstaff${n}`,
    pool: 'itstaff',
    username: `sim.itstaff${n}`,
    displayName: `Sim IS Staff ${n}`,
    jobTitle: 'Systems Administrator',
    department: 'SIM-IS',
    manager: 'itlead',
    // The DBA team reads the CMDB (demo grant), so they can pick CIs on the configuration change form.
    groups: ['dba-team'],
    locale: LOCALES[n % 3],
    about: 'IS staff in the DBA team: requests configuration changes',
  })),
  ...[1, 2, 3].map((n): PersonaSpec => ({
    name: `agent${n}`,
    pool: 'agent',
    username: `sim.agent${n}`,
    displayName: `Sim Agent ${n}`,
    jobTitle: 'Service Desk Analyst',
    department: 'SIM-IS',
    manager: 'itlead',
    groups: ['service-desk'],
    roles: ['itsm-agent'],
    locale: LOCALES[(n + 1) % 3],
    about: 'Service desk agent (Service Desk group, itsm-agent): works tickets',
  })),
  {
    name: 'approver',
    username: 'sim.approver',
    displayName: 'Sim CI Approver',
    jobTitle: 'Infrastructure Lead',
    department: 'SIM-IS',
    manager: 'itlead',
    groups: SUPPORT_GROUPS,
    locale: 'ja-JP',
    about: 'Member of every CI support group (approves changes to any CI)',
  },
  {
    name: 'cab',
    username: 'sim.cab',
    displayName: 'Sim CAB Member',
    jobTitle: 'Change Manager',
    department: 'SIM-IS',
    manager: 'itlead',
    groups: ['cab'],
    locale: 'en',
    about: 'Member of the Change Advisory Board',
  },
  {
    name: 'roleowner',
    username: 'sim.roleowner',
    displayName: 'Sim Access Owner',
    jobTitle: 'Application Owner',
    department: 'SIM-IS',
    manager: 'itlead',
    locale: 'zh-TW',
    about: 'Owner of the roles the access-request flow makes requestable',
  },
  // Service desk and delivery (flows/service-desk.ts, flows/delivery.ts).
  {
    name: 'changemgr',
    username: 'sim.changemgr',
    displayName: 'Sim Change Manager',
    jobTitle: 'Change Manager',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['itsm-change-manager'],
    locale: 'en',
    about: 'Change manager (itsm-change-manager): plans change windows, approves normal changes',
  },
  {
    name: 'problemmgr',
    username: 'sim.problemmgr',
    displayName: 'Sim Problem Manager',
    jobTitle: 'Problem Manager',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['itsm-problem-manager', 'knowledge-agent'],
    locale: 'zh-TW',
    about:
      'Problem manager (itsm-problem-manager, knowledge-agent): root causes, known errors, their articles',
  },
  {
    name: 'kbeditor',
    username: 'sim.kbeditor',
    displayName: 'Sim Knowledge Editor',
    jobTitle: 'Knowledge Manager',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['knowledge-editor'],
    locale: 'ja-JP',
    about: 'Knowledge editor (knowledge-editor): reviews, publishes and retires articles',
  },
  {
    name: 'cmdbmgr',
    username: 'sim.cmdbmgr',
    displayName: 'Sim Configuration Manager',
    jobTitle: 'Configuration Manager',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['cmdb-manager'],
    locale: 'en',
    about: 'Configuration manager (cmdb-manager): records CIs and their relationships',
  },
  {
    name: 'comms',
    username: 'sim.comms',
    displayName: 'Sim IS Communications',
    jobTitle: 'IS Communications Officer',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['announcements-editor'],
    locale: 'zh-TW',
    about: 'Announcements editor (announcements-editor): publishes IS announcements',
  },
  {
    name: 'pm',
    username: 'sim.pm',
    displayName: 'Sim Project Manager',
    jobTitle: 'IS Project Manager',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['projects-manager'],
    locale: 'en',
    about: 'Project manager (projects-manager): proposes projects (large ones go to their manager, itlead)',
  },
  {
    name: 'releasemgr',
    username: 'sim.releasemgr',
    displayName: 'Sim Release Manager',
    jobTitle: 'Release Manager',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['alm-manager', 'itsm-change-viewer'],
    locale: 'ja-JP',
    about: 'Release manager (alm-manager, itsm-change-viewer): applications, releases, deployments',
  },
  // Assets, information security and database access (flows/assets.ts, flows/isms.ts, flows/dbaccess.ts).
  ...[1, 2].map((n): PersonaSpec => ({
    name: `assetmgr${n}`,
    pool: 'assetmgr',
    username: `sim.assetmgr${n}`,
    displayName: `Sim Asset Manager ${n}`,
    jobTitle: 'IS Asset Manager',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['itam-asset-manager'],
    locale: LOCALES[n % 3],
    about:
      'IS asset managers (itam-asset-manager): hardware lifecycle, licences, discovery; approve disposals',
  })),
  {
    name: 'contractmgr',
    username: 'sim.contractmgr',
    displayName: 'Sim Contract Manager',
    jobTitle: 'IS Procurement Officer',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['itam-contract-manager'],
    locale: 'zh-TW',
    about: 'Contract manager (itam-contract-manager): contracts, renewals and vendors',
  },
  {
    name: 'assetviewer',
    username: 'sim.assetviewer',
    displayName: 'Sim Asset Viewer',
    jobTitle: 'IS Auditor',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['itam-viewer'],
    locale: 'en',
    about: 'Reads hardware, licences and contracts (itam-viewer): is refused every change',
  },
  {
    name: 'ismsmgr',
    username: 'sim.ismsmgr',
    displayName: 'Sim Information Asset Manager',
    jobTitle: 'Information Asset Manager',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['isms-asset-manager', 'itam-viewer'],
    locale: 'ja-JP',
    about:
      'Information asset manager (isms-asset-manager, itam-viewer): the register, stocktakes, create from',
  },
  {
    name: 'infosec',
    username: 'sim.infosec',
    displayName: 'Sim Information Security Officer',
    jobTitle: 'Information Security Officer',
    department: 'SIM-IS',
    manager: 'itlead',
    // The Security Team signs off disposals of data-bearing devices and high-risk database roles.
    groups: ['security-team'],
    roles: ['isms-security-officer', 'dbaccess-review-manager'],
    locale: 'zh-TW',
    about:
      'Information security (security-team, isms-security-officer, dbaccess-review-manager): sign-offs, accounts, reviews',
  },
  ...[1, 2, 3].map((n): PersonaSpec => ({
    name: `custodian${n}`,
    pool: 'custodian',
    username: `sim.custodian${n}`,
    displayName: `Sim Custodian ${n}`,
    jobTitle: 'Office Manager',
    department: 'SIM-BIZ',
    manager: 'manager',
    locale: LOCALES[(n + 2) % 3],
    about: 'Business staff without roles: manage information assets (stocktakes), keep shared accounts',
  })),
  // A pool: raising a review's tickets is limited to 10 a minute per person.
  ...[1, 2, 3].map((n): PersonaSpec => ({
    name: `accreviewer${n}`,
    pool: 'accreviewer',
    username: `sim.accreviewer${n}`,
    displayName: `Sim Account Reviewer ${n}`,
    jobTitle: 'Finance System Owner',
    department: 'SIM-BIZ',
    manager: 'manager',
    locale: LOCALES[n % 3],
    about: 'Review the accounts of a system in ISMS account reviews (no roles)',
  })),
  {
    name: 'dba',
    username: 'sim.dba',
    displayName: 'Sim DBA',
    jobTitle: 'Database Administrator',
    department: 'SIM-IS',
    manager: 'itlead',
    roles: ['dbaccess-dba'],
    locale: 'ja-JP',
    about: 'DBA (dbaccess-dba): the simulator’s database server and its requestable roles',
  },
  {
    name: 'dataowner',
    username: 'sim.dataowner',
    displayName: 'Sim Data Owner',
    jobTitle: 'Finance Data Owner',
    department: 'SIM-BIZ',
    manager: 'manager',
    locale: 'zh-TW',
    about: 'Owns the simulator’s requestable database roles: approves requests, decides access reviews',
  },
  // Only the dbaccess flows use them: they hold database grants while a run lasts.
  ...[1, 2, 3, 4].map((n): PersonaSpec => ({
    name: `dbuser${n}`,
    pool: 'dbuser',
    username: `sim.dbuser${n}`,
    displayName: `Sim Data Analyst ${n}`,
    jobTitle: 'Data Analyst',
    department: 'SIM-BIZ',
    manager: 'manager',
    locale: LOCALES[(n + 1) % 3],
    about: 'Employees who request database access (only the dbaccess flows: they hold grants)',
  })),
  // Platform requests, automation and the assistant (flows/platform.ts, flows/automation.ts, flows/assistant.ts).
  {
    name: 'finance',
    username: 'sim.finance',
    displayName: 'Sim Finance Approver',
    jobTitle: 'Financial Controller',
    department: 'SIM-BIZ',
    manager: 'manager',
    // The seeded equipment and software workflows ask the Finance Team above a cost or for paid licences.
    groups: ['finance-team'],
    locale: 'ja-JP',
    about: 'Member of the Finance Team: approves expensive equipment and licence purchases',
  },
  {
    name: 'ismsofficer',
    username: 'sim.ismsofficer',
    displayName: 'Sim ISMS Officer',
    jobTitle: 'ISMS Coordinator',
    department: 'SIM-IS',
    manager: 'itlead',
    locale: 'zh-TW',
    about:
      'Joins the ISMS process pack’s groups while the isms-pack flow has it applied (no roles otherwise)',
  },
];

export interface PersonaInfo {
  name: string;
  username: string;
  id: string;
  displayName: string;
}

interface StateFile {
  api: string;
  personas: Record<string, { username: string; password: string; id?: string }>;
}

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.state');

function stateFile(api: string): string {
  const url = new URL(api);
  return join(STATE_DIR, `personas-${url.hostname}-${url.port || '80'}.json`);
}

function loadState(api: string): StateFile {
  const file = stateFile(api);
  if (!existsSync(file)) return { api, personas: {} };
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as StateFile;
  } catch {
    return { api, personas: {} };
  }
}

function saveState(state: StateFile) {
  const file = stateFile(state.api);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** A password the API's policy accepts (≥ 10 characters, not repetitive). */
const newPassword = () => `Sim-${randomBytes(18).toString('base64url')}`;

export function credentialsOf(spec: PersonaSpec, state: StateFile): Credentials {
  if (spec.seeded === 'admin') return { username: spec.username, password: SEED_ADMIN_PASSWORD };
  if (spec.seeded === 'demo') return { username: spec.username, password: SEED_DEMO_PASSWORD };
  const entry = state.personas[spec.name];
  if (!entry) throw new Error(`Persona ${spec.name} has not been set up`);
  return { username: entry.username, password: entry.password };
}

type Log = (line: string) => void;

class SetupError extends Error {}

function must<T>(res: ApiResponse<T>, what: string): ApiResponse<T> {
  if (res.status >= 200 && res.status < 300) return res;
  const code = (res.body as { error?: { code?: string; message?: string } } | undefined)?.error;
  throw new SetupError(`${what}: HTTP ${res.status} ${code?.code ?? ''} ${code?.message ?? ''}`.trim());
}

/**
 * Makes sure every `sim.*` persona exists with its department, manager, groups and roles, and can sign in.
 * Idempotent: run it as often as you like (the CLI runs it when a persona can't sign in, or with `--setup`).
 */
export async function setupPersonas(api: string, admin: ApiClient, log: Log): Promise<void> {
  const state = loadState(api);
  state.api = api;

  // Departments, then people (managers first), then department managers.
  const depts = must(await admin.get('/departments'), 'list departments').body.items as {
    id: string;
    code: string;
  }[];
  const deptId = new Map(depts.map((d) => [d.code, d.id]));
  for (const d of DEPARTMENTS) {
    if (deptId.has(d.code)) continue;
    const created = must(
      await admin.post('/departments', {
        code: d.code,
        name: d.name,
        parentId: d.parent ? deptId.get(d.parent) : null,
        description: 'People the flow simulator signs in as (tooling/flow-sim)',
      }),
      `create department ${d.code}`,
    );
    deptId.set(d.code, created.body.id);
    log(`  + department ${d.code}`);
  }

  const groupKeys = [...new Set(PERSONAS.flatMap((p) => p.groups ?? []))];
  const groupId = new Map<string, string>();
  for (const key of groupKeys) {
    const res = must(await admin.get('/groups', { query: { q: key, pageSize: 50 } }), `find group ${key}`);
    const g = (res.body.items as { id: string; key: string }[]).find((x) => x.key === key);
    if (g) groupId.set(key, g.id);
    else log(`  ! group ${key} not found: personas that need it won't be in it`);
  }
  const roleRows = must(await admin.get('/roles'), 'list roles').body.items as { id: string; key: string }[];
  const roleId = new Map(roleRows.map((r) => [r.key, r.id]));

  const userIds = new Map<string, string>();
  const findUser = async (username: string) => {
    const res = must(await admin.get('/users', { query: { q: username, pageSize: 50 } }), `find ${username}`);
    return (res.body.items as { id: string; username: string }[]).find((u) => u.username === username);
  };

  for (const spec of PERSONAS) {
    if (spec.seeded) {
      const u = await findUser(spec.username);
      if (!u) throw new SetupError(`The seed's ${spec.username} account is missing: is the database seeded?`);
      userIds.set(spec.name, u.id);
      continue;
    }
    const managerId = spec.manager ? (userIds.get(spec.manager) ?? (await findUser(spec.manager))?.id) : null;
    const locale = spec.locale ?? 'en';
    const profile = {
      displayName: spec.displayName ?? spec.username,
      jobTitle: spec.jobTitle ?? null,
      departmentId: spec.department ? deptId.get(spec.department)! : null,
      managerId: managerId ?? null,
      locale,
      timezone: TIMEZONES[locale],
    };
    let user = await findUser(spec.username);
    if (!user) {
      const created = must(
        await admin.post('/users', {
          ...profile,
          email: `${spec.username}@sim.isbp.example`,
          username: spec.username,
          status: 'active',
          groupIds: [],
        }),
        `create ${spec.username}`,
      );
      user = { id: created.body.id, username: spec.username };
      log(`  + ${spec.username}`);
    } else {
      must(await admin.patch(`/users/${user.id}`, profile), `update ${spec.username}`);
    }
    userIds.set(spec.name, user.id);

    // A password that works: the stored one, or a new one.
    const stored = state.personas[spec.name];
    let works = false;
    if (stored?.username === spec.username) {
      works = await signIn(api, stored, spec.name).then(
        () => true,
        () => false,
      );
    }
    if (!works) {
      const password = newPassword();
      must(
        await admin.post(`/users/${user.id}/password`, { password, mustChangePassword: false }),
        `set the password of ${spec.username}`,
      );
      state.personas[spec.name] = { username: spec.username, password, id: user.id };
    } else {
      state.personas[spec.name] = { ...stored!, id: user.id };
    }

    for (const key of spec.groups ?? []) {
      const gid = groupId.get(key);
      if (!gid) continue;
      must(
        await admin.post(`/groups/${gid}/members`, { userIds: [user.id] }),
        `add ${spec.username} to ${key}`,
      );
    }
    for (const key of spec.roles ?? []) {
      const rid = roleId.get(key);
      if (!rid) {
        log(`  ! role ${key} not found (module disabled?)`);
        continue;
      }
      const existing = must(
        await admin.get('/role-assignments', { query: { userId: user.id, roleId: rid, pageSize: 5 } }),
        `list ${spec.username}'s ${key} assignments`,
      );
      if ((existing.body.items as unknown[]).length) continue;
      must(
        await admin.post('/role-assignments', {
          roleId: rid,
          principalType: 'user',
          principalId: user.id,
          reason: 'Flow simulation persona',
        }),
        `grant ${key} to ${spec.username}`,
      );
    }
  }

  for (const d of DEPARTMENTS) {
    if (!d.manager) continue;
    must(
      await admin.patch(`/departments/${deptId.get(d.code)}`, { managerId: userIds.get(d.manager) }),
      `set the manager of ${d.code}`,
    );
  }
  saveState(state);
}

/** The personas of one stack: their clients and who they are. */
export class PersonaDirectory {
  private readonly clients = new Map<string, ApiClient>();
  private readonly infos = new Map<string, PersonaInfo>();
  private state: StateFile;

  constructor(
    readonly api: string,
    private readonly makeClient: (spec: PersonaSpec, credentials: () => Credentials) => ApiClient,
  ) {
    this.state = loadState(api);
  }

  reload() {
    this.state = loadState(this.api);
    this.clients.clear();
    this.infos.clear();
  }

  spec(name: string): PersonaSpec {
    const spec = PERSONAS.find((p) => p.name === name);
    if (!spec)
      throw new Error(`Unknown persona "${name}" (see PERSONAS in tooling/flow-sim/src/personas.ts)`);
    return spec;
  }

  /** Persona names of a pool (`employee` → employee1…employee4), or the name itself. */
  members(nameOrPool: string): string[] {
    const pool = PERSONAS.filter((p) => p.pool === nameOrPool).map((p) => p.name);
    if (pool.length) return pool;
    return [this.spec(nameOrPool).name];
  }

  isKnown(nameOrPool: string): boolean {
    return PERSONAS.some((p) => p.name === nameOrPool || p.pool === nameOrPool);
  }

  client(name: string): ApiClient {
    let c = this.clients.get(name);
    if (!c) {
      const spec = this.spec(name);
      c = this.makeClient(spec, () => credentialsOf(spec, this.state));
      this.clients.set(name, c);
    }
    return c;
  }

  info(name: string): PersonaInfo {
    const info = this.infos.get(name);
    if (!info) throw new Error(`Persona ${name} is not signed in yet`);
    return info;
  }

  /** Persona name of a user id, if the user is one of ours. */
  nameOf(userId: string): string | null {
    for (const [name, info] of this.infos) if (info.id === userId) return name;
    return null;
  }

  /** Signs every persona in and learns who they are. Returns the names that could not sign in. */
  async signInAll(): Promise<string[]> {
    const failed: string[] = [];
    await Promise.all(
      PERSONAS.map(async (spec) => {
        const c = this.client(spec.name);
        try {
          await c.ensureSession();
          const me = await c.get('/me');
          if (me.status !== 200) throw new Error(`HTTP ${me.status}`);
          this.infos.set(spec.name, {
            name: spec.name,
            username: spec.username,
            id: me.body.id,
            displayName: me.body.displayName,
          });
        } catch {
          failed.push(spec.name);
        }
      }),
    );
    return failed;
  }
}
