import { defineWebModule } from '@isbp/sdk/web';
import { PERMISSIONS } from '../contracts';
import { manifest } from '../manifest';

/** Pages at /meetings/* (lazy-loaded); the static `/action-items` comes before `/:ref`. */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/meetings-page'), permission: PERMISSIONS.use },
    { path: '/action-items', load: () => import('./pages/action-items-page'), permission: PERMISSIONS.use },
    { path: '/:ref', load: () => import('./pages/meeting-page'), permission: PERMISSIONS.use },
  ],
  // Meetings show on the pages of the records they are linked to through `core.record.links`; action items reach their
  // owners on My work (`manifest.work`), and the ones that became project tasks through Projects.
});
