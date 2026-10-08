import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/**
 * Pages served at /knowledge/*. Fixed paths come before `/:ref` (articles are `KB-00042` or a uuid).
 * Hosts the `knowledge.home.assist` slot (props: `KnowledgeHomeAssistSlotProps`) on the home page.
 */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/home-page'), permission: 'knowledge.articles.read' },
    { path: '/manage', load: () => import('./pages/manage-page'), permission: 'knowledge.articles.write' },
    { path: '/new', load: () => import('./pages/editor-page'), permission: 'knowledge.articles.write' },
    {
      path: '/categories',
      load: () => import('./pages/categories-page'),
      permission: 'knowledge.categories.manage',
    },
    { path: '/guide/:slug', load: () => import('./pages/guide-page'), permission: 'knowledge.articles.read' },
    { path: '/:ref', load: () => import('./pages/article-page'), permission: 'knowledge.articles.read' },
    { path: '/:ref/edit', load: () => import('./pages/editor-page'), permission: 'knowledge.articles.write' },
  ],
});
