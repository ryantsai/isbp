import { defineManifest, type WorkflowGraph } from '@isbp/sdk';
import { z } from 'zod';
import {
  aiExpiringContractsInput,
  approvalStatusSchema,
  aiFindAssetsInput,
  aiGetAssetInput,
  aiLicenseComplianceInput,
  assetCategorySchema,
  assetStatusSchema,
  complianceStateSchema,
  SECURITY_SIGN_OFF_STEP,
  wipeMethodSchema,
} from './contracts';

import { ASSET_CATEGORIES, ASSET_STATUSES, COMPLIANCE_STATES, LICENSE_BILLING, LICENSE_TYPES } from './model';

const fact = (key: string) => `itam.recordFacts.${key}`;

/**
 * Approval facts of an asset (`itam.asset` picked in a record field), for workflows (`records.<field>.<fact>`) and
 * record-field filters. People are user ids.
 */
export const assetFactsSchema = z.object({
  category: z.enum(ASSET_CATEGORIES).meta({ label: fact('category'), valueLabels: 'itam.category' }),
  status: z.enum(ASSET_STATUSES).meta({ label: fact('status'), valueLabels: 'itam.status' }),
  dataBearing: z.boolean().meta({ label: fact('dataBearing') }),
  assigneeId: z
    .uuid()
    .nullable()
    .meta({ label: fact('assigneeId'), ref: 'user' }),
  departmentCode: z
    .string()
    .nullable()
    .meta({ label: fact('departmentCode') }),
  location: z
    .string()
    .nullable()
    .meta({ label: fact('location') }),
  warrantyEnd: z.iso
    .date()
    .nullable()
    .meta({ label: fact('warrantyEnd') }),
  /** A returned device's pending data wipe (cleared by "Record data wipe"). */
  wipeDue: z.iso
    .date()
    .nullable()
    .meta({ label: fact('wipeDue') }),
});
export type AssetFacts = z.infer<typeof assetFactsSchema>;

/** Approval facts of a licence (`itam.license`). */
export const licenseFactsSchema = z.object({
  product: z.string().meta({ label: fact('product') }),
  publisher: z
    .string()
    .nullable()
    .meta({ label: fact('publisher') }),
  licenseType: z.enum(LICENSE_TYPES).meta({ label: fact('licenseType'), valueLabels: 'itam.licenseType' }),
  billing: z.enum(LICENSE_BILLING).meta({ label: fact('billing'), valueLabels: 'itam.billing' }),
  complianceState: z
    .enum(COMPLIANCE_STATES)
    .meta({ label: fact('complianceState'), valueLabels: 'itam.compliance' }),
  quantity: z
    .number()
    .int()
    .nullable()
    .meta({ label: fact('quantity') }),
  cost: z
    .number()
    .nullable()
    .meta({ label: fact('cost') }),
  endDate: z.iso
    .date()
    .nullable()
    .meta({ label: fact('endDate') }),
});
export type LicenseFacts = z.infer<typeof licenseFactsSchema>;

const assetRef = z.object({ assetId: z.uuid(), tag: z.string(), name: z.string() });
const licenseRef = z.object({ licenseId: z.uuid(), reference: z.string(), product: z.string() });
const contractRef = z.object({ contractId: z.uuid(), reference: z.string(), title: z.string() });
const titleRuleRef = z.object({ ruleId: z.uuid(), title: z.string(), licenseId: z.uuid().nullable() });
const approvedSoftwareRef = z.object({ entryId: z.uuid(), title: z.string(), status: approvalStatusSchema });

/**
 * Facts the disposal workflow decides on (`asset.dataBearing`, `asset.bookValue`, …). The asset's custom fields
 * come along as `attributes.<key>` and `records.<key>.<fact>` (`customFieldEntity` on the trigger), hence `loose()`.
 */
export const disposalFactsSchema = z
  .object({
    asset: z.object({
      category: assetCategorySchema,
      dataBearing: z.boolean().describe('Laptop, desktop, server, storage, phone or tablet'),
      bookValue: z.number().describe('Straight-line book value today (0 when unknown or fully depreciated)'),
      ageMonths: z.number().int().describe('Whole months since purchase'),
    }),
  })
  .loose();

/**
 * Disposal: an asset manager approves; data-bearing devices that still carry book value (or are under
 * five years old) also need the information security team's sign-off that the storage was wiped or
 * destroyed. The disposal dialog previews whichever workflow is bound, so its notice follows the admin's graph.
 */
const disposalGraph: WorkflowGraph = {
  steps: [
    {
      id: 'asset-manager',
      type: 'approval',
      name: { en: 'Asset manager approval', 'zh-TW': '資產管理員簽核', 'ja-JP': '資産マネージャーの承認' },
      approvers: [
        {
          type: 'role',
          roleKey: 'itam-asset-manager',
          fallback: { type: 'role', roleKey: 'itam-admin' },
        },
      ],
      mode: 'any',
      sla: { dueHours: 72, remindHours: 48, onBreach: 'notify' },
    },
    {
      id: SECURITY_SIGN_OFF_STEP,
      type: 'approval',
      name: {
        en: 'Information security sign-off',
        'zh-TW': '資訊安全簽核',
        'ja-JP': '情報セキュリティの承認',
      },
      when: {
        all: [
          { fact: 'asset.dataBearing', op: 'eq', value: true },
          {
            any: [
              { fact: 'asset.bookValue', op: 'gt', value: 0 },
              { fact: 'asset.ageMonths', op: 'lt', value: 60 },
            ],
          },
        ],
      },
      approvers: [
        { type: 'group', groupKey: 'security-team', fallback: { type: 'role', roleKey: 'itam-admin' } },
      ],
      mode: 'any',
      instructions: {
        en: 'Confirm the storage was securely wiped (NIST 800-88) or physically destroyed before you approve.',
        'zh-TW': '核准前請確認儲存裝置已安全抹除（NIST 800-88）或已實體銷毀。',
        'ja-JP':
          '承認する前に、ストレージが安全に消去 (NIST 800-88) または物理的に破壊されたことを確認してください。',
      },
      sla: { dueHours: 72, remindHours: 48, onBreach: 'notify' },
    },
  ],
};

/**
 * IT asset management: hardware through its lifecycle, software licences (entitlement vs usage and
 * compliance), contracts with renewal reminders, and vendors. The id is `itam` because `assets` is a
 * reserved URL; people see "Assets".
 */
export const manifest = defineManifest({
  id: 'itam',
  version: '0.1.0',
  name: 'itam.meta.name',
  description: 'itam.meta.description',
  icon: 'package',
  dependsOn: ['cmdb'],
  navigation: [
    {
      // Everyone's own devices: a personal entry, right after Requests.
      id: 'mine',
      label: 'itam.nav.mine',
      href: '/itam/mine',
      icon: 'laptop',
      permission: 'itam.self.read',
      section: 'main',
      order: 3,
    },
    {
      id: 'assets',
      label: 'itam.nav.group',
      href: '/itam',
      icon: 'package',
      section: 'main',
      order: 42,
      children: [
        {
          id: 'overview',
          label: 'itam.nav.overview',
          href: '/itam',
          icon: 'gauge',
          permission: 'itam.hardware.read',
        },
        {
          id: 'hardware',
          label: 'itam.nav.hardware',
          href: '/itam/hardware',
          icon: 'monitor-smartphone',
          permission: 'itam.hardware.read',
        },
        {
          // Licences, the approved-software list and discovery are one area with section tabs.
          id: 'software',
          label: 'itam.nav.software',
          href: '/itam/software',
          icon: 'key-round',
          permission: 'itam.software.read',
          tabs: [
            {
              id: 'approved-software',
              label: 'itam.nav.approvedSoftware',
              href: '/itam/approved-software',
              icon: 'list-checks',
              permission: 'itam.software.read',
            },
            {
              // Software reports from inventory tools and CSV imports: the same permission as the discovery API.
              id: 'discovery',
              label: 'itam.nav.discovery',
              href: '/itam/discovery',
              icon: 'radar',
              permission: 'itam.hardware.manage',
            },
          ],
        },
        {
          id: 'contracts',
          label: 'itam.nav.contracts',
          href: '/itam/contracts',
          icon: 'file-text',
          permission: 'itam.contracts.read',
          tabs: [
            {
              // Every role that manages vendors (asset and contract managers) also reads contracts.
              id: 'vendors',
              label: 'itam.nav.vendors',
              href: '/itam/vendors',
              icon: 'building',
              permission: 'itam.contracts.read',
            },
          ],
        },
      ],
    },
    {
      id: 'settings',
      label: 'itam.nav.settings',
      description: 'itam.nav.settingsAbout',
      href: '/itam/settings',
      icon: 'package',
      permission: 'itam.config.manage',
      section: 'admin',
      area: 'modules',
      order: 31,
    },
  ],
  permissions: [
    {
      key: 'itam.hardware.read',
      description: 'itam.permissions.hardwareRead',
      scopes: ['global', 'department'],
    },
    { key: 'itam.hardware.manage', description: 'itam.permissions.hardwareManage' },
    { key: 'itam.software.read', description: 'itam.permissions.softwareRead' },
    { key: 'itam.software.manage', description: 'itam.permissions.softwareManage' },
    { key: 'itam.licenses.reveal', description: 'itam.permissions.licensesReveal' },
    { key: 'itam.contracts.read', description: 'itam.permissions.contractsRead' },
    { key: 'itam.contracts.manage', description: 'itam.permissions.contractsManage' },
    { key: 'itam.self.read', description: 'itam.permissions.selfRead' },
    { key: 'itam.config.manage', description: 'itam.permissions.configManage' },
    // Phase 5: written by the Integrations Hub's agent (it holds `*.*.sync`), never by a role template.
    { key: 'itam.assets.sync', description: 'itam.permissions.assetsSync' },
  ],
  roles: [
    {
      key: 'itam-self',
      name: 'My devices',
      description: 'See the devices and software assigned to you (granted to everyone by default)',
      permissions: ['itam.self.read'],
      grantByDefault: true,
    },
    {
      key: 'itam-viewer',
      name: 'Asset viewer',
      description: 'Browse hardware, software licences and contracts',
      permissions: ['itam.hardware.read', 'itam.software.read', 'itam.contracts.read', 'itam.self.read'],
    },
    {
      key: 'itam-asset-manager',
      name: 'Asset manager',
      description:
        'Manage hardware and software licences, reveal licence keys, maintain the model catalogue and vendors; approves disposals',
      permissions: [
        'itam.hardware.*',
        'itam.software.*',
        'itam.licenses.reveal',
        'itam.config.manage',
        'itam.contracts.read',
        'itam.self.read',
      ],
    },
    {
      key: 'itam-contract-manager',
      name: 'Contract manager',
      description:
        'Manage contracts and their renewals, and vendors; see the hardware and software they cover',
      permissions: [
        'itam.contracts.*',
        'itam.config.manage',
        'itam.software.read',
        'itam.hardware.read',
        'itam.self.read',
      ],
    },
    {
      key: 'itam-admin',
      name: 'Asset administrator',
      description: 'Everything in asset management',
      permissions: ['itam.*'],
    },
  ],
  events: {
    emits: [
      {
        name: 'itam.asset.created',
        description: 'A hardware asset was registered',
        schema: assetRef.extend({ category: assetCategorySchema, status: assetStatusSchema }),
      },
      {
        name: 'itam.asset.updated',
        description: 'Fields of an asset changed (names of the changed fields)',
        schema: assetRef.extend({ changes: z.array(z.string()) }),
      },
      {
        name: 'itam.asset.status_changed',
        schema: assetRef.extend({ from: assetStatusSchema, to: assetStatusSchema }),
      },
      {
        name: 'itam.asset.assigned',
        description: 'An asset was handed to a person',
        schema: assetRef.extend({ userId: z.uuid(), previousUserId: z.uuid().nullable() }),
      },
      {
        name: 'itam.asset.returned',
        schema: assetRef.extend({ userId: z.uuid().nullable(), toStatus: assetStatusSchema }),
      },
      {
        name: 'itam.asset.disposed',
        description: 'Disposal was approved; the asset is gone',
        schema: assetRef.extend({ instanceId: z.uuid().nullable() }),
      },
      {
        name: 'itam.asset.data_wiped',
        description: "A device's storage was wiped (Record data wipe); its pending wipe is cleared",
        schema: assetRef.extend({ method: wipeMethodSchema, wipedAt: z.string() }),
      },
      { name: 'itam.license.created', schema: licenseRef },
      { name: 'itam.license.updated', schema: licenseRef.extend({ changes: z.array(z.string()) }) },
      {
        name: 'itam.license.compliance_changed',
        schema: licenseRef.extend({ from: complianceStateSchema, to: complianceStateSchema }),
      },
      { name: 'itam.contract.created', schema: contractRef },
      { name: 'itam.contract.updated', schema: contractRef.extend({ changes: z.array(z.string()) }) },
      {
        name: 'itam.contract.renewed',
        schema: contractRef.extend({
          startDate: z.string().nullable(),
          endDate: z.string(),
          automatic: z.boolean(),
        }),
      },
      { name: 'itam.contract.expired', schema: contractRef.extend({ endDate: z.string() }) },
      {
        name: 'itam.title-rule.created',
        description:
          'A discovered software title was mapped to a licence (licenseId) or ignored (licenseId null)',
        schema: titleRuleRef,
      },
      {
        name: 'itam.title-rule.deleted',
        description: 'A title rule was removed: the title is matched by name again',
        schema: titleRuleRef,
      },
      {
        name: 'itam.approved-software.created',
        description: 'A title was added to the approved-software list (allowed or blocked)',
        schema: approvedSoftwareRef,
      },
      {
        name: 'itam.approved-software.updated',
        description: 'An approved-software entry changed (scope, validity, status…)',
        schema: approvedSoftwareRef,
      },
      { name: 'itam.approved-software.deleted', schema: approvedSoftwareRef },
    ],
    consumes: ['core.user.offboarded'],
  },
  settings: [
    {
      key: 'currency',
      label: 'itam.settings.currency',
      description: 'itam.settings.currencyHelp',
      type: 'string',
      default: 'TWD',
    },
    {
      key: 'reminders.warrantyDays',
      label: 'itam.settings.warrantyDays',
      description: 'itam.settings.warrantyDaysHelp',
      type: 'number',
      default: 30,
    },
    {
      key: 'wipe.months',
      label: 'itam.settings.wipeMonths',
      description: 'itam.settings.wipeMonthsHelp',
      type: 'number',
      default: 2,
    },
    {
      key: 'wipe.remindDays',
      label: 'itam.settings.wipeRemindDays',
      description: 'itam.settings.wipeRemindDaysHelp',
      type: 'number',
      default: 7,
      advanced: true,
    },
    {
      key: 'compliance.underUsedPercent',
      label: 'itam.settings.underUsedPercent',
      description: 'itam.settings.underUsedPercentHelp',
      type: 'number',
      default: 60,
      advanced: true,
    },
  ],
  ai: {
    tools: [
      {
        name: 'itam.find_assets',
        description:
          'Search hardware assets (laptops, phones, monitors, servers, network gear…) the caller can see, by asset tag such as AST-00042, serial number or name, optionally by the person it is assigned to or by lifecycle status. Returns tag, model, status, assignee, location and warranty end.',
        input: aiFindAssetsInput,
        permission: 'itam.hardware.read',
        readOnly: true,
      },
      {
        name: 'itam.get_asset',
        description:
          'Get one hardware asset by id, asset tag (AST-00042) or serial number: model, status, assignee, location, purchase and warranty, book value, the linked CMDB configuration item and recent lifecycle history.',
        input: aiGetAssetInput,
        permission: 'itam.hardware.read',
        readOnly: true,
      },
      {
        name: 'itam.my_assets',
        description:
          "List the devices (laptop, phone, monitor…) and software licences assigned to the caller, with asset tags, serial numbers and warranty. Use it to answer 'which laptop do I have?' or to identify the device a user reports a problem with.",
        input: z.object({}),
        permission: 'itam.self.read',
        readOnly: true,
      },
      {
        name: 'itam.license_compliance',
        description:
          'Software licence compliance: entitlements versus seats in use, unlicensed installs and the compliance state (compliant, over_deployed, under_used, expiring, expired) per licence, optionally for one product.',
        input: aiLicenseComplianceInput,
        permission: 'itam.software.read',
        readOnly: true,
      },
      {
        name: 'itam.expiring_contracts',
        description:
          'Contracts (support, maintenance, leases, subscriptions…) ending within the next N days (default 90), with vendor, end date, notice date, auto-renewal and annual cost.',
        input: aiExpiringContractsInput,
        permission: 'itam.contracts.read',
        readOnly: true,
      },
    ],
  },
  search: { entities: ['asset', 'license', 'contract'] },
  portal: {
    entries: [
      {
        id: 'my-devices',
        label: 'itam.portal.myDevices',
        description: 'itam.portal.myDevicesDescription',
        icon: 'laptop',
        href: '/itam/mine',
        permission: 'itam.self.read',
        order: 20,
      },
    ],
  },
  workflows: [
    {
      key: 'itam.disposal',
      name: 'itam.workflows.disposal.name',
      description: 'itam.workflows.disposal.description',
      subject: 'asset',
      facts: disposalFactsSchema,
      customFieldEntity: 'itam.asset',
      required: true,
      defaultGraph: disposalGraph,
    },
  ],
  notifications: [
    { type: 'itam.asset.assigned', defaultChannels: ['inApp', 'email'] },
    { type: 'itam.license.non_compliant', defaultChannels: ['inApp', 'email'] },
    { type: 'itam.contract.renewal_due', defaultChannels: ['inApp', 'email'] },
    { type: 'itam.warranty.expiring', defaultChannels: ['inApp'] },
    { type: 'itam.offboarding.return', defaultChannels: ['inApp', 'email'] },
    { type: 'itam.wipe.due', defaultChannels: ['inApp', 'email'] },
    { type: 'itam.approved-software.expiring', defaultChannels: ['inApp'] },
  ],
  customFields: {
    entities: [
      { type: 'asset', name: 'itam.entities.asset' },
      { type: 'contract', name: 'itam.entities.contract' },
    ],
  },
  /**
   * Hardware kept in step with other asset systems by the Integrations Hub (adapter in `server/sync.ts`),
   * matched on serial number. The lifecycle applies; `disposed` only through the disposal approval.
   */
  syncEntities: [
    {
      entity: 'asset',
      name: 'itam.sync.entities.asset',
      icon: 'laptop',
      permission: 'itam.assets.sync',
      events: [
        'itam.asset.created',
        'itam.asset.updated',
        'itam.asset.status_changed',
        'itam.asset.assigned',
        'itam.asset.returned',
        'itam.asset.disposed',
      ],
    },
  ],
  records: {
    types: [
      {
        type: 'asset',
        name: 'itam.entities.asset',
        icon: 'laptop',
        permission: 'itam.hardware.read',
        facts: assetFactsSchema,
      },
      {
        type: 'license',
        name: 'itam.entities.license',
        icon: 'key-round',
        permission: 'itam.software.read',
        facts: licenseFactsSchema,
      },
      {
        type: 'contract',
        name: 'itam.entities.contract',
        icon: 'file-text',
        permission: 'itam.contracts.read',
      },
    ],
  },
  /** What request forms can do here after they are sent or decided (handlers in `server/process-actions.ts`). */
  processActions: [
    {
      action: 'approve-software',
      name: 'itam.processActions.approveSoftware.name',
      description: 'itam.processActions.approveSoftware.description',
      icon: 'list-checks',
      permission: 'itam.software.manage',
    },
    {
      action: 'assign-asset',
      name: 'itam.processActions.assignAsset.name',
      description: 'itam.processActions.assignAsset.description',
      icon: 'user-plus',
      permission: 'itam.hardware.manage',
    },
    {
      action: 'return-asset',
      name: 'itam.processActions.returnAsset.name',
      description: 'itam.processActions.returnAsset.description',
      icon: 'undo-2',
      permission: 'itam.hardware.manage',
    },
  ],
});
