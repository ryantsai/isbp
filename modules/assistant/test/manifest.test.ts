import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import { manifest } from '../src/manifest';

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

describe('assistant manifest', () => {
  it('only declares permissions, events and tools in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('assistant.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('assistant.')).toBe(true);
    for (const tool of manifest.ai?.tools ?? []) expect(tool.name.startsWith('assistant.')).toBe(true);
  });

  it('ships the same message keys in every locale', () => {
    expect(keys(zh).sort()).toEqual(keys(en).sort());
    expect(keys(ja).sort()).toEqual(keys(en).sort());
  });
});
