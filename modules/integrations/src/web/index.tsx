import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/**
 * Pages served at /integrations/* (Administration → Integrations; static segments before dynamic ones), the
 * "Synced with" card on record pages and the profile picker of the `integrations.sync` task type.
 * Connector modules contribute their connection settings forms to `integrations.connector-config.<type>`.
 */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/overview-page'), permission: 'integrations.connections.read' },
    {
      path: '/conflicts',
      load: () => import('./pages/conflicts-page'),
      permission: 'integrations.connections.read',
    },
    {
      path: '/runs/:id',
      load: () => import('./pages/run-page'),
      permission: 'integrations.connections.read',
    },
    {
      path: '/connections/:id/profiles/new',
      load: () => import('./pages/profile-page'),
      permission: 'integrations.connections.manage',
    },
    {
      path: '/connections/:id/profiles/:profileId',
      load: () => import('./pages/profile-page'),
      permission: 'integrations.connections.read',
    },
    {
      path: '/connections/:id',
      load: () => import('./pages/connection-page'),
      permission: 'integrations.connections.read',
    },
  ],
  slots: [
    // On every record page: visible to whoever can read the record (the API checks), empty without links.
    { slot: 'core.record.links', load: () => import('./slots/record-sync'), order: 60 },
    // The profile picker in Scheduled Jobs' job form.
    {
      slot: 'scheduler.task-config.integrations.sync',
      load: () => import('./slots/task-config'),
      permission: 'integrations.connections.manage',
    },
  ],
});
