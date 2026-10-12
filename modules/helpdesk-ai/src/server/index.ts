import { defineServerModule, HttpError } from '@isbp/sdk/server';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { AssistService, readSettings, TRIAGE_TYPES } from './assist';
import { conversationRecords } from './records';
import { routes } from './routes';
import { seed } from './seed';

interface TicketCreated {
  ticketId: string;
  reference: string;
  type: string;
  title: string;
  channel: string;
}

export default defineServerModule(manifest, {
  migrations,
  routes,

  events: {
    /**
     * Triage on create, as the agent identity (once per ticket: redelivery is a no-op). When auto-triage
     * is on and the suggestion is confident enough, the agent fills the still-empty fields.
     */
    'itsm.ticket.created': async (event, ctx) => {
      const p = event.payload as TicketCreated;
      if (!(TRIAGE_TYPES as readonly string[]).includes(p.type)) return;
      if (!(await readSettings(ctx)).triageEnabled) return;
      try {
        await new AssistService(ctx).triage(p.ticketId, { auth: ctx.ai.agent(), trigger: 'created' });
      } catch (err) {
        // Gone, or no longer visible to the agent identity: nothing to triage (don't retry forever).
        if (err instanceof HttpError && (err.statusCode === 404 || err.statusCode === 403)) {
          ctx.logger.info({ ticketId: p.ticketId, code: err.code }, 'skipped triage');
          return;
        }
        throw err;
      }
    },
  },

  records: { conversation: conversationRecords },

  seed,
});
