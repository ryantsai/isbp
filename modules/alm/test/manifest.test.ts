import type { ModuleManifest } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import {
  APP_STAGES,
  CRITICALITIES,
  createAppSchema,
  createDeploymentSchema,
  DATA_CLASSIFICATIONS,
  DEPLOYMENT_STATUSES,
  DISPOSITIONS,
  ENVIRONMENT_KINDS,
  gitStatusSchema,
  HOSTINGS,
  READINESS_CHECKS,
  RELEASE_STATUSES,
  REPO_PROVIDERS,
  updateAppSchema,
} from '../src/contracts';
import { manifest as typed } from '../src/manifest';

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

describe('alm manifest', () => {
  it('only declares permissions, events, tools and notifications in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('alm.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('alm.')).toBe(true);
    for (const tool of manifest.ai?.tools ?? []) expect(tool.name.startsWith('alm.')).toBe(true);
    for (const n of manifest.notifications ?? []) expect(n.type.startsWith('alm.')).toBe(true);
  });

  it('depends on the CMDB and ITSM, whose tables it reads', () => {
    expect(manifest.dependsOn).toEqual(['cmdb', 'itsm']);
  });

  it('declares the exact permissions and roles the platform seed grants', () => {
    expect(manifest.permissions?.map((p) => p.key)).toEqual([
      'alm.apps.read',
      'alm.apps.manage',
      'alm.releases.manage',
      'alm.deployments.create',
      'alm.deployments.override',
      'alm.repositories.sync',
    ]);
    const roles = Object.fromEntries((manifest.roles ?? []).map((r) => [r.key, r.permissions]));
    expect(roles).toEqual({
      'alm-viewer': ['alm.apps.read'],
      'alm-release-manager': ['alm.apps.read', 'alm.releases.manage', 'alm.deployments.create'],
      'alm-pipeline': ['alm.apps.read', 'alm.deployments.create'],
      'alm-manager': ['alm.apps.read', 'alm.apps.manage', 'alm.releases.manage', 'alm.deployments.create'],
      'alm-admin': ['alm.*'],
    });
    expect(manifest.roles?.some((r) => r.grantByDefault)).toBe(false);
  });

  it('emits the documented events', () => {
    expect(manifest.events?.emits?.map((e) => e.name).sort()).toEqual(
      [
        'alm.application.created',
        'alm.application.updated',
        'alm.application.stage_changed',
        'alm.repository.created',
        'alm.repository.updated',
        'alm.release.created',
        'alm.release.updated',
        'alm.release.status_changed',
        'alm.deployment.recorded',
        'alm.deployment.succeeded',
        'alm.deployment.failed',
        'alm.deployment.policy_overridden',
      ].sort(),
    );
    for (const e of manifest.events?.emits ?? []) expect(e.schema, e.name).toBeDefined();
  });

  it('turns the change requirement on and the window off by default', () => {
    expect(manifest.settings?.map((s) => [s.key, s.type, s.default])).toEqual([
      ['policy.requireChange', 'boolean', true],
      ['policy.enforceWindow', 'boolean', false],
    ]);
  });

  it('exposes AI tools that say when to use them; recording is not destructive and has no override', () => {
    const tools = manifest.ai?.tools ?? [];
    expect(tools.map((t) => [t.name, t.permission, Boolean(t.destructive)])).toEqual([
      ['alm.find_applications', 'alm.apps.read', false],
      ['alm.get_application', 'alm.apps.read', false],
      ['alm.release_readiness', 'alm.apps.read', false],
      ['alm.record_deployment', 'alm.deployments.create', false],
    ]);
    for (const tool of tools) expect(tool.description.length).toBeGreaterThan(80);
    const record = tools.find((t) => t.name === 'alm.record_deployment')!.input;
    expect(record.parse({ application: 'erp', environment: 'test', version: '12.1.0' })).toEqual({
      application: 'erp',
      environment: 'test',
      version: '12.1.0',
      status: 'succeeded',
    });
    // Unknown keys (like an override) are stripped: the policy can't be overridden through AI.
    expect(
      record.parse({
        application: 'erp',
        environment: 'production',
        version: '1',
        override: { reason: 'x' },
      }),
    ).not.toHaveProperty('override');
  });

  it('lets the Integrations Hub sync repositories inside applications (Git status)', () => {
    expect(manifest.syncEntities).toEqual([
      {
        entity: 'repository',
        name: 'alm.sync.entities.repository',
        icon: 'git-branch',
        permission: 'alm.repositories.sync',
        events: ['alm.repository.created', 'alm.repository.updated'],
        container: 'alm.application',
      },
    ]);
    for (const role of manifest.roles ?? []) expect(role.permissions).not.toContain('alm.repositories.sync');
  });

  it('links applications and releases as records, and lets admins extend applications', () => {
    expect(manifest.records?.types.map((t) => [t.type, t.permission])).toEqual([
      ['application', 'alm.apps.read'],
      ['release', 'alm.apps.read'],
    ]);
    expect(manifest.customFields?.entities).toEqual([
      { type: 'application', name: 'alm.entities.application' },
    ]);
    // One sidebar row; the release calendar is a section tab of it.
    expect(manifest.navigation?.map((n) => [n.href, n.icon, n.tabs?.map((t) => t.href)])).toEqual([
      ['/alm', 'app-window', ['/alm/releases']],
    ]);
  });
});

describe('contracts', () => {
  it('reads the Git status a sync reports: full ref names, ids as text, unknown keys dropped', () => {
    expect(
      gitStatusSchema.parse({
        branches: [{ name: 'refs/heads/main', commitSha: 'abc1234', extra: 1 }],
        pullRequests: [
          {
            id: 42,
            title: 'Add MFA prompt',
            author: 'Mei Lin',
            sourceBranch: 'refs/heads/feature/mfa',
            targetBranch: 'main',
            url: 'https://ado.contoso.local/tfs/DefaultCollection/_git/erp/pullrequest/42',
          },
        ],
      }),
    ).toEqual({
      branches: [{ name: 'main', commitSha: 'abc1234' }],
      pullRequests: [
        {
          id: '42',
          title: 'Add MFA prompt',
          author: 'Mei Lin',
          sourceBranch: 'feature/mfa',
          targetBranch: 'main',
          url: 'https://ado.contoso.local/tfs/DefaultCollection/_git/erp/pullrequest/42',
        },
      ],
    });
    expect(gitStatusSchema.safeParse({ branches: [{ name: '' }] }).success).toBe(false);
    expect(
      gitStatusSchema.safeParse({
        pullRequests: [
          { id: 1, title: 'x', sourceBranch: 'a', targetBranch: 'b', url: 'javascript:alert(1)' },
        ],
      }).success,
    ).toBe(false);
  });

  it('fills defaults on create but never on update', () => {
    expect(createAppSchema.parse({ code: 'hr-portal', name: ' HR Portal ' })).toEqual({
      code: 'hr-portal',
      name: 'HR Portal',
      stage: 'planned',
      criticality: 'medium',
      hosting: 'on_prem',
      techStack: [],
      dataClassification: 'internal',
    });
    expect(updateAppSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(updateAppSchema.safeParse({ code: 'other' }).data).toEqual({});
  });

  it('validates codes, https links and dates', () => {
    for (const code of ['erp', 'hr-portal', 'a1', 'data-warehouse-2'])
      expect(createAppSchema.safeParse({ code, name: 'x' }).success, code).toBe(true);
    for (const code of ['E', 'Erp', '1erp', 'erp-', 'erp--x', 'releases', 'a'.repeat(33), 'hr_portal'])
      expect(createAppSchema.safeParse({ code, name: 'x' }).success, code).toBe(false);
    expect(
      createAppSchema.safeParse({ code: 'x1', name: 'x', documentationUrl: 'http://w.example.com' }).success,
    ).toBe(false);
    expect(
      createAppSchema.safeParse({ code: 'x1', name: 'x', documentationUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(createAppSchema.safeParse({ code: 'x1', name: 'x', goLiveDate: '2026-02-30' }).success).toBe(
      false,
    );
  });

  it('accepts what a CI/CD pipeline sends and rejects impossible timings', () => {
    const ok = createDeploymentSchema.parse({
      application: 'erp',
      environment: 'Production',
      version: '12.1.0',
    });
    expect(ok.status).toBe('succeeded');
    expect(
      createDeploymentSchema.safeParse({
        application: 'erp',
        environment: 'test',
        version: '1',
        startedAt: '2026-10-07T10:00:00Z',
        finishedAt: '2026-10-07T09:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      createDeploymentSchema.safeParse({ application: 'erp', environment: 'test', version: '1 2' }).success,
    ).toBe(false);
    expect(
      createDeploymentSchema.safeParse({
        application: 'erp',
        environment: 'test',
        version: '1',
        override: { reason: 'short' },
      }).success,
    ).toBe(false);
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

  it('label every enum value, manifest string, audit action and notification', () => {
    const enums: [string, readonly string[]][] = [
      ['stage', APP_STAGES],
      ['criticality', CRITICALITIES],
      ['disposition', DISPOSITIONS],
      ['hosting', HOSTINGS],
      ['classification', DATA_CLASSIFICATIONS],
      ['provider', REPO_PROVIDERS],
      ['envKind', ENVIRONMENT_KINDS],
      ['releaseStatus', RELEASE_STATUSES],
      ['deploymentStatus', DEPLOYMENT_STATUSES],
      ['readiness.checks', READINESS_CHECKS],
      ['policy.reason', ['no_change', 'change_not_approved', 'outside_window']],
    ];
    for (const catalog of [en, zh, ja]) {
      for (const [prefix, values] of enums)
        for (const v of values) expect(get(catalog, `${prefix}.${v}`), `${prefix}.${v}`).toBeTruthy();
      const keys = [
        manifest.name,
        manifest.description!,
        ...(manifest.navigation ?? []).flatMap((n) => [n.label, ...(n.tabs ?? []).map((t) => t.label)]),
        ...(manifest.permissions ?? []).map((p) => p.description),
        ...(manifest.settings ?? []).flatMap((s) => [s.label, s.description!]),
        ...(manifest.customFields?.entities ?? []).map((e) => e.name),
        ...(manifest.records?.types ?? []).map((r) => r.name),
        ...(manifest.syncEntities ?? []).map((e) => e.name),
        ...[
          'name',
          'url',
          'provider',
          'defaultBranch',
          'lastCommitSha',
          'lastCommitAt',
          'lastCommitMessage',
          'lastCommitAuthor',
          'branches',
          'pullRequests',
        ].map((f) => `sync.fields.${f}`),
      ];
      for (const key of keys) expect(get(catalog, key.replace(/^alm\./, '')), key).toBeTruthy();
      for (const action of [
        'application.created',
        'application.updated',
        'application.owner_released',
        'environment.created',
        'environment.updated',
        'environment.deleted',
        'environment.reordered',
        'repository.created',
        'repository.updated',
        'repository.deleted',
        'release.created',
        'release.updated',
        'release.status_changed',
        'deployment.recorded',
        'deployment.updated',
        'deployment.policy_overridden',
      ])
        expect(get(catalog, `audit.${action.replace('.', '_')}`), action).toBeTruthy();
      for (const n of manifest.notifications ?? []) {
        const key = `notifications.${n.type.replace(/^alm\./, '').replace(/[.-]/g, '_')}`;
        for (const part of ['label', 'title', 'body'])
          expect(get(catalog, `${key}.${part}`), `${key}.${part}`).toBeTruthy();
      }
    }
  });
});
