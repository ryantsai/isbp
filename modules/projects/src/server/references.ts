/**
 * What in Projects still uses another thing before it is deleted (`docs/ai/recipes.md` §30): the status reporting
 * schedule names its reporters' group by key, so that group can't be deleted while the schedule is on.
 */
import type { ReferenceFinder } from '@isbp/sdk/server';
import { and, eq } from 'drizzle-orm';
import { statusSchedule } from './schema';

const scheduleUsingGroup: ReferenceFinder = async (target, _ctx, { tx }) => {
  if (!target.key) return [];
  const [row] = await tx
    .select({ id: statusSchedule.id })
    .from(statusSchedule)
    .where(and(eq(statusSchedule.groupKey, target.key), eq(statusSchedule.enabled, true)));
  return row
    ? [
        {
          kind: 'setting',
          label: {
            en: 'Status reporting schedule',
            'zh-TW': '狀態回報排程',
            'ja-JP': 'ステータス報告のスケジュール',
          },
          href: '/projects/reporting',
        },
      ]
    : [];
};

export const references = { 'core.group': scheduleUsingGroup };
