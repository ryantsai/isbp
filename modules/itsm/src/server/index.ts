import { defineServerModule } from '@isbp/sdk/server';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { aiTools } from './ai-tools';
import { records } from './records';
import { routes } from './routes';
import { seed } from './seed';
import { services } from './services';

/**
 * IT service management: incidents, service requests, problems and changes with CAB approval, SLA
 * timers on business calendars, catalog fulfilment of Phase 1 forms and the AI tools Helpdesk AI uses.
 */
export default defineServerModule(manifest, {
  migrations,
  routes,

  workflows: {
    'itsm.change': {
      onCompleted: (result, ctx) => services(ctx).tickets.onChangeCompleted(result),
    },
  },

  events: {
    'core.form-submission.created': async (event, ctx) => {
      const { submissionId } = event.payload as { submissionId: string };
      await services(ctx).fulfilment.onSubmitted(submissionId);
    },
    'core.form-submission.completed': async (event, ctx) => {
      const { submissionId, status } = event.payload as {
        submissionId: string;
        status: 'approved' | 'rejected' | 'cancelled';
      };
      await services(ctx).fulfilment.onCompleted(submissionId, status);
    },
    /** People who leave can't work tickets: their open tickets go back to the group queue. */
    'core.user.offboarded': async (event, ctx) => {
      const { userId } = event.payload as { userId: string };
      await services(ctx).tickets.offboard(userId);
    },
    /** Resolved tickets feed similar-ticket search and AI triage (semantic index). */
    'itsm.ticket.resolved': async (event, ctx) => {
      await services(ctx).tickets.index((event.payload as { ticketId: string }).ticketId);
    },
    'itsm.ticket.closed': async (event, ctx) => {
      await services(ctx).tickets.index((event.payload as { ticketId: string }).ticketId);
    },
  },

  jobs: {
    'sla-monitor': {
      description: 'Warns SLA timers past their threshold and marks overdue ones breached',
      schedule: { everyMs: 60_000 },
      timeoutMs: 55_000,
      handler: async (job, ctx) => {
        const result = await services(ctx).tickets.sla.monitor();
        if (result.warned || result.breached)
          await job.log(`warned ${result.warned}, breached ${result.breached} SLA timer(s)`);
        return result;
      },
    },
    'auto-close': {
      description: 'Closes resolved tickets the requester did not confirm within autoCloseDays',
      schedule: { cron: '30 2 * * *' },
      handler: async (job, ctx) => {
        const closed = await services(ctx).tickets.autoClose();
        if (closed) await job.log(`closed ${closed} resolved ticket(s)`);
        return { closed };
      },
    },
  },

  ai: aiTools,

  search: (query, ctx, auth, limit) => services(ctx).tickets.search(query, auth, limit),

  records,

  seed,
});
