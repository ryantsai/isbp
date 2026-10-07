import { defineServerModule } from '@isbp/sdk/server';
import { manifest } from '../manifest';
import { sdpConnector } from './connector';

/**
 * No routes, tables or jobs: the module contributes the `sdp.server` connector. The Integrations Hub opens it
 * through `ctx.connectors` with a connection's settings and secrets.
 */
export default defineServerModule(manifest, {
  connectors: { server: sdpConnector },
});
