import { describe, expect, it } from 'vitest';
import { auditHash, createAuditService } from '../../src/kernel/audit';

const row = {
  eventId: '01a10fa3-0000-7000-8000-000000000001',
  occurredAt: new Date('2026-10-06T00:00:00Z'),
  actorType: 'user',
  actorId: null,
  actorName: 'Alice',
  onBehalfOfId: null,
  action: 'core.user.updated',
  category: 'data',
  moduleId: 'core',
  entityType: 'user',
  entityId: '42',
  entityLabel: 'Bob',
  changes: { jobTitle: ['A', 'B'] as [unknown, unknown] },
  metadata: null,
  outcome: 'success',
  ip: '10.0.0.1',
  userAgent: null,
  requestId: null,
};

describe('audit hash', () => {
  it('changes when any recorded field changes', () => {
    const h = auditHash(row);
    expect(auditHash({ ...row })).toBe(h);
    expect(auditHash({ ...row, actorName: 'Mallory' })).not.toBe(h);
    expect(auditHash({ ...row, changes: { jobTitle: ['A', 'C'] } })).not.toBe(h);
  });
});

describe('audit diff', () => {
  const audit = createAuditService({} as never);
  it('reports only changed fields', () => {
    expect(audit.diff({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', c: undefined })).toEqual({ b: ['x', 'y'] });
  });
  it('compares dates by value', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(audit.diff({ at: d }, { at: new Date(d) })).toEqual({});
  });
});
