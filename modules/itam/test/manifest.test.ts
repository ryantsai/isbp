import { advanceWorkflow, emptyWorkflowState, type ModuleManifest, workflowGraphSchema } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import { type DisposalFacts, needsSecuritySignOff, SECURITY_SIGN_OFF_WHEN } from '../src/contracts';
import { manifest as declared } from '../src/manifest';

const manifest: ModuleManifest = declared;

describe('itam manifest', () => {
  it('only declares permissions, events and tools in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('itam.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('itam.')).toBe(true);
    for (const tool of manifest.ai?.tools ?? []) expect(tool.name.startsWith('itam.')).toBe(true);
  });

  it('declares the permissions and roles the platform seed grants', () => {
    expect((manifest.permissions ?? []).map((p) => p.key).sort()).toEqual(
      [
        'itam.assets.sync',
        'itam.config.manage',
        'itam.contracts.manage',
        'itam.contracts.read',
        'itam.hardware.manage',
        'itam.hardware.read',
        'itam.licenses.reveal',
        'itam.self.read',
        'itam.software.manage',
        'itam.software.read',
      ].sort(),
    );
    expect(manifest.permissions?.find((p) => p.key === 'itam.hardware.read')?.scopes).toEqual([
      'global',
      'department',
    ]);
    const roles = Object.fromEntries((manifest.roles ?? []).map((r) => [r.key, r]));
    expect(Object.keys(roles).sort()).toEqual(
      ['itam-admin', 'itam-asset-manager', 'itam-contract-manager', 'itam-self', 'itam-viewer'].sort(),
    );
    expect(roles['itam-self']).toMatchObject({ grantByDefault: true, permissions: ['itam.self.read'] });
    expect(roles['itam-admin']!.permissions).toEqual(['itam.*']);
    expect(roles['itam-asset-manager']!.permissions).toEqual(
      expect.arrayContaining([
        'itam.hardware.*',
        'itam.software.*',
        'itam.licenses.reveal',
        'itam.config.manage',
      ]),
    );
  });

  it('requires approval for disposal, with an information security step for data-bearing devices', () => {
    const trigger = manifest.workflows?.find((w) => w.key === 'itam.disposal');
    expect(trigger).toMatchObject({ subject: 'asset', required: true });
    const graph = workflowGraphSchema.parse(trigger!.defaultGraph);
    expect(graph.steps.map((s) => s.id)).toEqual(['asset-manager', 'security']);
    /** Approves the asset manager's step and returns what runs next. */
    const afterManager = (asset: Record<string, unknown>) => {
      const facts = { asset };
      const start = advanceWorkflow(graph, emptyWorkflowState(), facts);
      expect(start.activated.map((s) => s.id)).toEqual(['asset-manager']);
      return advanceWorkflow(
        graph,
        { steps: { ...start.state.steps, 'asset-manager': { status: 'approved' } } },
        facts,
      );
    };
    const laptop = afterManager({ category: 'laptop', dataBearing: true, bookValue: 1000, ageMonths: 20 });
    expect(laptop.activated.map((s) => s.id)).toEqual(['security']);
    const oldServer = afterManager({ category: 'server', dataBearing: true, bookValue: 0, ageMonths: 30 });
    expect(oldServer.activated.map((s) => s.id)).toEqual(['security']);
    const ancient = afterManager({ category: 'server', dataBearing: true, bookValue: 0, ageMonths: 90 });
    expect(ancient).toMatchObject({ outcome: 'approved', activated: [] });
    const monitor = afterManager({ category: 'monitor', dataBearing: false, bookValue: 5000, ageMonths: 10 });
    expect(monitor).toMatchObject({ outcome: 'approved', activated: [] });
    // The disposal dialog's notice uses the step's own condition, so it says the same for every case.
    expect(graph.steps.find((s) => s.id === 'security')).toMatchObject({ when: SECURITY_SIGN_OFF_WHEN });
    const cases: [DisposalFacts['asset'], boolean][] = [
      [{ category: 'laptop', dataBearing: true, bookValue: 1000, ageMonths: 20 }, true],
      [{ category: 'server', dataBearing: true, bookValue: 0, ageMonths: 30 }, true],
      [{ category: 'server', dataBearing: true, bookValue: 0, ageMonths: 90 }, false],
      [{ category: 'monitor', dataBearing: false, bookValue: 5000, ageMonths: 10 }, false],
    ];
    for (const [asset, asked] of cases) {
      expect(needsSecuritySignOff({ asset })).toBe(asked);
      expect(afterManager(asset).activated.some((s) => s.id === 'security')).toBe(asked);
    }
    expect(
      trigger!.facts!.safeParse({
        asset: { category: 'laptop', dataBearing: true, bookValue: 1, ageMonths: 2 },
      }).success,
    ).toBe(true);
  });

  it('lets the Integrations Hub sync hardware with its own permission, granted by no role template', () => {
    expect(manifest.syncEntities).toEqual([
      expect.objectContaining({ entity: 'asset', permission: 'itam.assets.sync', icon: 'laptop' }),
    ]);
    const emitted = new Set(manifest.events?.emits?.map((e) => e.name));
    for (const name of manifest.syncEntities![0]!.events) expect(emitted.has(name), name).toBe(true);
    for (const role of manifest.roles ?? []) expect(role.permissions).not.toContain('itam.assets.sync');
  });

  it('declares record types, custom fields, the portal entry and five AI tools', () => {
    expect(manifest.records?.types.map((t) => [t.type, t.permission])).toEqual([
      ['asset', 'itam.hardware.read'],
      ['license', 'itam.software.read'],
      ['contract', 'itam.contracts.read'],
    ]);
    expect(manifest.customFields?.entities.map((e) => e.type)).toEqual(['asset', 'contract']);
    expect(manifest.portal?.entries[0]).toMatchObject({
      href: '/itam/mine',
      permission: 'itam.self.read',
      icon: 'laptop',
    });
    expect(manifest.ai?.tools?.map((t) => t.name)).toEqual([
      'itam.find_assets',
      'itam.get_asset',
      'itam.my_assets',
      'itam.license_compliance',
      'itam.expiring_contracts',
    ]);
    expect(manifest.dependsOn).toEqual(['cmdb']);
  });
});
