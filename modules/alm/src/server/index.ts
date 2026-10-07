import { defineServerModule, type RecordRef } from '@isbp/sdk/server';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { aiTools } from './ai';
import { CHANGE_TYPE, RELEASE_TYPE, releasesLinkedTo } from './changes';
import { records, search } from './records';
import { routes } from './routes';
import { seed } from './seed';
import { services } from './services';
import { sync } from './sync';

/**
 * Application lifecycle management: the application inventory, environments, releases and deployment
 * records, linked to ITSM change management (production deployments need an authorized change).
 */
export default defineServerModule(manifest, {
  migrations,
  routes,

  events: {
    /** People who leave no longer own applications: clear them (audited) so the gap shows on the dashboard. */
    'core.user.offboarded': async (event, ctx) => {
      const { userId } = event.payload as { userId: string };
      await services(ctx).apps.releaseOwner(userId);
    },
    /** A change linked to a release (e.g. raised from "Raise a change"): planned → in progress; readiness. */
    'core.record.linked': async (event, ctx) => {
      const { a, b } = event.payload as { a: RecordRef; b: RecordRef };
      const release = a.type === RELEASE_TYPE ? a : b.type === RELEASE_TYPE ? b : null;
      const change = a.type === CHANGE_TYPE ? a : b.type === CHANGE_TYPE ? b : null;
      if (release && change) await services(ctx).releases.onChangeLinked(release.id, change.id);
    },
    /** The CAB approved a change: releases linked to it may now be ready. */
    'itsm.change.approved': async (event, ctx) => {
      const { ticketId } = event.payload as { ticketId: string };
      const s = services(ctx);
      for (const id of await releasesLinkedTo(ctx, ticketId)) await s.releases.checkReady(id);
    },
  },

  ai: aiTools,
  search,
  records,
  sync,
  seed,
});
