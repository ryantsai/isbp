import { describe, expect, it } from 'vitest';
import { forType } from '../src/server/sync';

describe('sync status by ticket type', () => {
  it('treats resolved and fulfilled as the same outcome, named the way each ticket type uses', () => {
    expect(forType('service_request', 'resolved')).toBe('fulfilled');
    expect(forType('service_request', 'fulfilled')).toBe('fulfilled');
    expect(forType('incident', 'fulfilled')).toBe('resolved');
    expect(forType('problem', 'fulfilled')).toBe('resolved');
    expect(forType('incident', 'closed')).toBe('closed');
    // Changes keep their own statuses (their CAB rules apply unchanged).
    expect(forType('change', 'fulfilled')).toBe('fulfilled');
  });
});
