import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';
import {
  aiCreateDraftInput,
  aiGetArticleInput,
  aiSearchArticlesInput,
  articleAudienceSchema,
  articleLocaleSchema,
  articleSourceSchema,
  articleStatusSchema,
  DEFAULT_CLASSIFICATION_LEVELS,
} from './contracts';

const fact = (key: string) => `knowledge.recordFacts.${key}`;

/**
 * Approval facts of an article (`knowledge.article` picked in a record field), for workflows
 * (`records.<field>.<fact>`) and record-field filters.
 */
export const articleFactsSchema = z.object({
  audience: articleAudienceSchema.meta({ label: fact('audience'), valueLabels: 'knowledge.audience' }),
  categoryKey: z
    .string()
    .nullable()
    .meta({ label: fact('categoryKey') }),
  status: articleStatusSchema.meta({ label: fact('status'), valueLabels: 'knowledge.status' }),
  locale: articleLocaleSchema.meta({ label: fact('locale') }),
  ownerId: z
    .uuid()
    .nullable()
    .meta({ label: fact('ownerId'), ref: 'user' }),
  tags: z.array(z.string()).meta({ label: fact('tags') }),
  /** A key of `classification.levels` (built-in keys have labels under `knowledge.classificationLevel`). */
  classification: z
    .string()
    .nullable()
    .meta({ label: fact('classification'), valueLabels: 'knowledge.classificationLevel' }),
});
export type ArticleFacts = z.infer<typeof articleFactsSchema>;

const articleRef = z.object({
  articleId: z.uuid(),
  number: z.number().int(),
  reference: z.string(),
  title: z.string(),
});

/**
 * Knowledge Base: articles for agents and self-service, versioned on every publish, reviewed on a
 * schedule and published to the shared semantic index that Helpdesk AI uses for retrieval.
 */
export const manifest = defineManifest({
  id: 'knowledge',
  version: '0.1.0',
  name: 'knowledge.meta.name',
  description: 'knowledge.meta.description',
  icon: 'book-open',
  navigation: [
    {
      id: 'home',
      label: 'knowledge.nav.home',
      href: '/knowledge',
      icon: 'book-open',
      permission: 'knowledge.articles.read',
      section: 'main',
      order: 30,
      children: [
        {
          id: 'manage',
          label: 'knowledge.nav.manage',
          href: '/knowledge/manage',
          icon: 'notebook-pen',
          permission: 'knowledge.articles.write',
        },
        {
          id: 'categories',
          label: 'knowledge.nav.categories',
          href: '/knowledge/categories',
          icon: 'folder-tree',
          permission: 'knowledge.categories.manage',
        },
      ],
    },
  ],
  permissions: [
    { key: 'knowledge.articles.read', description: 'knowledge.permissions.read' },
    { key: 'knowledge.articles.read-internal', description: 'knowledge.permissions.readInternal' },
    { key: 'knowledge.articles.write', description: 'knowledge.permissions.write' },
    { key: 'knowledge.articles.publish', description: 'knowledge.permissions.publish' },
    { key: 'knowledge.categories.manage', description: 'knowledge.permissions.manageCategories' },
    // Phase 5: written by the Integrations Hub's agent (it holds `*.*.sync`), never by a role template.
    { key: 'knowledge.articles.sync', description: 'knowledge.permissions.sync' },
  ],
  roles: [
    {
      key: 'knowledge-reader',
      name: 'Knowledge reader',
      description: 'Read published self-service articles (granted to everyone by default)',
      permissions: ['knowledge.articles.read'],
      grantByDefault: true,
    },
    {
      key: 'knowledge-agent',
      name: 'Knowledge agent',
      description: 'Read internal articles, write drafts and submit them for review',
      permissions: [
        'knowledge.articles.read',
        'knowledge.articles.read-internal',
        'knowledge.articles.write',
      ],
    },
    {
      key: 'knowledge-editor',
      name: 'Knowledge editor',
      description: 'Publish, retire and restore articles, edit any article and manage categories',
      permissions: ['knowledge.*'],
    },
  ],
  events: {
    emits: [
      {
        name: 'knowledge.article.created',
        description: 'A draft was written (by a person or generated, e.g. from a resolved ticket)',
        schema: articleRef.extend({
          locale: articleLocaleSchema,
          audience: articleAudienceSchema,
          source: articleSourceSchema.nullable(),
        }),
      },
      {
        name: 'knowledge.article.updated',
        schema: articleRef.extend({ status: articleStatusSchema, changes: z.array(z.string()) }),
      },
      {
        name: 'knowledge.article.published',
        description: 'A version went live (first publish or an update of a published article)',
        schema: articleRef.extend({
          version: z.number().int(),
          locale: articleLocaleSchema,
          audience: articleAudienceSchema,
          categoryKey: z.string().nullable(),
        }),
      },
      { name: 'knowledge.article.retired', schema: articleRef },
      { name: 'knowledge.article.deleted', schema: articleRef },
      {
        name: 'knowledge.article.submitted',
        description: 'Sent for review; `instanceId` is set when an approval workflow decides',
        schema: articleRef.extend({ instanceId: z.uuid().nullable() }),
      },
    ],
    /** Our own lifecycle events keep the semantic index in sync after commit. */
    consumes: [
      'knowledge.article.published',
      'knowledge.article.updated',
      'knowledge.article.retired',
      'knowledge.article.deleted',
      'core.user.offboarded',
    ],
  },
  settings: [
    {
      key: 'reviewIntervalDays',
      label: 'knowledge.settings.reviewIntervalDays',
      type: 'number',
      default: 180,
    },
    {
      key: 'reminderRepeatDays',
      label: 'knowledge.settings.reminderRepeatDays',
      type: 'number',
      default: 7,
      advanced: true,
    },
    {
      key: 'classification.levels',
      label: 'knowledge.settings.classificationLevels',
      description: 'knowledge.settings.classificationLevelsHelp',
      type: 'text',
      default: DEFAULT_CLASSIFICATION_LEVELS,
    },
    {
      key: 'guide.publish',
      label: 'knowledge.settings.guidePublish',
      description: 'knowledge.settings.guidePublishHelp',
      type: 'boolean',
      default: true,
    },
  ],
  ai: {
    tools: [
      {
        name: 'knowledge.search_articles',
        description:
          'Search published knowledge-base articles (hybrid semantic + keyword, any language). Returns the best matches with a relevant snippet; only articles the caller may read.',
        input: aiSearchArticlesInput,
        permission: 'knowledge.articles.read',
        readOnly: true,
      },
      {
        name: 'knowledge.get_article',
        description:
          'Get one knowledge-base article (Markdown body) by id or reference such as KB-00042. Only articles the caller may read.',
        input: aiGetArticleInput,
        permission: 'knowledge.articles.read',
        readOnly: true,
      },
      {
        name: 'knowledge.create_draft',
        description:
          'Create a knowledge-base article as a draft owned by the caller (never published automatically), e.g. from a resolved ticket. Editors review it before it goes live.',
        input: aiCreateDraftInput,
        permission: 'knowledge.articles.write',
      },
    ],
  },
  search: { entities: ['article'] },
  portal: {
    entries: [
      {
        id: 'browse',
        label: 'knowledge.portal.browse.label',
        description: 'knowledge.portal.browse.description',
        icon: 'book-open',
        href: '/knowledge',
        permission: 'knowledge.articles.read',
        order: 30,
      },
    ],
  },
  workflows: [
    {
      key: 'knowledge.publish',
      name: 'knowledge.workflows.publish.name',
      description: 'knowledge.workflows.publish.description',
      subject: 'article',
      facts: z.object({
        article: z.object({
          audience: articleAudienceSchema,
          locale: articleLocaleSchema,
          categoryKey: z.string().nullable(),
        }),
      }),
    },
  ],
  notifications: [
    { type: 'knowledge.article.feedback', defaultChannels: ['inApp'] },
    { type: 'knowledge.article.review_due', defaultChannels: ['inApp', 'email'] },
    { type: 'knowledge.article.approved', defaultChannels: ['inApp', 'email'] },
    { type: 'knowledge.article.rejected', defaultChannels: ['inApp', 'email'] },
  ],
  /**
   * Articles kept in step with another knowledge base by the Integrations Hub (adapter in
   * `server/sync.ts`), matched on title. The sync writes and submits drafts; publishing needs the agent's
   * own publish permission and makes a version, and a review workflow still decides.
   */
  syncEntities: [
    {
      entity: 'article',
      name: 'knowledge.sync.entities.article',
      icon: 'book-open',
      permission: 'knowledge.articles.sync',
      events: [
        'knowledge.article.created',
        'knowledge.article.updated',
        'knowledge.article.submitted',
        'knowledge.article.published',
        'knowledge.article.retired',
      ],
    },
  ],
  records: {
    types: [
      {
        type: 'article',
        name: 'knowledge.entities.article',
        icon: 'book-open',
        permission: 'knowledge.articles.read',
        facts: articleFactsSchema,
      },
    ],
  },
});
