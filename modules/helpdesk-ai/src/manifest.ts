import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';

const ticketRef = z.object({ insightId: z.uuid(), ticketId: z.uuid(), reference: z.string() });
const conversationRef = z.object({ conversationId: z.uuid(), userId: z.uuid() });

/**
 * AI on the service desk: triage on create, similar tickets and articles, KB-grounded reply drafts,
 * summaries, KB drafts from resolved tickets and the self-service virtual agent ("Ask IT"). It reaches
 * ITSM and the knowledge base only through the AI gateway's tool registry — as the signed-in user, or
 * as its own least-privilege agent identity for background triage.
 */
export const manifest = defineManifest({
  id: 'helpdesk-ai',
  version: '0.1.0',
  name: 'helpdesk-ai.meta.name',
  description: 'helpdesk-ai.meta.description',
  icon: 'sparkles',
  dependsOn: ['itsm', 'knowledge'],
  navigation: [
    {
      // Ask IT lives in Requests (and Home). The insights are the "AI insights" tab of the service desk's Reports
      // (service desk report readers see the metrics too); a row of its own for people who can't open Reports.
      id: 'insights',
      label: 'helpdesk-ai.nav.insights',
      href: '/helpdesk-ai',
      icon: 'brain-circuit',
      permission: ['helpdesk-ai.insights.read', 'itsm.reports.read'],
      section: 'main',
      parent: 'itsm.reports',
      order: 30,
    },
  ],
  permissions: [
    { key: 'helpdesk-ai.chat.use', description: 'helpdesk-ai.permissions.chat' },
    { key: 'helpdesk-ai.assist.use', description: 'helpdesk-ai.permissions.assist' },
    { key: 'helpdesk-ai.insights.read', description: 'helpdesk-ai.permissions.insights' },
  ],
  roles: [
    {
      key: 'helpdesk-ai-user',
      name: 'Virtual agent user',
      description: 'Ask the IT virtual agent for help (granted to everyone by default)',
      permissions: ['helpdesk-ai.chat.use'],
      grantByDefault: true,
    },
    {
      key: 'helpdesk-ai-agent',
      name: 'AI-assisted agent',
      description: 'Use the AI assist panel on tickets (triage, similar tickets, reply drafts, summaries)',
      permissions: ['helpdesk-ai.assist.use', 'helpdesk-ai.chat.use'],
    },
    {
      key: 'helpdesk-ai-admin',
      name: 'Helpdesk AI administrator',
      description: 'Everything in Helpdesk AI, including accuracy metrics and conversation review',
      permissions: ['helpdesk-ai.*'],
    },
  ],
  events: {
    emits: [
      {
        name: 'helpdesk-ai.triage.suggested',
        description: 'A triage suggestion was stored for a new ticket',
        schema: ticketRef.extend({ confidence: z.number(), mode: z.enum(['builtin', 'llm']) }),
      },
      {
        name: 'helpdesk-ai.triage.applied',
        description: 'A triage suggestion was applied (automatically or by an agent)',
        schema: ticketRef.extend({ by: z.enum(['auto', 'agent']), fields: z.array(z.string()) }),
      },
      {
        name: 'helpdesk-ai.conversation.deflected',
        description: 'The virtual agent solved the problem without a ticket',
        schema: conversationRef,
      },
      {
        name: 'helpdesk-ai.conversation.escalated',
        description: 'The user confirmed a ticket proposed by the virtual agent',
        schema: conversationRef.extend({ ticketId: z.string(), reference: z.string() }),
      },
    ],
    consumes: ['itsm.ticket.created'],
  },
  settings: [
    { key: 'triageEnabled', label: 'helpdesk-ai.settings.triageEnabled', type: 'boolean', default: true },
    {
      key: 'autoTriage',
      label: 'helpdesk-ai.settings.autoTriage',
      description: 'helpdesk-ai.settings.autoTriageHelp',
      type: 'boolean',
      default: false,
    },
    {
      key: 'autoTriageThreshold',
      label: 'helpdesk-ai.settings.autoTriageThreshold',
      description: 'helpdesk-ai.settings.autoTriageThresholdHelp',
      type: 'number',
      default: 0.8,
      advanced: true,
    },
    {
      key: 'virtualAgentEnabled',
      label: 'helpdesk-ai.settings.virtualAgentEnabled',
      type: 'boolean',
      default: true,
    },
    { key: 'suggestReplies', label: 'helpdesk-ai.settings.suggestReplies', type: 'boolean', default: true },
  ],
  ai: {
    /** Least privilege: read tickets and articles, set triage fields — nothing else. */
    agent: {
      name: 'Helpdesk AI',
      permissions: [
        'itsm.tickets.read',
        'itsm.tickets.triage',
        'knowledge.articles.read',
        'knowledge.articles.read-internal',
      ],
    },
  },
});
