import { createdAt, departments, groups, id, updatedAt, users } from '@isbp/db/schema';
import type { LocalizedText } from '@isbp/sdk';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { CiCriticality, CiEnvironment, CiStatus, RelationshipType } from '../model';

/**
 * All tables of this module live in the `cmdb` Postgres schema. Exported as `@isbp/module-cmdb/schema`:
 * modules that depend on the CMDB (ITSM) **read** these tables; they never write them.
 */
export const cmdbSchema = pgSchema('cmdb');

/** Human numbers: `CI-00042`. */
export const ciNumberSeq = cmdbSchema.sequence('ci_number_seq');

/** Kinds of CI. System classes are installed by migration and can't be deleted. */
export const ciClasses = cmdbSchema.table('ci_classes', {
  key: varchar('key', { length: 64 }).primaryKey(),
  name: jsonb('name').$type<LocalizedText>().notNull(),
  description: jsonb('description').$type<LocalizedText>(),
  /** lucide icon name (kebab-case). */
  icon: varchar('icon', { length: 64 }).notNull().default('box'),
  system: boolean('system').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(100),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const cis = cmdbSchema.table(
  'cis',
  {
    id: id(),
    number: bigint('number', { mode: 'number' })
      .notNull()
      .default(sql`nextval('cmdb.ci_number_seq')`),
    name: varchar('name', { length: 200 }).notNull(),
    classKey: varchar('class_key', { length: 64 })
      .notNull()
      .references(() => ciClasses.key, { onDelete: 'restrict', onUpdate: 'cascade' }),
    status: varchar('status', { length: 20 }).$type<CiStatus>().notNull().default('in_use'),
    environment: varchar('environment', { length: 20 }).$type<CiEnvironment>(),
    criticality: varchar('criticality', { length: 20 }).$type<CiCriticality>().notNull().default('medium'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    supportGroupId: uuid('support_group_id').references(() => groups.id, { onDelete: 'set null' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    description: text('description'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Custom fields (`cmdb.ci`), validated against `core.custom_fields`. */
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('cis_number_uq').on(t.number),
    index('cis_name_trgm').using('gin', t.name.op('gin_trgm_ops')),
    index('cis_name_idx').on(t.name),
    index('cis_class_status_idx').on(t.classKey, t.status),
    index('cis_owner_idx').on(t.ownerId),
    index('cis_support_group_idx').on(t.supportGroupId),
    index('cis_department_idx').on(t.departmentId),
    index('cis_updated_idx').on(t.updatedAt),
    index('cis_tags_gin').using('gin', t.tags),
    index('cis_attributes_gin').using('gin', t.attributes.op('jsonb_path_ops')),
  ],
);

/** `source —type→ target`, e.g. "ERP app depends on ERP database". */
export const ciRelationships = cmdbSchema.table(
  'ci_relationships',
  {
    id: id(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => cis.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => cis.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).$type<RelationshipType>().notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ci_relationships_uq').on(t.sourceId, t.targetId, t.type),
    index('ci_relationships_target_idx').on(t.targetId, t.type),
    check('ci_relationships_not_self', sql`${t.sourceId} <> ${t.targetId}`),
  ],
);
