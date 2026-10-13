import { defineServerModule } from '@isbp/sdk/server';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { aiTools } from './ai';
import { customizations } from './customizations';
import { projectRecords, search, taskRecords } from './records';
import { references } from './references';
import { routes } from './routes';
import { seedProjects } from './seed';
import { services } from './services';
import { sync } from './sync';
import { taskTypes } from './task-types';
import { projectsNavigation, projectsWork } from './work';

/**
 * Project management: projects, tasks, milestones, the Kanban board, the Gantt timeline with
 * dependencies, workload, the proposal approval and the AI tools; status updates on an organisation-wide schedule
 * and the status report (Phase 11). Links to tickets, changes, CIs, releases and meetings go through the platform's
 * record links (`ctx.records`), so the module depends on no other.
 */
export default defineServerModule(manifest, {
  migrations,
  routes,

  workflows: {
    'projects.proposal': {
      onCompleted: (result, ctx) => services(ctx).projects.onProposalCompleted(result),
    },
  },

  events: {
    /** People who leave: their open tasks go back to unassigned and they leave the projects they don't own. */
    'core.user.offboarded': async (event, ctx) => {
      const { userId } = event.payload as { userId: string };
      await services(ctx).projects.offboard(userId);
    },
  },

  jobs: {
    'due-reminders': {
      description: 'Reminds assignees of open tasks due tomorrow (once per task and due date)',
      schedule: { cron: '0 8 * * *', tz: 'Asia/Taipei' },
      attempts: 3,
      handler: async (job, ctx) => {
        const sent = await services(ctx).tasks.dueReminders();
        if (sent) await job.log(`reminded ${sent} task(s) due tomorrow`);
        return { sent };
      },
    },
    'status-updates': {
      description:
        "Keeps the open period's expected status updates in step with the reporting schedule and sends due and overdue reminders",
      schedule: { everyMs: 15 * 60_000 },
      attempts: 3,
      handler: async (job, ctx) => {
        const out = await services(ctx).reporting.run();
        if (out.opened || out.removed || out.dueSoon || out.overdue)
          await job.log(
            `opened ${out.opened}, removed ${out.removed}, reminded ${out.dueSoon} due soon and ${out.overdue} overdue`,
          );
        return out;
      },
    },
    'report-narrative': {
      description: 'Writes the narrative of a status report with the chat model, as the person who opened it',
      attempts: 2,
      backoffMs: 30_000,
      timeoutMs: 4 * 60_000,
      handler: async (job, ctx) => services(ctx).reports.generate((job.data as { hash: string }).hash),
    },
    'purge-narratives': {
      description: 'Deletes status report narratives older than 90 days',
      schedule: { cron: '30 3 * * *', tz: 'Asia/Taipei' },
      handler: async (_job, ctx) => ({ purged: await services(ctx).reports.purge() }),
    },
  },

  ai: aiTools,

  search,

  work: projectsWork,

  navigation: projectsNavigation,

  records: { project: projectRecords, task: taskRecords },

  sync,

  taskTypes,

  customizations,

  references,

  seed: seedProjects,
});
