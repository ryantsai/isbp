import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/** Pages served at /itam/* (lazy-loaded) and the slots Assets contributes to other pages. */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/overview-page'), permission: 'itam.hardware.read' },
    { path: '/hardware', load: () => import('./pages/hardware-page'), permission: 'itam.hardware.read' },
    { path: '/hardware/:ref', load: () => import('./pages/asset-page'), permission: 'itam.hardware.read' },
    { path: '/software', load: () => import('./pages/software-page'), permission: 'itam.software.read' },
    { path: '/software/:ref', load: () => import('./pages/license-page'), permission: 'itam.software.read' },
    { path: '/contracts', load: () => import('./pages/contracts-page'), permission: 'itam.contracts.read' },
    {
      path: '/contracts/:ref',
      load: () => import('./pages/contract-page'),
      permission: 'itam.contracts.read',
    },
    // Contract readers and catalogue maintainers; the page checks both.
    { path: '/vendors', load: () => import('./pages/vendors-page') },
    { path: '/mine', load: () => import('./pages/mine-page'), permission: 'itam.self.read' },
    { path: '/settings', load: () => import('./pages/settings-page'), permission: 'itam.config.manage' },
  ],
  slots: [
    // The hardware record behind a CI, on the CMDB's CI page.
    { slot: 'cmdb.ci.related', load: () => import('./slots/ci-asset'), permission: 'itam.hardware.read' },
    // Devices and software of a person (Administration → People).
    {
      slot: 'core.user.overview',
      load: () => import('./slots/user-assets'),
      permission: 'itam.hardware.read',
    },
    // What needs an asset manager today, on the home dashboard.
    {
      slot: 'core.dashboard.work',
      load: () => import('./slots/attention'),
      permission: 'itam.hardware.manage',
    },
  ],
});
