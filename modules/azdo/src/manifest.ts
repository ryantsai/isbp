import { defineManifest } from '@isbp/sdk';
import { azdoConfigSchema, azdoSecretsSchema } from './contracts';

/**
 * Azure DevOps Server (on premises) for the Integrations Hub: team projects, work items (two-way, with
 * hierarchy and comments) and Git repositories (status only). The module has no tables, pages or
 * permissions of its own: connections, profiles and links live in the hub (`integrations`), which calls the
 * connector through `ctx.connectors`.
 */
export const manifest = defineManifest({
  id: 'azdo',
  version: '0.1.0',
  name: 'azdo.meta.name',
  description: 'azdo.meta.description',
  icon: 'git-branch',
  connectors: [
    {
      type: 'server',
      name: 'azdo.connector.name',
      description: 'azdo.connector.description',
      icon: 'git-branch',
      config: azdoConfigSchema,
      secrets: azdoSecretsSchema,
      objects: [
        {
          type: 'project',
          name: 'azdo.objects.project',
          entities: ['projects.project'],
          capabilities: {},
        },
        {
          type: 'work-item',
          name: 'azdo.objects.work_item',
          entities: ['projects.task'],
          capabilities: { create: true, update: true, comments: true, webhooks: true, hierarchy: true },
          scoped: true,
        },
        {
          type: 'repository',
          name: 'azdo.objects.repository',
          entities: ['alm.repository'],
          capabilities: { webhooks: true },
          scoped: true,
        },
      ],
    },
  ],
});
