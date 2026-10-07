import { roleAssignments, roles, users } from '@isbp/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, type Harness, PASSWORD, type Session } from './harness';

/**
 * The Phase 2 modules as records of the platform registry: ITSM tickets and changes, CMDB CIs and
 * knowledge articles resolve with each module's own visibility, can be linked at creation (`links`), and
 * clean up after themselves.
 */
let h: Harness;
const s: Record<'admin' | 'agent' | 'alice' | 'bob', Session> = {} as never;
let ciId: string;

async function mkUser(username: string, role?: string) {
  const [u] = await h.kernel.db
    .insert(users)
    .values({
      email: `${username}@test.example`,
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  if (role) {
    const [r] = await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, role));
    await h.kernel.db.insert(roleAssignments).values({ roleId: r!.id, userId: u!.id });
  }
  return u!.id;
}

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES ??= 'cmdb,knowledge,itsm';
  h = await createHarness();
  await mkUser('agent', 'itsm-agent');
  const [cm] = await h.kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'cmdb-viewer'));
  const agentId = (
    await h.kernel.db.select({ id: users.id }).from(users).where(eq(users.username, 'agent'))
  )[0]!.id;
  await h.kernel.db.insert(roleAssignments).values({ roleId: cm!.id, userId: agentId });
  await mkUser('alice');
  await mkUser('bob');
  await h.kernel.rbac.bump();
  s.admin = await h.login('admin');
  s.agent = await h.login('agent');
  s.alice = await h.login('alice');
  s.bob = await h.login('bob');
  const ci = await h.call(s.admin, 'POST', '/api/v1/cmdb/cis', {
    name: 'rec-app-01',
    classKey: 'server',
    criticality: 'medium',
  });
  expect(ci.status).toBe(201);
  ciId = ci.body.id;
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('ITSM, CMDB and Knowledge records', () => {
  it('lists the Phase 2 record types by permission', async () => {
    const agent = await h.call(s.agent, 'GET', '/api/v1/records/types');
    expect(agent.body.items.map((t: { type: string }) => t.type)).toEqual(
      expect.arrayContaining(['itsm.ticket', 'itsm.change', 'cmdb.ci']),
    );
    const alice = await h.call(s.alice, 'GET', '/api/v1/records/types');
    expect(alice.body.items.map((t: { type: string }) => t.type)).not.toContain('cmdb.ci');
  });

  it('creates a change already linked to a CI and resolves it from both sides', async () => {
    const change = await h.call(s.admin, 'POST', '/api/v1/itsm/tickets', {
      type: 'change',
      title: 'Patch rec-app-01',
      links: [{ type: 'cmdb.ci', id: ciId }],
    });
    expect(change.status).toBe(201);
    const fromChange = await h.call(s.agent, 'GET', `/api/v1/records/itsm.change/${change.body.id}/links`);
    expect(fromChange.status).toBe(200);
    expect(fromChange.body.record).toMatchObject({
      reference: change.body.reference,
      status: { key: 'itsm.status.draft' },
    });
    expect(fromChange.body.links[0].record).toMatchObject({ type: 'cmdb.ci', title: 'rec-app-01' });
    const fromCi = await h.call(s.agent, 'GET', `/api/v1/records/cmdb.ci/${ciId}/links`);
    expect(fromCi.body.links[0].record).toMatchObject({
      type: 'itsm.change',
      reference: change.body.reference,
    });
    // A change is not an `itsm.ticket` record.
    expect((await h.call(s.admin, 'GET', `/api/v1/records/itsm.ticket/${change.body.id}`)).status).toBe(404);
  });

  it('refuses links to records the creator cannot see', async () => {
    const res = await h.call(s.alice, 'POST', '/api/v1/itsm/tickets', {
      title: 'My screen flickers',
      links: [{ type: 'cmdb.ci', id: ciId }],
    });
    expect(res.status).toBe(404);
  });

  it('lets requesters attach files to their own open ticket only', async () => {
    const t = await h.call(s.alice, 'POST', '/api/v1/itsm/tickets', { title: 'Printer jam on 5F' });
    expect(t.status).toBe(201);
    const mine = await h.call(s.alice, 'GET', `/api/v1/records/itsm.ticket/${t.body.id}`);
    expect(mine.body).toMatchObject({ editable: true, reference: t.body.reference });
    expect((await h.call(s.bob, 'GET', `/api/v1/records/itsm.ticket/${t.body.id}`)).status).toBe(404);
    const agentView = await h.call(s.agent, 'GET', `/api/v1/records/itsm.ticket/${t.body.id}`);
    expect(agentView.body.editable).toBe(true);
    // Pickers only offer types the person may browse: agents find the ticket, the requester gets nothing.
    const asAgent = await h.call(s.agent, 'GET', `/api/v1/records/search?q=${t.body.reference}`);
    expect(asAgent.body.items[0]).toMatchObject({ id: t.body.id, type: 'itsm.ticket' });
    const asAlice = await h.call(s.alice, 'GET', `/api/v1/records/search?q=${t.body.reference}`);
    expect(asAlice.body.items).toEqual([]);
  });

  it('forgets the links of a deleted CI', async () => {
    const ci = await h.call(s.admin, 'POST', '/api/v1/cmdb/cis', { name: 'rec-tmp', classKey: 'server' });
    const change = await h.call(s.admin, 'POST', '/api/v1/itsm/tickets', {
      type: 'change',
      title: 'Retire rec-tmp',
      links: [{ type: 'cmdb.ci', id: ci.body.id }],
    });
    expect((await h.kernel.records.linked({ type: 'itsm.change', id: change.body.id })).length).toBe(1);
    expect((await h.call(s.admin, 'DELETE', `/api/v1/cmdb/cis/${ci.body.id}`)).status).toBe(204);
    expect(await h.kernel.records.linked({ type: 'itsm.change', id: change.body.id })).toEqual([]);
  });

  it('finds knowledge articles by title for linking', async () => {
    const draft = await h.call(s.admin, 'POST', '/api/v1/knowledge/articles', {
      title: 'Reset a locked rec account',
      body: 'Steps…',
      locale: 'en',
    });
    expect([200, 201]).toContain(draft.status);
    const found = await h.call(
      s.admin,
      'GET',
      '/api/v1/records/search?q=locked%20rec&types=knowledge.article',
    );
    expect(found.body.items[0]).toMatchObject({
      type: 'knowledge.article',
      title: 'Reset a locked rec account',
    });
    // A draft is invisible to people without write access.
    const alice = await h.call(s.alice, 'GET', `/api/v1/records/knowledge.article/${found.body.items[0].id}`);
    expect(alice.status).toBe(404);
  });
});
