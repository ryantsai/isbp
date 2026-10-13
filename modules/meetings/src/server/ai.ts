/**
 * Handlers of `manifest.ai.tools`: the same services and access rules as the pages. `meetings.find_meetings` is also
 * how Projects reads the decisions of a project's meetings for status drafts and reports (as the person).
 */
import type { AiToolHandler } from '@isbp/sdk/server';
import { aiCreateMinutesInput, aiFindMeetingsInput, aiMyActionItemsInput } from '../contracts';
import { services } from './services';

export const aiTools: Record<string, AiToolHandler> = {
  'meetings.find_meetings': async (input, ctx, auth) =>
    services(ctx).meetings.findForTool(aiFindMeetingsInput.parse(input), auth),

  'meetings.my_action_items': async (input, ctx, auth) => {
    const { status } = aiMyActionItemsInput.parse(input);
    const page = await services(ctx).items.list(
      { page: 1, pageSize: 50, view: 'mine', status: status === 'open' ? 'open' : 'all' },
      auth,
    );
    return {
      total: page.total,
      items: page.items.map((i) => ({
        title: i.title,
        meeting: `${i.meeting.reference} ${i.meeting.title}`,
        dueDate: i.dueDate,
        status: i.status,
        task: i.task?.reference ?? null,
        href: `/meetings/${i.meeting.reference}?item=${i.id}`,
      })),
    };
  },

  'meetings.create_minutes': async (input, ctx, auth) =>
    services(ctx).meetings.createFromTool(aiCreateMinutesInput.parse(input), auth),
};
