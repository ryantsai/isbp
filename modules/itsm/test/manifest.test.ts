import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import { manifest } from '../src/manifest';

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

describe('itsm manifest', () => {
  it('only declares permissions, events and tools in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('itsm.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('itsm.')).toBe(true);
    for (const tool of manifest.ai?.tools ?? []) expect(tool.name.startsWith('itsm.')).toBe(true);
  });

  it('has catalog text for every customisation kind', () => {
    const catalog = new Set(keys(en).map((k) => `itsm.${k}`));
    for (const k of manifest.customizations ?? []) expect(catalog, k.label).toContain(k.label);
  });

  it('passes the ticket custom fields of a change to its CAB workflow as facts', () => {
    const trigger = manifest.workflows?.find((w) => w.key === 'itsm.change');
    expect(trigger?.customFieldEntity).toBe('itsm.ticket');
    expect(manifest.customFields?.entities.map((e) => `itsm.${e.type}`)).toContain(
      trigger?.customFieldEntity,
    );
    const change = {
      type: 'normal',
      risk: 'low',
      impact: 2,
      ciCount: 0,
      durationHours: 2,
      criticalCis: false,
    };
    expect(trigger!.facts!.safeParse({ change, attributes: { outage: true }, records: {} }).success).toBe(
      true,
    );
  });

  it('ships the same message keys in every locale', () => {
    expect(keys(zh).sort()).toEqual(keys(en).sort());
    expect(keys(ja).sort()).toEqual(keys(en).sort());
  });
});
