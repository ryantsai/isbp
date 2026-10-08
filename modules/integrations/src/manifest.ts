import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';
import {
  countsSchema,
  directionSchema,
  runKindSchema,
  runStatusSchema,
  runTriggerSchema,
  syncTaskConfigSchema,
} from './contracts';

const connectionRef = z.object({ connectionId: z.uuid(), name: z.string(), type: z.string() });
const profileRef = z.object({
  profileId: z.uuid(),
  connectionId: z.uuid(),
  name: z.string(),
  entity: z.string(),
  objectType: z.string(),
  direction: directionSchema,
});
const conflictRef = z.object({
  conflictId: z.uuid(),
  linkId: z.uuid(),
  profileId: z.uuid(),
  connectionId: z.uuid(),
  entity: z.string(),
  localId: z.string(),
});

/**
 * Integrations Hub: connections to outside systems (through connector modules), sync profiles with field
 * mappings, the two-way sync engine (pull, push, three-way merge, webhooks), runs, links and conflicts.
 * Design: docs/architecture.md §12.
 */
export const manifest = defineManifest({
  id: 'integrations',
  version: '0.1.0',
  name: 'integrations.meta.name',
  description: 'integrations.meta.description',
  icon: 'arrow-left-right',
  navigation: [
    {
      id: 'overview',
      label: 'integrations.nav.overview',
      href: '/integrations',
      icon: 'arrow-left-right',
      permission: 'integrations.connections.read',
      section: 'admin',
      group: 'integrations.nav.group',
      order: 70,
    },
    {
      id: 'conflicts',
      label: 'integrations.nav.conflicts',
      href: '/integrations/conflicts',
      icon: 'git-compare-arrows',
      permission: 'integrations.connections.read',
      section: 'admin',
      group: 'integrations.nav.group',
      order: 71,
    },
  ],
  permissions: [
    { key: 'integrations.connections.read', description: 'integrations.permissions.connectionsRead' },
    { key: 'integrations.connections.manage', description: 'integrations.permissions.connectionsManage' },
    { key: 'integrations.conflicts.resolve', description: 'integrations.permissions.conflictsResolve' },
  ],
  roles: [
    {
      key: 'integrations-viewer',
      name: 'Integrations viewer',
      description: 'See connections, sync profiles, runs, linked records and conflicts',
      permissions: ['integrations.connections.read'],
    },
    {
      key: 'integrations-admin',
      name: 'Integrations administrator',
      description:
        'Set up connections and sync profiles for every syncable entity, run syncs and resolve conflicts',
      permissions: ['integrations.*', '*.*.sync'],
    },
  ],
  events: {
    emits: [
      { name: 'integrations.connection.created', schema: connectionRef },
      {
        name: 'integrations.connection.updated',
        description: 'Settings, credentials, the webhook secret or the enabled flag changed',
        schema: connectionRef.extend({ changes: z.array(z.string()) }),
      },
      { name: 'integrations.connection.deleted', schema: connectionRef },
      { name: 'integrations.profile.created', schema: profileRef },
      { name: 'integrations.profile.updated', schema: profileRef.extend({ changes: z.array(z.string()) }) },
      { name: 'integrations.profile.deleted', schema: profileRef },
      {
        name: 'integrations.run.finished',
        description: 'A sync run ended (succeeded, partial or failed)',
        schema: z.object({
          runId: z.uuid(),
          profileId: z.uuid(),
          connectionId: z.uuid(),
          kind: runKindSchema,
          trigger: runTriggerSchema,
          status: runStatusSchema,
          counts: countsSchema,
        }),
      },
      {
        name: 'integrations.conflict.created',
        description: 'Both sides changed the same fields differently and the profile asks a person',
        schema: conflictRef.extend({ remoteRef: z.string(), fields: z.array(z.string()) }),
      },
      {
        name: 'integrations.conflict.resolved',
        description: 'Someone picked a side per field (resolved) or kept both values (dismissed)',
        schema: conflictRef.extend({
          outcome: z.enum(['resolved', 'dismissed']),
          choices: z.record(z.string(), z.enum(['local', 'remote'])),
        }),
      },
    ],
  },
  ai: {
    /** The hub writes synced records as this identity: every entity's `.sync` permission, nothing else. */
    agent: { name: 'Integrations Hub', permissions: ['*.*.sync'] },
  },
  notifications: [
    { type: 'integrations.connection.failing', defaultChannels: ['inApp', 'email'] },
    { type: 'integrations.conflict.created', defaultChannels: ['inApp'] },
  ],
  taskTypes: [
    {
      type: 'sync',
      name: 'integrations.taskTypes.sync.name',
      description: 'integrations.taskTypes.sync.description',
      icon: 'arrow-left-right',
      permission: 'integrations.connections.manage',
      config: syncTaskConfigSchema,
    },
  ],
  customizations: [
    {
      kind: 'profile',
      label: 'integrations.customizations.profile',
      description:
        'A sync profile of the Integrations Hub: which remote object type of a connection (a ServiceDesk Plus request, an Azure DevOps work item) syncs with which ISBP record type, in which direction, with field and value mappings, matching, conflict policy and schedule. Applying makes it live; archiving disables it.',
      icon: 'arrow-left-right',
      readPermission: 'integrations.connections.read',
      applyPermission: 'integrations.connections.manage',
      operations: ['create', 'update', 'archive', 'delete'],
    },
  ],
});
