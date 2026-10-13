import type { ModuleManifest, SyncEntityDef } from '@isbp/sdk';
import { describe, expect, it } from 'vitest';
import { manifest, PROPOSAL_THRESHOLD_HOURS } from '../src/manifest';
import { PERMISSIONS } from '../src/model';

describe('projects manifest', () => {
  it('only declares permissions, events, tools, triggers and notifications in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('projects.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('projects.')).toBe(true);
    for (const tool of manifest.ai?.tools ?? []) expect(tool.name.startsWith('projects.')).toBe(true);
    for (const w of manifest.workflows ?? []) expect(w.key.startsWith('projects.')).toBe(true);
    for (const n of manifest.notifications ?? []) expect(n.type.startsWith('projects.')).toBe(true);
  });

  it('keeps the role keys the platform seed grants', () => {
    expect(manifest.roles.map((r) => r.key)).toEqual([
      'projects-member',
      'projects-manager',
      'projects-pmo',
      'projects-admin',
    ]);
    expect(manifest.roles.find((r) => r.key === 'projects-member')).toMatchObject({
      grantByDefault: true,
      permissions: [PERMISSIONS.use],
    });
    expect(manifest.roles.find((r) => r.key === 'projects-admin')!.permissions).toEqual(['projects.*']);
  });

  it('requires the proposal workflow, with the threshold literal matching the setting default', () => {
    const trigger = manifest.workflows.find((w) => w.key === 'projects.proposal')!;
    expect(trigger.required).toBe(true);
    const condition = JSON.stringify(trigger.defaultGraph);
    expect(condition).toContain('"fact":"project.budgetHours","op":"gt","value":400');
    expect(manifest.settings.find((s) => s.key === 'proposalThresholdHours')!.default).toBe(
      PROPOSAL_THRESHOLD_HOURS,
    );
    expect(condition).toContain('"roleKey":"projects-pmo"');
    // The project's custom fields are facts too (`attributes.<key>`, `records.<key>.<fact>`).
    expect(trigger.customFieldEntity).toBe('projects.project');
    expect(
      trigger.facts!.safeParse({
        project: { budgetHours: 10, priority: 'medium', departmentId: null, memberCount: 1 },
        attributes: { sponsor: 'CFO' },
        records: {},
      }).success,
    ).toBe(true);
  });

  it('lets the Integrations Hub sync projects and their tasks, with permissions no role template holds', () => {
    const entities: SyncEntityDef[] = manifest.syncEntities;
    expect(entities.map((e) => [e.entity, e.permission, e.container ?? null])).toEqual([
      ['project', 'projects.projects.sync', null],
      ['task', 'projects.tasks.sync', 'projects.project'],
    ]);
    expect(entities[1]!.commentEvents).toEqual(['projects.task.commented']);
    for (const role of manifest.roles)
      for (const p of ['projects.projects.sync', 'projects.tasks.sync'])
        expect(role.permissions).not.toContain(p);
  });

  it('declares status reporting: the PMO permission, My work, the task type, the kinds and the tools', () => {
    expect(manifest.roles.find((r) => r.key === 'projects-pmo')!.permissions).toContain(
      PERMISSIONS.reporting,
    );
    expect(manifest.roles.find((r) => r.key === 'projects-member')!.permissions).not.toContain(
      PERMISSIONS.reporting,
    );
    expect(manifest.work.map((w) => [w.key, w.kind])).toEqual([
      ['tasks', 'task'],
      ['status-updates', 'todo'],
    ]);
    expect(manifest.taskTypes.map((t) => [t.type, t.permission])).toEqual([
      ['status-report', PERMISSIONS.reporting],
    ]);
    expect(manifest.customizations.map((k) => [k.kind, k.operations])).toEqual([
      ['status-schedule', ['update']],
      ['report-template', ['create', 'update', 'archive']],
    ]);
    const declared: ModuleManifest = manifest;
    const tools = Object.fromEntries((declared.ai?.tools ?? []).map((t) => [t.name, t]));
    expect(tools['projects.status_report']!.readOnly).toBe(true);
    expect(tools['projects.post_status_update']!.readOnly).toBeUndefined();
    // The reporting page is an administration page for the PMO.
    expect(manifest.navigation.find((n) => n.id === 'reporting')).toMatchObject({
      section: 'admin',
      permission: PERMISSIONS.reporting,
    });
  });

  it('declares linkable records and custom-field entities', () => {
    expect(manifest.records.types.map((r) => r.type)).toEqual(['project', 'task']);
    expect(manifest.customFields.entities.map((e) => e.type)).toEqual(['task', 'project']);
    expect(manifest.dependsOn).toEqual([]);
  });
});
