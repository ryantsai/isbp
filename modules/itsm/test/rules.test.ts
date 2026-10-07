import { type AuthContext, PermissionSet } from '@isbp/sdk/server';
import { describe, expect, it } from 'vitest';
import {
  formatTicketRef,
  parseTicketRef,
  priorityFor,
  type TicketStatus,
  ticketStatusSchema,
  type TicketType,
  TRANSITIONS,
} from '../src/contracts';
import { viewerOf } from '../src/server/access';
import { matchPolicy, slaFacts } from '../src/server/sla';
import {
  allowedTransitions,
  canTransition,
  fulfilmentState,
  linkProblem,
  portalState,
  statusTone,
} from '../src/server/rules';

describe('priority matrix (impact × urgency)', () => {
  it('maps every combination', () => {
    const table = [1, 2, 3].map((impact) => [1, 2, 3].map((urgency) => priorityFor(impact, urgency)));
    expect(table).toEqual([
      [1, 2, 3],
      [2, 3, 4],
      [3, 4, 4],
    ]);
  });

  it('clamps out-of-range levels', () => {
    expect(priorityFor(0, 0)).toBe(1);
    expect(priorityFor(9, 9)).toBe(4);
  });
});

describe('ticket references', () => {
  it('formats with the type prefix and five digits', () => {
    expect(formatTicketRef('incident', 42)).toBe('INC-00042');
    expect(formatTicketRef('service_request', 7)).toBe('SR-00007');
    expect(formatTicketRef('problem', 123456)).toBe('PRB-123456');
    expect(formatTicketRef('change', 12)).toBe('CHG-00012');
  });

  it('parses references case-insensitively, with or without padding', () => {
    expect(parseTicketRef('INC-00042')).toEqual({ type: 'incident', number: 42 });
    expect(parseTicketRef(' sr-7 ')).toEqual({ type: 'service_request', number: 7 });
    expect(parseTicketRef('prb-000001')).toEqual({ type: 'problem', number: 1 });
    expect(parseTicketRef('CHG-12')).toEqual({ type: 'change', number: 12 });
  });

  it('round-trips', () => {
    for (const type of ['incident', 'service_request', 'problem', 'change'] as TicketType[])
      expect(parseTicketRef(formatTicketRef(type, 314))).toEqual({ type, number: 314 });
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'INC', 'INC-', 'REQ-00042', 'INC-12a', '42', 'INC 42', 'CI-00042'])
      expect(parseTicketRef(bad)).toBeNull();
  });
});

describe('state machines', () => {
  it('only names known statuses', () => {
    for (const machine of Object.values(TRANSITIONS))
      for (const [from, targets] of Object.entries(machine)) {
        expect(ticketStatusSchema.safeParse(from).success).toBe(true);
        for (const to of targets!) expect(ticketStatusSchema.safeParse(to).success).toBe(true);
      }
  });

  it('follows the incident lifecycle', () => {
    expect(canTransition('incident', 'new', 'in_progress')).toBe(true);
    expect(canTransition('incident', 'in_progress', 'resolved')).toBe(true);
    expect(canTransition('incident', 'resolved', 'closed')).toBe(true);
    expect(canTransition('incident', 'resolved', 'in_progress')).toBe(true);
    expect(canTransition('incident', 'new', 'closed')).toBe(false);
    expect(canTransition('incident', 'closed', 'in_progress')).toBe(false);
    expect(canTransition('incident', 'new', 'fulfilled')).toBe(false);
    expect(allowedTransitions('incident', 'closed')).toEqual([]);
  });

  it('service requests are fulfilled, not resolved', () => {
    expect(canTransition('service_request', 'in_progress', 'fulfilled')).toBe(true);
    expect(canTransition('service_request', 'in_progress', 'resolved')).toBe(false);
  });

  it('changes are scheduled or rejected only by the CAB workflow', () => {
    expect(canTransition('change', 'assessment', 'authorization')).toBe(true);
    expect(canTransition('change', 'authorization', 'scheduled')).toBe(false);
    expect(canTransition('change', 'authorization', 'rejected')).toBe(false);
    expect(canTransition('change', 'authorization', 'cancelled')).toBe(true);
    expect(canTransition('change', 'scheduled', 'implementing')).toBe(true);
    expect(canTransition('change', 'implementing', 'review')).toBe(true);
  });

  it('problems record known errors', () => {
    expect(canTransition('problem', 'investigating', 'known_error')).toBe(true);
    expect(canTransition('problem', 'known_error', 'resolved')).toBe(true);
  });
});

describe('status presentation', () => {
  it('maps statuses to tones and portal states', () => {
    const tones: [TicketStatus, string][] = [
      ['new', 'info'],
      ['on_hold', 'warning'],
      ['resolved', 'success'],
      ['closed', 'neutral'],
      ['rejected', 'danger'],
    ];
    for (const [s, tone] of tones) expect(statusTone(s)).toBe(tone);
    expect(portalState('in_progress')).toBe('open');
    expect(portalState('resolved')).toBe('closed');
    expect(fulfilmentState('in_progress')).toBe('open');
    expect(fulfilmentState('fulfilled')).toBe('done');
    expect(fulfilmentState('closed')).toBe('done');
    expect(fulfilmentState('cancelled')).toBe('cancelled');
  });
});

describe('ticket links', () => {
  it('validates link types against ticket types', () => {
    expect(linkProblem('caused_by', 'incident', 'problem')).toBeNull();
    expect(linkProblem('caused_by', 'service_request', 'problem')).toBeNull();
    expect(linkProblem('caused_by', 'incident', 'incident')).not.toBeNull();
    expect(linkProblem('caused_by', 'problem', 'problem')).not.toBeNull();
    expect(linkProblem('implements', 'change', 'incident')).toBeNull();
    expect(linkProblem('implements', 'change', 'problem')).toBeNull();
    expect(linkProblem('implements', 'incident', 'problem')).not.toBeNull();
    expect(linkProblem('implements', 'change', 'service_request')).not.toBeNull();
    expect(linkProblem('parent_of', 'incident', 'incident')).toBeNull();
    expect(linkProblem('parent_of', 'incident', 'problem')).not.toBeNull();
    expect(linkProblem('related', 'change', 'service_request')).toBeNull();
    expect(linkProblem('duplicate_of', 'incident', 'service_request')).toBeNull();
  });
});

describe('viewer rules', () => {
  const auth = (userId: string, grants: ConstructorParameters<typeof PermissionSet>[0]): AuthContext => {
    const permissions = new PermissionSet(grants);
    return {
      principal: { type: 'user', id: userId, name: userId },
      user: { id: userId } as AuthContext['user'],
      sessionId: null,
      permissions,
      can: (p, r) => permissions.can(p, r),
      require: () => undefined,
      reach: (p) => permissions.reach(p),
    };
  };
  const ticket = {
    type: 'incident' as const,
    status: 'resolved' as const,
    departmentId: 'dept-sales',
    requesterId: 'alice',
    requestedForId: null,
  };

  it('requesters can comment, reopen and confirm but not edit', () => {
    const v = viewerOf(ticket, auth('alice', [{ p: 'itsm.tickets.create', s: 'g' }]));
    expect(v).toMatchObject({ role: 'requester', canEdit: false, canComment: true, canWorkNote: false });
    expect(v).toMatchObject({ canReopen: true, canConfirm: true, transitions: [] });
  });

  it('department-scoped agents work tickets of their departments only', () => {
    const scoped = auth('bob', [
      { p: 'itsm.tickets.read', s: 'd', d: ['dept-sales'] },
      { p: 'itsm.tickets.work', s: 'd', d: ['dept-sales'] },
    ]);
    expect(viewerOf(ticket, scoped)).toMatchObject({
      role: 'agent',
      canEdit: true,
      transitions: ['in_progress', 'closed'],
    });
    const other = viewerOf({ ...ticket, departmentId: 'dept-hr' }, scoped);
    expect(other).toMatchObject({ role: 'requester', canEdit: false, canComment: false });
  });

  it('change managers work changes without the ticket work permission', () => {
    const cm = auth('carol', [
      { p: 'itsm.tickets.read', s: 'g' },
      { p: 'itsm.changes.*', s: 'g' },
    ]);
    expect(viewerOf({ ...ticket, type: 'change', status: 'draft' }, cm).canEdit).toBe(true);
    expect(viewerOf(ticket, cm).canEdit).toBe(false);
  });
});

describe('SLA policy matching', () => {
  const policy = (id: string, types: TicketType[], condition: unknown, sortOrder: number) =>
    ({ id, ticketTypes: types, condition, sortOrder }) as never;
  const facts = (priority: number, type: TicketType = 'incident') =>
    slaFacts(
      {
        type,
        priority,
        impact: 2,
        urgency: 2,
        major: false,
        channel: 'portal',
      } as never,
      'network-vpn',
    );

  it('picks the first active policy whose types and condition match', () => {
    const policies = [
      policy('p1', ['incident'], { fact: 'ticket.priority', op: 'eq', value: 1 }, 10),
      policy('inc', ['incident'], null, 20),
      policy('sr', ['service_request'], null, 30),
    ];
    expect(matchPolicy(policies, facts(1))?.id).toBe('p1');
    expect(matchPolicy(policies, facts(3))?.id).toBe('inc');
    expect(matchPolicy(policies, facts(3, 'service_request'))?.id).toBe('sr');
    expect(matchPolicy(policies, facts(3, 'change'))).toBeNull();
  });
});
