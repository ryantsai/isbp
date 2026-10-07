import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/** Pages served at /scheduler/* (lazy-loaded) and the home dashboard card. */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/overview-page'), permission: 'scheduler.jobs.read' },
    { path: '/jobs', load: () => import('./pages/jobs-page'), permission: 'scheduler.jobs.read' },
    { path: '/jobs/new', load: () => import('./pages/job-form-page'), permission: 'scheduler.jobs.create' },
    { path: '/jobs/:id', load: () => import('./pages/job-page'), permission: 'scheduler.jobs.read' },
    // Owners edit with scheduler.jobs.create, managers with scheduler.jobs.manage: the page checks.
    {
      path: '/jobs/:id/edit',
      load: () => import('./pages/job-form-page'),
      permission: 'scheduler.jobs.read',
    },
    { path: '/runs', load: () => import('./pages/runs-page'), permission: 'scheduler.jobs.read' },
    { path: '/runs/:id', load: () => import('./pages/run-page'), permission: 'scheduler.jobs.read' },
  ],
  slots: [
    // What is failing, on the home dashboard.
    {
      slot: 'core.dashboard.work',
      load: () => import('./slots/failing-jobs'),
      permission: 'scheduler.jobs.read',
    },
  ],
});
