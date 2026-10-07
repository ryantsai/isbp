import { defineManifest } from '@isbp/sdk';
import { sdpConfigSchema, sdpSecretsSchema } from './contracts';

/**
 * ManageEngine ServiceDesk Plus, on-premises. The module has no pages, tables or permissions of its own: it
 * contributes the `sdp.server` connector, which the Integrations Hub uses to keep requests, problems,
 * changes, assets and solutions in sync with ITSM, Asset Management and the Knowledge Base, and the settings
 * form of its connections.
 */
export const manifest = defineManifest({
  id: 'sdp',
  version: '0.1.0',
  name: 'sdp.meta.name',
  description: 'sdp.meta.description',
  icon: 'headset',
  connectors: [
    {
      type: 'server',
      name: 'sdp.connector.name',
      description: 'sdp.connector.description',
      icon: 'headset',
      config: sdpConfigSchema,
      secrets: sdpSecretsSchema,
      objects: [
        {
          type: 'request',
          name: 'sdp.objects.request',
          entities: ['itsm.ticket'],
          capabilities: { create: true, update: true, comments: true, webhooks: true },
        },
        {
          type: 'problem',
          name: 'sdp.objects.problem',
          entities: ['itsm.ticket'],
          capabilities: { create: true, update: true, webhooks: true },
        },
        {
          type: 'change',
          name: 'sdp.objects.change',
          entities: ['itsm.change'],
          capabilities: { create: true, update: true, webhooks: true },
        },
        {
          type: 'asset',
          name: 'sdp.objects.asset',
          entities: ['itam.asset'],
          capabilities: { create: true, update: true },
        },
        {
          type: 'solution',
          name: 'sdp.objects.solution',
          entities: ['knowledge.article'],
          capabilities: { create: true, update: true },
        },
      ],
    },
  ],
});
