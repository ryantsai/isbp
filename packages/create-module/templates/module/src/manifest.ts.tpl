import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';

const itemRef = z.object({ itemId: z.uuid(), title: z.string() });

export const manifest = defineManifest({
  id: '__ID__',
  version: '0.1.0',
  name: '__ID__.meta.name',
  description: '__ID__.meta.description',
  icon: '__ICON__',
  navigation: [
    { id: 'home', label: '__ID__.nav.home', href: '/__ID__', icon: '__ICON__', permission: '__ID__.items.read', section: 'main', order: 50 },
  ],
  permissions: [
    { key: '__ID__.items.read', description: '__ID__.permissions.read' },
    { key: '__ID__.items.manage', description: '__ID__.permissions.manage' },
  ],
  roles: [
    { key: '__ID__-manager', name: '__TITLE__ manager', description: 'Create, edit and delete __TITLE__ items', permissions: ['__ID__.items.*'] },
    { key: '__ID__-viewer', name: '__TITLE__ viewer', description: 'Read-only access to __TITLE__', permissions: ['__ID__.items.read'] },
  ],
  events: {
    emits: [
      { name: '__ID__.item.created', schema: itemRef },
      { name: '__ID__.item.updated', schema: itemRef.extend({ changes: z.array(z.string()) }) },
      { name: '__ID__.item.deleted', schema: itemRef },
    ],
    consumes: ['core.user.offboarded'],
  },
  settings: [
    {
      key: 'defaultStatus',
      label: '__ID__.settings.defaultStatus',
      type: 'select',
      default: 'draft',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'active', label: 'Active' },
      ],
    },
  ],
  ai: {
    tools: [
      {
        name: '__ID__.list_items',
        description: 'List __TITLE__ items, optionally filtered by status or a search term.',
        input: z.object({ query: z.string().optional(), status: z.enum(['draft', 'active', 'archived']).optional(), limit: z.number().int().max(50).default(10) }),
        permission: '__ID__.items.read',
      },
    ],
  },
  search: { entities: ['item'] },
});
