import { defineWebModule } from '@isbp/sdk/web';
import { PERMISSIONS } from '../contracts';
import { manifest } from '../manifest';

/**
 * Pages served at /projects/* (lazy-loaded). Static paths precede `/:key`, and task pages live under
 * `/tasks/:ref` so a project key can never shadow them.
 */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/portfolio-page'), permission: PERMISSIONS.use },
    { path: '/my-tasks', load: () => import('./pages/my-tasks-page'), permission: PERMISSIONS.use },
    { path: '/tasks/:ref', load: () => import('./pages/task-page'), permission: PERMISSIONS.use },
    { path: '/:key', load: () => import('./pages/project-page'), permission: PERMISSIONS.use },
  ],
  // Assigned tasks reach people through My work (`manifest.work` → "Tasks") and its summary on Home.
});
