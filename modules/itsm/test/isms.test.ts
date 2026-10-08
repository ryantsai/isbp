import { type AuthContext, PermissionSet } from '@isbp/sdk/server';
import { describe, expect, it } from 'vitest';
import { acceptanceSchema, SIGN_OFF_TRANSITIONS, TRANSITIONS } from '../src/contracts';
import { viewerOf } from '../src/server/access';
import { allowedTransitions, canTransition, statusLabelKey } from '../src/server/rules';

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

describe('resolution sign-off', () => {
  it('only goes back to work or is cancelled while it waits', () => {
    expect(allowedTransitions('incident', 'pending_approval', true)).toEqual([...SIGN_OFF_TRANSITIONS]);
    expect(allowedTransitions('service_request', 'pending_approval', true)).toEqual([
      'in_progress',
      'cancelled',
    ]);
    expect(canTransition('problem', 'pending_approval', 'resolved', true)).toBe(false);
    // A service request waiting for its catalog approval keeps its own rules.
    expect(allowedTransitions('service_request', 'pending_approval')).toEqual(
      TRANSITIONS.service_request.pending_approval,
    );
    expect(allowedTransitions('incident', 'pending_approval')).toEqual([]);
  });

  it('shows "Waiting for sign-off" instead of "Pending approval"', () => {
    expect(statusLabelKey({ status: 'pending_approval', signOffInstanceId: 'x' })).toBe(
      'itsm.signOff.status',
    );
    expect(statusLabelKey({ status: 'pending_approval', signOffInstanceId: null })).toBe(
      'itsm.status.pending_approval',
    );
    expect(statusLabelKey({ status: 'resolved' })).toBe('itsm.status.resolved');
  });

  it('gives agents the sign-off transitions', () => {
    const agent = auth('agent', [
      { p: 'itsm.tickets.read', s: 'g' },
      { p: 'itsm.tickets.work', s: 'g' },
    ]);
    const t = {
      type: 'incident' as const,
      status: 'pending_approval' as const,
      departmentId: null,
      requesterId: 'alice',
      requestedForId: null,
      signOffInstanceId: 'instance',
    };
    expect(viewerOf(t, agent).transitions).toEqual(['in_progress', 'cancelled']);
  });
});

describe('change acceptance', () => {
  const change = (status: 'implementing' | 'review' | 'closed') => ({
    type: 'change' as const,
    status,
    departmentId: null,
    requesterId: 'alice',
    requestedForId: 'carol',
  });
  const requester = (id: string) => auth(id, [{ p: 'itsm.tickets.create', s: 'g' }]);

  it('is for the requester (or the person it was for) while the change is in review', () => {
    expect(viewerOf(change('review'), requester('alice')).canAccept).toBe(true);
    expect(viewerOf(change('review'), requester('carol')).canAccept).toBe(true);
    expect(viewerOf(change('implementing'), requester('alice')).canAccept).toBe(false);
    expect(viewerOf(change('closed'), requester('alice')).canAccept).toBe(false);
    const manager = auth('cm', [
      { p: 'itsm.changes.read', s: 'g' },
      { p: 'itsm.changes.manage', s: 'g' },
    ]);
    expect(viewerOf(change('review'), manager).canAccept).toBe(false);
  });

  it('needs a reason to report a problem', () => {
    expect(acceptanceSchema.safeParse({ accepted: true }).success).toBe(true);
    expect(acceptanceSchema.safeParse({ accepted: false }).success).toBe(false);
    expect(acceptanceSchema.safeParse({ accepted: false, note: ' ok ' }).success).toBe(false);
    expect(acceptanceSchema.safeParse({ accepted: false, note: 'Still read-only' }).success).toBe(true);
  });
});
