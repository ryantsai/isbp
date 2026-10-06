import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness } from './harness';

let h: Harness;
let stopWorker: () => Promise<void>;

beforeAll(async () => {
  h = await createHarness();
  stopWorker = await startWorker(h.kernel);
});
afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

async function eventually<T>(
  fn: () => Promise<T>,
  accept: (v: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (accept(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('event bus (outbox → relay → BullMQ → module handler)', () => {
  it('core.user.offboarded makes the announcements module archive that author’s drafts', async () => {
    const admin = await h.login('admin');
    // Give the outsider editor rights and let them write a draft.
    const roles = await h.call(admin, 'GET', '/api/v1/roles');
    const editor = roles.body.items.find((r: { key: string }) => r.key === 'announcements-editor');
    await h.call(admin, 'POST', '/api/v1/role-assignments', {
      roleId: editor.id,
      principalType: 'user',
      principalId: h.ids.outsider,
    });
    const outsider = await h.login('outsider');
    const draft = await h.call(outsider, 'POST', '/api/v1/announcements/posts', {
      title: 'Unfinished draft',
    });
    expect(draft.body.status).toBe('draft');

    await h.call(admin, 'POST', `/api/v1/users/${h.ids.outsider}/offboard`, { reason: 'Left the company' });

    const post = await eventually(
      () => h.call(admin, 'GET', `/api/v1/announcements/posts/${draft.body.id}`),
      (r) => r.body.status === 'archived',
    );
    expect(post.body.status).toBe('archived');
  });
});
