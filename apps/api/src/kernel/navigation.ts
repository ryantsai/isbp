import type { NavItem } from '@isbp/contracts';
import type { AuthContext, ModuleContext, NavEntry, ServerModule } from '@isbp/sdk/server';
import type { FastifyBaseLogger } from 'fastify';

/** A person with this many administration pages or fewer sees them as rows instead of the Administration hub. */
export const MAX_ADMIN_ROWS = 2;

/** The row that opens the Administration hub; its order puts it last. */
const ADMIN_ROW = {
  id: 'core.admin',
  label: 'core.nav.admin',
  href: '/admin',
  icon: 'settings',
  order: 1000,
};

const CHECK_TIMEOUT_MS = 1_500;

const pathOf = (href: string) => href.split(/[?#]/)[0]!;

export interface NavigationSource {
  modules: readonly ServerModule[];
  context: (moduleId: string) => ModuleContext;
  logger?: Pick<FastifyBaseLogger, 'warn'>;
}

/**
 * The sidebar and the Administration hub for one person: enabled modules' entries the person may see (permission,
 * then the module's `check`), cross-module `parent`s attached (to a group as a page, to a page as a section tab),
 * empty groups dropped, single-page groups shown as one row, and the administration pages behind one
 * "Administration" row (or as rows when there are only one or two).
 */
export async function buildNavigation(
  src: NavigationSource,
  auth: AuthContext,
): Promise<{ items: NavItem[]; admin: NavItem[] }> {
  const allowed = (e: NavEntry) =>
    !e.permission ||
    (Array.isArray(e.permission) ? e.permission : [e.permission]).some((p) => auth.permissions.hasAny(p));

  // Module checks run once each, in parallel, and fail closed.
  const checks = new Map<string, Promise<boolean>>();
  const check = (m: ServerModule, e: NavEntry): Promise<boolean> => {
    if (!e.check) return Promise.resolve(true);
    const key = `${m.manifest.id}.${e.id}`;
    let p = checks.get(key);
    if (!p) {
      const fn = m.navigation?.[e.id];
      let timer: NodeJS.Timeout | undefined;
      p = fn
        ? Promise.race([
            fn(auth, src.context(m.manifest.id)),
            new Promise<boolean>((resolve) => {
              timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
            }),
          ])
            .catch((err: unknown) => {
              src.logger?.warn({ err, entry: key }, 'navigation check failed');
              return false;
            })
            .finally(() => clearTimeout(timer))
        : Promise.resolve(false);
      checks.set(key, p);
    }
    return p;
  };

  const toItem = async (m: ServerModule, e: NavEntry, depth: number): Promise<NavItem | null> => {
    if (!allowed(e) || !(await check(m, e))) return null;
    const moduleId = m.manifest.id;
    const kids = async (list?: NavEntry[]) =>
      list
        ? (await Promise.all(list.map((c) => toItem(m, c, depth + 1)))).filter((c) => c !== null)
        : undefined;
    const [children, tabs] = await Promise.all([kids(e.children), kids(e.tabs)]);
    return {
      id: `${moduleId}.${e.id}`,
      label: e.label,
      href: e.href,
      icon: e.icon,
      section: depth === 0 ? (e.section ?? 'main') : 'main',
      badge: e.badge,
      order: e.order ?? 100,
      moduleId,
      children: e.children ? children : undefined,
      tabs: tabs?.length ? tabs : undefined,
      match: e.match,
      description: e.description,
      keywords: e.keywords,
      area: e.section === 'admin' ? (e.area ?? 'modules') : undefined,
    };
  };

  const top: { item: NavItem; parent?: string }[] = [];
  await Promise.all(
    src.modules.flatMap((m) =>
      (m.manifest.navigation ?? []).map(async (e) => {
        const item = await toItem(m, e, 0);
        if (item) top.push({ item, parent: e.parent });
      }),
    ),
  );
  const byOrder = (a: NavItem, b: NavItem) => a.order - b.order || a.id.localeCompare(b.id);

  const admin = top
    .filter((t) => t.item.section === 'admin')
    .map((t) => t.item)
    .sort(byOrder);
  const main = top.filter((t) => t.item.section === 'main');

  // Cross-module groups: an entry with `parent` joins that group as one of its pages (after the group's own), or
  // that page's section tabs when the parent is a page (Helpdesk AI's insights as a tab of the service desk's
  // reports). With the host hidden from this person, the entry is a row of its own.
  const groups = new Map(main.filter((t) => t.item.children).map((t) => [t.item.id, t.item]));
  const pages = new Map(
    main
      .filter((t) => !t.parent)
      .flatMap((t) => (t.item.children ?? [t.item]).map((p) => [p.id, p] as const)),
  );
  const rows: NavItem[] = [];
  const guests = new Map<string, NavItem[]>();
  const tabGuests = new Map<string, NavItem[]>();
  for (const t of main) {
    const host = t.parent ? groups.get(t.parent) : undefined;
    const page = t.parent && !host ? pages.get(t.parent) : undefined;
    if (host) guests.set(host.id, [...(guests.get(host.id) ?? []), t.item]);
    else if (page && !t.item.children) tabGuests.set(page.id, [...(tabGuests.get(page.id) ?? []), t.item]);
    else rows.push(t.item);
  }
  for (const [id, extra] of tabGuests) {
    const page = pages.get(id)!;
    page.tabs = [...(page.tabs ?? []), ...extra.sort(byOrder).map(({ tabs: _t, ...tab }) => tab)];
  }
  const items: NavItem[] = [];
  for (const row of rows.sort(byOrder)) {
    if (!row.children) {
      items.push(row);
      continue;
    }
    const children = [...row.children, ...(guests.get(row.id) ?? []).sort(byOrder)];
    if (!children.length) continue;
    if (children.length === 1) {
      // A group with one page for this person is that page: under the group's name when it is the module's own.
      const only = children[0]!;
      items.push(
        only.moduleId === row.moduleId
          ? { ...only, label: row.label, icon: row.icon ?? only.icon, order: row.order, section: 'main' }
          : { ...only, order: row.order, section: 'main' },
      );
      continue;
    }
    items.push({ ...row, children });
  }

  if (admin.length > 0 && admin.length <= MAX_ADMIN_ROWS) {
    items.push(...admin.map((a, i) => ({ ...a, section: 'main' as const, order: ADMIN_ROW.order + i })));
  } else if (admin.length) {
    items.push({
      ...ADMIN_ROW,
      section: 'main',
      moduleId: 'core',
      match: [...new Set(admin.map((a) => pathOf(a.href)))],
    });
  }
  return { items: items.sort(byOrder), admin };
}
