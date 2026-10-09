import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';
import { aiFindAssetsInput } from './contracts';
import {
  ACCOUNT_STATES,
  ASSET_STATUSES,
  PASSWORD_REASONS,
  REVIEW_DECISIONS,
  STOCKTAKE_RESULTS,
} from './model';

const fact = (key: string) => `isms.recordFacts.${key}`;

/**
 * Approval facts of an information asset (`isms.asset` picked in a record field), so processes can route on what was
 * picked ("an asset of value 4 needs the security officer"). People are user ids, groups are group keys; codes are the
 * register's own (class `HW`, site `HQ01`, classification label key). Everyone who reads the asset sees them.
 */
export const assetFactsSchema = z.object({
  classCode: z.string().meta({ label: fact('classCode') }),
  subClass: z
    .string()
    .nullable()
    .meta({ label: fact('subClass') }),
  confidentiality: z
    .number()
    .int()
    .min(1)
    .max(4)
    .meta({ label: fact('confidentiality') }),
  integrity: z
    .number()
    .int()
    .min(1)
    .max(4)
    .meta({ label: fact('integrity') }),
  availability: z
    .number()
    .int()
    .min(1)
    .max(4)
    .meta({ label: fact('availability') }),
  value: z
    .number()
    .int()
    .min(1)
    .max(4)
    .meta({ label: fact('value') }),
  classification: z
    .string()
    .nullable()
    .meta({ label: fact('classification') }),
  managerId: z
    .uuid()
    .nullable()
    .meta({ label: fact('managerId'), ref: 'user' }),
  managerGroup: z
    .string()
    .nullable()
    .meta({ label: fact('managerGroup'), ref: 'group' }),
  siteCode: z.string().meta({ label: fact('siteCode') }),
  status: z.enum(ASSET_STATUSES).meta({ label: fact('status'), valueLabels: 'isms.assetStatus' }),
});
export type AssetFacts = z.infer<typeof assetFactsSchema>;

const assetRef = z.object({ assetId: z.uuid(), number: z.string(), name: z.string() });
const stocktakeRef = z.object({ stocktakeId: z.uuid(), reference: z.string(), name: z.string() });
const accountRef = z.object({ accountId: z.uuid(), reference: z.string(), accountName: z.string() });
const reviewRef = z.object({ reviewId: z.uuid(), reference: z.string(), target: z.string() });

/**
 * Information security (ISO 27001-style ISMS records): the information asset register with its configurable
 * classes, C/I/A scoring and classification labels; yearly stocktakes; shared accounts with their custodians and
 * members; and account reviews of any system.
 */
export const manifest = defineManifest({
  id: 'isms',
  version: '0.1.0',
  name: 'isms.meta.name',
  description: 'isms.meta.description',
  icon: 'shield-check',
  navigation: [
    {
      // People who only take part (a stocktake check, an account review, a password change) get it on My work.
      id: 'security',
      label: 'isms.nav.group',
      href: '/isms',
      icon: 'shield-check',
      section: 'main',
      order: 50,
      children: [
        {
          id: 'register',
          label: 'isms.nav.register',
          href: '/isms',
          icon: 'folder-lock',
          permission: 'isms.assets.read',
        },
        {
          id: 'stocktakes',
          label: 'isms.nav.stocktakes',
          href: '/isms/stocktakes',
          icon: 'clipboard-check',
          permission: ['isms.assets.read', 'isms.stocktakes.manage', 'isms.stocktakes.signoff'],
        },
        {
          id: 'accounts',
          label: 'isms.nav.accounts',
          href: '/isms/accounts',
          icon: 'key-square',
          permission: ['isms.accounts.read', 'isms.accounts.manage'],
        },
        {
          id: 'reviews',
          label: 'isms.nav.reviews',
          href: '/isms/reviews',
          icon: 'user-check',
          permission: ['isms.reviews.read', 'isms.reviews.manage', 'isms.reviews.signoff'],
        },
      ],
    },
    {
      id: 'settings',
      label: 'isms.nav.settings',
      description: 'isms.nav.settingsAbout',
      href: '/isms/settings',
      icon: 'shield-check',
      permission: 'isms.config.manage',
      section: 'admin',
      area: 'modules',
      order: 32,
    },
  ],
  work: [
    {
      key: 'stocktake-checks',
      label: 'isms.work.stocktakeChecks',
      kind: 'review',
      icon: 'clipboard-check',
      permission: 'isms.self.use',
    },
    {
      key: 'account-reviews',
      label: 'isms.work.accountReviews',
      kind: 'review',
      icon: 'user-check',
      permission: 'isms.self.use',
    },
    {
      key: 'password-changes',
      label: 'isms.work.passwordChanges',
      kind: 'todo',
      icon: 'key-square',
      permission: 'isms.self.use',
    },
  ],
  permissions: [
    { key: 'isms.assets.read', description: 'isms.permissions.assetsRead' },
    { key: 'isms.assets.manage', description: 'isms.permissions.assetsManage' },
    { key: 'isms.config.manage', description: 'isms.permissions.configManage' },
    { key: 'isms.stocktakes.manage', description: 'isms.permissions.stocktakesManage' },
    { key: 'isms.stocktakes.signoff', description: 'isms.permissions.stocktakesSignoff' },
    { key: 'isms.accounts.read', description: 'isms.permissions.accountsRead' },
    { key: 'isms.accounts.manage', description: 'isms.permissions.accountsManage' },
    { key: 'isms.reviews.read', description: 'isms.permissions.reviewsRead' },
    { key: 'isms.reviews.manage', description: 'isms.permissions.reviewsManage' },
    { key: 'isms.reviews.signoff', description: 'isms.permissions.reviewsSignoff' },
    { key: 'isms.self.use', description: 'isms.permissions.selfUse' },
  ],
  roles: [
    {
      key: 'isms-participant',
      name: 'Information security participant',
      description:
        'Check the assets you manage in stocktakes, decide account reviews given to you and look after the shared accounts you are custodian of (granted to everyone by default)',
      permissions: ['isms.self.use'],
      grantByDefault: true,
    },
    {
      key: 'isms-viewer',
      name: 'Information security viewer',
      description: 'Read the information asset register, stocktakes, shared accounts and account reviews',
      permissions: ['isms.assets.read', 'isms.accounts.read', 'isms.reviews.read', 'isms.self.use'],
    },
    {
      key: 'isms-asset-manager',
      name: 'Information asset manager',
      description: 'Maintain the information asset register, import and export it, and run stocktakes',
      permissions: [
        'isms.assets.read',
        'isms.assets.manage',
        'isms.stocktakes.manage',
        'isms.accounts.read',
        'isms.reviews.read',
        'isms.self.use',
      ],
    },
    {
      key: 'isms-security-officer',
      name: 'Information security officer',
      description:
        'Sign off stocktakes and account reviews, manage shared accounts and account reviews, and read the register',
      permissions: [
        'isms.assets.read',
        'isms.stocktakes.manage',
        'isms.stocktakes.signoff',
        'isms.accounts.read',
        'isms.accounts.manage',
        'isms.reviews.read',
        'isms.reviews.manage',
        'isms.reviews.signoff',
        'isms.self.use',
      ],
    },
    {
      key: 'isms-admin',
      name: 'Information security administrator',
      description: 'Everything in information security, including classes, sites and classification labels',
      permissions: ['isms.*'],
    },
  ],
  events: {
    emits: [
      {
        name: 'isms.asset.created',
        description: 'An information asset was registered (by hand, import or from another record)',
        schema: assetRef.extend({ classCode: z.string(), value: z.number().int() }),
      },
      {
        name: 'isms.asset.updated',
        description: 'Fields of an information asset changed (names of the changed fields)',
        schema: assetRef.extend({ changes: z.array(z.string()) }),
      },
      { name: 'isms.asset.deleted', schema: assetRef },
      {
        name: 'isms.taxonomy.changed',
        description: 'A class, site or classification label was created, changed, archived or restored',
        schema: z.object({
          kind: z.enum(['class', 'site', 'label']),
          id: z.uuid(),
          code: z.string(),
          op: z.enum(['created', 'updated', 'archived', 'restored']),
        }),
      },
      {
        name: 'isms.stocktake.created',
        schema: stocktakeRef.extend({ status: z.enum(['scheduled', 'open']), dueOn: z.string() }),
      },
      {
        name: 'isms.stocktake.started',
        description: 'In-scope assets were snapshotted as items for their managers',
        schema: stocktakeRef.extend({ items: z.number().int(), dueOn: z.string() }),
      },
      {
        name: 'isms.stocktake.item_recorded',
        schema: stocktakeRef.extend({
          itemId: z.uuid(),
          assetId: z.uuid().nullable(),
          result: z.enum(STOCKTAKE_RESULTS),
        }),
      },
      { name: 'isms.stocktake.signed_off', schema: stocktakeRef },
      { name: 'isms.stocktake.cancelled', schema: stocktakeRef },
      { name: 'isms.account.created', schema: accountRef },
      { name: 'isms.account.updated', schema: accountRef.extend({ changes: z.array(z.string()) }) },
      { name: 'isms.account.member_added', schema: accountRef.extend({ userId: z.uuid() }) },
      { name: 'isms.account.member_removed', schema: accountRef.extend({ userId: z.uuid() }) },
      {
        name: 'isms.account.password_change_due',
        description: 'A member left, moved or was removed: the custodian must change the password today',
        schema: accountRef.extend({ reason: z.enum(PASSWORD_REASONS), userId: z.uuid().nullable() }),
      },
      { name: 'isms.account.password_changed', schema: accountRef.extend({ changedOn: z.string() }) },
      {
        name: 'isms.account.reviewed',
        description: 'The yearly review confirmed the members',
        schema: accountRef.extend({ nextReviewOn: z.string() }),
      },
      {
        name: 'isms.review.created',
        schema: reviewRef.extend({
          reviewerId: z.uuid().nullable(),
          dueOn: z.string(),
          status: z.enum(['scheduled', 'open']),
        }),
      },
      {
        name: 'isms.review.started',
        description: 'A review was opened (now, or on its start date) and its reviewer told',
        schema: reviewRef.extend({
          reviewerId: z.uuid().nullable(),
          items: z.number().int(),
          dueOn: z.string(),
        }),
      },
      {
        name: 'isms.review.items_imported',
        schema: reviewRef.extend({ added: z.number().int(), updated: z.number().int() }),
      },
      {
        name: 'isms.review.item_decided',
        schema: reviewRef.extend({
          itemId: z.uuid(),
          decision: z.enum(REVIEW_DECISIONS),
          accountStatus: z.enum(ACCOUNT_STATES),
        }),
      },
      { name: 'isms.review.completed', schema: reviewRef },
      {
        name: 'isms.review.reopened',
        description: 'A completed review went back to its reviewer',
        schema: reviewRef,
      },
      { name: 'isms.review.signed_off', schema: reviewRef },
      { name: 'isms.review.cancelled', schema: reviewRef },
    ],
    // A member leaving or moving department makes the shared account's password due.
    consumes: ['core.user.offboarded', 'core.user.transferred'],
  },
  notifications: [
    { type: 'isms.stocktake.assigned', defaultChannels: ['inApp', 'email'] },
    { type: 'isms.stocktake.reminder', defaultChannels: ['inApp', 'email'] },
    { type: 'isms.stocktake.overdue', defaultChannels: ['inApp', 'email'] },
    { type: 'isms.stocktake.ready', defaultChannels: ['inApp'] },
    // A security control: custodians can't turn it off.
    { type: 'isms.account.password_change_due', defaultChannels: ['inApp', 'email'], mandatory: true },
    { type: 'isms.account.review_due', defaultChannels: ['inApp', 'email'] },
    { type: 'isms.review.assigned', defaultChannels: ['inApp', 'email'] },
    { type: 'isms.review.reminder', defaultChannels: ['inApp', 'email'] },
    { type: 'isms.review.overdue', defaultChannels: ['inApp', 'email'] },
    { type: 'isms.review.ready', defaultChannels: ['inApp'] },
  ],
  settings: [
    {
      key: 'reminders.daysBefore',
      label: 'isms.settings.reminderDays',
      description: 'isms.settings.reminderDaysHelp',
      type: 'number',
      default: 7,
    },
    {
      key: 'accounts.reviewMonths',
      label: 'isms.settings.reviewMonths',
      description: 'isms.settings.reviewMonthsHelp',
      type: 'number',
      default: 12,
    },
  ],
  customFields: { entities: [{ type: 'asset', name: 'isms.entities.asset' }] },
  records: {
    types: [
      {
        type: 'asset',
        name: 'isms.entities.asset',
        icon: 'shield-check',
        permission: 'isms.assets.read',
        facts: assetFactsSchema,
      },
      { type: 'account', name: 'isms.entities.account', icon: 'key-round', permission: 'isms.accounts.read' },
    ],
  },
  search: { entities: ['asset', 'account'] },
  ai: {
    tools: [
      {
        name: 'isms.find_assets',
        description:
          'Search the information asset register (ISO 27001 asset inventory) by asset number such as HQ01HW0001 or by name, optionally by class code (PE, HW, SW, DA, SV) or a minimum asset value (1-4). Returns number, name, class, manager, confidentiality/integrity/availability, asset value and classification label. Use it to answer questions about which assets exist and how valuable they are.',
        input: aiFindAssetsInput,
        permission: 'isms.assets.read',
        readOnly: true,
      },
    ],
  },
  /** What request forms can do with shared accounts once approved (`server/process-actions.ts`). */
  processActions: [
    {
      action: 'register-shared-account',
      name: 'isms.processActions.registerSharedAccount.name',
      description: 'isms.processActions.registerSharedAccount.description',
      icon: 'key-round',
      permission: 'isms.accounts.manage',
    },
  ],
  customizations: [
    {
      kind: 'asset-class',
      label: 'isms.kinds.assetClass',
      description:
        'A class of the information asset register (people, hardware, software, information, services …): its code used in asset numbers, its names, its sub-classes and the confidentiality/integrity/availability scoring guidance for scores 1-4',
      icon: 'shapes',
      readPermission: 'isms.assets.read',
      applyPermission: 'isms.config.manage',
      operations: ['create', 'update', 'archive'],
    },
  ],
  /** Ready-made processes an administrator installs as one change set (`server/packages`). */
  customizationPackages: [
    {
      key: 'isms-processes',
      name: 'isms.packages.processes.name',
      description: 'isms.packages.processes.description',
      icon: 'shield-check',
    },
  ],
});
