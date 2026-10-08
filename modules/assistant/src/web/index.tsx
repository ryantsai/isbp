import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/**
 * Pages served at /assistant/* (the change sets) and the assistant itself: a button in the shell header on every
 * page (`core.shell.header`) that opens the panel. Modules preview their own kinds on the change set page through
 * `assistant.preview.<module>.<kind>` (props: `AssistantPreviewProps` in `../contracts`).
 */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/change-sets-page'), permission: 'assistant.agent.use' },
    {
      path: '/change-sets',
      load: () => import('./pages/change-sets-page'),
      permission: 'assistant.agent.use',
    },
    {
      path: '/change-sets/:id',
      load: () => import('./pages/change-set-page'),
      permission: 'assistant.agent.use',
    },
  ],
  slots: [
    { slot: 'core.shell.header', load: () => import('./panel/launcher'), permission: 'assistant.agent.use' },
  ],
});
