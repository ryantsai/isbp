/**
 * Demo of assigned and recurring forms (Phase 8, §15.8a): the "Monthly server room inspection" checklist for IS
 * Administrators, opened every month by a `core.assign-form` scheduled job — three past months (two on time, one
 * late) and this month's, open, under "To do" for the group's members (the admin among them).
 */
import { assignmentDueAt, localDateOf, periodKey, zonedInstant } from '@isbp/contracts';
import { formAssignments, formSubmissions, forms, groups, users } from '@isbp/db/schema';
import type { AuthContext, FormSchema } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { FormAssignmentService } from './core/services/form-assignments';
import { FormService } from './core/services/forms';
import { runWithContext } from './kernel/context';
import type { Kernel } from './kernel/kernel';

export const INSPECTION_FORM_KEY = 'server-room-inspection';
export const INSPECTION_JOB_NAME = 'Monthly server room inspection';
const GROUP_KEY = 'it-admins';
const TZ = 'Asia/Taipei';
const DAY = 86_400_000;

const L = (en: string, zh: string, ja: string) => ({ en, 'zh-TW': zh, 'ja-JP': ja });

export const inspectionSchema: FormSchema = {
  elements: [
    {
      id: 'inspected-on',
      key: 'inspectedOn',
      type: 'date',
      label: L('Inspected on', '巡檢日期', '点検日'),
      required: true,
      width: 'half',
    },
    {
      id: 'temperature',
      key: 'temperature',
      type: 'number',
      label: L('Room temperature (°C)', '機房溫度（°C）', '室温 (°C)'),
      required: true,
      width: 'half',
      validation: { min: 5, max: 45 },
    },
    {
      id: 'humidity',
      key: 'humidity',
      type: 'number',
      label: L('Relative humidity (%)', '相對濕度（%）', '相対湿度 (%)'),
      required: true,
      width: 'half',
      validation: { min: 0, max: 100 },
    },
    {
      id: 'ups',
      key: 'ups',
      type: 'select',
      label: L('UPS status', 'UPS 狀態', 'UPS の状態'),
      required: true,
      width: 'half',
      options: [
        { value: 'normal', label: L('Normal', '正常', '正常') },
        { value: 'battery', label: L('On battery', '電池供電中', 'バッテリー駆動中') },
        { value: 'alarm', label: L('Alarm', '警報', 'アラーム') },
      ],
    },
    {
      id: 'fire-panel',
      key: 'firePanelOk',
      type: 'boolean',
      label: L(
        'The fire suppression panel shows no fault',
        '消防滅火控制盤無異常',
        '消火設備の制御盤に異常はない',
      ),
    },
    {
      id: 'findings',
      key: 'findings',
      type: 'textarea',
      label: L('Findings and follow-up', '發現事項與後續處理', '所見とフォローアップ'),
    },
  ],
};

const as = <T>(auth: AuthContext, fn: () => Promise<T>) =>
  runWithContext({ principal: auth.principal, requestId: 'seed' }, fn);

/** After every other seed (it adds requests, so the numbered records before it keep their numbers). */
export async function seedFormAssignments(kernel: Kernel): Promise<void> {
  const db = kernel.db;
  const [existing] = await db.select({ id: forms.id }).from(forms).where(eq(forms.key, INSPECTION_FORM_KEY));
  if (existing) return;
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'admin'));
  const [group] = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(eq(groups.key, GROUP_KEY));
  if (!admin || !group) return;
  const core = kernel.registry.context('core');
  const auth = await core.rbac.authFor(admin.id);
  if (!auth) return;
  const formSvc = new FormService(core);
  const assignments = new FormAssignmentService(core);

  // The checklist, offered to IS Administrators.
  const form = await as(auth, async () => {
    const created = await formSvc.create(
      {
        key: INSPECTION_FORM_KEY,
        name: L('Monthly server room inspection', '機房每月巡檢', 'サーバー室の月次点検'),
        description: L(
          'The monthly checklist for the Taipei server room: temperature, humidity, UPS and fire suppression.',
          '台北機房的每月巡檢表：溫度、濕度、UPS 與消防滅火設備。',
          '台北のサーバー室の月次チェックリスト: 温度、湿度、UPS、消火設備。',
        ),
        icon: 'clipboard-check',
        category: 'security',
      },
      auth,
    );
    await formSvc.update(
      created.id,
      { draft: inspectionSchema, audience: { type: 'groups', groupKeys: [GROUP_KEY] } },
      auth,
    );
    return formSvc.publish(created.id, auth);
  });
  const [formRow] = await db.select().from(forms).where(eq(forms.id, form.id));

  // The job that opens it on the 1st of every month (when Scheduled jobs is installed).
  let jobId: string | null = null;
  if (kernel.registry.get('scheduler')) {
    const { seedJob } = await import('@isbp/module-scheduler/server');
    jobId = await seedJob(kernel.registry.context('scheduler'), {
      name: INSPECTION_JOB_NAME,
      description: 'Asks IS Administrators to fill in the server room inspection checklist every month.',
      type: 'core.assign-form',
      config: {
        formKey: INSPECTION_FORM_KEY,
        assignee: { type: 'group', groupKey: GROUP_KEY },
        period: 'month',
        due: { type: 'end-of-period' },
        title: 'Server room inspection {{period}}',
        note: 'Check the UPS event log and the fire panel as well.',
      },
      trigger: { kind: 'cron', cron: '0 9 1 * *', timezone: TZ },
      ownerUsername: 'admin',
      ownerGroupKey: GROUP_KEY,
      timeoutSeconds: 60,
      retries: { maxAttempts: 3, backoff: 'exponential', delaySeconds: 60 },
    });
  }

  // What the job opened: the last three months (done; one late) and this month's (open).
  const today = localDateOf(new Date(), TZ);
  /** 09:00 on the 1st, `monthsAgo` months back, in Taipei (the job's slot). */
  const firstOfMonth = (monthsAgo: number) =>
    zonedInstant({ year: today.year, month: today.month - monthsAgo, day: 1, hour: 9 }, TZ);
  const months = [
    { ago: 3, doneAfterDays: 4, ups: 'normal', temperature: 22, humidity: 48 },
    { ago: 2, doneAfterDays: 33, ups: 'battery', temperature: 24, humidity: 55 }, // done after the due date
    { ago: 1, doneAfterDays: 6, ups: 'normal', temperature: 21, humidity: 46 },
    { ago: 0, doneAfterDays: null, ups: 'normal', temperature: 22, humidity: 50 },
  ];
  for (const m of months) {
    const at = firstOfMonth(m.ago);
    const key = periodKey(at, 'month', TZ);
    const { row, created } = await as(auth, () =>
      assignments.open({
        form: formRow!,
        assignee: { groupId: group.id },
        title: `Server room inspection ${key}`,
        dueAt: assignmentDueAt(at, 'month', { type: 'end-of-period' }, TZ),
        periodKey: key,
        note: 'Check the UPS event log and the fire panel as well.',
        source: { type: jobId ? 'job' : 'manual', id: jobId },
        dedupeKey: `form:${formRow!.id}:group:${group.id}:${key}`,
        createdBy: jobId ? null : admin.id,
      }),
    );
    if (!created) continue;
    await db.update(formAssignments).set({ createdAt: at }).where(eq(formAssignments.id, row.id));
    if (m.doneAfterDays === null) continue;
    const doneAt = new Date(at.getTime() + m.doneAfterDays * DAY);
    const sub = await as(auth, () =>
      formSvc.submit(
        INSPECTION_FORM_KEY,
        {
          inspectedOn: doneAt.toISOString().slice(0, 10),
          temperature: m.temperature,
          humidity: m.humidity,
          ups: m.ups,
          firePanelOk: true,
          findings:
            m.ups === 'battery'
              ? 'The UPS switched to battery during the 14:10 power dip; the vendor replaced battery string B.'
              : 'Nothing to report.',
        },
        auth,
        { assignmentId: row.id },
      ),
    );
    // Back-date the request and its completion to when the inspection was done.
    await db
      .update(formSubmissions)
      .set({ createdAt: doneAt, updatedAt: doneAt })
      .where(eq(formSubmissions.id, sub.id));
    await db
      .update(formAssignments)
      .set({ completedAt: doneAt, updatedAt: doneAt })
      .where(and(eq(formAssignments.id, row.id), eq(formAssignments.status, 'done')));
  }
  kernel.logger.info({ form: INSPECTION_FORM_KEY, jobId }, 'phase 8 recurring inspection created');
}
