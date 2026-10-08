import { approvalTasks, processActionRuns, users } from '@isbp/db/schema';
import type { FieldType, FormElement, FormSchema } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { type Harness, type LooseJson, PASSWORD, type Session } from './harness';

/** Shared steps of the process action suites. */
export function processActionHelpers(get: () => { h: Harness; admin: Session }) {
  const eventually = async <T>(fn: () => Promise<T>, accept: (v: T) => boolean, timeoutMs = 15_000) => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn();
      if (accept(v) || Date.now() > until) return v;
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  const mkUser = async (username: string) => {
    const { h } = get();
    const [u] = await h.kernel.db
      .insert(users)
      .values({
        email: `${username}@test.example`,
        username,
        displayName: username,
        passwordHash: await hashPassword(PASSWORD),
      })
      .returning();
    return u!.id;
  };

  const field = (key: string, type: FieldType, extra: Record<string, unknown> = {}): FormElement =>
    ({ id: key, key, type, label: { en: key }, ...extra }) as FormElement;

  const mkForm = async (
    key: string,
    draft: FormSchema,
    opts: { workflowDefinitionId?: string; publish?: boolean } = {},
  ): Promise<LooseJson> => {
    const { h, admin } = get();
    const created = await h.call(admin, 'POST', '/api/v1/forms', { key, name: { en: key } });
    expect(created.status).toBe(201);
    const saved = await h.call(admin, 'PATCH', `/api/v1/forms/${created.body.id}`, {
      draft,
      workflowDefinitionId: opts.workflowDefinitionId ?? null,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    if (opts.publish === false) return saved.body;
    const published = await h.call(admin, 'POST', `/api/v1/forms/${created.body.id}/publish`);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return published.body;
  };

  const submit = async (session: Session, key: string, data: Record<string, unknown>) => {
    const res = await get().h.call(session, 'POST', `/api/v1/forms/by-key/${key}/submissions`, { data });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as LooseJson;
  };

  const runs = (submissionId: string) =>
    get()
      .h.kernel.db.select()
      .from(processActionRuns)
      .where(eq(processActionRuns.submissionId, submissionId))
      .orderBy(processActionRuns.createdAt);

  const done = (list: { status: string }[]) =>
    list.length > 0 && list.every((r) => ['succeeded', 'failed', 'skipped'].includes(r.status));

  const settledRuns = (submissionId: string) => eventually(() => runs(submissionId), done);

  /** A published form-submission workflow with one approval by `approverId`. */
  const approvalWorkflow = async (name: string, approverId: string) => {
    const { h, admin } = get();
    const wf = await h.call(admin, 'POST', '/api/v1/workflows', { name, triggerKey: 'core.form-submission' });
    await h.call(admin, 'PATCH', `/api/v1/workflows/${wf.body.id}`, {
      draft: {
        steps: [
          {
            id: 'ok',
            type: 'approval',
            name: { en: 'Approve' },
            approvers: [{ type: 'user', userId: approverId }],
            mode: 'any',
          },
        ],
      },
    });
    expect((await h.call(admin, 'POST', `/api/v1/workflows/${wf.body.id}/publish`)).status).toBe(200);
    return wf.body.id as string;
  };

  const decide = async (instanceId: string, session: Session, verdict: 'approve' | 'reject') => {
    const { h } = get();
    const [task] = await h.kernel.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.instanceId, instanceId), eq(approvalTasks.status, 'pending')));
    const res = await h.call(session, 'POST', `/api/v1/approvals/${task!.id}/${verdict}`, {
      comment: verdict === 'reject' ? 'Not now' : undefined,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };

  return { eventually, mkUser, field, mkForm, submit, runs, settledRuns, approvalWorkflow, decide };
}
