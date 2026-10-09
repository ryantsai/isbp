/**
 * Announcements under simultaneous requests: a double click on Publish (or two tabs) publishes, audits and
 * notifies once; edits, withdrawals and deletes re-read the post they act on.
 */
import { auditLogs, outboxEvents } from '@isbp/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session } from './harness';

let h: Harness;
let admin: Session;
const API = '/api/v1/announcements/posts';

const draft = async (title: string) => {
  const res = await h.call(admin, 'POST', API, { title, severity: 'info' });
  expect(res.status).toBe(201);
  return res.body.id as string;
};

const audits = (postId: string, action: string) =>
  h.kernel.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, postId), eq(auditLogs.action, action)));

const events = (postId: string, name: string) =>
  h.kernel.db
    .select()
    .from(outboxEvents)
    .where(and(eq(outboxEvents.name, name), sql`${outboxEvents.payload}->>'postId' = ${postId}`));

beforeAll(async () => {
  h = await createHarness();
  admin = await h.login('admin');
});

afterAll(async () => {
  await h?.close();
});

describe('simultaneous requests on one announcement', () => {
  it('publishes once when Publish is sent several times at the same moment', async () => {
    // A few posts, each published from four "tabs" at once, so the requests really overlap.
    for (const title of ['Wi-Fi maintenance on Saturday', 'New VPN client', 'Phone system upgrade']) {
      const id = await draft(title);
      const results = await Promise.all(
        Array.from({ length: 4 }, () => h.call(admin, 'POST', `${API}/${id}/publish`)),
      );
      // Publishing is idempotent: every answer shows the live post, but it went live (and notified) once.
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(results.every((r) => r.body.status === 'published')).toBe(true);
      expect(await audits(id, 'announcements.post.published')).toHaveLength(1);
      expect(await events(id, 'announcements.post.published')).toHaveLength(1);
    }
  });

  it('deletes once when Delete is sent twice at the same moment', async () => {
    const id = await draft('Old notice');
    const results = await Promise.all([
      h.call(admin, 'DELETE', `${API}/${id}`),
      h.call(admin, 'DELETE', `${API}/${id}`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
    expect(await audits(id, 'announcements.post.deleted')).toHaveLength(1);
    expect(await events(id, 'announcements.post.deleted')).toHaveLength(1);
  });

  it('archives once when Archive is sent twice at the same moment', async () => {
    const id = await draft('Printer swap on floor 3');
    expect((await h.call(admin, 'POST', `${API}/${id}/publish`)).status).toBe(200);
    const results = await Promise.all([
      h.call(admin, 'POST', `${API}/${id}/archive`),
      h.call(admin, 'POST', `${API}/${id}/archive`),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await audits(id, 'announcements.post.archived')).toHaveLength(1);
    expect(await events(id, 'announcements.post.archived')).toHaveLength(1);
  });
});
