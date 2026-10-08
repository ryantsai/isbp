import { formSubmissions, notifications } from '@isbp/db/schema';
import {
  type AuthContext,
  defineManifest,
  defineServerModule,
  ErrorCodes,
  HttpError,
} from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker } from '../../src/kernel/worker';
import { createHarness, type Harness, type Session } from './harness';
import { processActionHelpers } from './process-actions-helpers';

/** Test actions: `unstable` throws a plain error until `failUntil` calls, `locked` throws an HttpError. */
const state = { failUntil: 100, unstable: 0, locked: 0, counted: 0, auth: null as AuthContext | null };
const testModule = defineServerModule(
  defineManifest({
    id: 'itest-actions',
    version: '1.0.0',
    name: 'Test actions',
    permissions: [{ key: 'itest-actions.items.manage', description: 'Manage test items' }],
    processActions: [
      {
        action: 'unstable',
        name: 'Unstable',
        description: 'Unstable',
        permission: 'itest-actions.items.manage',
      },
      { action: 'locked', name: 'Locked', description: 'Locked', permission: 'itest-actions.items.manage' },
      {
        action: 'counted',
        name: 'Counted',
        description: 'Counted',
        permission: 'itest-actions.items.manage',
      },
    ],
  }),
  {
    processActions: {
      unstable: {
        fields: () => [{ key: 'note', type: 'text', label: { en: 'Note' } }],
        run: async ({ auth }) => {
          state.unstable++;
          state.auth = auth;
          if (state.unstable <= state.failUntil) throw new Error('Temporary failure');
          return { reference: 'ITEM-1', href: '/itest-actions/items/1' };
        },
      },
      locked: {
        fields: () => [],
        run: async () => {
          state.locked++;
          throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The item is locked');
        },
      },
      counted: {
        fields: () => [],
        run: async () => {
          state.counted++;
          await new Promise((r) => setTimeout(r, 50));
          return { reference: `N-${state.counted}` };
        },
      },
    },
  },
);

let h: Harness;
let stopWorker: () => Promise<void>;
let admin: Session;
let requester: Session;
let requesterId: string;
const t = processActionHelpers(() => ({ h, admin }));

beforeAll(async () => {
  h = await createHarness({ extraModules: [testModule] });
  h.kernel.processActions.retryDelayMs = 100;
  stopWorker = await startWorker(h.kernel);
  admin = await h.login('admin');
  requesterId = await t.mkUser('ravi');
  requester = await h.login('ravi');
});

afterAll(async () => {
  await stopWorker?.();
  await h?.close();
});

describe('retries and failures', () => {
  it('retries a failing action with backoff, then fails, tells the editors and lets an admin retry', async () => {
    await t.mkForm('unstable-form', {
      elements: [t.field('what', 'text')],
      actions: [{ id: 'try', on: 'submitted', type: 'itest-actions.unstable', config: { note: 'n' } }],
    });
    const sub = await t.submit(requester, 'unstable-form', { what: 'x' });
    const [run] = await t.settledRuns(sub.id);
    expect(run!.status).toBe('failed');
    expect(run!.attempts).toBe(3);
    expect(state.unstable).toBe(3);
    expect(run!.error).toBe('Temporary failure');

    // The action ran as a system principal named after the form, with only its module's permissions.
    expect(state.auth!.principal).toMatchObject({ type: 'system', name: 'form:unstable-form' });
    expect(state.auth!.can('itest-actions.items.manage')).toBe(true);
    expect(state.auth!.can('core.users.read')).toBe(false);

    const told = await t.eventually(
      () =>
        h.kernel.db
          .select()
          .from(notifications)
          .where(
            and(eq(notifications.userId, h.ids.admin), eq(notifications.type, 'core.process-action.failed')),
          ),
      (rows) => rows.length > 0,
    );
    expect(told[0]!.href).toBe(`/requests/${sub.reference}`);

    // Errors are for administrators only.
    const mine = await h.call(requester, 'GET', `/api/v1/requests/${sub.reference}`);
    expect(mine.body.submission.actions[0]).toMatchObject({ status: 'failed', error: null, canRetry: false });
    const theirs = await h.call(admin, 'GET', `/api/v1/requests/${sub.reference}`);
    expect(theirs.body.submission.actions[0]).toMatchObject({
      status: 'failed',
      error: { code: 'INTERNAL', message: 'Temporary failure' },
      canRetry: true,
    });

    const path = `/api/v1/form-submissions/${sub.id}/actions/${run!.id}/retry`;
    expect((await h.call(requester, 'POST', path)).status).toBe(403);
    state.failUntil = 0;
    const retried = await h.call(admin, 'POST', path);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    const [again] = await t.eventually(
      () => t.runs(sub.id),
      (list) => list[0]?.status === 'succeeded',
    );
    expect(again!.result).toMatchObject({ reference: 'ITEM-1', href: '/itest-actions/items/1' });
    // The first result with a link becomes the request's fulfilment.
    const [row] = await h.kernel.db.select().from(formSubmissions).where(eq(formSubmissions.id, sub.id));
    expect(row!.fulfilment).toMatchObject({
      moduleId: 'core',
      reference: 'ITEM-1',
      href: '/itest-actions/items/1',
    });
    // A succeeded run can't be retried.
    expect((await h.call(admin, 'POST', path)).body.error.code).toBe('INVALID_STATE');
  });

  it('fails at once on an HttpError', async () => {
    await t.mkForm('locked-form', {
      elements: [t.field('what', 'text')],
      actions: [{ id: 'lock', on: 'submitted', type: 'itest-actions.locked', config: {} }],
    });
    const sub = await t.submit(requester, 'locked-form', { what: 'x' });
    const [run] = await t.settledRuns(sub.id);
    expect(run).toMatchObject({ status: 'failed', attempts: 1, errorCode: 'INVALID_STATE' });
    expect(state.locked).toBe(1);
  });

  it('runs an action once however often its job is delivered', async () => {
    await t.mkForm('counted-form', {
      elements: [t.field('what', 'text')],
      actions: [{ id: 'count', on: 'submitted', type: 'itest-actions.counted', config: {} }],
    });
    const sub = await t.submit(requester, 'counted-form', { what: 'x' });
    const [queued] = await t.runs(sub.id);
    // Racing the worker, and again once it is done.
    await Promise.all([
      h.kernel.processActions.execute(queued!.id),
      h.kernel.processActions.execute(queued!.id),
    ]);
    const [run] = await t.settledRuns(sub.id);
    expect(run!.status).toBe('succeeded');
    expect(await h.kernel.processActions.execute(run!.id)).toEqual({ status: 'ignored' });
    await h.kernel.processActions.enqueue([run!.id]);
    expect(state.counted).toBe(1);
    expect(run!.attempts).toBe(1);
    void requesterId;
  });
});
