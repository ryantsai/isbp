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
    { path: '/status-report', load: () => import('./pages/status-report-page'), permission: PERMISSIONS.use },
    {
      path: '/status-updates',
      load: () => import('./pages/status-updates-page'),
      permission: PERMISSIONS.use,
    },
    { path: '/reporting', load: () => import('./pages/reporting-page'), permission: PERMISSIONS.reporting },
    { path: '/tasks/:ref', load: () => import('./pages/task-page'), permission: PERMISSIONS.use },
    { path: '/:key', load: () => import('./pages/project-page'), permission: PERMISSIONS.use },
  ],
  // Assigned tasks and the status updates people owe reach them through My work (`manifest.work`).
  slots: [
    {
      slot: 'scheduler.task-config.projects.status-report',
      load: () => import('./slots/status-report-task-config'),
      permission: PERMISSIONS.reporting,
    },
  ],
});
