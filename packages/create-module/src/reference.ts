/**
 * Generates docs/ai/reference.md — the catalog of every extension point the installed modules (and core)
 * declare: permissions, roles, events and their payloads, record and task types, workflow triggers,
 * notifications, AI tools, settings, navigation, portal entries, web routes, slots (hosted and contributed),
 * background jobs and error codes. Built from the code, so it can't drift; CI fails when it is stale.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModuleManifest } from '@isbp/sdk';
import { discoverModules } from './registry';

type Json = Record<string, unknown>;

interface Loaded {
  id: string;
  dir: string;
  manifest: ModuleManifest;
  web: {
    routes: { path: string; permission?: string }[];
    slots: { slot: string; permission?: string }[];
  } | null;
  server: {
    jobs?: Record<
      string,
      { description?: string; schedule?: { cron?: string; everyMs?: number; tz?: string } }
    >;
    events?: Record<string, unknown>;
    workflows?: Record<string, unknown>;
  } | null;
  messages: Json;
}

const imp = async <T>(file: string): Promise<T | null> => {
  if (!existsSync(file)) return null;
  try {
    return (await import(pathToFileURL(file).href)) as T;
  } catch (err) {
    console.warn(`  (skipped ${file}: ${(err as Error).message.split('\n')[0]})`);
    return null;
  }
};

const readJson = (file: string): Json =>
  existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Json) : {};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const pick = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Json)[k] : undefined), obj);

const cell = (s: unknown) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim() || '—';
const code = (s: unknown) => (s === undefined || s === null || s === '' ? '—' : `\`${String(s)}\``);

function table(headers: string[], rows: unknown[][]): string {
  if (!rows.length) return '';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

/** Compact "field: type" list from a JSON Schema object. */
function fields(schema: unknown): string {
  const props = (schema as { properties?: Record<string, Json> } | undefined)?.properties;
  if (!props) return '—';
  const required = new Set(((schema as { required?: string[] }).required ?? []) as string[]);
  return Object.entries(props)
    .map(([k, v]) => {
      const t =
        (v.type as string | undefined) ??
        (v.enum
          ? 'enum'
          : v.anyOf
            ? (v.anyOf as Json[]).map((x) => x.type ?? 'object').join('\\|')
            : 'object');
      return `${k}${required.has(k) ? '' : '?'}: ${Array.isArray(t) ? t.join('\\|') : t}`;
    })
    .join(', ');
}

export async function renderReference(root: string): Promise<string> {
  const { serializeManifest, ErrorCodes } = await import('@isbp/sdk');
  const coreMessages = (file: string) => readJson(join(root, 'packages/i18n/messages/en', `${file}.json`));
  const core: Loaded = {
    id: 'core',
    dir: join(root, 'apps/api'),
    manifest: (await imp<{ coreManifest: ModuleManifest }>(join(root, 'apps/api/src/core/manifest.ts')))!
      .coreManifest,
    web: null,
    server:
      (await imp<{ coreModule: Loaded['server'] }>(join(root, 'apps/api/src/core/index.ts')))?.coreModule ??
      null,
    messages: coreMessages('core'),
  };
  const modules: Loaded[] = [core];
  for (const m of discoverModules(root)) {
    const manifest = (await imp<{ manifest: ModuleManifest }>(join(m.dir, 'src/manifest.ts')))?.manifest;
    if (!manifest) continue;
    modules.push({
      id: m.id,
      dir: m.dir,
      manifest,
      web: (await imp<{ default: Loaded['web'] }>(join(m.dir, 'src/web/index.tsx')))?.default ?? null,
      server: (await imp<{ default: Loaded['server'] }>(join(m.dir, 'src/server/index.ts')))?.default ?? null,
      messages: readJson(join(m.dir, 'messages/en.json')),
    });
  }

  /** English text of an i18n key (`<module>.<path>`); plain text is returned as is. */
  const en = (key: string | undefined): string => {
    if (!key) return '';
    const [ns, ...rest] = key.split('.');
    const owner = modules.find((m) => m.id === ns);
    if (!owner || !rest.length || /\s/.test(key)) return key;
    const found = pick(owner.messages, rest.join('.'));
    return typeof found === 'string' ? found : key;
  };

  // Slot hosts: `<Slot name="x" …>` (or a template literal) anywhere in web code.
  const hosts = new Map<string, Set<string>>();
  const sources = [
    ...walk(join(root, 'apps/web/src')),
    ...modules.filter((m) => m.id !== 'core').flatMap((m) => walk(join(m.dir, 'src/web'))),
  ];
  const addHost = (name: string, file: string) => {
    if (!hosts.has(name)) hosts.set(name, new Set());
    hosts.get(name)!.add(relative(root, file));
  };
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    const consts = new Map(
      [...text.matchAll(/const\s+([A-Za-z_]\w*)\s*=\s*'([a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*)'/g)].map((m) => [
        m[1]!,
        m[2]!,
      ]),
    );
    for (const match of text.matchAll(
      /<Slot(?:<[^>]*>)?\s[^>]*?name=(?:"([^"]+)"|\{`([^`]+)`\}|\{'([^']+)'\}|\{([A-Za-z_]\w*)\})/g,
    )) {
      const name = match[1] ?? match[2] ?? match[3] ?? consts.get(match[4] ?? '');
      if (name) addHost(name, file);
    }
    for (const match of text.matchAll(/useSlot\((?:'([^']+)'|`([^`]+)`|([A-Za-z_]\w*))\)/g)) {
      const name = match[1] ?? match[2] ?? consts.get(match[3] ?? '');
      if (name) addHost(name, file);
    }
  }

  const out: string[] = [];
  out.push(
    '<!-- GENERATED by `pnpm docs:reference` from the module manifests and web code. Do not edit by hand. -->',
    '',
    '# Extension point reference',
    '',
    'Everything the installed modules and core declare, generated from the code. Use it to find the exact names',
    'to depend on (permissions, events, record and task types, slots, triggers). How to use each kind of',
    'extension point is in [api-reference.md](api-reference.md) and [recipes.md](recipes.md).',
    '',
    '## Modules',
    '',
    table(
      ['Module', 'Name', 'Depends on', 'Description'],
      modules.map((m) => [
        code(m.id),
        en(m.manifest.name),
        (m.manifest.dependsOn ?? []).map(code).join(', ') || '—',
        en(m.manifest.description),
      ]),
    ),
    '',
  );

  // Slots
  const contributed = new Map<string, string[]>();
  for (const m of modules)
    for (const s of m.web?.slots ?? []) {
      const list = contributed.get(s.slot) ?? [];
      list.push(`${m.id}${s.permission ? ` (${s.permission})` : ''}`);
      contributed.set(s.slot, list);
    }
  const slotNames = [...new Set([...hosts.keys(), ...contributed.keys()])].sort();
  out.push(
    '## Web slots',
    '',
    'Hosts render `<Slot name=… props=… />`; modules contribute with `defineWebModule({ slots })`. Template names',
    '(`${…}`) are families: contribute the concrete name, e.g. `scheduler.task-config.etl.pipeline`.',
    '',
    table(
      ['Slot', 'Hosted in', 'Contributed by'],
      slotNames.map((s) => [
        code(s),
        [...(hosts.get(s) ?? [])].sort().map(code).join('<br>') || '—',
        (contributed.get(s) ?? []).sort().join(', ') || '—',
      ]),
    ),
    '',
  );

  // Errors: errors.json first, then any core catalog that names the code (e.g. sign-in errors in auth.json).
  const errorText = (k: string): string | undefined => {
    const direct = coreMessages('errors')[k];
    if (typeof direct === 'string') return direct;
    for (const f of readdirSync(join(root, 'packages/i18n/messages/en')).filter((x) => x.endsWith('.json'))) {
      const find = (o: unknown): string | undefined => {
        if (!o || typeof o !== 'object') return undefined;
        for (const [key, v] of Object.entries(o as Json)) {
          if (key === k && typeof v === 'string') return v;
          const deep = find(v);
          if (deep) return deep;
        }
        return undefined;
      };
      const hit = find(coreMessages(f.slice(0, -5)));
      if (hit) return hit;
    }
    return undefined;
  };
  out.push(
    '## Error codes',
    '',
    'Throw `new HttpError(status, ErrorCodes.X, message, details)`. The UI translates by code (`errors.json`).',
    '',
    table(
      ['Code', 'Message (en)'],
      Object.keys(ErrorCodes)
        .sort()
        .map((k) => [code(k), errorText(k) ?? '—']),
    ),
    '',
  );

  for (const m of modules) {
    const s = serializeManifest(m.manifest);
    out.push(`## \`${m.id}\` — ${en(m.manifest.name)}`, '');
    if (m.manifest.description) out.push(en(m.manifest.description), '');
    const section = (title: string, body: string) => {
      if (body) out.push(`### ${title}`, '', body, '');
    };
    section(
      'Permissions',
      table(
        ['Key', 'Scopes', 'Description'],
        (s.permissions ?? []).map((p) => [
          code(p.key),
          (p.scopes ?? ['global']).join(', '),
          en(p.description),
        ]),
      ),
    );
    section(
      'Roles',
      table(
        ['Key', 'Name', 'Permissions', 'Everyone'],
        (s.roles ?? []).map((r) => [
          code(r.key),
          r.name,
          r.permissions.map(code).join(' '),
          r.grantByDefault ? 'yes' : '',
        ]),
      ),
    );
    section(
      'Events emitted',
      table(
        ['Event', 'Payload', 'Description'],
        (s.events?.emits ?? []).map((e) => [code(e.name), fields(e.schema), e.description ?? '']),
      ),
    );
    if (s.events?.consumes?.length) section('Events consumed', s.events.consumes.map(code).join(', '));
    section(
      'Record types',
      table(
        ['Type', 'Name', 'Permission'],
        (s.records?.types ?? []).map((r) => [code(`${m.id}.${r.type}`), en(r.name), code(r.permission)]),
      ),
    );
    section(
      'Task types (Scheduled jobs)',
      table(
        ['Type', 'Name', 'Permission', 'Config'],
        (s.taskTypes ?? []).map((t) => [
          code(`${m.id}.${t.type}`),
          en(t.name),
          code(t.permission),
          fields(t.config),
        ]),
      ),
    );
    section(
      'Workflow triggers',
      table(
        ['Trigger', 'Subject', 'Required', 'Facts'],
        (s.workflows ?? []).map((w) => [code(w.key), w.subject, w.required ? 'yes' : '', fields(w.facts)]),
      ),
    );
    section(
      'Notifications',
      table(
        ['Type', 'Default channels', 'Mandatory'],
        (s.notifications ?? []).map((n) => [
          code(n.type),
          (n.defaultChannels ?? ['inApp']).join(', '),
          n.mandatory ? 'yes' : '',
        ]),
      ),
    );
    section(
      'AI tools',
      table(
        ['Tool', 'Permission', 'Destructive', 'Input'],
        (s.ai?.tools ?? []).map((t) => [
          code(t.name),
          code(t.permission),
          t.destructive ? 'yes' : '',
          fields(t.input),
        ]),
      ),
    );
    if (s.ai?.agent)
      section('AI agent identity', `${s.ai.agent.name}: ${s.ai.agent.permissions.map(code).join(' ')}`);
    section(
      'Settings',
      table(
        ['Key', 'Type', 'Default', 'Label'],
        (s.settings ?? []).map((x) => [
          code(x.key),
          x.type,
          x.default === undefined ? '—' : code(JSON.stringify(x.default)),
          en(x.label),
        ]),
      ),
    );
    section(
      'Navigation',
      table(
        ['Label', 'Path', 'Section', 'Group', 'Order', 'Permission'],
        (s.navigation ?? []).map((n) => [
          en(n.label),
          code(n.href),
          n.section ?? 'main',
          en(n.group),
          n.order ?? '',
          code(n.permission),
        ]),
      ),
    );
    section(
      'Portal entries',
      table(
        ['Entry', 'Path', 'Permission'],
        (s.portal?.entries ?? []).map((p) => [en(p.label), code(p.href), code(p.permission)]),
      ),
    );
    section(
      'Custom-field entities',
      (s.customFields?.entities ?? []).map((e) => code(`${m.id}.${e.type}`)).join(', '),
    );
    section(
      'Web routes',
      table(
        ['Path', 'Permission'],
        (m.web?.routes ?? []).map((r) => [
          code(`/${m.id}${r.path === '/' ? '' : r.path}`),
          code(r.permission),
        ]),
      ),
    );
    section(
      'Slots contributed',
      table(
        ['Slot', 'Permission'],
        (m.web?.slots ?? []).map((x) => [code(x.slot), code(x.permission)]),
      ),
    );
    section(
      'Background jobs',
      table(
        ['Job', 'Schedule', 'Description'],
        Object.entries(m.server?.jobs ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, j]) => [
            code(`${m.id}:${name}`),
            j.schedule?.cron
              ? code(`${j.schedule.cron}${j.schedule.tz ? ` ${j.schedule.tz}` : ''}`)
              : j.schedule?.everyMs
                ? `every ${Math.round(j.schedule.everyMs / 1000)} s`
                : 'on demand',
            j.description ?? '',
          ]),
      ),
    );
  }
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}
