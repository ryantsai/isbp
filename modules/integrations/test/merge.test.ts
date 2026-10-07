import { describe, expect, it } from 'vitest';
import {
  CursorTracker,
  decideField,
  effectiveDirections,
  type FieldDecisionInput,
  newerSide,
  normalize,
  sameValue,
} from '../src/merge';
import { appendCapped, type LogEntry, matchesFilter } from '../src/model';

const base: FieldDecisionInput = {
  localType: 'string',
  remoteType: 'string',
  snap: { l: 'A', r: 'A' },
  local: 'A',
  remote: 'A',
  remoteAsLocal: 'A',
  canPull: true,
  canPush: true,
  policy: 'manual',
  newer: 'remote',
};
const decide = (patch: Partial<FieldDecisionInput>) => decideField({ ...base, ...patch });

describe('normalization', () => {
  it('ignores trivial differences', () => {
    expect(sameValue('text', 'a\r\nb  \n', 'a\nb')).toBe(true);
    expect(sameValue('string', null, '')).toBe(true);
    expect(sameValue('string', undefined, '  ')).toBe(true);
    expect(sameValue('tags', ['B', 'a', 'a'], ['a', 'b'])).toBe(true);
    expect(sameValue('tags', 'a; b', ['b', 'a'])).toBe(true);
    expect(sameValue('choice', 'Open', 'open')).toBe(true);
    expect(sameValue('datetime', '2026-10-07T10:00:00.123Z', '2026-10-07T18:00:00+08:00')).toBe(true);
    expect(sameValue('date', '2026-10-07T00:00:00Z', '2026-10-07')).toBe(true);
    expect(sameValue('number', '3.0', 3)).toBe(true);
    expect(sameValue('json', { b: 1, a: [1, 2] }, { a: [1, 2], b: 1 })).toBe(true);
    expect(sameValue('html', '<p>a</p>\n  <p>b</p>', '<p>a</p><p>b</p>')).toBe(true);
    expect(
      sameValue(
        'user',
        { email: 'Dana@Corp.example', name: 'D' },
        { email: 'dana@corp.example', name: 'Dana' },
      ),
    ).toBe(true);
  });

  it('keeps real differences', () => {
    expect(sameValue('string', 'a', 'b')).toBe(false);
    expect(sameValue('number', 1, 2)).toBe(false);
    expect(sameValue('boolean', false, null)).toBe(false);
    expect(normalize('datetime', 'not a date')).toBe('not a date');
  });
});

describe('three-way merge per field', () => {
  it('does nothing when neither side changed (replays and echoes are no-ops)', () => {
    expect(decide({}).action).toBe('same');
    // Our own write comes back: the snapshot already holds it in both forms.
    expect(
      decide({ snap: { l: 'B', r: '<p>B</p>' }, local: 'B', remote: '<p>B</p>', remoteType: 'html' }).action,
    ).toBe('same');
  });

  it('pulls what only the remote side changed and pushes what only ISBP changed', () => {
    expect(decide({ remote: 'B', remoteAsLocal: 'B' }).action).toBe('pull');
    expect(decide({ local: 'B' }).action).toBe('push');
  });

  it('accepts a change it may not carry as the new base (one-way)', () => {
    const d = decide({ remote: 'B', remoteAsLocal: 'B', canPull: false });
    expect(d).toMatchObject({ action: 'ignore', snap: { l: 'A', r: 'B' } });
    expect(decide({ local: 'B', canPush: false })).toMatchObject({
      action: 'ignore',
      snap: { l: 'B', r: 'A' },
    });
  });

  it('settles converged edits without a conflict', () => {
    expect(decide({ local: 'B', remote: 'B', remoteAsLocal: 'B' })).toMatchObject({
      action: 'same',
      snap: { l: 'B', r: 'B' },
    });
  });

  it('applies the four conflict policies when both changed differently', () => {
    const both = { local: 'L', remote: 'R', remoteAsLocal: 'R' };
    expect(decide({ ...both, policy: 'manual' }).action).toBe('conflict');
    expect(decide({ ...both, policy: 'remote' }).action).toBe('pull');
    expect(decide({ ...both, policy: 'local' }).action).toBe('push');
    expect(decide({ ...both, policy: 'newest', newer: 'local' }).action).toBe('push');
    expect(decide({ ...both, policy: 'newest', newer: 'remote' }).action).toBe('pull');
  });

  it('lets the source win in one-way profiles, whatever the policy', () => {
    const both = { local: 'L', remote: 'R', remoteAsLocal: 'R', policy: 'manual' as const };
    expect(decide({ ...both, canPush: false }).action).toBe('pull');
    expect(decide({ ...both, canPull: false }).action).toBe('push');
    expect(decide({ ...both, canPull: false, canPush: false }).action).toBe('ignore');
  });

  it('treats a field never agreed as changed only on the side that has a value', () => {
    expect(decide({ snap: undefined, local: null, remote: 'R', remoteAsLocal: 'R' }).action).toBe('pull');
    expect(decide({ snap: undefined, local: 'L', remote: null, remoteAsLocal: null }).action).toBe('push');
    expect(decide({ snap: undefined, local: 'X', remote: 'X', remoteAsLocal: 'X' })).toMatchObject({
      action: 'same',
      snap: { l: 'X', r: 'X' },
    });
    expect(decide({ snap: undefined, local: 'L', remote: 'R', remoteAsLocal: 'R' }).action).toBe('conflict');
    expect(decide({ snap: undefined, local: null, remote: null, remoteAsLocal: null })).toMatchObject({
      action: 'same',
      snap: { l: null, r: null },
    });
  });

  it('compares each side with its own form, so lossy conversions do not loop', () => {
    // Remote HTML was converted to Markdown when pulled; reading the same HTML again is not a change.
    const d = decide({
      localType: 'markdown',
      remoteType: 'html',
      snap: { l: '**Hi**', r: '<p><b>Hi</b></p>' },
      local: '**Hi**',
      remote: '<p><b>Hi</b></p>',
      remoteAsLocal: '**Hi**',
    });
    expect(d.action).toBe('same');
  });

  it('picks the newer side by updatedAt (ties go to the remote side)', () => {
    expect(newerSide('2026-10-07T10:00:01Z', '2026-10-07T10:00:00Z')).toBe('local');
    expect(newerSide('2026-10-07T10:00:00Z', '2026-10-07T10:00:00Z')).toBe('remote');
    expect(newerSide(null, '2026-10-07T10:00:00Z')).toBe('remote');
    expect(newerSide('2026-10-07T10:00:00Z', 'garbage')).toBe('local');
  });
});

describe('directions', () => {
  const rw = {};
  it('narrow the profile direction by the row and the fields', () => {
    expect(effectiveDirections('both', 'both', rw, rw)).toEqual({ canPull: true, canPush: true });
    expect(effectiveDirections('pull', 'both', rw, rw)).toEqual({ canPull: true, canPush: false });
    expect(effectiveDirections('push', 'both', rw, rw)).toEqual({ canPull: false, canPush: true });
    expect(effectiveDirections('both', 'pull', rw, rw)).toEqual({ canPull: true, canPush: false });
    expect(effectiveDirections('pull', 'push', rw, rw)).toEqual({ canPull: false, canPush: false });
    expect(effectiveDirections('both', 'both', { readOnly: true }, rw)).toEqual({
      canPull: false,
      canPush: true,
    });
    expect(effectiveDirections('both', 'both', rw, { readOnly: true })).toEqual({
      canPull: true,
      canPush: false,
    });
  });

  it('allow create-only fields and non-updatable remote objects only on create', () => {
    expect(effectiveDirections('both', 'both', { createOnly: true }, rw).canPull).toBe(false);
    expect(
      effectiveDirections('both', 'both', { createOnly: true }, rw, { remoteUpdatable: true, onCreate: true })
        .canPull,
    ).toBe(true);
    expect(effectiveDirections('both', 'both', rw, rw, { remoteUpdatable: false }).canPush).toBe(false);
    expect(
      effectiveDirections('both', 'both', rw, rw, { remoteUpdatable: false, onCreate: true }).canPush,
    ).toBe(true);
  });
});

describe('cursor handling', () => {
  it('advances past every handled page', () => {
    const c = new CursorTracker(null);
    expect(c.page('10', false)).toBe('10');
    expect(c.read).toBe('10');
    expect(c.page('20', false)).toBe('20');
  });

  it('stays before the first page with deferred items until they are done', () => {
    const c = new CursorTracker('5');
    expect(c.page('10', false)).toBe('10');
    expect(c.page('20', true)).toBe('10');
    expect(c.read).toBe('20');
    expect(c.page('30', false)).toBe('10');
    expect(c.page('40', true)).toBe('10');
    expect(c.release()).toBe('40');
  });

  it('keeps the position when a page returns no cursor', () => {
    const c = new CursorTracker('7');
    expect(c.page(null, false)).toBe('7');
  });
});

describe('push filter', () => {
  const values = { status: 'open', tags: ['VIP', 'net'], title: 'Printer down', owner: null };
  it('requires every condition', () => {
    expect(matchesFilter([], values)).toBe(true);
    expect(matchesFilter([{ field: 'status', op: 'eq', value: 'OPEN' }], values)).toBe(true);
    expect(matchesFilter([{ field: 'status', op: 'neq', value: 'done' }], values)).toBe(true);
    expect(matchesFilter([{ field: 'status', op: 'in', value: ['done', 'open'] }], values)).toBe(true);
    expect(matchesFilter([{ field: 'tags', op: 'contains', value: 'vip' }], values)).toBe(true);
    expect(matchesFilter([{ field: 'title', op: 'contains', value: 'printer' }], values)).toBe(true);
    expect(matchesFilter([{ field: 'owner', op: 'empty' }], values)).toBe(true);
    expect(
      matchesFilter(
        [
          { field: 'status', op: 'eq', value: 'open' },
          { field: 'owner', op: 'not_empty' },
        ],
        values,
      ),
    ).toBe(false);
  });
});

describe('run log', () => {
  it('keeps the first entries and the latest, counting what falls out', () => {
    let log: LogEntry[] = [];
    let dropped = 0;
    for (let i = 0; i < 10; i++)
      ({ log, dropped } = appendCapped(log, { at: '', level: 'info', message: String(i) }, dropped, 5, 2));
    expect(log.map((l) => l.message)).toEqual(['0', '1', '7', '8', '9']);
    expect(dropped).toBe(5);
  });
});
