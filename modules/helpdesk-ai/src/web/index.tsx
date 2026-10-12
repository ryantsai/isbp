import { defineWebModule } from '@isbp/sdk/web';
import { manifest } from '../manifest';

/** Pages served at /helpdesk-ai/* and the module's contributions to other modules' pages. */
export default defineWebModule(manifest, {
  routes: [
    // Helpdesk AI's reviewers or service desk report readers (`itsm.reports.read`): the page checks either.
    { path: '/', load: () => import('./pages/insights-page') },
    { path: '/chat', load: () => import('./pages/chat-page'), permission: 'helpdesk-ai.chat.use' },
    {
      path: '/conversations/:id',
      load: () => import('./pages/conversation-page'),
      permission: 'helpdesk-ai.insights.read',
    },
    {
      path: '/published',
      load: () => import('./pages/published-page'),
      permission: 'helpdesk-ai.publish.manage',
    },
  ],
  // Ask IT published outside the platform: `/p/helpdesk-ai/chat/<token>`, as a link or in another website's frame.
  publicRoutes: [
    { path: '/chat/:token', load: () => import('./published/chat-page') },
    { path: '/chat/:token/connect', load: () => import('./published/connect-page') },
  ],
  slots: [
    {
      slot: 'itsm.ticket.aside',
      load: () => import('./assist/assist-panel'),
      permission: 'helpdesk-ai.assist.use',
      order: 10,
    },
    {
      slot: 'core.requests.assist',
      load: () => import('./chat/ask-it-card'),
      permission: 'helpdesk-ai.chat.use',
    },
    {
      slot: 'knowledge.home.assist',
      load: () => import('./chat/ask-it-card').then((m) => ({ default: m.KnowledgeAskItCard })),
      permission: 'helpdesk-ai.chat.use',
    },
  ],
});
