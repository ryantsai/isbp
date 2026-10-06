import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';

const postRef = z.object({ postId: z.uuid(), title: z.string() });
const severity = z.enum(['info', 'maintenance', 'incident']);

/**
 * IT announcements: service notices, maintenance windows and incident updates for everyone.
 * Generated with `pnpm create-module announcements` and then shaped into a real feature.
 */
export const manifest = defineManifest({
  id: 'announcements',
  version: '0.1.0',
  name: 'announcements.meta.name',
  description: 'announcements.meta.description',
  icon: 'megaphone',
  navigation: [
    {
      id: 'feed',
      label: 'announcements.nav.feed',
      href: '/announcements',
      icon: 'megaphone',
      permission: 'announcements.posts.read',
      section: 'main',
      order: 10,
    },
  ],
  permissions: [
    { key: 'announcements.posts.read', description: 'announcements.permissions.read' },
    { key: 'announcements.posts.manage', description: 'announcements.permissions.manage' },
  ],
  roles: [
    {
      key: 'announcements-reader',
      name: 'Announcement reader',
      description: 'See published announcements (granted to everyone by default)',
      permissions: ['announcements.posts.read'],
      grantByDefault: true,
    },
    {
      key: 'announcements-editor',
      name: 'Announcement editor',
      description: 'Write, publish and archive announcements',
      permissions: ['announcements.posts.*'],
    },
  ],
  events: {
    emits: [
      {
        name: 'announcements.post.published',
        description: 'A post became visible to everyone',
        schema: postRef.extend({ severity }),
      },
      { name: 'announcements.post.updated', schema: postRef.extend({ changes: z.array(z.string()) }) },
      {
        name: 'announcements.post.archived',
        schema: postRef.extend({ reason: z.enum(['manual', 'expired']) }),
      },
      { name: 'announcements.post.deleted', schema: postRef },
    ],
    consumes: ['core.user.offboarded'],
  },
  settings: [
    {
      key: 'defaultSeverity',
      label: 'announcements.settings.defaultSeverity',
      type: 'select',
      default: 'info',
      options: [
        { value: 'info', label: 'Information' },
        { value: 'maintenance', label: 'Maintenance' },
        { value: 'incident', label: 'Incident' },
      ],
    },
    {
      key: 'maxPinned',
      label: 'announcements.settings.maxPinned',
      type: 'number',
      default: 3,
      advanced: true,
    },
  ],
  ai: {
    tools: [
      {
        name: 'announcements.list_current',
        description:
          'List announcements that are currently published, e.g. ongoing incidents or upcoming maintenance windows.',
        input: z.object({
          severity: severity.optional(),
          limit: z.number().int().min(1).max(20).default(10),
        }),
        permission: 'announcements.posts.read',
      },
      {
        name: 'announcements.publish_post',
        description:
          'Publish an announcement to every user. Broadcasts immediately, so it always requires human confirmation.',
        input: z.object({
          title: z.string().min(1).max(200),
          body: z.string().max(10_000),
          severity,
          startsAt: z.iso.datetime({ offset: true }).optional(),
          endsAt: z.iso.datetime({ offset: true }).optional(),
        }),
        permission: 'announcements.posts.manage',
        destructive: true,
      },
    ],
  },
  search: { entities: ['post'] },
});
