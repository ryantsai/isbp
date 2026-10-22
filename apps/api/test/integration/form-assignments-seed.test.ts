import { formAssignments, forms, groupMembers, groups } from '@isbp/db/schema';
import { jobs } from '@isbp/module-scheduler/schema';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INSPECTION_FORM_KEY, INSPECTION_JOB_NAME, seedFormAssignments } from '../../src/seed-assignments';
import { createHarness, type Harness, type LooseJson } from './harness';

/*
 * The demo's recurring checklist: the "Monthly server room inspection" form for IS Administrators, its monthly
 * `core.assign-form` job and four months of assignments (two on time, one late, this month's open). Idempotent.
 */

const MODULES = process.env.ISBP_TEST_MODULES;
let h: Harness;

beforeAll(async () => {
  process.env.ISBP_TEST_MODULES = MODULES ?? 'scheduler';
  try {
    h = await createHarness();
  } finally {
    if (MODULES === undefined) delete process.env.ISBP_TEST_MODULES;
  }
  const [g] = await h.kernel.db
    .insert(groups)
    .values({ key: 'it-admins', name: 'IS Administrators' })
    .returning();
  await h.kernel.db.insert(groupMembers).values({ groupId: g!.id, userId: h.ids.admin });
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('seedFormAssignments', () => {
  it('creates the checklist, its monthly job and four months of assignments, once', async () => {
    await seedFormAssignments(h.kernel);
    await seedFormAssignments(h.kernel);

    const [form] = await h.kernel.db.select().from(forms).where(eq(forms.key, INSPECTION_FORM_KEY));
    expect(form).toMatchObject({
      publishedVersion: 1,
      audience: { type: 'groups', groupKeys: ['it-admins'] },
    });
    const [job] = await h.kernel.db.select().from(jobs).where(eq(jobs.name, INSPECTION_JOB_NAME));
    expect(job).toMatchObject({ type: 'core.assign-form', cron: '0 9 1 * *', timezone: 'Asia/Taipei' });

    const rows = await h.kernel.db
      .select()
      .from(formAssignments)
      .where(eq(formAssignments.formId, form!.id))
      .orderBy(asc(formAssignments.dueAt));
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.status)).toEqual(['done', 'done', 'done', 'open']);
    expect(rows.every((r) => r.source.type === 'job' && r.source.id === job!.id)).toBe(true);
    const late = rows.filter((r) => r.completedAt && r.completedAt > r.dueAt);
    expect(late).toHaveLength(1);

    const session = await h.login('admin');
    const todo = (await h.call(session, 'GET', '/api/v1/me/form-assignments')).body as LooseJson;
    expect(todo.items.map((i: LooseJson) => i.id)).toContain(rows[3]!.id);
    const compliance = (await h.call(session, 'GET', `/api/v1/forms/${form!.id}/assignments/compliance`))
      .body as LooseJson;
    expect(compliance.periods).toHaveLength(4);
    expect(compliance.periods.reduce((n: number, p: LooseJson) => n + p.late, 0)).toBe(1);
    expect(compliance.periods.reduce((n: number, p: LooseJson) => n + p.onTime, 0)).toBe(2);

    // The job's next "Run now" in this month changes nothing (same period).
    const ran = await h.kernel.registry.context('core').taskTypes.run('core.assign-form', job!.config, {
      runId: '01a10fa3-5141-77f6-9b0a-10258b3a22fb',
      jobId: job!.id,
      attempt: 1,
      scheduledFor: new Date(),
      timeZone: 'Asia/Taipei',
      lastSuccessAt: null,
      signal: new AbortController().signal,
      log: () => undefined,
    });
    expect(ran.metrics).toEqual({ created: 0 });
  });
});
