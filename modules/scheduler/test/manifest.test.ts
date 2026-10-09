import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import { manifest } from '../src/manifest';

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

const catalog = new Set(keys(en).map((k) => `scheduler.${k}`));

describe('scheduler manifest', () => {
  it('only declares permissions, events, tools and notifications in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('scheduler.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('scheduler.')).toBe(true);
    for (const tool of manifest.ai?.tools ?? []) expect(tool.name.startsWith('scheduler.')).toBe(true);
    for (const n of manifest.notifications ?? []) expect(n.type.startsWith('scheduler.')).toBe(true);
  });

  it('defines exactly the role keys the platform seed grants', () => {
    expect(manifest.roles.map((r) => r.key).sort()).toEqual([
      'scheduler-admin',
      'scheduler-operator',
      'scheduler-viewer',
    ]);
    const operator = manifest.roles.find((r) => r.key === 'scheduler-operator')!;
    expect(operator.permissions.sort()).toEqual([
      'scheduler.jobs.create',
      'scheduler.jobs.read',
      'scheduler.jobs.run',
    ]);
  });

  it('marks running a job from AI as destructive', () => {
    expect(manifest.ai.tools.find((t) => t.name === 'scheduler.run_job')).toMatchObject({
      destructive: true,
      permission: 'scheduler.jobs.run',
    });
  });

  it('has catalog text for every manifest label', () => {
    const labels: (string | undefined)[] = [
      manifest.name,
      manifest.description,
      ...manifest.navigation.flatMap((n) => [n.label, ...(n.tabs ?? []).map((t) => t.label)]),
      ...manifest.permissions.map((p) => p.description),
      ...manifest.settings.flatMap((s) => [s.label, s.description]),
      ...manifest.taskTypes.flatMap((t) => [t.name, t.description]),
      ...manifest.records.types.map((r) => r.name),
      ...(manifest.customizations ?? []).map((k) => k.label),
    ];
    for (const key of labels) if (key) expect(catalog, key).toContain(key);
  });

  it('has label, title and body for every notification type, and audit labels for every event', () => {
    for (const n of manifest.notifications) {
      const key = n.type.replace(/^scheduler\./, '').replace(/[.-]/g, '_');
      for (const part of ['label', 'title', 'body'])
        expect(catalog).toContain(`scheduler.notifications.${key}.${part}`);
    }
    for (const action of [
      'job.created',
      'job.updated',
      'job.deleted',
      'job.enabled',
      'job.disabled',
      'job.auto_disabled',
      'job.owner_released',
      'run.requested',
      'run.cancelled',
    ])
      expect(catalog).toContain(`scheduler.audit.${action.replace('.', '_')}`);
  });

  it('ships the same message keys in every locale', () => {
    expect(keys(zh).sort()).toEqual(keys(en).sort());
    expect(keys(ja).sort()).toEqual(keys(en).sort());
  });
});
