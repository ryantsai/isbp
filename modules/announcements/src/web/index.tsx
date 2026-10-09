import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/** Pages served at /announcements/* by the platform's module host (lazy-loaded), and News on Home. */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/feed-page'), permission: 'announcements.posts.read' },
    { path: '/:id', load: () => import('./pages/post-page'), permission: 'announcements.posts.read' },
  ],
  slots: [
    // "News" on Home: readers find announcements there (the sidebar entry is for the people who write them).
    {
      slot: 'core.home.news',
      load: () => import('./slots/home-news'),
      permission: 'announcements.posts.read',
    },
  ],
});
