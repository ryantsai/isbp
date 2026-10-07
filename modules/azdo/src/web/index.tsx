import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/**
 * No pages: the connector's only UI is its settings form in the Integrations Hub's connection sheet. The hub
 * gates the sheet with its own permission.
 */
export default defineWebModule(manifest, {
  routes: [],
  slots: [
    {
      slot: 'integrations.connector-config.azdo.server',
      load: () => import('./slots/connector-config'),
    },
  ],
});
