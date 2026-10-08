import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';
import { MAX_IMPACT_DEPTH, RELATIONSHIP_TYPES } from './model';

const ciRef = z.object({ ciId: z.uuid(), number: z.number().int(), name: z.string() });
const relationshipRef = z.object({
  relationshipId: z.uuid(),
  sourceId: z.uuid(),
  targetId: z.uuid(),
  type: z.enum(RELATIONSHIP_TYPES),
});

/**
 * Configuration Management Database: configuration items (CIs) of typed classes, directional
 * relationships between them and impact analysis. ITSM reads its tables (`@isbp/module-cmdb/schema`).
 */
export const manifest = defineManifest({
  id: 'cmdb',
  version: '0.1.0',
  name: 'cmdb.meta.name',
  description: 'cmdb.meta.description',
  icon: 'network',
  navigation: [
    {
      id: 'cis',
      label: 'cmdb.nav.cis',
      href: '/cmdb',
      icon: 'network',
      permission: 'cmdb.cis.read',
      section: 'main',
      order: 40,
    },
  ],
  permissions: [
    { key: 'cmdb.cis.read', description: 'cmdb.permissions.cisRead' },
    { key: 'cmdb.cis.manage', description: 'cmdb.permissions.cisManage' },
    { key: 'cmdb.classes.manage', description: 'cmdb.permissions.classesManage' },
    { key: 'cmdb.services.read', description: 'cmdb.permissions.servicesRead' },
  ],
  roles: [
    {
      key: 'cmdb-service-reader',
      name: 'Business service reader',
      description:
        'See the list of business services, e.g. to name the affected service when reporting an issue (granted to everyone by default)',
      permissions: ['cmdb.services.read'],
      grantByDefault: true,
    },
    {
      key: 'cmdb-viewer',
      name: 'CMDB viewer',
      description: 'Browse configuration items, their relationships and impact analysis',
      permissions: ['cmdb.cis.read', 'cmdb.services.read'],
    },
    {
      key: 'cmdb-manager',
      name: 'CMDB manager',
      description: 'Create, edit, retire and delete configuration items, relationships and classes',
      permissions: ['cmdb.*'],
    },
  ],
  events: {
    emits: [
      {
        name: 'cmdb.ci.created',
        description: 'A configuration item was registered',
        schema: ciRef.extend({ classKey: z.string() }),
      },
      {
        name: 'cmdb.ci.updated',
        description: 'Fields of a configuration item changed (names of the changed fields)',
        schema: ciRef.extend({ changes: z.array(z.string()) }),
      },
      {
        name: 'cmdb.ci.retired',
        description: 'A configuration item was taken out of service',
        schema: ciRef,
      },
      { name: 'cmdb.ci.deleted', description: 'A configuration item was deleted', schema: ciRef },
      { name: 'cmdb.relationship.created', schema: relationshipRef },
      { name: 'cmdb.relationship.deleted', schema: relationshipRef },
    ],
    consumes: ['core.user.offboarded'],
  },
  ai: {
    tools: [
      {
        name: 'cmdb.find_cis',
        description:
          'Search the CMDB for configuration items (business services, applications, servers, databases, network devices…) by name or CI number such as CI-00042. Use it to identify the system a user or ticket is talking about before looking at its details or impact.',
        input: z.object({
          query: z.string().trim().min(1).max(200),
          classKey: z.string().max(64).optional(),
          limit: z.number().int().min(1).max(25).default(10),
        }),
        permission: 'cmdb.cis.read',
        readOnly: true,
      },
      {
        name: 'cmdb.get_ci',
        description:
          'Get one configuration item by id or CI number (e.g. CI-00042): class, status, environment, criticality, owner, support group and a summary of its relationships. Use it to learn who supports a system and what it is connected to.',
        input: z
          .object({ id: z.uuid().optional(), number: z.string().max(32).optional() })
          .refine((v) => Boolean(v.id) !== Boolean(v.number), 'Give either id or number'),
        permission: 'cmdb.cis.read',
        readOnly: true,
      },
      {
        name: 'cmdb.get_impact',
        description:
          'Impact analysis for a configuration item: which CIs and business services break if it fails (impacted, upstream) and what it depends on (dependsOn, downstream), up to 5 levels deep. Use it to assess the blast radius of an outage or a planned change.',
        input: z.object({
          ciId: z.uuid(),
          depth: z.number().int().min(1).max(MAX_IMPACT_DEPTH).default(3),
        }),
        permission: 'cmdb.cis.read',
        readOnly: true,
      },
    ],
  },
  search: { entities: ['ci'] },
  customFields: { entities: [{ type: 'ci', name: 'cmdb.entities.ci' }] },
  records: {
    types: [{ type: 'ci', name: 'cmdb.entities.ci', icon: 'network', permission: 'cmdb.cis.read' }],
  },
});
