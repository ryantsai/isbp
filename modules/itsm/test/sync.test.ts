import { describe, expect, it } from 'vitest';
import { TRANSITIONS, type TicketStatus, type TicketType } from '../src/contracts';
import { statusPath } from '../src/server/sync-support';

const next = (type: TicketType) => (s: TicketStatus) => TRANSITIONS[type][s] ?? [];

describe('sync status paths', () => {
  it('walks the state machine one allowed step at a time', () => {
    expect(statusPath(next('incident'), 'new', 'in_progress')).toEqual(['in_progress']);
    expect(statusPath(next('incident'), 'new', 'closed')).toEqual(['resolved', 'closed']);
    expect(statusPath(next('service_request'), 'in_progress', 'closed')).toEqual(['fulfilled', 'closed']);
    expect(statusPath(next('problem'), 'new', 'resolved')).toEqual(['investigating', 'resolved']);
    // A problem can be flagged as a known error straight away (one step).
    expect(statusPath(next('problem'), 'new', 'known_error')).toEqual(['known_error']);
    expect(statusPath(next('incident'), 'resolved', 'resolved')).toEqual([]);
  });

  it('finds no way past the CAB authorization of a change, or out of a final status', () => {
    // "Submit for approval" from a draft passes the assessment in the same step.
    expect(statusPath(next('change'), 'draft', 'authorization')).toEqual(['authorization']);
    for (const to of ['scheduled', 'implementing', 'review', 'closed', 'rejected'] as const)
      expect(statusPath(next('change'), 'draft', to), to).toBeNull();
    expect(statusPath(next('incident'), 'closed', 'in_progress')).toBeNull();
    expect(statusPath(next('incident'), 'new', 'fulfilled')).toBeNull();
  });
});
