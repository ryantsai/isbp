import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/** Pages served at /announcements/* by the platform's module host (lazy-loaded). */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/feed-page'), permission: 'announcements.posts.read' },
    { path: '/:id', load: () => import('./pages/post-page'), permission: 'announcements.posts.read' },
  ],
});
