import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/** Pages served at /__ID__/* by the platform's module host (lazy-loaded). */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/list-page'), permission: '__ID__.items.read' },
    { path: '/:id', load: () => import('./pages/detail-page'), permission: '__ID__.items.read' },
  ],
});
