import { defineServerModule } from '@isbp/sdk/server';
import { manifest } from '../manifest';
import { serverConnector } from './connector';

/**
 * No tables, routes or jobs: the module only contributes the `azdo.server` connector. The Integrations Hub
 * opens it with `ctx.connectors.open('azdo.server', connection)`.
 */
export default defineServerModule(manifest, {
  connectors: { server: serverConnector },
});
