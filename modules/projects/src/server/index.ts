import { defineServerModule } from '@isbp/sdk/server';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { aiTools } from './ai';
import { projectRecords, search, taskRecords } from './records';
import { routes } from './routes';
import { seedProjects } from './seed';
import { services } from './services';
import { sync } from './sync';

/**
 * Project management: projects, tasks, milestones, the Kanban board, the Gantt timeline with
 * dependencies, workload, the proposal approval and the AI tools. Links to tickets, changes, CIs and
 * releases go through the platform's record links (`ctx.records`), so the module depends on no other.
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
  },

  ai: aiTools,

  search,

  records: { project: projectRecords, task: taskRecords },

  sync,

  seed: seedProjects,
});
