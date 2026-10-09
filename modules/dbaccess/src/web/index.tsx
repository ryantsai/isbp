import { defineWebModule } from '@isbp/sdk/web';
import { manifest, PERMISSIONS } from '../manifest';

/** Pages served at /dbaccess/* (lazy-loaded) and the slots Database access contributes to other pages. */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/my-access-page'), permission: PERMISSIONS.request },
    { path: '/request', load: () => import('./pages/request-page'), permission: PERMISSIONS.request },
    {
      path: '/requests/:ref',
      load: () => import('./pages/request-detail-page'),
      permission: PERMISSIONS.request,
    },
    { path: '/grants', load: () => import('./pages/access-page'), permission: PERMISSIONS.grantsRead },
    { path: '/reviews', load: () => import('./pages/reviews-page'), permission: PERMISSIONS.request },
    { path: '/reviews/:id', load: () => import('./pages/review-page'), permission: PERMISSIONS.request },
    { path: '/servers', load: () => import('./pages/servers-page'), permission: PERMISSIONS.servers },
    { path: '/servers/:id', load: () => import('./pages/server-page'), permission: PERMISSIONS.servers },
  ],
  slots: [
    // The config editor of the inventory sync task type, in the Scheduled jobs job form.
    {
      slot: 'scheduler.task-config.dbaccess.sync',
      load: () => import('./slots/task-config'),
      permission: PERMISSIONS.servers,
    },
    // A person's database access (Administration → People); the API allows DBAs and the manager.
    {
      slot: 'core.user.overview',
      load: () => import('./slots/user-access'),
      permission: PERMISSIONS.request,
    },
    // My database access ending soon, on Home (reviews awaiting me are on My work).
    {
      slot: 'core.dashboard.work',
      load: () => import('./slots/dashboard-work'),
      permission: PERMISSIONS.request,
      order: 70,
    },
  ],
});
