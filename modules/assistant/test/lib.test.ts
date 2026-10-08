import { ErrorCodes, HttpError } from '@isbp/sdk/server';
import { describe, expect, it } from 'vitest';
import { appliedLinks, linkText } from '../src/lib/links';
import { labelOf, refsIn, renameRefs, resolveRefs, uniqueRef } from '../src/lib/refs';
import { checkFromError } from '../src/server/change-sets';
import { systemPrompt } from '../src/server/chat';
import { linkLines } from '../src/server/text';

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

describe('template refs', () => {
  it('renames references to items whose names were taken, leaving others alone', () => {
    const names = new Map([['approval', 'approval-2']]);
    expect(renameRefs({ workflowId: '$ref:approval', other: '$ref:form', text: 'approval' }, names)).toEqual({
      workflowId: '$ref:approval-2',
      other: '$ref:form',
      text: 'approval',
    });
  });

  it('finds the first free name within 40 characters', () => {
    expect(uniqueRef('approval', new Set())).toBe('approval');
    expect(uniqueRef('approval', new Set(['approval', 'approval-2']))).toBe('approval-3');
    const long = 'a'.repeat(40);
    expect(uniqueRef(long, new Set([long]))).toBe(`${'a'.repeat(38)}-2`);
  });
});

describe('links of what a change set made', () => {
  const label = { en: 'Open the form', 'zh-TW': '開啟表單', 'ja-JP': 'フォームを開く' };
  const snap = (over: Record<string, unknown>) => ({
    id: 'x',
    label: 'Laptop request',
    archived: false,
    href: '/admin/forms/x',
    version: 'v',
    value: {},
    ...over,
  });

  it('lists the links of the objects as applied, once each, skipping archived ones', () => {
    const items = [
      { id: '1', label: 'Approval', after: snap({ label: 'Approval' }) },
      { id: '2', label: 'Laptop', after: snap({ links: [{ href: '/requests/forms/laptop', label }] }) },
      {
        id: '3',
        label: 'Old',
        after: snap({ archived: true, links: [{ href: '/requests/forms/old', label }] }),
      },
      { id: '4', label: 'Laptop again', after: snap({ links: [{ href: '/requests/forms/laptop', label }] }) },
      { id: '5', label: 'Not applied', after: null },
    ];
    expect(appliedLinks(items)).toEqual([
      { itemId: '2', object: 'Laptop request', href: '/requests/forms/laptop', label },
    ]);
    expect(linkText(label, 'ja-JP')).toBe('フォームを開く');
    expect(linkText({ en: 'Open' }, 'zh-TW')).toBe('Open');
  });

  it('writes them as Markdown lines in the person’s language, escaping what would break a link', () => {
    const links = [{ itemId: '2', object: 'Laptop [new] request', href: '/requests/forms/laptop', label }];
    expect(linkLines(links, 'en')).toBe(
      'Ready to use:\n\n- Laptop \\[new\\] request: [Open the form](/requests/forms/laptop)',
    );
    expect(linkLines(links, 'zh-TW')).toBe(
      '已可使用：\n\n- Laptop \\[new\\] request：[開啟表單](/requests/forms/laptop)',
    );
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
