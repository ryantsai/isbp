import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/**
 * Pages served at /etl/* (lazy-loaded; the first matching route wins, so `/pipelines/new` precedes
 * `/pipelines/:id`) and the config editor of the `etl.pipeline` task type in Scheduled Jobs.
 */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/endpoints-page'), permission: 'etl.endpoints.read' },
    {
      path: '/endpoints/:slug',
      load: () => import('./pages/endpoint-page'),
      permission: 'etl.endpoints.read',
    },
    { path: '/logs', load: () => import('./pages/logs-page'), permission: 'etl.endpoints.read' },
    { path: '/pipelines', load: () => import('./pages/pipelines-page'), permission: 'etl.pipelines.read' },
    {
      path: '/pipelines/new',
      load: () => import('./pages/pipeline-new-page'),
      permission: 'etl.pipelines.manage',
    },
    { path: '/pipelines/:id', load: () => import('./pages/pipeline-page'), permission: 'etl.pipelines.read' },
    {
      path: '/pipelines/:id/runs/:runId',
      load: () => import('./pages/run-page'),
      permission: 'etl.pipelines.read',
    },
  ],
  slots: [
    // The pipeline picker in Scheduled Jobs' job form.
    {
      slot: 'scheduler.task-config.etl.pipeline',
      load: () => import('./slots/task-config'),
      permission: 'etl.pipelines.run',
    },
  ],
});
