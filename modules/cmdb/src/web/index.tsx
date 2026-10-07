import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/** Pages served at /cmdb/* by the platform's module host (lazy-loaded). `/classes` precedes `/:ref`. */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/list-page'), permission: 'cmdb.cis.read' },
    { path: '/classes', load: () => import('./pages/classes-page'), permission: 'cmdb.classes.manage' },
    { path: '/:ref', load: () => import('./pages/detail-page'), permission: 'cmdb.cis.read' },
  ],
});
