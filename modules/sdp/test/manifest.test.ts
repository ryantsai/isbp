import { ASSET_CATEGORIES, ASSET_STATUSES } from '@isbp/module-itam/model';
import {
  changeTypeSchema,
  riskSchema,
  ticketStatusSchema,
  ticketTypeSchema,
} from '@isbp/module-itsm/contracts';
import { ARTICLE_STATUSES, articleAudienceSchema } from '@isbp/module-knowledge/contracts';
import type { ModuleManifest } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import { SDP_OBJECT_TYPES, sdpSecretsSchema } from '../src/contracts';
import { manifest as typed } from '../src/manifest';
import server from '../src/server';
import { defaultMapping, MAPPED_PAIRS } from '../src/server/mapping';
import { fieldDefs, OBJECTS } from '../src/server/objects';
import web from '../src/web';

/** Widened to the SDK types (the manifest itself is a const literal). */
const manifest: ModuleManifest = typed;

type Catalog = Record<string, unknown>;

const flat = (o: Catalog, p = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v
      ? flat(v as Catalog, `${p}${k}.`)
      : [[`${p}${k}`, String(v)] as [string, string]],
  );

/** ICU arguments (`{name}`, `{count, plural, …}`); branch text never matches (it has spaces, `#` or CJK). */
const args = (message: string) => [...message.matchAll(/\{\s*([A-Za-z]\w*)\s*[,}]/g)].map((m) => m[1]).sort();

const get = (catalog: Catalog, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Catalog | undefined)?.[k], catalog);

describe('sdp manifest', () => {
  it('declares one connector with the five ServiceDesk Plus objects, and nothing else', () => {
    expect(manifest.permissions ?? []).toEqual([]);
    expect(manifest.navigation ?? []).toEqual([]);
    expect(manifest.events ?? {}).toEqual({});
    expect(manifest.connectors?.map((c) => c.type)).toEqual(['server']);
    const objects = manifest.connectors![0]!.objects;
    expect(objects.map((o) => [o.type, o.entities, o.capabilities])).toEqual([
      ['request', ['itsm.ticket'], { create: true, update: true, comments: true, webhooks: true }],
      ['problem', ['itsm.ticket'], { create: true, update: true, webhooks: true }],
      ['change', ['itsm.change'], { create: true, update: true, webhooks: true }],
      ['asset', ['itam.asset'], { create: true, update: true }],
      ['solution', ['knowledge.article'], { create: true, update: true }],
    ]);
    expect(objects.map((o) => o.type)).toEqual([...SDP_OBJECT_TYPES]);
    expect(Object.keys(OBJECTS)).toEqual([...SDP_OBJECT_TYPES]);
  });

  it('keeps the technician API key as the only secret', () => {
    expect(Object.keys(sdpSecretsSchema.shape)).toEqual(['apiKey']);
    expect(manifest.connectors![0]!.secrets).toBe(sdpSecretsSchema);
  });

  it('wires the connector handler and the settings form slot', () => {
    expect(Object.keys(server.connectors ?? {})).toEqual(['server']);
    expect(web.routes).toEqual([]);
    expect(web.slots.map((s) => s.slot)).toEqual(['integrations.connector-config.sdp.server']);
  });
});

/**
 * Local field keys of the sync adapters (docs/architecture.md §12.8) and the values they accept. The value
 * maps' local values must be valid there, or the hub refuses the mapping.
 */
const LEVELS = ['1', '2', '3'];
const LOCAL: Record<string, Record<string, readonly string[] | null>> = {
  'itsm.ticket': {
    type: ticketTypeSchema.options.filter((t) => t !== 'change'),
    title: null,
    description: null,
    status: ticketStatusSchema.options,
    impact: LEVELS,
    urgency: LEVELS,
    priority: ['1', '2', '3', '4'],
    // Category and group choices are ids of the installation: no static value map can name them.
    category: null,
    assignmentGroup: null,
    assignee: null,
    requester: null,
    resolutionCode: null,
    resolutionNotes: null,
    major: null,
  },
  'itsm.change': {
    title: null,
    description: null,
    status: null,
    changeType: changeTypeSchema.options,
    risk: riskSchema.options,
    reason: null,
    plannedStart: null,
    plannedEnd: null,
    implementationPlan: null,
    backoutPlan: null,
    testPlan: null,
    assignmentGroup: null,
    assignee: null,
  },
  'itam.asset': {
    name: null,
    category: ASSET_CATEGORIES,
    serialNumber: null,
    status: ASSET_STATUSES,
    assignedTo: null,
    location: null,
    vendor: null,
    purchaseDate: null,
    purchaseCost: null,
    currency: null,
    invoiceNumber: null,
    warrantyEnd: null,
    notes: null,
  },
  'knowledge.article': {
    title: null,
    summary: null,
    body: null,
    category: null,
    tags: null,
    locale: null,
    audience: articleAudienceSchema.options,
    status: ARTICLE_STATUSES,
  },
};

describe('default mappings', () => {
  it('cover every object with the entity it maps to', () => {
    expect(MAPPED_PAIRS).toEqual([
      { objectType: 'request', entity: 'itsm.ticket' },
      { objectType: 'problem', entity: 'itsm.ticket' },
      { objectType: 'change', entity: 'itsm.change' },
      { objectType: 'asset', entity: 'itam.asset' },
      { objectType: 'solution', entity: 'knowledge.article' },
    ]);
    expect(defaultMapping('asset', 'itsm.ticket')).toEqual([]);
  });

  it.each(MAPPED_PAIRS)(
    '$objectType → $entity uses existing keys and valid values',
    ({ objectType, entity }) => {
      const remote = new Map(fieldDefs(OBJECTS[objectType as keyof typeof OBJECTS]).map((f) => [f.key, f]));
      const local = LOCAL[entity]!;
      const rows = defaultMapping(objectType, entity);
      expect(new Set(rows.map((r) => r.local)).size, 'each local field once').toBe(rows.length);
      for (const row of rows) {
        const f = remote.get(row.remote);
        expect(f, `remote ${row.remote}`).toBeDefined();
        expect(row.local in local, `local ${row.local}`).toBe(true);
        // A read-only remote field can only be pulled.
        if (f!.readOnly) expect(row.direction, row.remote).toBe('pull');
        for (const v of row.values ?? []) {
          expect(
            f!.choices?.map((c) => c.value),
            `${row.remote} choice ${v.remote}`,
          ).toContain(v.remote);
          const allowed = local[row.local];
          expect(allowed, `${row.local} has choices`).not.toBeNull();
          expect(allowed, `${row.local} value ${v.local}`).toContain(v.local);
        }
      }
    },
  );

  it('leaves out fields whose local choices are ids of the installation', () => {
    const idChoices: Record<string, string[]> = {
      'itsm.ticket': ['category', 'assignmentGroup'],
      'itsm.change': ['assignmentGroup'],
      'itam.asset': ['vendor'],
      'knowledge.article': ['category'],
    };
    for (const { objectType, entity } of MAPPED_PAIRS)
      for (const row of defaultMapping(objectType, entity))
        expect(idChoices[entity], `${objectType} ${row.local}`).not.toContain(row.local);
  });

  it('never maps change statuses (approval happens in ISBP)', () => {
    expect(
      defaultMapping('change', 'itsm.change').some((r) => r.local === 'status' || r.remote === 'status'),
    ).toBe(false);
  });

  it('makes problems tickets of type problem', () => {
    expect(defaultMapping('problem', 'itsm.ticket').find((r) => r.local === 'type')).toEqual({
      local: 'type',
      remote: 'record_type',
      direction: 'pull',
      values: [{ remote: 'Problem', local: 'problem' }],
    });
  });

  it('pushes each local value to one remote value (the first listed)', () => {
    const status = defaultMapping('request', 'itsm.ticket').find((r) => r.local === 'status')!;
    const first = (local: string) => status.values!.find((v) => v.local === local)?.remote;
    expect(first('in_progress')).toBe('In Progress');
    expect(first('fulfilled')).toBe('Resolved');
    expect(first('cancelled')).toBe('Canceled');
  });

  it('returns copies', () => {
    const a = defaultMapping('request', 'itsm.ticket');
    a[0]!.remote = 'changed';
    expect(defaultMapping('request', 'itsm.ticket')[0]!.remote).toBe('subject');
  });
});

describe('catalogs', () => {
  it('ship the same keys and ICU arguments in every locale', () => {
    const base = new Map(flat(en));
    for (const [label, catalog] of [
      ['zh-TW', zh],
      ['ja-JP', ja],
    ] as const) {
      const other = new Map(flat(catalog));
      expect([...other.keys()].sort(), label).toEqual([...base.keys()].sort());
      for (const [key, value] of base) expect(args(other.get(key)!), `${label} ${key}`).toEqual(args(value));
    }
  });

  it('never use characters ICU treats specially', () => {
    for (const catalog of [en, zh, ja])
      for (const [key, value] of flat(catalog)) {
        expect(value, key).not.toMatch(/[<>]/);
        expect(value, key).not.toContain("'");
      }
  });

  it('label the module, the connector and its objects', () => {
    const c = manifest.connectors![0]!;
    const keys = [
      manifest.name,
      manifest.description!,
      c.name,
      c.description!,
      ...c.objects.map((o) => o.name),
    ];
    for (const catalog of [en, zh, ja])
      for (const key of keys) expect(get(catalog, key.replace(/^sdp\./, '')), key).toBeTruthy();
  });
});
