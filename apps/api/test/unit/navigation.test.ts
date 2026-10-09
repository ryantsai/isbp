import {
  type AuthContext,
  defineManifest,
  defineServerModule,
  HttpError,
  type ModuleContext,
  PermissionSet,
} from '@isbp/sdk/server';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { buildNavigation, MAX_ADMIN_ROWS } from '../../src/kernel/navigation';
import { WorkRegistry } from '../../src/kernel/work';
import { ModuleRegistry } from '../../src/kernel/modules';

function auth(grants: string[]): AuthContext {
  const permissions = new PermissionSet(grants.map((p) => ({ p, s: 'g' as const })));
  return {
    principal: { type: 'user', id: 'u1', name: 'Tester' },
    user: { id: 'u1', locale: 'en' },
    sessionId: null,
    permissions,
    can: (p: string) => permissions.can(p),
    require: (p: string) => {
      if (!permissions.can(p)) throw new HttpError(403, 'FORBIDDEN', 'no');
    },
    reach: (p: string) => permissions.reach(p),
  } as unknown as AuthContext;
}

const core = defineServerModule(
  defineManifest({
    id: 'core',
    version: '1.0.0',
    name: 'core',
    navigation: [
      { id: 'home', label: 'core.nav.home', href: '/', section: 'main', order: 0 },
      {
        id: 'users',
        label: 'core.nav.users',
        href: '/admin/users',
        permission: 'core.users.read',
        section: 'admin',
        area: 'people',
        order: 10,
      },
      {
        id: 'roles',
        label: 'core.nav.roles',
        href: '/admin/roles',
        permission: 'core.roles.read',
        section: 'admin',
        area: 'people',
        order: 11,
      },
      {
        id: 'audit',
        label: 'core.nav.audit',
        href: '/admin/audit',
        permission: 'core.audit.read',
        section: 'admin',
        area: 'platform',
      },
      {
        id: 'departments',
        label: 'core.nav.departments',
        href: '/admin/departments',
        permission: ['core.departments.manage', 'core.users.read'],
        section: 'admin',
        area: 'people',
        order: 12,
      },
    ],
  }),
  {},
);

const desk = defineServerModule(
  defineManifest({
    id: 'desk',
    version: '1.0.0',
    name: 'desk',
    navigation: [
      {
        id: 'service',
        label: 'desk.nav.group',
        href: '/desk',
        icon: 'life-buoy',
        section: 'main',
        order: 20,
        children: [
          { id: 'tickets', label: 'desk.nav.tickets', href: '/desk', permission: 'desk.tickets.work' },
          {
            id: 'problems',
            label: 'desk.nav.problems',
            href: '/desk/problems',
            permission: 'desk.tickets.read',
            match: ['/desk/tickets/PRB-'],
          },
        ],
      },
      {
        id: 'settings',
        label: 'desk.nav.settings',
        href: '/desk/settings',
        permission: 'desk.config.manage',
        section: 'admin',
      },
    ],
  }),
  {},
);

const cis = defineServerModule(
  defineManifest({
    id: 'cis',
    version: '1.0.0',
    name: 'cis',
    navigation: [
      {
        id: 'list',
        label: 'cis.nav.list',
        href: '/cis',
        permission: 'cis.items.read',
        parent: 'desk.service',
        order: 40,
      },
    ],
  }),
  {},
);

// A page of another module shown as a section tab of the desk's Problems page (`parent` names a page).
const insights = defineServerModule(
  defineManifest({
    id: 'insights',
    version: '1.0.0',
    name: 'insights',
    navigation: [
      {
        id: 'overview',
        label: 'insights.nav.overview',
        href: '/insights',
        permission: 'insights.overview.read',
        parent: 'desk.problems',
      },
    ],
  }),
  {},
);

let memberOf = false;
const projects = defineServerModule(
  defineManifest({
    id: 'projects',
    version: '1.0.0',
    name: 'projects',
    navigation: [
      {
        id: 'portfolio',
        label: 'projects.nav.portfolio',
        href: '/projects',
        permission: 'projects.projects.use',
        check: true,
        order: 52,
        tabs: [{ id: 'mine', label: 'projects.nav.mine', href: '/projects/my-tasks' }],
      },
    ],
    work: [{ key: 'tasks', label: 'projects.work.tasks', kind: 'task' }],
  }),
  {
    navigation: { portfolio: async () => memberOf },
    work: {
      tasks: async (_auth, _ctx, { limit }) => ({
        count: 3,
        items: [
          { id: 't1', title: 'Late', href: '/projects/tasks/A-1', due: '2000-01-01' },
          { id: 't2', title: 'Later', href: '/projects/tasks/A-2', due: null },
        ].slice(0, limit),
      }),
    },
  },
);

const reviews = defineServerModule(
  defineManifest({
    id: 'reviews',
    version: '1.0.0',
    name: 'reviews',
    work: [
      { key: 'mine', label: 'reviews.work.mine', kind: 'review', permission: 'reviews.self.use' },
      { key: 'broken', label: 'reviews.work.broken', kind: 'approval' },
    ],
  }),
  {
    work: {
      mine: async () => ({ count: 2, items: [{ id: 'r1', title: 'Q4', href: '/reviews/1' }] }),
      broken: async () => {
        throw new Error('down');
      },
    },
  },
);

const ctx = () => ({}) as ModuleContext;
const nav = (grants: string[], modules = [core, desk, cis, projects]) =>
  buildNavigation({ modules, context: ctx }, auth(grants));
const ids = (items: { id: string; children?: { id: string }[] }[]) =>
  items.map((i) => (i.children ? `${i.id}[${i.children.map((c) => c.id).join(',')}]` : i.id));

describe('navigation', () => {
  it('groups an area’s pages and attaches other modules’ pages to it (`parent`)', async () => {
    const { items } = await nav(['desk.tickets.work', 'desk.tickets.read', 'cis.items.read']);
    expect(ids(items)).toEqual(['core.home', 'desk.service[desk.tickets,desk.problems,cis.list]']);
    expect(items[1]!.children![1]!.match).toEqual(['/desk/tickets/PRB-']);
  });

  it('shows a group with one page as that page, and a guest on its own when the host is hidden', async () => {
    const single = await nav(['desk.tickets.read']);
    expect(single.items.map((i) => [i.id, i.label, i.href])).toEqual([
      ['core.home', 'core.nav.home', '/'],
      ['desk.problems', 'desk.nav.group', '/desk/problems'],
    ]);
    const guest = await nav(['cis.items.read']);
    expect(ids(guest.items)).toEqual(['core.home', 'cis.list']);
  });

  it('adds a guest to another module’s page as a section tab, or as its own row when the page is hidden', async () => {
    const modules = [core, desk, cis, projects, insights];
    const { items } = await nav(
      ['desk.tickets.work', 'desk.tickets.read', 'insights.overview.read'],
      modules,
    );
    expect(ids(items)).toEqual(['core.home', 'desk.service[desk.tickets,desk.problems]']);
    const problems = items[1]!.children![1]!;
    expect(problems.tabs!.map((t) => [t.id, t.href])).toEqual([['insights.overview', '/insights']]);
    const alone = await nav(['insights.overview.read'], modules);
    expect(ids(alone.items)).toEqual(['core.home', 'insights.overview']);
  });

  it('asks the module before showing an entry marked `check`, and lists its tabs', async () => {
    memberOf = false;
    expect(ids((await nav(['projects.projects.use'])).items)).toEqual(['core.home']);
    memberOf = true;
    const { items } = await nav(['projects.projects.use']);
    expect(ids(items)).toEqual(['core.home', 'projects.portfolio']);
    expect(items[1]!.tabs!.map((t) => t.href)).toEqual(['/projects/my-tasks']);
  });

  it(`puts administration behind one row, or shows up to ${MAX_ADMIN_ROWS} pages as rows`, async () => {
    const few = await nav(['core.users.read']);
    // Departments is allowed by either permission: People and Departments become rows.
    expect(ids(few.items)).toEqual(['core.home', 'core.users', 'core.departments']);
    expect(few.admin.map((a) => a.id)).toEqual(['core.users', 'core.departments']);

    const many = await nav(['core.users.read', 'core.roles.read', 'core.audit.read', 'desk.config.manage']);
    expect(ids(many.items)).toEqual(['core.home', 'core.admin']);
    expect(many.items[1]!.match).toEqual(
      expect.arrayContaining(['/admin/users', '/admin/audit', '/desk/settings']),
    );
    expect(many.admin.find((a) => a.id === 'desk.settings')!.area).toBe('modules');
    expect(many.admin.find((a) => a.id === 'core.audit')!.area).toBe('platform');

    expect((await nav([])).admin).toEqual([]);
    expect(ids((await nav([])).items)).toEqual(['core.home']);
  });
});

describe('manifest checks', () => {
  it('refuses a `check` entry without its check, and a work source without its provider', () => {
    const m = defineManifest({
      id: 'demo',
      version: '1.0.0',
      name: 'demo',
      navigation: [{ id: 'x', label: 'demo.nav.x', href: '/demo', check: true }],
      work: [{ key: 'w', label: 'demo.work.w', kind: 'todo' }],
    });
    expect(() => defineServerModule(m, { work: { w: async () => ({ count: 0, items: [] }) } })).toThrow(
      /check/,
    );
    expect(() => defineServerModule(m, { navigation: { x: async () => true } })).toThrow(/no provider/);
  });

  it('refuses `parent` pointing at its own module and children on administration entries', () => {
    expect(() =>
      defineManifest({
        id: 'demo',
        version: '1.0.0',
        name: 'demo',
        navigation: [{ id: 'x', label: 'demo.nav.x', href: '/demo', parent: 'demo.y' }],
      }),
    ).toThrow();
    expect(() =>
      defineManifest({
        id: 'demo',
        version: '1.0.0',
        name: 'demo',
        navigation: [
          {
            id: 'x',
            label: 'demo.nav.x',
            href: '/demo',
            section: 'admin',
            children: [{ id: 'y', label: 'demo.nav.y', href: '/demo/y' }],
          },
        ],
      }),
    ).toThrow();
  });
});

describe('My work', () => {
  const registry = () => {
    const r = new ModuleRegistry([core, projects, reviews], {} as never, pino({ level: 'silent' }));
    (r as unknown as { enabledModules: () => unknown[] }).enabledModules = () => [core, projects, reviews];
    (r as unknown as { context: () => ModuleContext }).context = ctx;
    return r;
  };

  it('collects the sources the person may use, decisions first, failures marked, overdue flagged', async () => {
    const work = new WorkRegistry(registry(), pino({ level: 'silent' }));
    const sections = await work.collect(auth(['reviews.self.use']), { limit: 5 });
    expect(sections.map((s) => [s.source, s.kind, s.count, s.error])).toEqual([
      ['reviews.broken', 'approval', 0, true],
      ['reviews.mine', 'review', 2, false],
      ['projects.tasks', 'task', 3, false],
    ]);
    const tasks = sections.find((s) => s.source === 'projects.tasks')!;
    expect(tasks.items.map((i) => [i.id, i.overdue])).toEqual([
      ['t1', true],
      ['t2', false],
    ]);
    // Without the permission the source isn't asked at all.
    const other = await work.collect(auth([]), { limit: 5 });
    expect(other.map((s) => s.source)).not.toContain('reviews.mine');
  });

  it('counts everything but tasks in the badge', async () => {
    const work = new WorkRegistry(registry(), pino({ level: 'silent' }));
    expect(await work.counts(auth(['reviews.self.use']))).toEqual({
      total: 2,
      tasks: 3,
      byKind: { approval: 0, todo: 0, review: 2, task: 3 },
    });
  });
});
