/**
 * Demo application portfolio of a mid-size Taiwanese company (Taipei HQ, a Hsinchu plant, a Kaohsiung
 * warehouse, a Tokyo sales office): ~14 applications aligned with the CMDB's application CIs, their
 * environments and Azure DevOps repositories, ~40 releases and ~250 deployments over the last 120 days.
 *
 * Deterministic (seeded PRNG; dates relative to today). Historical production deployments are inserted
 * directly with plausible change references — the change policy applies to new requests, not to history.
 * The lead's cross-module seed links releases to changes **by application code and version**: keep the
 * codes and versions below stable.
 */
import { departments, groups, users } from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import { formatTicketRef } from '@isbp/module-itsm/contracts';
import { changes, tickets } from '@isbp/module-itsm/schema';
import type { ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type {
  AppStage,
  Criticality,
  DataClassification,
  DeploymentStatus,
  Disposition,
  EnvironmentKind,
  Hosting,
  ReleaseStatus,
} from '../model';
import { refreshEnvironment } from './deployments';
import { applications, deployments, environments, releases, repositories } from './schema';

type Dept =
  'IT' | 'IT-INFRA' | 'IT-SD' | 'IT-APP' | 'IT-SEC' | 'IT-DATA' | 'HR' | 'FIN' | 'SALES-TPE' | 'OPS';

interface SeedEnv {
  name: string;
  kind: EnvironmentKind;
  url?: string;
  /** CMDB CI name (skipped when missing). */
  ci?: string;
}

interface SeedApp {
  code: string;
  name: string;
  description: string;
  stage: AppStage;
  criticality: Criticality;
  disposition?: Disposition;
  hosting: Hosting;
  vendor?: string;
  /** CMDB CI name of the application (skipped when missing). */
  ci?: string;
  /** The n-th active person of a department, by username (stable on every fresh seed). */
  businessOwner?: [Dept, number];
  technicalOwner?: [Dept, number];
  team: string;
  department: Dept;
  techStack: string[];
  docs?: string;
  classification: DataClassification;
  goLive?: string;
  retire?: string;
  envs: SeedEnv[];
  /** Azure DevOps project / repository names. */
  repos?: { project: string; name: string; branch?: string; commit?: { message: string; daysAgo: number } }[];
  /** Production deployments by hand (the technical owner) rather than by the pipeline. */
  manualProduction?: boolean;
}

const ADO = 'https://devops.example.com/DefaultCollection';
const STD = (host: string, prodCi?: string, testCi?: string): SeedEnv[] => [
  { name: 'Development', kind: 'development', url: `https://${host}-dev.corp.example.com` },
  { name: 'Test', kind: 'test', url: `https://${host}-test.corp.example.com`, ci: testCi },
  { name: 'Staging', kind: 'staging', url: `https://${host}-stg.corp.example.com` },
  { name: 'Production', kind: 'production', url: `https://${host}.corp.example.com`, ci: prodCi },
];

/** Codes and names are stable: other seeds and the e2e suite rely on them. */
export const APPS: SeedApp[] = [
  {
    code: 'erp',
    name: 'Finance ERP',
    description:
      'General ledger, accounts payable and receivable, purchasing and month-end close for all entities (Taiwan and Japan).\n\n' +
      '- **Users:** Finance (Taipei, Tokyo), Procurement, Operations\n' +
      '- **Integrations:** HR Portal (cost centres), Warehouse Management (goods receipts), bank file exchange\n' +
      '- **Change freeze:** the last three working days of each month (closing)',
    stage: 'production',
    criticality: 'critical',
    disposition: 'invest',
    hosting: 'on_prem',
    ci: 'ERP Application',
    businessOwner: ['FIN', 0],
    technicalOwner: ['IT-APP', 2],
    team: 'dev-team',
    department: 'FIN',
    techStack: ['Java 21', 'Spring Boot', 'PostgreSQL 16', 'RHEL 9'],
    docs: 'https://wiki.corp.example.com/apps/erp',
    classification: 'confidential',
    goLive: '2019-04-01',
    envs: [
      ...STD('erp', 'erp-app-01', 'erp-app-test-01'),
      { name: 'Disaster Recovery', kind: 'dr', url: 'https://erp-dr.corp.example.com' },
    ],
    repos: [
      {
        project: 'ERP',
        name: 'erp-core',
        commit: { message: 'Merge v12 ledger migration scripts', daysAgo: 2 },
      },
      {
        project: 'ERP',
        name: 'erp-reports',
        commit: { message: 'AP ageing report: Excel export fix', daysAgo: 9 },
      },
    ],
    manualProduction: true,
  },
  {
    code: 'hr-portal',
    name: 'HR Portal',
    description:
      'Self-service leave requests, payslips, personal data and onboarding tasks for every employee (人資入口網站).',
    stage: 'production',
    criticality: 'high',
    disposition: 'tolerate',
    hosting: 'on_prem',
    ci: 'HR Portal Application',
    businessOwner: ['HR', 0],
    technicalOwner: ['IT-APP', 1],
    team: 'dev-team',
    department: 'HR',
    techStack: ['ASP.NET Core 8', 'SQL Server 2022', 'Windows Server 2022'],
    docs: 'https://wiki.corp.example.com/apps/hr-portal',
    classification: 'restricted',
    goLive: '2021-09-01',
    envs: STD('hr', 'hr-app-01'),
    repos: [
      {
        project: 'HR',
        name: 'hr-portal',
        commit: { message: 'Leave balance: include carry-over days', daysAgo: 4 },
      },
    ],
  },
  {
    code: 'corp-web',
    name: 'Corporate Website',
    description: 'Public website, product pages and the careers site, published from a headless CMS.',
    stage: 'production',
    criticality: 'medium',
    disposition: 'invest',
    hosting: 'cloud',
    ci: 'Website CMS',
    businessOwner: ['SALES-TPE', 0],
    technicalOwner: ['IT-APP', 3],
    team: 'dev-team',
    department: 'SALES-TPE',
    techStack: ['Next.js', 'TypeScript', 'Headless CMS', 'Azure Static Web Apps'],
    docs: 'https://wiki.corp.example.com/apps/corp-web',
    classification: 'public',
    goLive: '2023-03-15',
    envs: [
      { name: 'Development', kind: 'development', url: 'https://dev.www.example.com' },
      { name: 'Test', kind: 'test', url: 'https://test.www.example.com' },
      { name: 'Staging', kind: 'staging', url: 'https://staging.www.example.com' },
      { name: 'Production', kind: 'production', url: 'https://www.example.com' },
    ],
    repos: [
      {
        project: 'Web',
        name: 'corp-web',
        commit: { message: 'Careers: new Hsinchu openings page', daysAgo: 1 },
      },
      { project: 'Web', name: 'corp-web-content-models' },
    ],
  },
  {
    code: 'exchange',
    name: 'Exchange Online',
    description:
      'Mailboxes, calendars and transport rules in Microsoft 365. Configuration changes go through the change process.',
    stage: 'production',
    criticality: 'high',
    disposition: 'tolerate',
    hosting: 'saas',
    vendor: 'Microsoft',
    ci: 'Exchange Online',
    businessOwner: ['IT', 0],
    technicalOwner: ['IT-APP', 0],
    team: 'it-admins',
    department: 'IT',
    techStack: ['Microsoft 365', 'Exchange Online PowerShell'],
    docs: 'https://wiki.corp.example.com/apps/exchange',
    classification: 'confidential',
    goLive: '2020-07-01',
    envs: [{ name: 'Production', kind: 'production', url: 'https://outlook.office.com' }],
    repos: [{ project: 'Workplace', name: 'm365-config' }],
    manualProduction: true,
  },
  {
    code: 'vpn',
    name: 'Remote Access VPN',
    description: 'SSL VPN portal and gateways with SAML sign-in and MFA for staff working remotely.',
    stage: 'production',
    criticality: 'critical',
    disposition: 'tolerate',
    hosting: 'on_prem',
    ci: 'VPN Gateway Service',
    businessOwner: ['IT', 0],
    technicalOwner: ['IT-INFRA', 0],
    team: 'network-team',
    department: 'IT',
    techStack: ['SSL VPN appliance', 'SAML 2.0', 'RADIUS'],
    classification: 'internal',
    goLive: '2020-03-20',
    envs: [
      { name: 'Lab', kind: 'test', url: 'https://vpn-lab.corp.example.com' },
      { name: 'Production', kind: 'production', url: 'https://vpn.example.com', ci: 'vpn-gw-01' },
    ],
    repos: [{ project: 'Network', name: 'vpn-config' }],
    manualProduction: true,
  },
  {
    code: 'service-desk',
    name: 'IS Big Platform',
    description:
      'The internal IT platform: service desk, approvals, CMDB, knowledge base, assets, projects and this very application inventory. Yes, it tracks its own releases.',
    stage: 'production',
    criticality: 'high',
    disposition: 'invest',
    hosting: 'on_prem',
    ci: 'IS Big Platform',
    businessOwner: ['IT-SD', 1],
    technicalOwner: ['IT-APP', 0],
    team: 'dev-team',
    department: 'IT',
    techStack: ['TypeScript', 'Fastify', 'Next.js', 'PostgreSQL 17', 'Redis'],
    docs: 'https://wiki.corp.example.com/apps/isbp',
    classification: 'confidential',
    goLive: '2025-11-03',
    envs: STD('isbp', 'tpe-app-01'),
    repos: [
      {
        project: 'ISBP',
        name: 'isbp',
        commit: { message: 'Phase 3: application lifecycle module', daysAgo: 0 },
      },
    ],
  },
  {
    code: 'intranet',
    name: 'Intranet',
    description:
      'The legacy intranet (news, forms, phone book). Content is moving to the new portal; switch-off at year end.',
    stage: 'sunsetting',
    criticality: 'low',
    disposition: 'migrate',
    hosting: 'on_prem',
    businessOwner: ['IT', 1],
    technicalOwner: ['IT-APP', 4],
    team: 'dev-team',
    department: 'IT',
    techStack: ['SharePoint 2013', 'Windows Server 2012 R2'],
    classification: 'internal',
    goLive: '2014-06-01',
    retire: '2026-12-31',
    envs: [
      {
        name: 'Production',
        kind: 'production',
        url: 'https://intranet.corp.example.com',
        ci: 'old-intranet-01',
      },
    ],
    repos: [{ project: 'Legacy', name: 'intranet-customizations' }],
    manualProduction: true,
  },
  {
    code: 'data-warehouse',
    name: 'Data Warehouse',
    description:
      'Consolidated finance, sales and operations data for management reporting. Replaces the spreadsheet packs in 2027.',
    stage: 'development',
    criticality: 'medium',
    disposition: 'invest',
    hosting: 'cloud',
    businessOwner: ['FIN', 1],
    technicalOwner: ['IT-DATA', 0],
    team: 'dba-team',
    department: 'IT-DATA',
    techStack: ['dbt', 'Azure Synapse', 'Power BI', 'Python'],
    classification: 'confidential',
    goLive: '2027-03-01',
    envs: [
      { name: 'Development', kind: 'development', url: 'https://dw-dev.corp.example.com' },
      { name: 'Test', kind: 'test', url: 'https://dw-test.corp.example.com' },
    ],
    repos: [
      {
        project: 'Data',
        name: 'dw-pipelines',
        commit: { message: 'Sales fact: add Tokyo entity', daysAgo: 3 },
      },
      { project: 'Data', name: 'dw-models' },
    ],
  },
  {
    code: 'mobile-app',
    name: 'Field Service Mobile App',
    description:
      'Mobile app for field engineers: work orders, parts lookup and customer sign-off, offline first.',
    stage: 'planned',
    criticality: 'medium',
    hosting: 'cloud',
    businessOwner: ['OPS', 0],
    technicalOwner: ['IT-APP', 5],
    team: 'dev-team',
    department: 'OPS',
    techStack: ['React Native', 'TypeScript'],
    classification: 'internal',
    goLive: '2027-06-01',
    envs: [{ name: 'Development', kind: 'development' }],
    repos: [{ project: 'Mobile', name: 'field-service-app' }],
  },
  {
    code: 'legacy-crm',
    name: 'Legacy CRM',
    description:
      'The old on-premises CRM, replaced by Sales CRM. Kept read-only until the data was archived; now switched off.',
    stage: 'retired',
    criticality: 'low',
    disposition: 'eliminate',
    hosting: 'on_prem',
    businessOwner: ['SALES-TPE', 1],
    team: 'dev-team',
    department: 'SALES-TPE',
    techStack: ['Classic ASP', 'SQL Server 2008'],
    classification: 'confidential',
    goLive: '2011-01-10',
    retire: '2025-12-31',
    envs: [{ name: 'Production', kind: 'production' }],
  },
  {
    code: 'sales-crm',
    name: 'Sales CRM',
    description: 'Accounts, opportunities and quotes for the Taipei, Tokyo and global sales teams.',
    stage: 'production',
    criticality: 'high',
    disposition: 'invest',
    hosting: 'saas',
    vendor: 'Salesforce',
    businessOwner: ['SALES-TPE', 0],
    technicalOwner: ['IT-APP', 1],
    team: 'dev-team',
    department: 'SALES-TPE',
    techStack: ['Salesforce Sales Cloud', 'Apex', 'Lightning Web Components'],
    classification: 'confidential',
    goLive: '2025-10-01',
    envs: [
      { name: 'Sandbox', kind: 'test', url: 'https://example--uat.sandbox.my.salesforce.com' },
      { name: 'Production', kind: 'production', url: 'https://example.my.salesforce.com' },
    ],
    repos: [{ project: 'Sales', name: 'crm-metadata' }],
  },
  {
    code: 'expense',
    name: 'Expense Claims',
    description:
      'Travel and expense claims with receipt capture and approval, integrated with the Finance ERP.',
    stage: 'production',
    criticality: 'medium',
    disposition: 'tolerate',
    hosting: 'saas',
    vendor: 'SAP Concur',
    businessOwner: ['FIN', 2],
    team: 'dev-team',
    department: 'FIN',
    techStack: ['SaaS', 'SFTP integration'],
    classification: 'confidential',
    goLive: '2022-02-01',
    envs: [
      { name: 'Test', kind: 'test' },
      { name: 'Production', kind: 'production' },
    ],
    manualProduction: true,
  },
  {
    code: 'mes',
    name: 'Manufacturing Execution System',
    description:
      'Shop-floor execution at the Hsinchu plant: work orders, lot tracking, equipment states and yield.',
    stage: 'production',
    criticality: 'critical',
    disposition: 'tolerate',
    hosting: 'on_prem',
    businessOwner: ['OPS', 1],
    technicalOwner: ['IT-APP', 6],
    team: 'dev-team',
    department: 'OPS',
    techStack: ['C#', '.NET Framework 4.8', 'Oracle 19c', 'OPC UA'],
    classification: 'confidential',
    goLive: '2018-08-20',
    envs: STD('mes'),
    repos: [
      {
        project: 'Manufacturing',
        name: 'mes-integration',
        commit: { message: 'Lot genealogy export to DW', daysAgo: 12 },
      },
    ],
    manualProduction: true,
  },
  {
    code: 'wms',
    name: 'Warehouse Management',
    description:
      'Inbound, putaway, picking and shipping at the Kaohsiung warehouse; moving to the cloud edition in 2027.',
    stage: 'production',
    criticality: 'high',
    disposition: 'migrate',
    hosting: 'hybrid',
    businessOwner: ['OPS', 2],
    technicalOwner: ['IT-APP', 7],
    team: 'dev-team',
    department: 'OPS',
    techStack: ['Java 11', 'IBM MQ', 'Handheld scanners'],
    classification: 'internal',
    goLive: '2016-05-02',
    envs: [
      { name: 'Test', kind: 'test', url: 'https://wms-test.corp.example.com' },
      { name: 'Production', kind: 'production', url: 'https://wms.corp.example.com' },
    ],
    repos: [{ project: 'Logistics', name: 'wms-customizations' }],
  },
];

interface SeedRelease {
  app: string;
  version: string;
  name?: string;
  status: ReleaseStatus;
  /** Planned date in days from today (negative: past); null = not planned. */
  planned: number | null;
  /** Created this many days before it was planned (or before today when unplanned). */
  lead: number;
  /** Environments an unreleased version got to. */
  reach?: EnvironmentKind[];
  notes?: string;
}

const notes = (...sections: [string, string[]][]) =>
  sections.map(([title, items]) => `## ${title}\n\n${items.map((i) => `- ${i}`).join('\n')}`).join('\n\n');

/** About 40 releases. Versions are stable (cross-module links use them). */
export const RELEASES: SeedRelease[] = [
  // Finance ERP: monthly, released on Friday evenings outside the closing freeze.
  {
    app: 'erp',
    version: '11.4.0',
    status: 'released',
    planned: -116,
    lead: 28,
    notes: notes([
      'Changes',
      ['Purchase requisitions: approval by cost centre', 'Bank file format for E.SUN Bank updated'],
    ]),
  },
  {
    app: 'erp',
    version: '11.5.0',
    status: 'released',
    planned: -88,
    lead: 26,
    notes: notes([
      'Changes',
      ['Japanese consumption tax rounding per invoice', 'Faster trial balance (materialized views)'],
    ]),
  },
  {
    app: 'erp',
    version: '11.6.0',
    status: 'cancelled',
    planned: -60,
    lead: 20,
    notes: 'Merged into 12.0.0.',
  },
  {
    app: 'erp',
    version: '12.0.0',
    name: 'ERP v12 foundation',
    status: 'released',
    planned: -53,
    lead: 40,
    notes: notes(
      [
        'Highlights',
        [
          'New ledger engine (v12) behind a feature flag',
          'Java 21 runtime',
          'Single sign-on through Entra ID',
        ],
      ],
      ['Upgrade notes', ['Run the ledger migration in read-only mode first', 'Reports keep their URLs']],
    ),
  },
  {
    app: 'erp',
    version: '12.0.1',
    status: 'released',
    planned: -32,
    lead: 6,
    notes: notes([
      'Fixes',
      [
        'Session timeouts after a few minutes (sticky sessions on the load balancer)',
        'AP ageing report export to Excel',
      ],
    ]),
  },
  {
    app: 'erp',
    version: '12.1.0',
    name: 'ERP v12 upgrade',
    status: 'in_progress',
    planned: 9,
    lead: 38,
    reach: ['development', 'test', 'staging'],
    notes: notes(
      [
        'Highlights',
        [
          'Switch every entity to the v12 ledger',
          'New month-end close cockpit',
          'Purchase orders with e-signature',
        ],
      ],
      [
        'Before go-live',
        [
          'Dry-run the cut-over on Staging with last month’s data',
          'Finance sign-off on the trial balance comparison',
          'Freeze ledger master data during the cut-over weekend',
        ],
      ],
    ),
  },
  { app: 'erp', version: '12.2.0', status: 'planned', planned: 46, lead: 5 },

  // HR Portal
  {
    app: 'hr-portal',
    version: '3.2.0',
    status: 'released',
    planned: -101,
    lead: 18,
    notes: notes(['Changes', ['Payslips as password-protected PDF', 'Onboarding checklist for managers']]),
  },
  {
    app: 'hr-portal',
    version: '3.3.0',
    status: 'released',
    planned: -59,
    lead: 21,
    notes: notes(['Changes', ['Leave requests in half days', 'Tokyo public holidays calendar']]),
  },
  {
    app: 'hr-portal',
    version: '3.3.1',
    status: 'released',
    planned: -38,
    lead: 4,
    notes: notes(['Fixes', ['Leave balance off by carry-over days']]),
  },
  {
    app: 'hr-portal',
    version: '3.4.0',
    name: 'Performance reviews',
    status: 'ready',
    planned: 5,
    lead: 30,
    reach: ['development', 'test', 'staging'],
    notes: notes(
      [
        'Highlights',
        ['Mid-year performance reviews with self-assessment', 'Leave balance now includes carry-over days'],
      ],
      ['Rollout', ['Enable for HR first, all employees one week later']],
    ),
  },
  { app: 'hr-portal', version: '3.5.0', status: 'planned', planned: 40, lead: 3 },

  // Corporate Website: monthly releases, hotfixes in between.
  {
    app: 'corp-web',
    version: '2026.06',
    status: 'released',
    planned: -112,
    lead: 14,
    notes: notes(['Changes', ['New product pages for the 2026 line-up']]),
  },
  {
    app: 'corp-web',
    version: '2026.07',
    status: 'released',
    planned: -84,
    lead: 14,
    notes: notes([
      'Changes',
      ['Careers site: Hsinchu plant openings', 'Cookie banner per new PDPA guidance'],
    ]),
  },
  {
    app: 'corp-web',
    version: '2026.08',
    status: 'released',
    planned: -56,
    lead: 12,
    notes: notes(['Changes', ['Japanese site section (日本語)', 'Image CDN']]),
  },
  {
    app: 'corp-web',
    version: '2026.09',
    status: 'released',
    planned: -28,
    lead: 13,
    notes: notes(['Changes', ['Investor relations pages', 'Accessibility fixes (WCAG 2.1 AA)']]),
  },
  { app: 'corp-web', version: '2026.10', status: 'planned', planned: 7, lead: 10 },

  // IS Big Platform (dogfooding)
  {
    app: 'service-desk',
    version: '2.4.0',
    status: 'released',
    planned: -110,
    lead: 10,
    notes: notes(['Changes', ['Notification preferences per channel']]),
  },
  {
    app: 'service-desk',
    version: '2.5.0',
    status: 'released',
    planned: -82,
    lead: 12,
    notes: notes(['Changes', ['Workflow builder simulator']]),
  },
  {
    app: 'service-desk',
    version: '2.6.0',
    status: 'released',
    planned: -61,
    lead: 11,
    notes: notes(['Changes', ['Service catalog fulfilment', 'SLA business calendars']]),
  },
  {
    app: 'service-desk',
    version: '2.7.0',
    status: 'cancelled',
    planned: -40,
    lead: 9,
    notes: 'Folded into 3.0.0.',
  },
  {
    app: 'service-desk',
    version: '3.0.0',
    name: 'Phase 3',
    status: 'released',
    planned: -20,
    lead: 21,
    notes: notes(
      [
        'Highlights',
        [
          'Asset management',
          'Projects with Kanban and Gantt',
          'Application lifecycle management (this page)',
        ],
      ],
      ['Platform', ['Linked records and attachments on every record']],
    ),
  },
  {
    app: 'service-desk',
    version: '3.1.0',
    status: 'in_progress',
    planned: 18,
    lead: 12,
    reach: ['development', 'test'],
  },

  // Remote Access VPN: firmware, twice a year.
  {
    app: 'vpn',
    version: '7.2.4',
    status: 'released',
    planned: -95,
    lead: 21,
    notes: notes(['Firmware', ['Security fixes for the SSL VPN portal', 'SAML clock-skew tolerance']]),
  },
  { app: 'vpn', version: '7.4.1', status: 'planned', planned: 23, lead: 8 },

  // Exchange Online: configuration releases.
  {
    app: 'exchange',
    version: '2026.08',
    name: 'Transport rules refresh',
    status: 'released',
    planned: -47,
    lead: 10,
    notes: notes([
      'Configuration',
      ['External sender tag on all inbound mail', 'Block auto-forwarding to external domains'],
    ]),
  },

  // Data Warehouse: not in production yet.
  {
    app: 'data-warehouse',
    version: '0.1.0',
    status: 'released',
    planned: -75,
    lead: 30,
    notes: notes(['Scope', ['Finance ledger and AP facts']]),
  },
  {
    app: 'data-warehouse',
    version: '0.2.0',
    status: 'in_progress',
    planned: 12,
    lead: 35,
    reach: ['development', 'test'],
    notes: notes(['Scope', ['Sales facts (Taipei, Tokyo)', 'Power BI datasets']]),
  },
  { app: 'data-warehouse', version: '0.3.0', status: 'planned', planned: 60, lead: 2 },

  // Field Service Mobile App
  { app: 'mobile-app', version: '0.1.0', name: 'Pilot', status: 'planned', planned: 75, lead: 4 },

  // Manufacturing Execution System (Hsinchu)
  {
    app: 'mes',
    version: '5.8.0',
    status: 'released',
    planned: -66,
    lead: 24,
    notes: notes(['Changes', ['Equipment state dashboard', 'OPC UA connector for the new reflow ovens']]),
  },
  {
    app: 'mes',
    version: '5.8.1',
    status: 'released',
    planned: -24,
    lead: 5,
    notes: notes(['Fixes', ['Lot genealogy export timeouts']]),
  },
  {
    app: 'mes',
    version: '5.9.0',
    status: 'in_progress',
    planned: 16,
    lead: 20,
    reach: ['development', 'test'],
  },

  // Warehouse Management (Kaohsiung)
  {
    app: 'wms',
    version: '4.2.0',
    status: 'released',
    planned: -79,
    lead: 25,
    notes: notes(['Changes', ['Wave picking', 'Carrier labels for Kerry TJ']]),
  },
  {
    app: 'wms',
    version: '4.2.1',
    status: 'released',
    planned: -33,
    lead: 3,
    notes: notes(['Fixes', ['Scanner sessions dropping at shift change']]),
  },
  {
    app: 'wms',
    version: '4.3.0',
    status: 'ready',
    planned: 11,
    lead: 22,
    reach: ['test'],
    notes: notes(['Changes', ['Cycle counting by zone']]),
  },

  // Sales CRM and Expense Claims (SaaS configuration releases)
  {
    app: 'sales-crm',
    version: '2026.07',
    name: 'Summer configuration',
    status: 'released',
    planned: -70,
    lead: 14,
    notes: notes(['Configuration', ['Quote approval for discounts over 15%', 'Tokyo price books']]),
  },
  {
    app: 'sales-crm',
    version: '2026.10',
    name: 'Autumn configuration',
    status: 'planned',
    planned: 20,
    lead: 6,
  },
  {
    app: 'expense',
    version: '2026.2',
    status: 'released',
    planned: -45,
    lead: 9,
    notes: notes(['Configuration', ['Per-diem rates 2026 (Taiwan, Japan)']]),
  },

  // Intranet: the last maintenance release before switch-off.
  {
    app: 'intranet',
    version: '9.9.3',
    status: 'released',
    planned: -90,
    lead: 7,
    notes: notes(['Maintenance', ['Read-only banner pointing to the new portal']]),
  },
];

/* ───────────────────────────── deterministic helpers ───────────────────────────── */

/** mulberry32: a tiny seeded PRNG (the same data on every fresh seed). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
/** Asia/Taipei has no daylight saving: local = UTC+8. */
const TPE = 8;

interface Plan {
  app: string;
  env: string;
  version: string;
  status: DeploymentStatus;
  startedAt: Date;
  finishedAt: Date | null;
  manual: boolean;
  production: boolean;
  notes?: string;
}

/** Demo data (idempotent: skipped once any application exists). */
export async function seed(ctx: ModuleContext) {
  const [existing] = await ctx.db.select({ n: count() }).from(applications);
  if (existing!.n > 0) return;

  const now = new Date();
  const rnd = prng(20261007);
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const chance = (p: number) => rnd() < p;
  const localMidnight = (() => {
    const t = new Date(now.getTime() + TPE * HOUR);
    return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - TPE * HOUR;
  })();
  /** `day` days from today at `hour` Taipei time, moved off weekends (Saturday → Friday, Sunday → Monday). */
  const at = (day: number, hour: number): Date => {
    let d = Math.round(day);
    const weekday = new Date(localMidnight + d * DAY + TPE * HOUR).getUTCDay();
    if (weekday === 6) d -= 1;
    if (weekday === 0) d += 1;
    return new Date(localMidnight + d * DAY + hour * HOUR + Math.floor(rnd() * 4) * 15 * MINUTE);
  };

  // People per department in a stable order, as the CMDB seed picks owners.
  const deptCodes = [
    ...new Set(
      APPS.flatMap((a) => [a.businessOwner?.[0], a.technicalOwner?.[0], a.department]).filter(Boolean),
    ),
  ] as Dept[];
  const deptRows = await ctx.db
    .select({ id: departments.id, code: departments.code })
    .from(departments)
    .where(inArray(departments.code, deptCodes));
  const deptIds = new Map(deptRows.map((d) => [d.code, d.id]));
  const people = await ctx.db
    .select({ id: users.id, code: departments.code, name: users.displayName })
    .from(users)
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(and(inArray(departments.code, deptCodes), eq(users.status, 'active')))
    .orderBy(asc(users.username));
  const byDept = new Map<string, { id: string; name: string }[]>();
  for (const p of people) byDept.set(p.code, [...(byDept.get(p.code) ?? []), p]);
  const [admin] = await ctx.db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(eq(users.username, 'admin'));
  const personOf = (o: [Dept, number] | undefined) => {
    if (!o) return null;
    const list = byDept.get(o[0]) ?? [];
    return list.length ? list[o[1] % list.length]! : (admin ?? null);
  };
  const groupRows = await ctx.db.select({ id: groups.id, key: groups.key }).from(groups);
  const groupIds = new Map(groupRows.map((g) => [g.key, g.id]));
  const teamOf = (key: string) =>
    groupIds.get(key) ?? groupIds.get('dev-team') ?? groupIds.get('it-admins') ?? null;
  const ciNames = [
    ...new Set(APPS.flatMap((a) => [a.ci, ...a.envs.map((e) => e.ci)]).filter(Boolean)),
  ] as string[];
  const ciRows = ciNames.length
    ? await ctx.db.select({ id: cis.id, name: cis.name }).from(cis).where(inArray(cis.name, ciNames))
    : [];
  const ciIds = new Map(ciRows.map((c) => [c.name, c.id]));
  const ciOf = (name?: string) => (name ? (ciIds.get(name) ?? null) : null);

  // Changes ITSM may already have for these deployments ("Deploy Finance ERP 12.0.0 to production").
  const changeTitles = RELEASES.map(
    (r) => `Deploy ${APPS.find((a) => a.code === r.app)!.name} ${r.version} to production`,
  );
  const knownChanges = await ctx.db
    .select({ id: tickets.id, number: tickets.number, title: tickets.title })
    .from(tickets)
    .innerJoin(changes, eq(changes.ticketId, tickets.id))
    .where(and(eq(tickets.type, 'change'), inArray(tickets.title, changeTitles)));
  const changeByTitle = new Map(knownChanges.map((c) => [c.title, c]));

  await ctx.transaction(async (tx) => {
    /* applications, environments, repositories */
    const appRows = await tx
      .insert(applications)
      .values(
        APPS.map((a) => ({
          code: a.code,
          name: a.name,
          description: a.description,
          stage: a.stage,
          criticality: a.criticality,
          disposition: a.disposition ?? null,
          businessOwnerId: personOf(a.businessOwner)?.id ?? null,
          technicalOwnerId: personOf(a.technicalOwner)?.id ?? null,
          teamGroupId: teamOf(a.team),
          supportGroupId: groupIds.get('service-desk') ?? null,
          departmentId: deptIds.get(a.department) ?? deptIds.get('IT') ?? null,
          vendor: a.vendor ?? null,
          hosting: a.hosting,
          ciId: ciOf(a.ci),
          techStack: a.techStack,
          documentationUrl: a.docs ?? null,
          dataClassification: a.classification,
          goLiveDate: a.goLive ?? null,
          retireDate: a.retire ?? null,
          createdBy: admin?.id ?? null,
          createdAt: new Date(now.getTime() - 130 * DAY),
        })),
      )
      .returning();
    const appByCode = new Map(appRows.map((a) => [a.code, a]));

    const envRows = await tx
      .insert(environments)
      .values(
        APPS.flatMap((a) =>
          a.envs.map((e, sort) => ({
            applicationId: appByCode.get(a.code)!.id,
            name: e.name,
            kind: e.kind,
            url: e.url ?? null,
            ciId: ciOf(e.ci),
            sort,
          })),
        ),
      )
      .returning();
    const envOf = (code: string, kind: EnvironmentKind) =>
      envRows.find((e) => e.applicationId === appByCode.get(code)!.id && e.kind === kind) ?? null;

    const repoValues = APPS.flatMap((a) =>
      (a.repos ?? []).map((r) => ({
        applicationId: appByCode.get(a.code)!.id,
        name: r.name,
        url: `${ADO}/${r.project}/_git/${r.name}`,
        provider: 'azure_devops' as const,
        defaultBranch: r.branch ?? 'main',
        lastCommitSha: r.commit
          ? Array.from({ length: 40 }, () => Math.floor(rnd() * 16).toString(16)).join('')
          : null,
        lastCommitAt: r.commit ? at(-r.commit.daysAgo, 15) : null,
        lastCommitMessage: r.commit?.message ?? null,
        lastCommitAuthor: r.commit ? (personOf(a.technicalOwner)?.name ?? null) : null,
      })),
    );
    if (repoValues.length) await tx.insert(repositories).values(repoValues);

    /* deployment plan */
    const plans: Plan[] = [];
    const appSeed = (code: string) => APPS.find((a) => a.code === code)!;
    const push = (
      code: string,
      kind: EnvironmentKind,
      version: string,
      startedAt: Date,
      status: DeploymentStatus,
      minutes: [number, number],
      extra: Partial<Plan> = {},
    ) => {
      const env = envOf(code, kind);
      if (!env || startedAt.getTime() > now.getTime() - 30 * MINUTE) return;
      const finishedAt =
        status === 'in_progress'
          ? null
          : new Date(startedAt.getTime() + between(minutes[0], minutes[1]) * MINUTE);
      plans.push({
        app: code,
        env: env.name,
        version,
        status,
        startedAt,
        finishedAt,
        manual: Boolean(appSeed(code).manualProduction && (kind === 'production' || kind === 'dr')),
        production: kind === 'production',
        ...extra,
      });
    };
    /** A production attempt that may fail; a failure is followed by a fix the next working day. */
    const productionRun = (code: string, version: string, day: number, risky = 0.08) => {
      const evening = code === 'erp' ? 20 : 19;
      const long: [number, number] = code === 'erp' ? [60, 120] : [10, 40];
      if (chance(risky)) {
        const outcome: DeploymentStatus = chance(0.5) ? 'rolled_back' : 'failed';
        push(code, 'production', version, at(day, evening), outcome, long, {
          notes:
            outcome === 'rolled_back'
              ? 'Smoke tests failed after the switch; rolled back.'
              : 'Database migration step failed.',
        });
        day += 1;
      }
      push(code, 'production', version, at(day, evening + 1), 'succeeded', long);
      if (envOf(code, 'dr')) push(code, 'dr', version, at(day + 1, 10), 'succeeded', [30, 60]);
      return day;
    };

    /* release journeys: development builds → test → staging → production */
    const releasedOn = new Map<string, number>();
    for (const r of RELEASES) {
      if (r.status === 'cancelled' || (r.status === 'planned' && !r.reach)) continue;
      const created = (r.planned ?? 0) - r.lead;
      const end = r.status === 'released' ? r.planned! : Math.min(r.planned ?? 0, 0) - 1;
      const span = Math.max(3, end - created);
      const reach =
        r.status === 'released'
          ? (['development', 'test', 'staging', 'production'] as const)
          : (r.reach ?? []);
      const has = (k: EnvironmentKind) => (reach as readonly EnvironmentKind[]).includes(k);
      const builds = r.app === 'erp' ? 3 : 2;
      if (has('development'))
        for (let i = 0; i < builds; i++)
          push(
            r.app,
            'development',
            r.version,
            at(created + 1 + (span * 0.45 * i) / builds, between(10, 17)),
            chance(0.1) ? 'failed' : 'succeeded',
            [3, 12],
          );
      if (has('test')) {
        const day = created + span * 0.55;
        if (chance(0.15))
          push(r.app, 'test', r.version, at(day - 1, 11), 'failed', [4, 15], {
            notes: 'Integration tests failed.',
          });
        push(r.app, 'test', r.version, at(day, between(11, 16)), 'succeeded', [4, 15]);
      }
      if (has('staging'))
        push(r.app, 'staging', r.version, at(created + span * 0.8, between(10, 15)), 'succeeded', [6, 20]);
      if (r.status === 'released')
        releasedOn.set(`${r.app}@${r.version}`, productionRun(r.app, r.version, end));
    }

    /* hotfixes between releases: frequent for the website and the platform */
    const hotfixes: { app: string; every: [number, number]; base: (day: number) => string | null }[] = [
      { app: 'corp-web', every: [2, 5], base: (d) => latestReleased('corp-web', d) },
      { app: 'service-desk', every: [3, 6], base: (d) => latestReleased('service-desk', d) },
    ];
    function latestReleased(code: string, day: number): string | null {
      const done = RELEASES.filter(
        (r) =>
          r.app === code && r.status === 'released' && (releasedOn.get(`${r.app}@${r.version}`) ?? 1e9) < day,
      );
      return done.length ? done[done.length - 1]!.version : null;
    }
    for (const h of hotfixes) {
      const patch = new Map<string, number>();
      for (let day = -118 + between(0, 3); day < -1; day += between(h.every[0], h.every[1])) {
        const base = h.base(day);
        if (!base) continue;
        const n = (patch.get(base) ?? 0) + 1;
        patch.set(base, n);
        const version = /^\d{4}\.\d{2}$/.test(base)
          ? `${base}.${n}`
          : base.replace(/\.(\d+)$/, (_, p) => `.${Number(p) + n}`);
        push(h.app, 'staging', version, at(day, between(10, 14)), 'succeeded', [5, 15]);
        productionRun(h.app, version, day, 0.09);
      }
    }

    /* a few routine deployments for the rest */
    push('data-warehouse', 'development', '0.2.0', at(-1, 16), 'in_progress', [0, 0]);
    push('wms', 'test', '4.2.1', at(-35, 10), 'succeeded', [5, 12]);
    push('sales-crm', 'test', '2026.10', at(-3, 11), 'succeeded', [5, 10]);
    push('exchange', 'production', '2026.08.1', at(-12, 19), 'succeeded', [5, 15], {
      notes: 'Adjusted the external sender tag for partner domains.',
    });

    /* releases (statuses, dates, notes) */
    const releaseRows = await tx
      .insert(releases)
      .values(
        RELEASES.map((r) => {
          const app = appByCode.get(r.app)!;
          const releasedDay = releasedOn.get(`${r.app}@${r.version}`);
          const prod = plans.find(
            (p) => p.app === r.app && p.version === r.version && p.production && p.status === 'succeeded',
          );
          const createdDay = (r.planned ?? 0) - r.lead;
          return {
            applicationId: app.id,
            version: r.version,
            name: r.name ?? null,
            status: r.status,
            plannedDate:
              r.planned === null
                ? null
                : new Date(localMidnight + r.planned * DAY + TPE * HOUR).toISOString().slice(0, 10),
            releasedAt:
              r.status === 'released' ? (prod?.finishedAt ?? at(releasedDay ?? r.planned ?? 0, 21)) : null,
            notes: r.notes ?? null,
            // Released and cancelled releases are past readiness: nobody is told about them now.
            readyNotifiedAt: r.status === 'released' || r.status === 'cancelled' ? now : null,
            createdBy: personOf(appSeed(r.app).technicalOwner)?.id ?? admin?.id ?? null,
            createdAt: at(Math.min(createdDay, -1), 10),
          };
        }),
      )
      .returning();
    const releaseOf = (code: string, version: string) =>
      releaseRows.find((r) => r.applicationId === appByCode.get(code)!.id && r.version === version) ?? null;

    /* deployments */
    let changeNo = 118;
    const pipeline = 'Azure DevOps Pipelines';
    plans.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const values = plans.map((p) => {
      const app = appByCode.get(p.app)!;
      const env = envRows.find((e) => e.applicationId === app.id && e.name === p.env)!;
      const release = releaseOf(p.app, p.version);
      const owner = personOf(appSeed(p.app).technicalOwner);
      const known = p.production
        ? changeByTitle.get(`Deploy ${app.name} ${p.version} to production`)
        : undefined;
      const reference = known
        ? formatTicketRef('change', known.number)
        : p.production
          ? formatTicketRef('change', changeNo++)
          : null;
      return {
        applicationId: app.id,
        environmentId: env.id,
        releaseId: release?.id ?? null,
        version: p.version,
        status: p.status,
        startedAt: p.startedAt,
        finishedAt: p.finishedAt,
        deployedBy: p.manual ? (owner?.id ?? null) : null,
        actorName: p.manual ? (owner?.name ?? 'Platform Admin') : pipeline,
        source: p.manual ? ('manual' as const) : ('api' as const),
        changeId: known?.id ?? null,
        changeReference: reference,
        commitSha: p.manual
          ? null
          : Array.from({ length: 12 }, () => Math.floor(rnd() * 16).toString(16)).join(''),
        pipelineUrl: p.manual
          ? null
          : `${ADO}/${p.app}/_build/results?buildId=${20000 + Math.floor(rnd() * 9000)}`,
        notes: p.notes ?? null,
        createdAt: p.startedAt,
      };
    });
    for (let i = 0; i < values.length; i += 200)
      await tx.insert(deployments).values(values.slice(i, i + 200));
    for (const env of envRows) await refreshEnvironment(tx, env.id);

    ctx.logger.info(
      {
        applications: appRows.length,
        environments: envRows.length,
        releases: releaseRows.length,
        deployments: values.length,
      },
      'alm demo portfolio created',
    );
  });
}
