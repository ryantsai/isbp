/**
 * Decisions and open action items of the meetings linked to projects, read through the AI tool registry as the
 * person (`meetings.find_meetings`): Projects never reads the meetings module's tables, and when that module is
 * disabled (or the person may not use it) the tool is simply not there and nothing is shown.
 */
import type { AuthContext, ModuleContext } from '@isbp/sdk/server';
import { z } from 'zod';

export const FIND_MEETINGS = 'meetings.find_meetings';

const meetingSchema = z.object({
  reference: z.string(),
  title: z.string(),
  href: z.string(),
  startsAt: z.coerce.date(),
  projectIds: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  actionItems: z
    .array(
      z.object({
        title: z.string(),
        owner: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        status: z.string(),
      }),
    )
    .default([]),
});
export type LinkedMeeting = z.infer<typeof meetingSchema>;

/** Meetings linked to any of `projectIds` held between `from` and `to` (dates), or null when meetings aren't available. */
export async function linkedMeetings(
  ctx: ModuleContext,
  auth: AuthContext,
  projectIds: readonly string[],
  from: string,
  to: string,
): Promise<LinkedMeeting[] | null> {
  if (!projectIds.length) return [];
  if (!ctx.ai.tools.list(auth).some((t) => t.name === FIND_MEETINGS)) return null;
  try {
    const out = await ctx.ai.tools.invoke<{ meetings?: unknown[] }>(
      FIND_MEETINGS,
      { projectIds: projectIds.slice(0, 100), from, to, limit: 50 },
      { auth },
    );
    return (out.meetings ?? []).flatMap((m) => {
      const parsed = meetingSchema.safeParse(m);
      return parsed.success ? [parsed.data] : [];
    });
  } catch (err) {
    ctx.logger.warn({ err }, 'reading linked meetings failed');
    return null;
  }
}
