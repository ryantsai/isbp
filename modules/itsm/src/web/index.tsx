import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/** Pages served at /itsm/* by the platform's module host (lazy-loaded), plus slot contributions. */
export default defineWebModule(manifest, {
  routes: [
    { path: '/', load: () => import('./pages/desk-page'), permission: 'itsm.tickets.work' },
    // Requesters and agents share the ticket page; the API decides what the viewer sees.
    { path: '/tickets/:ref', load: () => import('./pages/ticket-page'), permission: 'itsm.tickets.create' },
    { path: '/report', load: () => import('./pages/report-page'), permission: 'itsm.tickets.create' },
    { path: '/problems', load: () => import('./pages/problems-page'), permission: 'itsm.tickets.read' },
    { path: '/changes', load: () => import('./pages/changes-page'), permission: 'itsm.changes.read' },
    { path: '/reports', load: () => import('./pages/reports-page'), permission: 'itsm.reports.read' },
    { path: '/settings', load: () => import('./pages/settings-page'), permission: 'itsm.config.manage' },
  ],
  slots: [
    // Open tickets affecting a CI, on the CMDB's CI page.
    { slot: 'cmdb.ci.related', load: () => import('./slots/ci-related'), permission: 'itsm.tickets.read' },
    // Queue summary and my most urgent tickets on the home dashboard ("Your work").
    {
      slot: 'core.dashboard.work',
      load: () => import('./slots/dashboard-work'),
      permission: 'itsm.tickets.work',
    },
  ],
});
