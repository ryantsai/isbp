import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/**
 * Pages served at /assistant/* (the change sets, the process packs) and the assistant itself: a button in the shell header on every
 * page (`core.shell.header`) that opens the panel. Modules preview their own kinds on the change set page through
 * `assistant.preview.<module>.<kind>` (props: `AssistantPreviewProps` in `../contracts`). Administration → Forms
 * gets "Install a process pack" (`core.forms.header`).
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
    { path: '/packs', load: () => import('./pages/packs-page'), permission: 'assistant.agent.use' },
  ],
  slots: [
    { slot: 'core.shell.header', load: () => import('./panel/launcher'), permission: 'assistant.agent.use' },
    // Administration → Forms: "Install a process pack" beside "New form".
    { slot: 'core.forms.header', load: () => import('./forms-header'), permission: 'assistant.agent.use' },
  ],
});
