/**
 * Every default mapping the shipped connectors suggest must pass the hub's own profile validation against both
 * live catalogues: the real connectors (`sdp.server`, `azdo.server`) against the in-process stand-ins, and the
 * real sync adapters of the data modules. A suggestion the editor would refuse is a bug in the connector. The
 * mapping the hub offers in the profile editor (fitted to each remote scope's catalogue) is checked for every
 * scope too (the Azure DevOps stand-in has Agile, Scrum and Basic projects).
 *
 *   DATABASE_URL=postgres://isbp:isbp@localhost:5432/isbp_hub_test REDIS_URL=redis://localhost:6379/11 \
 *   ISBP_TEST_MODULES=cmdb,itsm,itam,knowledge,projects,alm,sdp,azdo,integrations \
 *   npx vitest run --project integration test/integration/integrations-defaults.test.ts
 */
import { uuidv7 } from '@isbp/db/schema';
import { createMockServer, MOCK_CREDENTIALS } from '@isbp/integration-mocks';
import { manifest as azdo } from '@isbp/module-azdo/manifest';
import {
  type CatalogueField,
  createConnection,
  services,
  validateProfileMapping,
} from '@isbp/module-integrations/server';
import { manifest as sdp } from '@isbp/module-sdp/manifest';
import type { FieldMappingSuggestion, ModuleContext } from '@isbp/sdk/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

const MODULES = process.env.ISBP_TEST_MODULES;
const NEEDED = 'cmdb,itsm,itam,knowledge,projects,alm,sdp,azdo,integrations';

let h: Harness;
let ctx: ModuleContext;
let mock: FastifyInstance;
let base: string;

/** Settings and secrets of a connection to the stand-in of each system. */
const connections: Record<
  string,
  () => { config: Record<string, unknown>; secrets: Record<string, string> }
> = {
  'sdp.server': () => ({
    config: { baseUrl: `${base}/sdp` },
    secrets: { apiKey: MOCK_CREDENTIALS.sdp.apiKey },
  }),
  'azdo.server': () => ({
    config: { collectionUrl: `${base}/ado/${MOCK_CREDENTIALS.ado.collection}` },
    secrets: { pat: MOCK_CREDENTIALS.ado.pat },
  }),
};

/** Every connector object type × each entity it lists, from the connector modules' manifests. */
const pairs = [sdp, azdo].flatMap((m) =>
  (m.connectors ?? []).flatMap((c) =>
    c.objects.flatMap((o) =>
      (o.entities ?? []).map((entity) => ({ type: `${m.id}.${c.type}`, objectType: o.type, entity })),
    ),
  ),
);

/** The hub's validation of a suggested mapping, as readable lines (empty: it would be accepted). */
function problems(
  suggested: FieldMappingSuggestion[],
  local: CatalogueField[],
  remote: CatalogueField[],
  capabilities: { create: boolean; update: boolean; comments: boolean },
  entity: { comments: boolean; matchKeys: string[] },
) {
  const issues = validateProfileMapping(
    {
      direction: 'both',
      createLocal: false,
      createRemote: false,
      comments: false,
      matchRule: null,
      pushFilter: [],
      mappings: suggested,
    },
    local,
    remote,
    { object: capabilities, entity },
  );
  return issues.map((i) => {
    const [, row, ...rest] = i.path.split('.');
    const m = row !== undefined ? suggested[Number(row)] : undefined;
    return `${m ? `${m.local} ↔ ${m.remote}` : i.path}${rest.length ? ` (${rest.join('.')})` : ''}: ${i.code} ${i.message}`;
  });
}

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES = MODULES ?? NEEDED;
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  ctx = h.kernel.registry.context('integrations');
  mock = await createMockServer();
  await mock.listen({ port: 0, host: '127.0.0.1' });
  base = `http://localhost:${(mock.server.address() as { port: number }).port}`;
}, 120_000);

afterAll(async () => {
  await mock?.close();
  await h?.close();
});

describe('default mappings of the shipped connectors', () => {
  it('cover every object type and entity the connectors declare', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(8);
    for (const p of pairs) expect(Object.keys(connections)).toContain(p.type);
  });

  it.each(pairs)('$type $objectType → $entity validates against both live catalogues', async (p) => {
    const info = ctx.connectors.list().find((c) => c.type === p.type);
    expect(info, `${p.type} is not installed`).toBeDefined();
    const object = info!.objects.find((o) => o.type === p.objectType)!;
    const entity = ctx.sync.entities().find((e) => e.entity === p.entity);
    expect(entity, `${p.entity} has no sync adapter`).toBeDefined();

    const conn = ctx.connectors.open(p.type, { id: uuidv7(), ...connections[p.type]!() });
    const scope = object.scoped ? ((await conn.scopes(p.objectType))[0]?.id ?? null) : null;
    if (object.scoped) expect(scope, `${p.objectType} has no scope to read fields from`).toBeTruthy();
    const suggested = conn.defaultMapping(p.objectType, p.entity);
    expect(suggested.length, `${p.type} suggests nothing for ${p.objectType} → ${p.entity}`).toBeGreaterThan(
      0,
    );

    const [local, remote] = await Promise.all([
      ctx.sync.fields(p.entity, { containerId: null }),
      conn.fields(p.objectType, scope),
    ]);
    expect(problems(suggested, local, remote, object.capabilities, entity!)).toEqual([]);
  });

  it.each(pairs)(
    '$type $objectType → $entity as offered in the editor, for every remote scope',
    async (p) => {
      const object = ctx.connectors
        .list()
        .find((c) => c.type === p.type)!
        .objects.find((o) => o.type === p.objectType)!;
      const entity = ctx.sync.entities().find((e) => e.entity === p.entity)!;
      const { connection } = await createConnection(ctx, {
        name: `${p.type} ${p.objectType} ${p.entity}`,
        type: p.type,
        ...connections[p.type]!(),
      });
      const conn = services(ctx).connections.open(await services(ctx).connections.row(connection.id));
      const scopes = object.scoped ? (await conn.scopes(p.objectType)).map((s) => s.id) : [null];
      expect(scopes.length).toBeGreaterThan(0);
      const local = await ctx.sync.fields(p.entity, { containerId: null });
      for (const scope of scopes) {
        const offered = await services(ctx).profiles.defaultMapping({
          connectionId: connection.id,
          objectType: p.objectType,
          entity: p.entity,
          scope: scope ?? undefined,
        });
        const remote = await conn.fields(p.objectType, scope);
        // Only rows for fields this scope's process doesn't have may be left out.
        const keys = new Set(remote.map((f) => f.key));
        const left = conn
          .defaultMapping(p.objectType, p.entity)
          .filter((m) => !offered.mappings.some((o) => o.local === m.local && o.remote === m.remote));
        expect(
          left.filter((m) => keys.has(m.remote)).map((m) => `${m.local} ↔ ${m.remote}`),
          `rows left out for scope ${scope}`,
        ).toEqual([]);
        expect(offered.dropped).toBe(left.length);
        expect(
          problems(offered.mappings, local, remote, object.capabilities, entity),
          `scope ${scope}`,
        ).toEqual([]);
      }
    },
  );
});
