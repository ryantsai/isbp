import { defineServerModule } from '@isbp/sdk/server';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { todayIn } from '../model';
import { aiTools } from './ai';
import { meetingRecords, search } from './records';
import { routes } from './routes';
import { services } from './services';
import { meetingsWork } from './work';

/** Demo data, run by the API seed after every module's own (it links to the Projects demo when that is installed). */
export { seedMeetings } from './seed';

type TaskEvent = { taskId: string; to?: string; assigneeId?: string | null };
type MeetingEvent = { meetingId: string };

/**
 * Meeting minutes (Phase 11): meetings, the minutes organiser, action items routed to project tasks or tracked here
 * with reminders, the record type, search and the AI tools. Depends on no other module: projects are reached through
 * the record registry and the AI tool registry, and project tasks through their events.
 */
export default defineServerModule(manifest, {
  migrations,
  routes,

  events: {
    'core.user.offboarded': async (event, ctx) => {
      await services(ctx).items.offboard((event.payload as { userId: string }).userId);
    },
    'projects.task.status_changed': async (event, ctx) => {
      const p = event.payload as TaskEvent;
      await services(ctx).items.followTask(p.taskId, { status: p.to });
    },
    'projects.task.assigned': async (event, ctx) => {
      const p = event.payload as TaskEvent;
      await services(ctx).items.followTask(p.taskId, { assigneeId: p.assigneeId ?? null });
    },
    'projects.task.deleted': async (event, ctx) => {
      await services(ctx).items.followTask((event.payload as TaskEvent).taskId, { deleted: true });
    },
    'meetings.meeting.created': async (event, ctx) => {
      await services(ctx).meetings.reindex((event.payload as MeetingEvent).meetingId);
    },
    'meetings.meeting.updated': async (event, ctx) => {
      await services(ctx).meetings.reindex((event.payload as MeetingEvent).meetingId);
    },
    'meetings.meeting.published': async (event, ctx) => {
      await services(ctx).meetings.reindex((event.payload as MeetingEvent).meetingId);
    },
    'meetings.action-item.created': async (event, ctx) => {
      await services(ctx).meetings.reindex((event.payload as MeetingEvent).meetingId);
    },
    'meetings.action-item.updated': async (event, ctx) => {
      await services(ctx).meetings.reindex((event.payload as MeetingEvent).meetingId);
    },
    'meetings.action-item.deleted': async (event, ctx) => {
      await services(ctx).meetings.reindex((event.payload as MeetingEvent).meetingId);
    },
    'meetings.meeting.deleted': async (event, ctx) => {
      await ctx.ai.index.remove('meetings.meeting', (event.payload as MeetingEvent).meetingId);
    },
  },

  jobs: {
    'action-item-reminders': {
      description:
        'Reminds owners of action items due tomorrow, and of overdue ones (weekly), with their organiser',
      schedule: { cron: '0 8 * * *', tz: 'Asia/Taipei' },
      attempts: 3,
      handler: async (job, ctx) => {
        const out = await services(ctx).items.reminders(todayIn('Asia/Taipei'));
        if (out.dueSoon || out.overdue)
          await job.log(`reminded ${out.dueSoon} due tomorrow, ${out.overdue} overdue`);
        return out;
      },
    },
  },

  ai: aiTools,

  search,

  work: meetingsWork,

  records: { meeting: meetingRecords },
});
