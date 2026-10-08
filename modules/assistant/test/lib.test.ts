import { ErrorCodes, HttpError } from '@isbp/sdk/server';
import { describe, expect, it } from 'vitest';
import { labelOf, refsIn, resolveRefs } from '../src/lib/refs';
import { checkFromError } from '../src/server/change-sets';
import { systemPrompt } from '../src/server/chat';

describe('references between items', () => {
  const value = { workflowId: '$ref:flow', steps: [{ group: '$ref:team' }, '$ref:flow'], note: 'not $ref:x' };

  it('finds every reference once, in order', () => {
    expect(refsIn(value)).toEqual(['flow', 'team']);
    expect(refsIn('$ref:solo')).toEqual(['solo']);
    expect(refsIn({ a: 1, b: null })).toEqual([]);
  });

  it('replaces references with ids and reports the missing ones', () => {
    const r = resolveRefs(value, new Map([['flow', 'id-1']]));
    expect(r.value).toEqual({
      workflowId: 'id-1',
      steps: [{ group: '$ref:team' }, 'id-1'],
      note: 'not $ref:x',
    });
    expect(r.missing).toEqual(['team']);
    expect(
      resolveRefs(
        value,
        new Map([
          ['flow', 'a'],
          ['team', 'b'],
        ]),
      ).missing,
    ).toEqual([]);
  });

  it('names a value from its name (plain or per locale), label, title or key', () => {
    expect(labelOf({ name: 'Laptop approval' })).toBe('Laptop approval');
    expect(labelOf({ name: { 'zh-TW': '筆電', en: 'Laptop' } }, 'zh-TW')).toBe('筆電');
    expect(labelOf({ name: { 'ja-JP': 'ノート PC' } })).toBe('ノート PC');
    expect(
      labelOf({ entityType: 'itsm.ticket', field: { key: 'costCenter', label: { en: 'Cost center' } } }),
    ).toBe('Cost center');
    expect(labelOf({ formKey: 'laptop' })).toBe('laptop');
    expect(labelOf(null)).toBeNull();
  });
});

describe('dry-run results', () => {
  it('marks permission failures as needing a reviewer, and keeps issues', () => {
    expect(
      checkFromError(new HttpError(403, ErrorCodes.FORBIDDEN, 'no', { permission: 'scheduler.sql.run' })),
    ).toMatchObject({ ok: false, needsApprover: true, permission: 'scheduler.sql.run' });
    expect(checkFromError(new HttpError(403, ErrorCodes.PRIVILEGE_ESCALATION, 'no')).needsApprover).toBe(
      true,
    );
    const invalid = checkFromError(
      new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'bad', {
        issues: [{ path: 'name', message: 'required' }],
      }),
    );
    expect(invalid).toMatchObject({
      needsApprover: false,
      code: 'VALIDATION_FAILED',
      issues: [{ path: 'name' }],
    });
    expect(checkFromError(new Error('boom'))).toMatchObject({
      code: 'INTERNAL',
      message: 'Unexpected error',
    });
  });
});

describe('system prompt', () => {
  it('states the rules, the kinds, the change set and the page', () => {
    const prompt = systemPrompt({
      userName: 'Ann',
      locale: 'zh-TW',
      page: {
        path: '/itsm/tickets/1',
        title: 'INC-00001',
        record: { type: 'itsm.ticket', id: '1', label: 'VPN' },
      },
      kinds: [{ kind: 'core.workflow', description: 'Approval workflows', canApply: false }],
      changeSet: { reference: 'CS-00003', status: 'draft', items: 2 },
    });
    expect(prompt).toContain('run only if they confirm');
    expect(prompt).toContain('core.workflow — Approval workflows (needs a reviewer)');
    expect(prompt).toContain('CS-00003 (draft, 2 items)');
    expect(prompt).toContain('showing itsm.ticket 1 (“VPN”)');
    expect(prompt).toContain('Traditional Chinese (Taiwan)');
  });
});
