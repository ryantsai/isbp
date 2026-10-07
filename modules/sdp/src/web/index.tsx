import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/**
 * No pages: the module contributes the settings form of its connections to the Integrations Hub
 * (Administration → Integrations → Add connection). The hub's page checks who may manage connections.
 */
export default defineWebModule(manifest, {
  routes: [],
  slots: [
    {
      slot: 'integrations.connector-config.sdp.server',
      load: () => import('./slots/connector-config'),
    },
  ],
});
