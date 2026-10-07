/**
 * The demo collection `DefaultCollection` of a Contoso Azure DevOps Server. Content is deterministic (ids,
 * GUIDs, commit hashes); dates are offsets from the moment the mock first seeds, so the demo looks current.
 *
 * It lines up with the ISBP demo seed:
 * - team project **ERP** (Agile) holds the work of ISBP's "ERP upgrade to v12" project (task titles match)
 *   and the repositories `erp-core` and `erp-reports`, whose web URLs equal the ALM seed's
 *   (`https://devops.example.com/DefaultCollection/ERP/_git/erp-core`);
 * - **Network** (Basic) holds part of "Network refresh 2026" and the ALM repository `vpn-config`;
 * - **Zero Trust rollout** (Scrum) has the same name as the ISBP project, so projects match by name.
 * Assignees are seeded ISBP people (`admin`, `helpdesk`, `hr.partner`, `auditor` at isbp.example) plus one
 * vendor engineer ISBP doesn't know.
 */
import {
  type AdoIdentity,
  type AdoProjectState,
  type AdoPullRequestState,
  type AdoRelation,
  type AdoRepoState,
  type AdoState,
  type GitPerson,
  guidFrom,
  type ProcessName,
  shaFrom,
  typeOf,
  type WorkItemRevision,
  type WorkItemState,
} from './state';

export const COLLECTION = 'DefaultCollection';
const DAY = 86_400_000;
const MINUTE = 60_000;

const person = (key: string, displayName: string, uniqueName: string, mail: string | null): AdoIdentity => ({
  id: guidFrom(`identity:${key}`),
  displayName,
  uniqueName,
  mail,
});

export const IDENTITIES = {
  admin: person('admin', 'Platform Admin', 'CONTOSO\\admin', 'admin@isbp.example'),
  helpdesk: person('helpdesk', '林雅婷', 'CONTOSO\\helpdesk', 'helpdesk@isbp.example'),
  hr: person('hr.partner', '佐藤 美咲', 'CONTOSO\\hr.partner', 'hr.partner@isbp.example'),
  auditor: person('auditor', 'Olivia Bennett', 'CONTOSO\\auditor', 'auditor@isbp.example'),
  /** A contractor with no ISBP account: shows how unmatched people are handled. */
  vendor: person('v-dwu', 'Daniel Wu (Fabrikam)', 'CONTOSO\\v-dwu', 'daniel.wu@fabrikam.example'),
  /** The service account the demo personal access token belongs to. */
  svc: person('svc-isbp', 'ISBP Integration', 'CONTOSO\\svc-isbp', null),
} as const;
type Who = keyof typeof IDENTITIES;

interface ProjectSeed {
  key: string;
  name: string;
  description: string;
  process: ProcessName;
  areas: string[];
  iterations: string[];
}

const PROJECTS: ProjectSeed[] = [
  {
    key: 'ERP',
    name: 'ERP',
    description: 'Finance ERP: the v12 upgrade, reports and the bank and payroll interfaces.',
    process: 'Agile',
    areas: ['ERP', 'ERP\\Finance', 'ERP\\Integration'],
    iterations: ['ERP', 'ERP\\Sprint 41', 'ERP\\Sprint 42', 'ERP\\Sprint 43', 'ERP\\Cutover'],
  },
  {
    key: 'NET',
    name: 'Network',
    description: 'Network infrastructure: switching, Wi-Fi, VPN and automation.',
    process: 'Basic',
    areas: ['Network', 'Network\\Taipei HQ', 'Network\\Hsinchu'],
    iterations: ['Network', 'Network\\2026 Q4'],
  },
  {
    key: 'ZTA',
    name: 'Zero Trust rollout',
    description: 'MFA everywhere, device compliance and conditional access.',
    process: 'Scrum',
    areas: ['Zero Trust rollout'],
    iterations: ['Zero Trust rollout', 'Zero Trust rollout\\Sprint 7', 'Zero Trust rollout\\Sprint 8'],
  },
];

interface ItemSeed {
  project: 'ERP' | 'NET' | 'ZTA';
  type: string;
  title: string;
  state: string;
  /** Index (1-based) of the parent in this list. */
  parent?: number;
  who?: Who;
  priority?: number;
  tags?: string[];
  area?: string;
  iteration?: string;
  estimate?: number;
  remaining?: number;
  completed?: number;
  points?: number;
  effort?: number;
  /** Day offsets from the seed day (negative: past). */
  start?: number;
  target?: number;
  description?: string;
  repro?: string;
  costCenter?: string;
  created: number;
  /** Days ago of the last change (fractions allowed). */
  changed: number;
  /** Items of one bulk import share their change time to the millisecond. */
  batch?: string;
  comments?: [Who, string, number][];
}

const html = (...paragraphs: string[]) => paragraphs.map((p) => `<div>${p}</div>`).join('');

/** 42 work items with an Epic → Feature → Story → Task hierarchy, bugs and a range of states. */
const ITEMS: ItemSeed[] = [
  /* 1 */ {
    project: 'ERP',
    type: 'Epic',
    title: 'ERP v12 upgrade',
    state: 'Active',
    who: 'admin',
    priority: 1,
    tags: ['v12'],
    start: -64,
    target: 60,
    effort: 400,
    costCenter: 'FIN-4100',
    created: 70,
    changed: 30,
    description: html('Upgrade the finance ERP from v11 to <b>v12</b> before the year-end close.'),
  },
  /* 2 */ {
    project: 'ERP',
    type: 'Feature',
    title: 'Data migration',
    state: 'Active',
    parent: 1,
    who: 'auditor',
    priority: 1,
    tags: ['data-migration'],
    start: -48,
    target: -6,
    costCenter: 'FIN-4100',
    area: 'ERP\\Finance',
    created: 66,
    changed: 12,
  },
  /* 3 */ {
    project: 'ERP',
    type: 'Feature',
    title: 'User acceptance testing',
    state: 'New',
    parent: 1,
    who: 'hr',
    priority: 2,
    tags: ['uat'],
    start: 13,
    target: 19,
    area: 'ERP\\Finance',
    created: 66,
    changed: 20,
  },
  /* 4 */ {
    project: 'ERP',
    type: 'Feature',
    title: 'Cutover and hypercare',
    state: 'New',
    parent: 1,
    who: 'admin',
    priority: 1,
    tags: ['change-window'],
    start: 28,
    target: 58,
    created: 66,
    changed: 25,
  },
  /* 5 */ {
    project: 'ERP',
    type: 'Feature',
    title: 'Integrations and reports',
    state: 'Active',
    parent: 1,
    who: 'helpdesk',
    priority: 2,
    tags: ['integration'],
    area: 'ERP\\Integration',
    created: 66,
    changed: 9,
  },
  /* 6 */ {
    project: 'ERP',
    type: 'User Story',
    title: 'Migrate master data and balances to v12',
    state: 'Active',
    parent: 2,
    who: 'auditor',
    points: 13,
    tags: ['data-migration'],
    area: 'ERP\\Finance',
    iteration: 'ERP\\Sprint 42',
    created: 50,
    changed: 8,
  },
  /* 7 */ {
    project: 'ERP',
    type: 'Task',
    title: 'Extract master data from ERP v11',
    state: 'Closed',
    parent: 6,
    who: 'auditor',
    estimate: 24,
    remaining: 0,
    completed: 24,
    tags: ['data-migration'],
    iteration: 'ERP\\Sprint 41',
    created: 48,
    changed: 40,
  },
  /* 8 */ {
    project: 'ERP',
    type: 'Task',
    title: 'Map chart of accounts to the v12 structure',
    state: 'Closed',
    parent: 6,
    who: 'admin',
    estimate: 24,
    remaining: 0,
    completed: 26,
    tags: ['data-migration'],
    iteration: 'ERP\\Sprint 41',
    created: 46,
    changed: 36,
  },
  /* 9 */ {
    project: 'ERP',
    type: 'Task',
    title: 'Data migration test cycle 1',
    state: 'Closed',
    parent: 6,
    who: 'auditor',
    estimate: 32,
    remaining: 0,
    completed: 30,
    tags: ['data-migration'],
    iteration: 'ERP\\Sprint 41',
    created: 36,
    changed: 27,
  },
  /* 10 */ {
    project: 'ERP',
    type: 'Task',
    title: 'Data migration test cycle 2',
    state: 'Active',
    parent: 6,
    who: 'auditor',
    estimate: 32,
    remaining: 4,
    completed: 28,
    tags: ['data-migration'],
    iteration: 'ERP\\Sprint 42',
    created: 21,
    changed: 7.5,
    comments: [
      ['auditor', '97% of GL balances reconcile. The remaining 3% are all in intercompany accounts.', 7],
      ['admin', 'Let’s treat the intercompany mapping as a bug and fix it before cycle 3.', 6],
    ],
  },
  /* 11 */ {
    project: 'ERP',
    type: 'Bug',
    title: 'Fix intercompany posting rule found in cycle 2',
    state: 'Active',
    parent: 6,
    who: 'helpdesk',
    priority: 1,
    estimate: 16,
    remaining: 10,
    completed: 6,
    tags: ['data-migration'],
    iteration: 'ERP\\Sprint 42',
    created: 6,
    changed: 1.2,
    repro: html(
      'Run the cycle 2 migration.',
      'Intercompany receivables post to 1450 instead of 1460: GL balances differ by 3%.',
    ),
  },
  /* 12 */ {
    project: 'ERP',
    type: 'Task',
    title: 'Reconcile GL balances after migration',
    state: 'Active',
    parent: 6,
    who: 'admin',
    estimate: 24,
    remaining: 16,
    completed: 8,
    tags: ['data-migration', 'finance'],
    iteration: 'ERP\\Sprint 42',
    created: 8,
    changed: 2.3,
  },
  /* 13 */ {
    project: 'ERP',
    type: 'Task',
    title: 'Data migration test cycle 3 (dress rehearsal)',
    state: 'New',
    parent: 6,
    who: 'auditor',
    estimate: 32,
    remaining: 32,
    tags: ['data-migration'],
    iteration: 'ERP\\Sprint 43',
    created: 8,
    changed: 5,
  },
  /* 14 */ {
    project: 'ERP',
    type: 'User Story',
    title: 'Finance signs off GL, AP and AR',
    state: 'New',
    parent: 3,
    who: 'hr',
    points: 8,
    tags: ['uat', 'finance'],
    iteration: 'ERP\\Sprint 43',
    created: 4,
    changed: 4,
    batch: 'uat',
  },
  /* 15 */ {
    project: 'ERP',
    type: 'Task',
    title: 'UAT round 1: General ledger',
    state: 'New',
    parent: 14,
    who: 'hr',
    estimate: 16,
    remaining: 16,
    tags: ['uat', 'finance'],
    iteration: 'ERP\\Sprint 43',
    created: 4,
    changed: 4,
    batch: 'uat',
  },
  /* 16 */ {
    project: 'ERP',
    type: 'Task',
    title: 'UAT round 1: Accounts payable',
    state: 'New',
    parent: 14,
    who: 'helpdesk',
    estimate: 12,
    remaining: 12,
    tags: ['uat', 'finance'],
    iteration: 'ERP\\Sprint 43',
    created: 4,
    changed: 4,
    batch: 'uat',
  },
  /* 17 */ {
    project: 'ERP',
    type: 'Task',
    title: 'UAT round 1: Accounts receivable',
    state: 'New',
    parent: 14,
    who: 'hr',
    estimate: 12,
    remaining: 12,
    tags: ['uat', 'finance'],
    iteration: 'ERP\\Sprint 43',
    created: 4,
    changed: 4,
    batch: 'uat',
  },
  /* 18 */ {
    project: 'ERP',
    type: 'User Story',
    title: 'Bank and payroll interfaces work on v12',
    state: 'Active',
    parent: 5,
    who: 'helpdesk',
    points: 8,
    tags: ['integration'],
    area: 'ERP\\Integration',
    iteration: 'ERP\\Sprint 42',
    created: 30,
    changed: 10,
  },
  /* 19 */ {
    project: 'ERP',
    type: 'Task',
    title: 'Update the SWIFT bank interface for the v12 API',
    state: 'Active',
    parent: 18,
    who: 'vendor',
    priority: 2,
    estimate: 40,
    remaining: 26,
    completed: 14,
    tags: ['integration'],
    area: 'ERP\\Integration',
    iteration: 'ERP\\Sprint 42',
    created: 10,
    changed: 2,
    comments: [
      ['vendor', 'The bank’s sandbox now accepts our v12 payment files. Still missing the return files.', 2],
    ],
  },
  /* 20 */ {
    project: 'ERP',
    type: 'Task',
    title: 'Payroll export regression test',
    state: 'Active',
    parent: 18,
    who: 'hr',
    estimate: 12,
    remaining: 8,
    completed: 4,
    tags: ['integration'],
    area: 'ERP\\Integration',
    iteration: 'ERP\\Sprint 42',
    created: 3,
    changed: 1.6,
  },
  /* 21 */ {
    project: 'ERP',
    type: 'Bug',
    title: 'Payroll export drops the cost centre of part-time staff',
    state: 'New',
    parent: 18,
    who: 'vendor',
    priority: 2,
    tags: ['integration'],
    area: 'ERP\\Integration',
    created: 1.5,
    changed: 1.4,
    repro: html(
      'Export payroll for September with part-time staff included.',
      'The cost centre column is empty for them.',
    ),
  },
  /* 22 */ {
    project: 'ERP',
    type: 'User Story',
    title: 'Cut over production to ERP v12',
    state: 'New',
    parent: 4,
    who: 'admin',
    priority: 1,
    points: 13,
    tags: ['change-window', 'finance'],
    iteration: 'ERP\\Cutover',
    created: 30,
    changed: 14,
    description: html(
      'Cutover weekend runbook: freeze postings Friday 18:00, final migration run and reconciliation, smoke tests with Finance key users, go / no-go call Sunday 12:00.',
    ),
  },
  /* 23 */ {
    project: 'ERP',
    type: 'Task',
    title: 'Back up the production database before cutover',
    state: 'New',
    parent: 22,
    who: 'auditor',
    priority: 2,
    estimate: 4,
    remaining: 4,
    tags: ['change-window'],
    iteration: 'ERP\\Cutover',
    created: 14,
    changed: 13,
  },
  /* 24 */ {
    project: 'ERP',
    type: 'Task',
    title: 'Hypercare roster',
    state: 'New',
    parent: 4,
    who: 'admin',
    estimate: 4,
    remaining: 4,
    tags: ['hypercare'],
    iteration: 'ERP\\Cutover',
    created: 14,
    changed: 13.5,
  },
  /* 25 */ {
    project: 'ERP',
    type: 'User Story',
    title: 'Rewrite the custom invoice report for v12',
    state: 'Resolved',
    parent: 5,
    who: 'helpdesk',
    points: 5,
    tags: ['reports'],
    area: 'ERP\\Integration',
    iteration: 'ERP\\Sprint 42',
    created: 5,
    changed: 0.8,
  },
  /* 26 */ {
    project: 'ERP',
    type: 'Task',
    title: 'Remove obsolete custom fields',
    state: 'Removed',
    who: 'helpdesk',
    estimate: 6,
    remaining: 0,
    tags: ['cleanup'],
    created: 40,
    changed: 35,
  },

  /* 27 */ {
    project: 'NET',
    type: 'Epic',
    title: 'Network refresh 2026',
    state: 'Doing',
    who: 'admin',
    priority: 1,
    start: -72,
    target: 98,
    created: 75,
    changed: 40,
  },
  /* 28 */ {
    project: 'NET',
    type: 'Issue',
    title: 'Core switch replacement at Taipei HQ',
    state: 'Doing',
    parent: 27,
    who: 'admin',
    priority: 1,
    effort: 60,
    tags: ['switching', 'taipei'],
    area: 'Network\\Taipei HQ',
    created: 30,
    changed: 3.5,
  },
  /* 29 */ {
    project: 'NET',
    type: 'Task',
    title: 'Replace core switch tpe-sw-core-01',
    state: 'Doing',
    parent: 28,
    who: 'helpdesk',
    priority: 1,
    remaining: 14,
    tags: ['switching', 'taipei', 'change-window'],
    area: 'Network\\Taipei HQ',
    iteration: 'Network\\2026 Q4',
    created: 12,
    changed: 2.1,
    description: html(
      '<b>Plan</b>: pre-stage the configuration, move uplinks in the Saturday change window (22:00–02:00), verify routing and HSRP failover.',
      '<b>Back-out</b>: re-patch uplinks to the old chassis.',
    ),
    comments: [
      [
        'admin',
        'CAB approved the change for Saturday night. Please post the verification checklist here.',
        4,
      ],
      ['helpdesk', 'Config staged and diffed against the golden template. Optics arrived yesterday.', 2.1],
    ],
  },
  /* 30 */ {
    project: 'NET',
    type: 'Task',
    title: 'Replace core switch tpe-sw-core-02',
    state: 'To Do',
    parent: 28,
    who: 'helpdesk',
    priority: 1,
    remaining: 24,
    tags: ['switching', 'taipei', 'change-window'],
    area: 'Network\\Taipei HQ',
    iteration: 'Network\\2026 Q4',
    created: 12,
    changed: 11,
  },
  /* 31 */ {
    project: 'NET',
    type: 'Issue',
    title: 'Wi-Fi 7 rollout at Taipei HQ',
    state: 'Doing',
    parent: 27,
    who: 'auditor',
    priority: 2,
    effort: 80,
    tags: ['wifi', 'taipei'],
    area: 'Network\\Taipei HQ',
    created: 30,
    changed: 6,
  },
  /* 32 */ {
    project: 'NET',
    type: 'Task',
    title: 'Deploy Wi-Fi 7 access points on floors 8–11',
    state: 'Doing',
    parent: 31,
    who: 'vendor',
    remaining: 30,
    tags: ['wifi', 'taipei'],
    area: 'Network\\Taipei HQ',
    iteration: 'Network\\2026 Q4',
    created: 9,
    changed: 1.1,
  },
  /* 33 */ {
    project: 'NET',
    type: 'Task',
    title: 'Update wireless LAN controller wlc-01 firmware',
    state: 'Doing',
    parent: 31,
    who: 'auditor',
    remaining: 1,
    tags: ['wifi'],
    area: 'Network\\Taipei HQ',
    iteration: 'Network\\2026 Q4',
    created: 7,
    changed: 0.9,
  },
  /* 34 */ {
    project: 'NET',
    type: 'Task',
    title: 'Intermittent DHCP timeouts on the pilot VLAN',
    state: 'Done',
    parent: 28,
    who: 'helpdesk',
    priority: 2,
    remaining: 0,
    tags: ['switching'],
    area: 'Network\\Taipei HQ',
    created: 22,
    changed: 17,
  },
  /* 35 */ {
    project: 'NET',
    type: 'Task',
    title: 'Add new switches to network monitoring',
    state: 'To Do',
    parent: 28,
    priority: 3,
    remaining: 6,
    tags: ['monitoring'],
    area: 'Network\\Taipei HQ',
    created: 5,
    changed: 4.5,
  },

  /* 36 */ {
    project: 'ZTA',
    type: 'Epic',
    title: 'MFA everywhere',
    state: 'In Progress',
    who: 'auditor',
    priority: 1,
    start: -60,
    target: 10,
    created: 62,
    changed: 20,
  },
  /* 37 */ {
    project: 'ZTA',
    type: 'Product Backlog Item',
    title: 'Enforce MFA for VPN',
    state: 'Committed',
    parent: 36,
    who: 'auditor',
    priority: 1,
    effort: 8,
    tags: ['mfa', 'vpn'],
    iteration: 'Zero Trust rollout\\Sprint 7',
    created: 20,
    changed: 3,
  },
  /* 38 */ {
    project: 'ZTA',
    type: 'Task',
    title: 'Enable MFA on the VPN gateway',
    state: 'In Progress',
    parent: 37,
    who: 'admin',
    remaining: 6,
    tags: ['vpn'],
    iteration: 'Zero Trust rollout\\Sprint 7',
    created: 10,
    changed: 1.3,
  },
  /* 39 */ {
    project: 'ZTA',
    type: 'Task',
    title: 'Pilot MFA for VPN with the IT department',
    state: 'Done',
    parent: 37,
    who: 'helpdesk',
    remaining: 0,
    tags: ['vpn'],
    iteration: 'Zero Trust rollout\\Sprint 7',
    created: 12,
    changed: 5,
  },
  /* 40 */ {
    project: 'ZTA',
    type: 'Product Backlog Item',
    title: 'Enforce MFA for the ERP',
    state: 'Approved',
    parent: 36,
    who: 'auditor',
    priority: 2,
    effort: 5,
    tags: ['mfa', 'erp'],
    iteration: 'Zero Trust rollout\\Sprint 8',
    created: 15,
    changed: 6,
  },
  /* 41 */ {
    project: 'ZTA',
    type: 'Bug',
    title: 'MFA prompt loop on macOS Safari',
    state: 'New',
    parent: 36,
    who: 'vendor',
    priority: 2,
    effort: 2,
    tags: ['mfa'],
    created: 2,
    changed: 0.7,
    repro: html(
      'Sign in to the VPN portal from Safari on macOS 15.',
      'The MFA prompt reappears after approval.',
    ),
    comments: [['auditor', 'Reproduced with Safari 18; Chrome and Edge work.', 0.7]],
  },
  /* 42 */ {
    project: 'ZTA',
    type: 'Product Backlog Item',
    title: 'Block legacy authentication',
    state: 'New',
    priority: 3,
    effort: 5,
    tags: ['policy'],
    created: 3,
    changed: 2.8,
  },
];

/** Date-only fields as the web UI stores them for someone in Taipei: local midnight (UTC+8). */
const taipeiMidnight = (now: number, dayOffset: number) => {
  const day = new Date(now + dayOffset * DAY).toISOString().slice(0, 10);
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - 8 * 3_600_000).toISOString();
};

const identityValue = (who: Who) => ({ $identity: IDENTITIES[who].id });

function workItems(
  projects: AdoProjectState[],
  now: number,
): { items: Record<string, WorkItemState>; next: number } {
  const FIRST_ID = 101;
  const items: Record<string, WorkItemState> = {};
  const projectByKey = new Map(PROJECTS.map((p, i) => [p.key, projects[i]!]));
  const batchTimes = new Map<string, string>();
  ITEMS.forEach((seed, index) => {
    const id = FIRST_ID + index;
    const project = projectByKey.get(seed.project)!;
    const def = typeOf(project.process, seed.type)!;
    const has = (field: string) => def.fields.includes(field);
    let createdAt = new Date(now - seed.created * DAY - index * 7 * MINUTE).toISOString();
    let changedAt = new Date(now - seed.changed * DAY - (index % 13) * 3 * MINUTE).toISOString();
    if (seed.batch) {
      // A bulk import: created in one go, never touched since.
      changedAt = batchTimes.get(seed.batch) ?? changedAt;
      createdAt = changedAt;
      batchTimes.set(seed.batch, changedAt);
    }
    const creator: Who = seed.who === 'vendor' ? 'admin' : (seed.who ?? 'admin');
    const fields: Record<string, unknown> = {
      'System.Id': id,
      'System.AreaPath': seed.area ?? project.name,
      'System.TeamProject': project.name,
      'System.IterationPath': seed.iteration ?? project.name,
      'System.WorkItemType': def.name,
      'System.State': def.states[0]![0],
      'System.Reason': 'New',
      'System.CreatedDate': createdAt,
      'System.CreatedBy': identityValue(creator),
      'System.ChangedDate': createdAt,
      'System.ChangedBy': identityValue(creator),
      'System.CommentCount': 0,
      'System.Title': seed.title,
      'Microsoft.VSTS.Common.StateChangeDate': createdAt,
    };
    if (seed.who) fields['System.AssignedTo'] = identityValue(seed.who);
    if (seed.description) fields['System.Description'] = seed.description;
    if (seed.tags?.length) fields['System.Tags'] = seed.tags.join('; ');
    if (has('Microsoft.VSTS.Common.Priority')) fields['Microsoft.VSTS.Common.Priority'] = seed.priority ?? 2;
    const put = (field: string, value: unknown) => {
      if (value !== undefined && has(field)) fields[field] = value;
    };
    put('Microsoft.VSTS.Scheduling.OriginalEstimate', seed.estimate);
    put('Microsoft.VSTS.Scheduling.RemainingWork', seed.remaining);
    put('Microsoft.VSTS.Scheduling.CompletedWork', seed.completed);
    put('Microsoft.VSTS.Scheduling.StoryPoints', seed.points);
    put('Microsoft.VSTS.Scheduling.Effort', seed.effort);
    put(
      'Microsoft.VSTS.Scheduling.StartDate',
      seed.start === undefined ? undefined : taipeiMidnight(now, seed.start),
    );
    put(
      'Microsoft.VSTS.Scheduling.TargetDate',
      seed.target === undefined ? undefined : taipeiMidnight(now, seed.target),
    );
    put('Microsoft.VSTS.TCM.ReproSteps', seed.repro);
    put('Custom.CostCenter', seed.costCenter);
    if (seed.type === 'Task' && has('Microsoft.VSTS.Common.Activity'))
      fields['Microsoft.VSTS.Common.Activity'] = 'Development';
    const relations: AdoRelation[] = [];
    if (seed.parent) {
      const parentId = FIRST_ID + seed.parent - 1;
      relations.push({
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        target: parentId,
        attributes: { isLocked: false, name: 'Parent' },
      });
      fields['System.Parent'] = parentId;
    }
    const revisions: WorkItemRevision[] = [
      { rev: 1, fields: { ...fields, 'System.Rev': 1 }, relations: [...relations] },
    ];
    // Later events: the state change (when the item moved on) and comments, in time order.
    const events: { at: string; kind: 'state' | 'comment'; comment?: [Who, string, number] }[] = [];
    if (seed.state !== def.states[0]![0] || changedAt !== createdAt)
      events.push({ at: changedAt, kind: 'state' });
    for (const c of seed.comments ?? [])
      events.push({
        at: new Date(now - c[2] * DAY - index * MINUTE).toISOString(),
        kind: 'comment',
        comment: c,
      });
    events.sort((a, b) => a.at.localeCompare(b.at));
    const comments: WorkItemState['comments'] = [];
    let last = revisions[0]!;
    for (const e of events) {
      const at =
        e.at > last.fields['System.ChangedDate']!
          ? e.at
          : new Date(Date.parse(last.fields['System.ChangedDate'] as string) + MINUTE).toISOString();
      const f: Record<string, unknown> = {
        ...last.fields,
        'System.Rev': last.rev + 1,
        'System.ChangedDate': at,
      };
      if (e.kind === 'state') {
        if (f['System.State'] !== seed.state) {
          f['System.State'] = seed.state;
          f['System.Reason'] = `Moved to ${seed.state}`;
          f['Microsoft.VSTS.Common.StateChangeDate'] = at;
        }
        f['System.ChangedBy'] = identityValue(seed.who === 'vendor' ? 'admin' : (seed.who ?? 'admin'));
      } else {
        const [who, text] = e.comment!;
        comments.push({
          id: comments.length + 1,
          rev: last.rev + 1,
          text: `<div>${text}</div>`,
          createdBy: IDENTITIES[who].id,
          createdDate: at,
          modifiedDate: at,
          isDeleted: false,
        });
        f['System.CommentCount'] = comments.length;
        f['System.ChangedBy'] = identityValue(who);
      }
      last = { rev: last.rev + 1, fields: f, relations: [...relations] };
      revisions.push(last);
    }
    items[String(id)] = { id, projectId: project.id, deleted: false, revisions, comments };
  });
  // Parents list their children (the other end of each hierarchy link).
  for (const item of Object.values(items)) {
    const parent = item.revisions
      .at(-1)!
      .relations.find((r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
    if (parent?.target)
      items[String(parent.target)]!.revisions.at(-1)!.relations.push({
        rel: 'System.LinkTypes.Hierarchy-Forward',
        target: item.id,
        attributes: { isLocked: false, name: 'Child' },
      });
  }
  return { items, next: FIRST_ID + ITEMS.length };
}

/* ───────────────────────────── Git ───────────────────────────── */

interface CommitSeed {
  message: string;
  who: Who;
  daysAgo: number;
}

interface RepoSeed {
  project: 'ERP' | 'NET' | 'ZTA';
  name: string;
  /** Default branch history, oldest first. */
  main: CommitSeed[];
  /** Branches off the default branch: forked `fork` commits before its head, with their own commits. */
  branches?: { name: string; fork: number; commits: CommitSeed[] }[];
  pullRequests?: {
    title: string;
    branch: string;
    who: Who;
    daysAgo: number;
    status?: 'active' | 'completed';
    draft?: boolean;
    description?: string;
  }[];
}

const REPOS: RepoSeed[] = [
  {
    project: 'ERP',
    name: 'erp-core',
    main: [
      { message: 'Import ERP v11 customisations', who: 'admin', daysAgo: 60 },
      { message: 'v12: upgrade the data access layer', who: 'helpdesk', daysAgo: 41 },
      { message: 'Chart of accounts mapping tables', who: 'admin', daysAgo: 33 },
      { message: 'Migration scripts for cycle 1', who: 'auditor', daysAgo: 27 },
      { message: 'Fix rounding in currency revaluation', who: 'helpdesk', daysAgo: 15 },
      { message: 'Merge v12 ledger migration scripts', who: 'admin', daysAgo: 2 },
    ],
    branches: [
      { name: 'release/12.0', fork: 2, commits: [] },
      {
        name: 'feature/intercompany-fix',
        fork: 1,
        commits: [
          { message: 'Intercompany receivables post to 1460', who: 'helpdesk', daysAgo: 1.5 },
          { message: 'Add reconciliation check for intercompany accounts', who: 'helpdesk', daysAgo: 1.1 },
        ],
      },
      {
        name: 'feature/swift-v12',
        fork: 0,
        commits: [
          { message: 'SWIFT: v12 payment file format', who: 'vendor', daysAgo: 6 },
          { message: 'SWIFT: sign payment files with the new HSM key', who: 'vendor', daysAgo: 3 },
          { message: 'SWIFT: parse camt.054 return files (WIP)', who: 'vendor', daysAgo: 2 },
        ],
      },
    ],
    pullRequests: [
      {
        title: 'Ledger migration scripts',
        branch: 'feature/ledger-migration',
        who: 'admin',
        daysAgo: 4,
        status: 'completed',
      },
      {
        title: 'Fix intercompany posting rule found in cycle 2',
        branch: 'feature/intercompany-fix',
        who: 'helpdesk',
        daysAgo: 1.1,
        description: 'Fixes the intercompany mapping that left 3% of GL balances unreconciled.',
      },
      {
        title: 'SWIFT interface for the v12 API',
        branch: 'feature/swift-v12',
        who: 'vendor',
        daysAgo: 2,
        draft: true,
      },
    ],
  },
  {
    project: 'ERP',
    name: 'erp-reports',
    main: [
      { message: 'Report pack for v11', who: 'helpdesk', daysAgo: 90 },
      { message: 'Trial balance: v12 account structure', who: 'helpdesk', daysAgo: 20 },
      { message: 'AP ageing report: Excel export fix', who: 'helpdesk', daysAgo: 9 },
    ],
    branches: [
      {
        name: 'feature/invoice-report-v12',
        fork: 0,
        commits: [{ message: 'Invoice report: v12 layout and QR code', who: 'helpdesk', daysAgo: 0.9 }],
      },
    ],
    pullRequests: [
      {
        title: 'Rewrite the custom invoice report for v12',
        branch: 'feature/invoice-report-v12',
        who: 'helpdesk',
        daysAgo: 0.8,
      },
    ],
  },
  {
    project: 'NET',
    name: 'vpn-config',
    main: [
      { message: 'VPN gateway baseline configuration', who: 'admin', daysAgo: 120 },
      { message: 'Split tunnel for Microsoft 365', who: 'admin', daysAgo: 45 },
      { message: 'Add MFA RADIUS profile for the VPN gateway', who: 'admin', daysAgo: 3 },
    ],
    branches: [
      {
        name: 'feature/tokyo-site',
        fork: 1,
        commits: [{ message: 'Site-to-site tunnel for the Tokyo office', who: 'vendor', daysAgo: 12 }],
      },
    ],
  },
  {
    project: 'NET',
    name: 'net-automation',
    main: [
      { message: 'Ansible inventory for Taipei HQ', who: 'helpdesk', daysAgo: 30 },
      { message: 'Playbook: golden template for core switches', who: 'helpdesk', daysAgo: 4 },
    ],
  },
  {
    project: 'ZTA',
    name: 'conditional-access-policies',
    main: [
      { message: 'Export current conditional access policies', who: 'auditor', daysAgo: 25 },
      { message: 'Require MFA for VPN users', who: 'auditor', daysAgo: 5 },
    ],
    branches: [
      {
        name: 'feature/block-legacy-auth',
        fork: 0,
        commits: [{ message: 'Block legacy authentication for all users', who: 'auditor', daysAgo: 1 }],
      },
    ],
    pullRequests: [
      {
        title: 'Block legacy authentication',
        branch: 'feature/block-legacy-auth',
        who: 'auditor',
        daysAgo: 0.6,
      },
    ],
  },
];

const gitPerson = (who: Who, at: string): GitPerson => ({
  name: IDENTITIES[who].displayName,
  email: IDENTITIES[who].mail ?? `${IDENTITIES[who].uniqueName.split('\\').at(-1)}@contoso.local`,
  date: at,
});

function repositories(projects: AdoProjectState[], now: number) {
  const projectByKey = new Map(PROJECTS.map((p, i) => [p.key, projects[i]!]));
  const repos: AdoRepoState[] = [];
  const prs: AdoPullRequestState[] = [];
  for (const seed of REPOS) {
    const project = projectByKey.get(seed.project)!;
    const repo: AdoRepoState = {
      id: guidFrom(`repo:${project.name}/${seed.name}`),
      name: seed.name,
      projectId: project.id,
      defaultBranch: 'refs/heads/main',
      isDisabled: false,
      refs: {},
      commits: {},
      pushes: 0,
    };
    const commit = (c: CommitSeed, parent: string | null, n: string): string => {
      const at = new Date(now - c.daysAgo * DAY).toISOString();
      const sha = shaFrom(`${repo.name}:${n}`);
      repo.commits[sha] = {
        sha,
        parents: parent ? [parent] : [],
        message: c.message,
        author: gitPerson(c.who, at),
        committer: gitPerson(c.who, at),
      };
      return sha;
    };
    const mainShas: string[] = [];
    for (const [i, c] of seed.main.entries()) mainShas.push(commit(c, mainShas.at(-1) ?? null, `main:${i}`));
    repo.refs['refs/heads/main'] = mainShas.at(-1)!;
    for (const b of seed.branches ?? []) {
      let head = mainShas[mainShas.length - 1 - b.fork]!;
      for (const [i, c] of b.commits.entries()) head = commit(c, head, `${b.name}:${i}`);
      repo.refs[`refs/heads/${b.name}`] = head;
    }
    for (const pr of seed.pullRequests ?? []) {
      const at = new Date(now - pr.daysAgo * DAY).toISOString();
      prs.push({
        id: prs.length + 1,
        repoId: repo.id,
        title: pr.title,
        description: pr.description ?? '',
        status: pr.status ?? 'active',
        isDraft: pr.draft ?? false,
        createdBy: IDENTITIES[pr.who].id,
        creationDate: at,
        sourceRefName: `refs/heads/${pr.branch}`,
        targetRefName: 'refs/heads/main',
      });
    }
    repos.push(repo);
  }
  return { repos, prs };
}

/** A fresh demo collection. */
export function seedAdo(nowMs = Date.now()): AdoState {
  const now = Math.floor(nowMs / 1000) * 1000;
  const projects: AdoProjectState[] = PROJECTS.map((p, i) => ({
    id: guidFrom(`project:${p.name}`),
    name: p.name,
    description: p.description,
    process: p.process,
    visibility: 'private',
    revision: 400 + i * 17,
    lastUpdateTime: new Date(now - (90 - i * 20) * DAY).toISOString(),
    areas: p.areas,
    iterations: p.iterations,
  }));
  const { items, next } = workItems(projects, now);
  const { repos, prs } = repositories(projects, now);
  return {
    collection: { id: guidFrom(`collection:${COLLECTION}`), name: COLLECTION },
    serverId: guidFrom('server'),
    patIdentity: IDENTITIES.svc.id,
    identities: Object.values(IDENTITIES),
    projects,
    workItems: items,
    nextWorkItemId: next,
    repos,
    pullRequests: prs,
    nextPullRequestId: prs.length + 1,
    rateLimit: null,
    notifications: 0,
  };
}
