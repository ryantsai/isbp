import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/**
 * Pages served at /alm/* by the platform's module host (lazy-loaded). `/releases` precedes `/:code`, so an
 * application can never be called "releases" (the code is reserved). Plus slot contributions.
 */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/inventory-page'), permission: 'alm.apps.read' },
    { path: '/releases', load: () => import('./pages/releases-page'), permission: 'alm.apps.read' },
    { path: '/:code', load: () => import('./pages/application-page'), permission: 'alm.apps.read' },
    {
      path: '/:code/releases/:version',
      load: () => import('./pages/release-page'),
      permission: 'alm.apps.read',
    },
  ],
  slots: [
    // The application a CI is (or hosts), on the CMDB's CI page.
    { slot: 'cmdb.ci.related', load: () => import('./slots/ci-related'), permission: 'alm.apps.read' },
    // Releases and deployments of a change, on ITSM's change page (renders nothing for other tickets).
    {
      slot: 'itsm.ticket.aside',
      load: () => import('./slots/change-aside'),
      permission: 'alm.apps.read',
      order: 50,
    },
    // The next releases of my applications, on the home dashboard.
    {
      slot: 'core.dashboard.work',
      load: () => import('./slots/dashboard-work'),
      permission: 'alm.apps.read',
      order: 60,
    },
  ],
});
