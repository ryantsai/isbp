/**
 * Access requests outlive their role: who asked for which access, and how it was decided, stays on record. Deleting
 * a role that people have requested — or the application that owns such a role — is refused with
 * `ROLE_HAS_HISTORY` (and the database refuses too); roles nobody requested can still be deleted.
 */
import { accessRequests, roles } from '@isbp/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session } from './harness';

let h: Harness;
let admin: Session;

beforeAll(async () => {
  h = await createHarness();
  admin = await h.login('admin');
});
afterAll(() => h?.close());

async function requested(roleId: string) {
  const [row] = await h.kernel.db
    .insert(accessRequests)
    .values({
      beneficiaryId: h.ids.outsider,
      requesterId: h.ids.outsider,
      roleId,
      justification: 'Needed for the quarterly close',
      status: 'rejected',
      decidedAt: new Date(),
    })
    .returning();
  return row!.id;
}

describe('access request history', () => {
  it('refuses to delete a requested role and keeps the request', async () => {
    const role = await h.call(admin, 'POST', '/api/v1/roles', {
      key: 'history-keeper',
      name: 'History keeper',
      permissions: ['core.users.read'],
    });
    expect(role.status).toBe(201);
    const requestId = await requested(role.body.id);

    const del = await h.call(admin, 'DELETE', `/api/v1/roles/${role.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('ROLE_HAS_HISTORY');
    expect(del.body.error.details).toMatchObject({ requests: 1 });

    const kept = await h.kernel.db.select().from(accessRequests).where(eq(accessRequests.id, requestId));
    expect(kept).toHaveLength(1);
    expect((await h.call(admin, 'GET', `/api/v1/roles/${role.body.id}`)).status).toBe(200);
  });

  it('still deletes a role nobody requested', async () => {
    const role = await h.call(admin, 'POST', '/api/v1/roles', {
      key: 'never-requested',
      name: 'Never requested',
      permissions: [],
    });
    expect(role.status).toBe(201);
    expect((await h.call(admin, 'DELETE', `/api/v1/roles/${role.body.id}`)).status).toBe(200);
    expect((await h.call(admin, 'GET', `/api/v1/roles/${role.body.id}`)).status).toBe(404);
  });

  it('refuses to delete an application whose role was requested', async () => {
    const app = await h.call(admin, 'POST', '/api/v1/applications', { key: 'ledger', name: 'Ledger' });
    expect(app.status).toBe(201);
    const role = await h.call(admin, 'POST', `/api/v1/applications/${app.body.id}/roles`, {
      key: 'ledger-clerk',
      name: 'Ledger clerk',
    });
    expect(role.status).toBe(201);
    await requested(role.body.id);

    const del = await h.call(admin, 'DELETE', `/api/v1/applications/${app.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('ROLE_HAS_HISTORY');
    expect((await h.call(admin, 'GET', `/api/v1/applications/${app.body.id}`)).status).toBe(200);
  });

  it('the database keeps the history even without the service check', async () => {
    const role = await h.call(admin, 'POST', '/api/v1/roles', {
      key: 'direct-delete',
      name: 'Direct delete',
      permissions: [],
    });
    await requested(role.body.id);
    await expect(h.kernel.db.delete(roles).where(eq(roles.id, role.body.id))).rejects.toThrow();
  });
});
