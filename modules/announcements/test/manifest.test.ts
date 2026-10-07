import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ja from '../messages/ja-JP.json';
import zh from '../messages/zh-TW.json';
import { createPostSchema } from '../src/contracts';
import { manifest } from '../src/manifest';

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

describe('announcements module', () => {
  it('only declares permissions, events and tools in its own namespace', () => {
    for (const p of manifest.permissions ?? []) expect(p.key.startsWith('announcements.')).toBe(true);
    for (const e of manifest.events?.emits ?? []) expect(e.name.startsWith('announcements.')).toBe(true);
    for (const tool of manifest.ai?.tools ?? []) expect(tool.name.startsWith('announcements.')).toBe(true);
  });

  it('marks broadcasting as a destructive AI action (requires human confirmation)', () => {
    expect(manifest.ai?.tools?.find((t) => t.name === 'announcements.publish_post')?.destructive).toBe(true);
  });

  it('rejects windows that end before they start', () => {
    const r = createPostSchema.safeParse({
      title: 'x',
      startsAt: '2026-10-10T10:00:00Z',
      endsAt: '2026-10-10T09:00:00Z',
    });
    expect(r.success).toBe(false);
  });

  it('ships the same message keys in every locale', () => {
    expect(keys(zh).sort()).toEqual(keys(en).sort());
    expect(keys(ja).sort()).toEqual(keys(en).sort());
  });
});
