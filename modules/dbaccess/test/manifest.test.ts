import type { ModuleManifest } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import { manifest as typed, requestFactsSchema } from '../src/manifest';

const manifest: ModuleManifest = typed;
type Catalog = Record<string, unknown>;

const flat = (o: Catalog, p = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v
      ? flat(v as Catalog, `${p}${k}.`)
      : [[`${p}${k}`, String(v)] as [string, string]],
  );

/** ICU argument names (`{name}`, `{count, plural, …}`), skipping quoted text and select/plural branch text. */
function args(message: string): string[] {
  const out = new Set<string>();
  const s = message;
  let i = 0;
  const message_ = (): void => {
    while (i < s.length) {
      const c = s[i]!;
      if (c === "'" && (s[i + 1] === '{' || s[i + 1] === '}')) {
        // ICU quoting: an apostrophe before a brace starts literal text up to the next apostrophe.
        const end = s.indexOf("'", i + 1);
        i = end === -1 ? s.length : end + 1;
      } else if (c === '{') {
        i++;
        argument();
      } else if (c === '}') return;
      else i++;
    }
  };
  const argument = () => {
    const head = /^\s*([A-Za-z_]\w*)\s*(?:,\s*(\w+)\s*)?/.exec(s.slice(i));
    if (!head) throw new Error(`Bad ICU argument in "${message}"`);
    out.add(head[1]!);
    i += head[0].length;
    const type = head[2];
    if (s[i] === '}') return void i++;
    if (s[i] === ',') i++;
    if (type === 'plural' || type === 'select' || type === 'selectordinal') {
      for (;;) {
        while (/\s/.test(s[i] ?? '')) i++;
        if (s[i] === '}') return void i++;
        while (i < s.length && s[i] !== '{' && !/\s/.test(s[i]!)) i++;
        while (/\s/.test(s[i] ?? '')) i++;
        if (s[i] !== '{') throw new Error(`Bad ICU branch in "${message}"`);
        i++;
        message_();
        i++;
      }
    }
    let depth = 1;
    while (i < s.length && depth) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') depth--;
      i++;
    }
  };
  message_();
  return [...out].sort();
}

const get = (catalog: Catalog, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Catalog | undefined)?.[k], catalog);

describe('dbaccess manifest', () => {
  it('declares the exact permissions and role keys the platform seed grants', () => {
    expect(manifest.permissions?.map((p) => p.key)).toEqual([
      'dbaccess.self.request',
      'dbaccess.servers.manage',
      'dbaccess.grants.read',
      'dbaccess.grants.manage',
      'dbaccess.reviews.read',
      'dbaccess.reviews.manage',
    ]);
    const roles = Object.fromEntries(
      (manifest.roles ?? []).map((r) => [r.key, [r.permissions.sort(), Boolean(r.grantByDefault)]]),
    );
    expect(roles).toEqual({
      'dbaccess-requester': [['dbaccess.self.request'], true],
      'dbaccess-dba': [['dbaccess.grants.manage', 'dbaccess.grants.read', 'dbaccess.servers.manage'], false],
      'dbaccess-auditor': [['dbaccess.grants.read', 'dbaccess.reviews.read'], false],
      'dbaccess-review-manager': [
        ['dbaccess.grants.read', 'dbaccess.reviews.manage', 'dbaccess.reviews.read'],
        false,
      ],
    });
  });

  it('places the navigation in the Database access group', () => {
    expect(manifest.navigation?.map((n) => [n.href, n.order, n.icon, n.permission ?? null, n.group])).toEqual(
      [
        ['/dbaccess', 64, 'database', 'dbaccess.self.request', 'dbaccess.nav.group'],
        ['/dbaccess/grants', 65, 'key-round', 'dbaccess.grants.read', 'dbaccess.nav.group'],
        ['/dbaccess/reviews', 66, 'clipboard-check', 'dbaccess.self.request', 'dbaccess.nav.group'],
        ['/dbaccess/servers', 67, 'server-cog', 'dbaccess.servers.manage', 'dbaccess.nav.group'],
      ],
    );
    expect(manifest.portal?.entries).toEqual([
      expect.objectContaining({ href: '/dbaccess/request', permission: 'dbaccess.self.request' }),
    ]);
  });

  it('requires approval: manager → role owner (from a fact) → security for high risk', () => {
    const wf = manifest.workflows?.find((w) => w.key === 'dbaccess.request');
    expect(wf).toMatchObject({ required: true, subject: 'request' });
    const steps = wf!.defaultGraph!.steps;
    expect(steps.map((s) => s.id)).toEqual(['manager', 'owner', 'security']);
    expect(steps[1]).toMatchObject({ approvers: [{ type: 'fact', fact: 'role.approverIds' }] });
    expect(steps[2]).toMatchObject({ when: { fact: 'role.risk', op: 'eq', value: 'high' } });
    expect(
      requestFactsSchema.parse({
        role: { risk: 'high', approverIds: [], environment: 'production', permanent: false, days: 7 },
      }),
    ).toBeTruthy();
  });

  it('declares the task type, notifications and AI tools', () => {
    expect(manifest.taskTypes?.map((t) => [t.type, t.permission])).toEqual([
      ['sync', 'dbaccess.servers.manage'],
    ]);
    expect(manifest.taskTypes?.[0]?.config.safeParse({ serverId: 'x' }).success).toBe(false);
    expect(manifest.notifications?.map((n) => n.type)).toEqual([
      'dbaccess.request.approved',
      'dbaccess.request.rejected',
      'dbaccess.grant.ready',
      'dbaccess.grant.expiring',
      'dbaccess.grant.revoked',
      'dbaccess.provisioning.failed',
      'dbaccess.review.assigned',
      'dbaccess.review.reminder',
    ]);
    expect(manifest.ai?.tools?.map((t) => [t.name, Boolean(t.destructive)])).toEqual([
      ['dbaccess.list_my_access', false],
      ['dbaccess.request_access', true],
    ]);
  });

  it('has catalog text for every key the manifest uses', () => {
    const keys = [
      manifest.name,
      manifest.description!,
      ...(manifest.navigation ?? []).flatMap((n) => [n.label, n.group!]),
      ...(manifest.permissions ?? []).map((p) => p.description),
      ...(manifest.settings ?? []).flatMap((s) => [s.label, s.description!]),
      ...(manifest.portal?.entries ?? []).flatMap((e) => [e.label, e.description!]),
      ...(manifest.workflows ?? []).flatMap((w) => [w.name, w.description!]),
      ...(manifest.taskTypes ?? []).flatMap((t) => [t.name, t.description!]),
    ];
    for (const key of keys) {
      expect(key.startsWith('dbaccess.'), key).toBe(true);
      expect(typeof get(en, key.slice('dbaccess.'.length)), key).toBe('string');
    }
    for (const n of manifest.notifications ?? []) {
      const base = `notifications.${n.type.split('.').slice(1).join('_').replaceAll('-', '_')}`;
      for (const part of ['label', 'title', 'body'])
        expect(typeof get(en, `${base}.${part}`), `${base}.${part}`).toBe('string');
    }
  });

  it('labels every audit action', () => {
    const actions = [
      'server.created',
      'server.updated',
      'server.deleted',
      'server.synced',
      'role.created',
      'role.updated',
      'role.deleted',
      'request.submitted',
      'request.approved',
      'request.rejected',
      'request.cancelled',
      'grant.requested',
      'grant.provisioned',
      'grant.provisioning_failed',
      'grant.revocation_failed',
      'grant.revoke_requested',
      'grant.revoked',
      'grant.expired',
      'grant.extended',
      'grant.adopted',
      'grant.retried',
      'account.created',
      'account.enabled',
      'account.disabled',
      'credential.revealed',
      'review.created',
      'review.started',
      'review.decided',
      'review.closed',
      'review.exported',
    ];
    for (const a of actions) expect(typeof get(en, `audit.${a.replace('.', '_')}`), a).toBe('string');
  });

  it('ships the same keys and ICU arguments in every locale, without tags', () => {
    const base = new Map(flat(en));
    for (const [name, catalog] of [
      ['zh-TW', zh],
      ['ja-JP', ja],
    ] as const) {
      const other = new Map(flat(catalog));
      expect([...other.keys()].sort(), name).toEqual([...base.keys()].sort());
      for (const [key, value] of base) expect(args(other.get(key)!), `${name}: ${key}`).toEqual(args(value));
    }
    for (const [key, value] of base) expect(value, key).not.toMatch(/<[^>]*>/);
  });
});
