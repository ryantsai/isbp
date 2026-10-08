import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/** Pages served at /isms/* (lazy-loaded) and the dashboard card. */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/register-page'), permission: 'isms.assets.read' },
    { path: '/assets/:ref', load: () => import('./pages/asset-page'), permission: 'isms.assets.read' },
    { path: '/stocktakes', load: () => import('./pages/stocktakes-page'), permission: 'isms.self.use' },
    { path: '/stocktakes/:ref', load: () => import('./pages/stocktake-page'), permission: 'isms.self.use' },
    { path: '/accounts', load: () => import('./pages/accounts-page'), permission: 'isms.self.use' },
    { path: '/accounts/:ref', load: () => import('./pages/account-page'), permission: 'isms.self.use' },
    { path: '/reviews', load: () => import('./pages/reviews-page'), permission: 'isms.self.use' },
    { path: '/reviews/:ref', load: () => import('./pages/review-page'), permission: 'isms.self.use' },
    { path: '/settings', load: () => import('./pages/settings-page'), permission: 'isms.config.manage' },
  ],
  slots: [
    {
      slot: 'core.dashboard.work',
      load: () => import('./slots/dashboard-card'),
      permission: 'isms.self.use',
      order: 75,
    },
  ],
});
