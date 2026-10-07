/**
 * Demo portfolio of a mid-size Taiwanese company (Taipei HQ, Hsinchu and Kaohsiung offices, Tokyo
 * sales). Dates are day offsets from the seed day, so the board, the timeline and the workload always
 * look current. Keys and the task titles the cross-module seed links are stable — don't rename them.
 */
import type {
  MemberRole,
  ProjectHealth,
  ProjectPriority,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
  Visibility,
} from '../model';

/** A seeded person: a named account, or the n-th active person of a department (by email). */
export type PersonPick = { username: string } | { dept: string; index: number };

export interface MemberSpec {
  slot: string;
  who: PersonPick;
  role: MemberRole;
  allocation: number;
}

export interface TaskSpec {
  title: string;
  status: TaskStatus;
  /** Member slot of the assignee. */
  assignee?: string;
  start?: number;
  due?: number;
  estimate?: number;
  remaining?: number;
  type?: TaskType;
  priority?: TaskPriority;
  /** Index into the project's milestones. */
  milestone?: number;
  labels?: string[];
  /** Title of the parent task (declared earlier). */
  parent?: string;
  /** Titles of tasks this one depends on (declared earlier). */
  deps?: string[];
  description?: string;
  /** [author slot, text, days ago]. */
  comments?: [string, string, number][];
}

export interface ProjectSpec {
  key: string;
  name: string;
  description: string;
  status: ProjectStatus;
  health: ProjectHealth;
  healthNote?: string;
  priority: ProjectPriority;
  visibility: Visibility;
  dept: string;
  budgetHours: number;
  start: number;
  target: number;
  completedDaysAgo?: number;
  owner: string;
  members: MemberSpec[];
  milestones: { name: string; due: number; done?: boolean; description?: string }[];
  /** Health/status history: [kind, from, to, note, days ago, author slot]. */
  history?: ['health' | 'status', string | null, string, string | null, number, string][];
  tasks: TaskSpec[];
}

type Extra = Partial<Omit<TaskSpec, 'title' | 'status' | 'assignee' | 'start' | 'due' | 'estimate'>>;

/** `t(title, status, assignee, start, due, estimate, extra)` — compact task rows. */
const t = (
  title: string,
  status: TaskStatus,
  assignee: string | undefined,
  start: number | undefined,
  due: number | undefined,
  estimate: number | undefined,
  extra: Extra = {},
): TaskSpec => ({ title, status, assignee, start, due, estimate, ...extra });

/* ───────────────────────────── NET ───────────────────────────── */

const NET: ProjectSpec = {
  key: 'NET',
  name: 'Network refresh 2026',
  description: [
    'Replace the core and access switches at Taipei HQ and the Hsinchu office, and roll out **Wi-Fi 7**.',
    '',
    '- Core: two new chassis switches (`tpe-sw-core-01`, `tpe-sw-core-02`) with 100G uplinks',
    '- Access: 48-port multigigabit switches on floors 8–15',
    '- Wireless: Wi-Fi 7 access points, 802.1X everywhere',
    '',
    'Changes to production go through the CAB (ITSM changes are linked on each task).',
  ].join('\n'),
  status: 'active',
  health: 'on_track',
  healthNote: 'Pilot on Taipei 12F signed off; core switch replacement is in this week’s change window.',
  priority: 'high',
  visibility: 'internal',
  dept: 'IT-INFRA',
  budgetHours: 1200,
  start: -72,
  target: 98,
  owner: 'admin',
  members: [
    { slot: 'admin', who: { username: 'admin' }, role: 'manager', allocation: 30 },
    { slot: 'lead', who: { dept: 'IT-INFRA', index: 0 }, role: 'manager', allocation: 60 },
    { slot: 'eng1', who: { dept: 'IT-INFRA', index: 1 }, role: 'member', allocation: 60 },
    { slot: 'eng2', who: { dept: 'IT-INFRA', index: 2 }, role: 'member', allocation: 80 },
    { slot: 'sec', who: { dept: 'IT-SEC', index: 1 }, role: 'member', allocation: 20 },
    { slot: 'sd', who: { dept: 'IT-SD', index: 2 }, role: 'viewer', allocation: 0 },
  ],
  milestones: [
    {
      name: 'Design',
      due: -42,
      done: true,
      description: 'High-level design, vendor selection and RF plan approved.',
    },
    {
      name: 'Pilot (Taipei 12F)',
      due: -6,
      done: true,
      description: 'One floor on the new switches and Wi-Fi 7.',
    },
    { name: 'Rollout HQ', due: 40, description: 'Core switches and floors 8–15 at Taipei HQ.' },
    { name: 'Rollout Hsinchu', due: 90, description: 'Distribution and Wi-Fi at the Hsinchu office.' },
  ],
  history: [
    ['status', 'proposed', 'active', 'Approved by the IT director.', 75, 'admin'],
    ['health', 'on_track', 'at_risk', 'Switch delivery delayed by the vendor (3 weeks).', 40, 'lead'],
    [
      'health',
      'at_risk',
      'on_track',
      'Pilot on Taipei 12F signed off; core switch replacement is in this week’s change window.',
      5,
      'lead',
    ],
  ],
  tasks: [
    t('Survey existing switching and Wi-Fi coverage at HQ', 'done', 'eng1', -70, -60, 24, {
      milestone: 0,
      labels: ['survey', 'taipei'],
    }),
    t('Write network refresh high-level design', 'done', 'lead', -62, -50, 32, {
      milestone: 0,
      labels: ['design'],
      type: 'story',
    }),
    t('Select core and access switch vendor (RFP)', 'done', 'lead', -60, -45, 40, {
      milestone: 0,
      labels: ['procurement'],
    }),
    t('Design Wi-Fi 7 RF plan for Taipei HQ floors 8–15', 'done', 'eng2', -55, -42, 30, {
      milestone: 0,
      labels: ['wifi', 'design'],
    }),
    t('Approve IP addressing and VLAN plan', 'done', 'lead', -50, -44, 8, {
      milestone: 0,
      labels: ['design'],
    }),
    t('Rack and power plan for comms rooms', 'done', 'eng1', -48, -40, 12, {
      milestone: 0,
      labels: ['design', 'facilities'],
    }),
    t('Stage pilot access switches for Taipei 12F', 'done', 'eng1', -40, -33, 16, {
      milestone: 1,
      labels: ['switching', 'taipei'],
    }),
    t('Install Wi-Fi 7 access points on Taipei 12F', 'done', 'eng2', -33, -24, 24, {
      milestone: 1,
      labels: ['wifi', 'taipei'],
    }),
    t('Intermittent DHCP timeouts on the pilot VLAN', 'done', 'eng1', -22, -17, 6, {
      milestone: 1,
      type: 'bug',
      priority: 'high',
      labels: ['switching'],
      comments: [
        [
          'eng1',
          'Root cause: DHCP snooping rate limit too low on the new access switches. Raised to 100 pps.',
          17,
        ],
      ],
    }),
    t('Fix roaming issue found in the pilot (802.11r)', 'done', 'eng2', -16, -10, 10, {
      milestone: 1,
      type: 'bug',
      labels: ['wifi'],
    }),
    t('Pilot user acceptance on Taipei 12F', 'done', 'lead', -24, -12, 12, {
      milestone: 1,
      labels: ['taipei'],
    }),
    t('Pilot sign-off report', 'done', 'lead', -10, -6, 6, { milestone: 1, labels: ['documentation'] }),
    t('Order core switches and optics', 'done', 'lead', -30, -12, 4, {
      milestone: 2,
      labels: ['procurement'],
    }),
    t('Replace core switch tpe-sw-core-01', 'in_progress', 'eng1', -3, 4, 24, {
      remaining: 14,
      milestone: 2,
      priority: 'high',
      labels: ['switching', 'taipei', 'change-window'],
      deps: ['Order core switches and optics'],
      description: [
        '## Plan',
        '1. Pre-stage configuration from the golden template',
        '2. Move uplinks to the new chassis during the Saturday change window (22:00–02:00)',
        '3. Verify routing adjacencies and HSRP failover',
        '',
        '**Back-out:** re-patch uplinks to the old chassis (cables labelled).',
      ].join('\n'),
      comments: [
        [
          'lead',
          'CAB approved the change for Saturday night. Please post the verification checklist here.',
          4,
        ],
        ['eng1', 'Config staged and diffed against the golden template. Optics arrived yesterday.', 2],
        ['sec', 'Reminder: keep the management VLAN ACLs identical to the old chassis.', 1],
      ],
    }),
    t('Replace core switch tpe-sw-core-02', 'todo', 'eng1', 5, 11, 24, {
      milestone: 2,
      priority: 'high',
      labels: ['switching', 'taipei', 'change-window'],
      deps: ['Replace core switch tpe-sw-core-01'],
    }),
    t('Recable comms room 8F (Cat6A)', 'todo', 'eng1', 1, 8, 20, {
      milestone: 2,
      labels: ['cabling', 'taipei'],
    }),
    t('Migrate floors 8–11 to new access switches', 'todo', 'eng1', 7, 18, 40, {
      milestone: 2,
      labels: ['switching', 'taipei'],
      deps: ['Replace core switch tpe-sw-core-02'],
    }),
    t('Migrate floors 12–15 to new access switches', 'backlog', 'eng1', 19, 32, 40, {
      milestone: 2,
      labels: ['switching', 'taipei'],
    }),
    t('Deploy Wi-Fi 7 access points on floors 8–11', 'in_progress', 'eng2', -2, 12, 40, {
      remaining: 30,
      milestone: 2,
      labels: ['wifi', 'taipei'],
    }),
    t('Deploy Wi-Fi 7 access points on floors 13–15', 'todo', 'eng2', 13, 28, 36, {
      milestone: 2,
      labels: ['wifi', 'taipei'],
    }),
    t('Update wireless LAN controller wlc-01 firmware', 'in_review', 'eng2', -6, -1, 6, {
      remaining: 1,
      milestone: 2,
      labels: ['wifi'],
      comments: [['eng2', 'Upgraded in the lab, waiting for the vendor’s release notes review.', 1]],
    }),
    t('Configure 802.1X on new access ports', 'in_progress', 'sec', -5, 6, 20, {
      remaining: 12,
      milestone: 2,
      labels: ['security'],
    }),
    t('Add new switches to network monitoring', 'todo', 'eng2', 3, 9, 6, {
      milestone: 2,
      labels: ['monitoring'],
    }),
    t('Firewall rule review for the new core', 'in_review', 'sec', -4, 1, 8, {
      remaining: 2,
      milestone: 2,
      labels: ['security'],
    }),
    t('Guest Wi-Fi captive portal', 'todo', 'eng2', 8, 15, 10, { milestone: 2, labels: ['wifi'] }),
    t('Update DHCP scopes for floors 8–11', 'todo', 'eng1', 6, 9, 4, { milestone: 2, labels: ['switching'] }),
    t('Update network diagrams in the CMDB', 'todo', 'lead', 10, 20, 8, {
      milestone: 2,
      labels: ['documentation'],
    }),
    t('Decommission old core switches', 'backlog', 'eng1', 33, 40, 12, {
      milestone: 2,
      labels: ['switching'],
    }),
    t('Renew switch support contract', 'todo', 'lead', -14, -3, 2, {
      priority: 'high',
      labels: ['procurement'],
    }),
    t('Site survey at the Hsinchu office', 'todo', 'eng2', 20, 27, 12, {
      milestone: 3,
      labels: ['hsinchu', 'survey'],
    }),
    t('Ship staged switches to Hsinchu', 'backlog', 'lead', 48, 55, 4, { milestone: 3, labels: ['hsinchu'] }),
    t('Replace Hsinchu distribution switches', 'backlog', 'eng1', 60, 72, 30, {
      milestone: 3,
      labels: ['hsinchu', 'switching'],
    }),
    t('Deploy Wi-Fi 7 at the Hsinchu office', 'backlog', 'eng2', 65, 82, 30, {
      milestone: 3,
      labels: ['hsinchu', 'wifi'],
    }),
    t('Hsinchu cutover weekend', 'backlog', 'lead', 86, 88, 16, {
      milestone: 3,
      labels: ['hsinchu', 'change-window'],
    }),
    t('Train the service desk on Wi-Fi 7 onboarding', 'todo', 'eng2', 2, 6, 6, { labels: ['training'] }),
    t('Spare parts kit for branch offices', 'backlog', undefined, undefined, undefined, 4, {
      labels: ['procurement'],
    }),
    t('Evaluate SD-WAN for branch offices', 'backlog', undefined, undefined, undefined, 16, {
      type: 'story',
      priority: 'low',
    }),
    t('Evaluate Wi-Fi 6E as an interim step', 'cancelled', 'eng2', -58, -50, 8, { labels: ['wifi'] }),
  ],
};

/* ───────────────────────────── ERP ───────────────────────────── */

const ERP: ProjectSpec = {
  key: 'ERP',
  name: 'ERP upgrade to v12',
  description: [
    'Upgrade the finance ERP from v11 to **v12** before the year-end close.',
    '',
    'Workstreams: data migration (three test cycles), user acceptance testing with Finance, cutover and hypercare.',
  ].join('\n'),
  status: 'active',
  health: 'at_risk',
  healthNote:
    'Data migration test cycle 2 left 3% of GL balances unreconciled. Cutover may slip one week unless the fix lands before cycle 3.',
  priority: 'high',
  visibility: 'internal',
  dept: 'IT-APP',
  budgetHours: 1600,
  start: -64,
  target: 60,
  owner: 'lead',
  members: [
    { slot: 'lead', who: { dept: 'IT-APP', index: 0 }, role: 'manager', allocation: 60 },
    { slot: 'dev1', who: { dept: 'IT-APP', index: 1 }, role: 'member', allocation: 100 },
    { slot: 'dev2', who: { dept: 'IT-APP', index: 2 }, role: 'member', allocation: 80 },
    { slot: 'dba', who: { dept: 'IT-DATA', index: 0 }, role: 'member', allocation: 70 },
    { slot: 'rel', who: { dept: 'IT-APP', index: 3 }, role: 'member', allocation: 40 },
    { slot: 'fin', who: { dept: 'FIN', index: 0 }, role: 'viewer', allocation: 0 },
  ],
  milestones: [
    { name: 'Data migration', due: -6, description: 'Three migration test cycles with reconciled balances.' },
    { name: 'UAT', due: 16, description: 'Finance signs off GL, AP and AR.' },
    { name: 'Cutover', due: 30, description: 'Production on v12 over the cutover weekend.' },
    { name: 'Hypercare', due: 58, description: 'Four weeks of hypercare, then v11 is retired.' },
  ],
  history: [
    ['status', 'proposed', 'active', null, 66, 'lead'],
    [
      'health',
      'on_track',
      'at_risk',
      'Data migration test cycle 2 left 3% of GL balances unreconciled. Cutover may slip one week unless the fix lands before cycle 3.',
      6,
      'lead',
    ],
  ],
  tasks: [
    t('Sizing for the v12 database server', 'done', 'dba', -62, -56, 8, { labels: ['infrastructure'] }),
    t('Licence true-up with the vendor', 'done', 'lead', -60, -52, 4, { labels: ['procurement'] }),
    t('Upgrade the test environment to ERP v12', 'done', 'dev1', -58, -48, 32, {
      milestone: 0,
      labels: ['environment'],
    }),
    t('Extract master data from ERP v11', 'done', 'dba', -48, -40, 24, {
      milestone: 0,
      labels: ['data-migration'],
      deps: ['Upgrade the test environment to ERP v12'],
    }),
    t('Map chart of accounts to the v12 structure', 'done', 'lead', -46, -36, 24, {
      milestone: 0,
      labels: ['data-migration'],
      deps: ['Extract master data from ERP v11'],
    }),
    t('Data migration test cycle 1', 'done', 'dba', -36, -27, 32, {
      milestone: 0,
      labels: ['data-migration'],
      deps: ['Map chart of accounts to the v12 structure'],
    }),
    t('Data migration test cycle 2', 'in_review', 'dba', -21, -8, 32, {
      remaining: 4,
      milestone: 0,
      labels: ['data-migration'],
      deps: ['Data migration test cycle 1'],
      comments: [
        ['dba', '97% of GL balances reconcile. The remaining 3% are all in intercompany accounts.', 7],
        ['lead', 'Let’s treat the intercompany mapping as a bug and fix it before cycle 3.', 6],
      ],
    }),
    t('Fix intercompany posting rule found in cycle 2', 'in_progress', 'dev2', -4, 2, 16, {
      remaining: 10,
      type: 'bug',
      priority: 'urgent',
      milestone: 0,
      labels: ['data-migration'],
    }),
    t('Reconcile GL balances after migration', 'in_progress', 'lead', -6, 3, 24, {
      remaining: 16,
      milestone: 0,
      labels: ['data-migration', 'finance'],
      deps: ['Data migration test cycle 2'],
    }),
    t('Data migration test cycle 3 (dress rehearsal)', 'todo', 'dba', 4, 12, 32, {
      milestone: 0,
      labels: ['data-migration'],
      deps: ['Reconcile GL balances after migration', 'Fix intercompany posting rule found in cycle 2'],
    }),
    t('Prepare UAT scripts with Finance', 'done', 'dev2', -30, -18, 20, { milestone: 1, labels: ['uat'] }),
    t('UAT round 1: General ledger', 'todo', 'dev2', 13, 16, 16, {
      milestone: 1,
      labels: ['uat', 'finance'],
      deps: ['Data migration test cycle 3 (dress rehearsal)'],
    }),
    t('UAT round 1: Accounts payable', 'todo', 'dev1', 13, 16, 12, {
      milestone: 1,
      labels: ['uat', 'finance'],
      deps: ['Data migration test cycle 3 (dress rehearsal)'],
    }),
    t('UAT round 1: Accounts receivable', 'todo', 'dev2', 13, 17, 12, {
      milestone: 1,
      labels: ['uat', 'finance'],
      deps: ['Data migration test cycle 3 (dress rehearsal)'],
    }),
    t('UAT sign-off by Finance', 'backlog', 'lead', 18, 19, 4, {
      milestone: 1,
      labels: ['uat'],
      deps: [
        'UAT round 1: General ledger',
        'UAT round 1: Accounts payable',
        'UAT round 1: Accounts receivable',
      ],
    }),
    t('Update the SWIFT bank interface for the v12 API', 'in_progress', 'dev1', -10, 5, 40, {
      remaining: 26,
      labels: ['integration'],
      comments: [
        ['dev1', 'The bank’s sandbox now accepts our v12 payment files. Still missing the return files.', 2],
      ],
    }),
    t('Rewrite the custom invoice report for v12', 'in_progress', 'dev1', -5, 6, 24, {
      remaining: 20,
      labels: ['reports'],
    }),
    t('Performance test of the month-end close', 'todo', 'dba', 8, 15, 16, { labels: ['performance'] }),
    t('Test the year-end close on v12', 'todo', 'dba', 16, 24, 16, {
      milestone: 1,
      labels: ['uat', 'finance'],
    }),
    t('Update the GL interface to the data warehouse', 'todo', 'dev1', 6, 14, 16, {
      labels: ['integration'],
    }),
    t('Payroll export regression test', 'in_progress', 'dev2', -3, 4, 12, {
      remaining: 8,
      labels: ['integration'],
    }),
    t('Security review of v12 roles', 'in_review', 'rel', -8, -2, 12, { remaining: 2, labels: ['security'] }),
    t('Change request for the production cutover', 'todo', 'rel', 8, 14, 4, {
      milestone: 2,
      labels: ['change-window'],
      description: 'Raise the normal change in ITSM and link it here (CAB meets on Tuesdays).',
    }),
    t('Freeze-period communication to finance users', 'todo', 'lead', 10, 20, 6, {
      milestone: 2,
      labels: ['communication'],
    }),
    t('Retrain finance key users on v12', 'todo', 'dev2', 18, 25, 16, {
      milestone: 2,
      labels: ['training', 'finance'],
    }),
    t('Upgrade the ERP client on finance PCs', 'todo', 'rel', 20, 27, 12, {
      milestone: 2,
      labels: ['deployment'],
    }),
    t('Back up the production database before cutover', 'backlog', 'dba', 28, 29, 4, {
      milestone: 2,
      priority: 'high',
      labels: ['change-window'],
      deps: ['UAT sign-off by Finance'],
    }),
    t('Cut over production to ERP v12', 'backlog', 'lead', 29, 30, 40, {
      milestone: 2,
      priority: 'urgent',
      labels: ['change-window', 'finance'],
      deps: ['UAT sign-off by Finance', 'Back up the production database before cutover'],
      description: [
        'Cutover weekend runbook:',
        '',
        '1. Freeze postings Friday 18:00',
        '2. Final migration run and reconciliation',
        '3. Smoke tests with Finance key users',
        '4. Go / no-go call Sunday 12:00',
      ].join('\n'),
    }),
    t('Hypercare roster', 'backlog', 'lead', 28, 31, 4, { milestone: 3, labels: ['hypercare'] }),
    t('Archive v11 data for 7-year retention', 'backlog', 'dba', 45, 55, 16, {
      milestone: 3,
      labels: ['data-migration'],
    }),
    t('Decommission ERP v11 servers', 'backlog', 'dba', 52, 58, 8, {
      milestone: 3,
      labels: ['infrastructure'],
    }),
    t('Remove obsolete custom fields', 'cancelled', 'dev2', -40, -35, 6, { labels: ['cleanup'] }),
    t('Hypercare daily check-in template', 'backlog', 'dev2', undefined, undefined, 2, { milestone: 3 }),
  ],
};

/* ───────────────────────────── ZTA ───────────────────────────── */

const ZTA: ProjectSpec = {
  key: 'ZTA',
  name: 'Zero Trust rollout',
  description: [
    'Move remote and internal access to a **Zero Trust** model:',
    '',
    '1. MFA everywhere',
    '2. Device compliance (Intune) for Windows and macOS',
    '3. Conditional access policies by risk, device and location',
  ].join('\n'),
  status: 'active',
  health: 'off_track',
  healthNote:
    'MFA for VPN missed its date: 140 field staff still have no registered authenticator. Phase 2 cannot start until registration reaches 95%.',
  priority: 'high',
  visibility: 'internal',
  dept: 'IT-SEC',
  budgetHours: 1400,
  start: -68,
  target: 112,
  owner: 'lead',
  members: [
    { slot: 'lead', who: { dept: 'IT-SEC', index: 0 }, role: 'manager', allocation: 70 },
    { slot: 'sec1', who: { dept: 'IT-SEC', index: 1 }, role: 'member', allocation: 60 },
    { slot: 'sec2', who: { dept: 'IT-SEC', index: 2 }, role: 'member', allocation: 100 },
    { slot: 'endpoint', who: { dept: 'IT-INFRA', index: 3 }, role: 'member', allocation: 50 },
    { slot: 'sd', who: { dept: 'IT-SD', index: 1 }, role: 'member', allocation: 30 },
    { slot: 'auditor', who: { username: 'auditor' }, role: 'viewer', allocation: 0 },
  ],
  milestones: [
    { name: 'Phase 1 – MFA everywhere', due: -4, description: 'MFA on VPN, Microsoft 365 and the ERP.' },
    { name: 'Phase 2 – Device compliance', due: 45 },
    { name: 'Phase 3 – Conditional access', due: 105 },
  ],
  history: [
    ['status', 'proposed', 'active', null, 70, 'lead'],
    ['health', 'on_track', 'at_risk', 'MFA registration at 70%, below plan.', 24, 'lead'],
    [
      'health',
      'at_risk',
      'off_track',
      'MFA for VPN missed its date: 140 field staff still have no registered authenticator. Phase 2 cannot start until registration reaches 95%.',
      3,
      'lead',
    ],
  ],
  tasks: [
    t('Zero Trust architecture', 'in_progress', 'lead', -68, 112, 40, {
      type: 'epic',
      remaining: 30,
      description: 'Umbrella epic for the three phases. Features below track each phase.',
    }),
    t('MFA everywhere', 'in_progress', 'lead', -60, 10, 16, {
      type: 'feature',
      remaining: 6,
      milestone: 0,
      parent: 'Zero Trust architecture',
      labels: ['mfa'],
    }),
    t('Enforce MFA for Microsoft 365', 'done', 'sec1', -40, -25, 24, {
      type: 'story',
      milestone: 0,
      parent: 'MFA everywhere',
      labels: ['mfa'],
    }),
    t('MFA registration campaign for all staff', 'in_progress', 'sd', -24, -3, 24, {
      type: 'story',
      remaining: 8,
      milestone: 0,
      parent: 'MFA everywhere',
      labels: ['mfa', 'communication'],
      comments: [
        ['sd', 'Registration is at 86%. Most of the rest are field engineers in Hsinchu and Kaohsiung.', 4],
        ['lead', 'Let’s run walk-up registration desks at both offices next week.', 3],
      ],
    }),
    t('Enforce MFA for VPN', 'in_progress', 'sec1', -10, -2, 16, {
      type: 'story',
      remaining: 10,
      priority: 'urgent',
      milestone: 0,
      parent: 'MFA everywhere',
      labels: ['mfa', 'vpn'],
      deps: ['Enforce MFA for Microsoft 365'],
      description:
        'Switch the VPN gateway to RADIUS with MFA for every group except the break-glass accounts.',
      comments: [
        ['sec1', 'Policy is live for IT and Finance. Field staff are blocked on registration.', 2],
        ['auditor', 'Please keep the exception list in the ticket for the next ISO 27001 audit.', 1],
      ],
    }),
    t('Enforce MFA for the ERP', 'todo', 'sec2', 3, 15, 16, {
      type: 'story',
      milestone: 0,
      parent: 'MFA everywhere',
      labels: ['mfa'],
      deps: ['Enforce MFA for VPN'],
    }),
    t('MFA prompt loop on macOS Safari', 'todo', 'sec1', -3, 1, 6, {
      type: 'bug',
      priority: 'urgent',
      parent: 'MFA everywhere',
      labels: ['mfa', 'macos'],
    }),
    t('Hardware tokens for shared accounts', 'backlog', 'sec2', undefined, undefined, 8, {
      type: 'story',
      parent: 'MFA everywhere',
      labels: ['mfa'],
    }),
    t('Device compliance', 'todo', 'lead', 0, 45, 12, {
      type: 'feature',
      milestone: 1,
      parent: 'Zero Trust architecture',
      labels: ['devices'],
    }),
    t('Define the device compliance baseline', 'in_progress', 'lead', -8, 4, 16, {
      type: 'story',
      remaining: 6,
      milestone: 1,
      parent: 'Device compliance',
      labels: ['devices', 'policy'],
    }),
    t('Enroll Windows laptops in Intune', 'todo', 'endpoint', 6, 24, 60, {
      type: 'story',
      milestone: 1,
      parent: 'Device compliance',
      labels: ['devices', 'windows'],
      deps: ['Define the device compliance baseline'],
    }),
    t('Enroll macOS laptops', 'backlog', 'endpoint', 18, 32, 30, {
      type: 'story',
      milestone: 1,
      parent: 'Device compliance',
      labels: ['devices', 'macos'],
    }),
    t('Quarantine non-compliant devices', 'backlog', 'sec2', 30, 42, 16, {
      type: 'story',
      milestone: 1,
      parent: 'Device compliance',
      labels: ['devices'],
      deps: ['Enroll Windows laptops in Intune'],
    }),
    t('Compliance dashboard for IT security', 'backlog', 'sec2', 35, 45, 12, {
      type: 'story',
      milestone: 1,
      parent: 'Device compliance',
      labels: ['reporting'],
    }),
    t('Conditional access', 'backlog', 'lead', 30, 105, 12, {
      type: 'feature',
      milestone: 2,
      parent: 'Zero Trust architecture',
      labels: ['conditional-access'],
    }),
    t('Block legacy authentication', 'todo', 'sec2', 10, 20, 12, {
      type: 'story',
      milestone: 2,
      parent: 'Conditional access',
      labels: ['conditional-access'],
    }),
    t('Location-based access for the Tokyo office', 'backlog', 'sec2', 50, 65, 16, {
      type: 'story',
      milestone: 2,
      parent: 'Conditional access',
      labels: ['conditional-access', 'tokyo'],
    }),
    t('Risk-based sign-in policies', 'backlog', 'sec1', 60, 90, 24, {
      type: 'story',
      milestone: 2,
      parent: 'Conditional access',
      labels: ['conditional-access'],
    }),
    t('Break-glass accounts and monitoring', 'in_review', 'sec1', -9, -1, 8, {
      type: 'story',
      remaining: 1,
      milestone: 2,
      parent: 'Conditional access',
      labels: ['conditional-access', 'monitoring'],
    }),
    t('Vendor evaluation: ZTNA gateway', 'done', 'lead', -66, -50, 24, { labels: ['procurement'] }),
    t('Budget approval for ZTNA licences', 'done', 'lead', -50, -44, 4, { labels: ['procurement'] }),
    t('Inventory VPN user groups', 'done', 'sec1', -30, -22, 8, { labels: ['vpn'] }),
    t('Report: people without MFA', 'done', 'sd', -18, -15, 4, { labels: ['mfa', 'reporting'] }),
    t('Configure Intune enrollment restrictions', 'todo', 'endpoint', 3, 9, 8, {
      milestone: 1,
      labels: ['devices'],
    }),
    t('Pilot ZTNA with the IT department', 'in_progress', 'sec2', -20, -5, 30, {
      remaining: 12,
      labels: ['ztna'],
    }),
    t('Penetration test of remote access', 'todo', 'sec1', 20, 30, 16, { labels: ['security-testing'] }),
    t('Update security awareness training', 'todo', 'sd', 5, 19, 10, { labels: ['training'] }),
    t('Document the exception process', 'todo', 'lead', undefined, undefined, 4, { labels: ['policy'] }),
    t('Disable SMS as a second factor', 'backlog', 'sec1', 40, 50, 6, { labels: ['mfa'] }),
    t('Pilot passwordless sign-in for IT', 'cancelled', 'sec2', -30, -20, 12, { labels: ['mfa'] }),
  ],
};

/* ───────────────────────────── M365 ───────────────────────────── */

const M365: ProjectSpec = {
  key: 'M365',
  name: 'Microsoft 365 migration',
  description:
    'Mailboxes, file shares and Teams moved from on-premises Exchange 2016 and file servers to Microsoft 365.',
  status: 'completed',
  health: 'on_track',
  healthNote: 'All waves migrated; Exchange 2016 decommissioned.',
  priority: 'medium',
  visibility: 'internal',
  dept: 'IT-INFRA',
  budgetHours: 900,
  start: -150,
  target: -25,
  completedDaysAgo: 21,
  owner: 'lead',
  members: [
    { slot: 'lead', who: { dept: 'IT-INFRA', index: 4 }, role: 'manager', allocation: 50 },
    { slot: 'eng', who: { dept: 'IT-INFRA', index: 5 }, role: 'member', allocation: 60 },
    { slot: 'sd', who: { dept: 'IT-SD', index: 3 }, role: 'member', allocation: 40 },
    { slot: 'sec', who: { dept: 'IT-SEC', index: 2 }, role: 'member', allocation: 10 },
  ],
  milestones: [
    { name: 'Tenant ready', due: -120, done: true },
    { name: 'Mailboxes migrated', due: -60, done: true },
    { name: 'Files and Teams', due: -30, done: true },
  ],
  history: [
    ['status', 'proposed', 'active', null, 150, 'lead'],
    ['status', 'active', 'completed', 'All waves migrated; Exchange 2016 decommissioned.', 21, 'lead'],
  ],
  tasks: [
    t('Set up the Microsoft 365 tenant and domains', 'done', 'eng', -150, -140, 16, {
      milestone: 0,
      labels: ['tenant'],
    }),
    t('Configure Entra ID Connect sync', 'done', 'eng', -140, -128, 24, {
      milestone: 0,
      labels: ['identity'],
    }),
    t('Licence assignment by group', 'done', 'lead', -130, -122, 6, { milestone: 0, labels: ['licensing'] }),
    t('Migrate mailboxes wave 1 (IT)', 'done', 'eng', -118, -110, 24, { milestone: 1, labels: ['exchange'] }),
    t('Migrate mailboxes wave 2 (Finance and HR)', 'done', 'eng', -105, -95, 32, {
      milestone: 1,
      labels: ['exchange'],
    }),
    t('Migrate mailboxes wave 3 (Sales Taipei and Tokyo)', 'done', 'eng', -90, -78, 40, {
      milestone: 1,
      labels: ['exchange', 'tokyo'],
    }),
    t('Migrate mailboxes wave 4 (R&D and Operations)', 'done', 'eng', -75, -62, 40, {
      milestone: 1,
      labels: ['exchange'],
    }),
    t('Mailbox permissions not migrated for shared mailboxes', 'done', 'eng', -80, -76, 6, {
      type: 'bug',
      milestone: 1,
      labels: ['exchange'],
    }),
    t('Migrate public folders', 'done', 'eng', -70, -64, 16, { milestone: 1, labels: ['exchange'] }),
    t('Shared mailbox clean-up', 'done', 'sd', -66, -60, 6, { milestone: 1, labels: ['exchange'] }),
    t('Configure retention policies', 'done', 'sec', -36, -31, 8, { labels: ['security', 'compliance'] }),
    t('Move department file shares to SharePoint', 'done', 'eng', -60, -40, 60, {
      milestone: 2,
      labels: ['sharepoint'],
    }),
    t('Create Teams for every department', 'done', 'lead', -50, -44, 8, { milestone: 2, labels: ['teams'] }),
    t('Teams phone pilot for the Tokyo office', 'cancelled', 'eng', -48, -38, 20, {
      milestone: 2,
      labels: ['teams', 'tokyo'],
    }),
    t('Train staff on OneDrive and Teams', 'done', 'sd', -46, -32, 24, {
      milestone: 2,
      labels: ['training'],
    }),
    t('Service desk FAQ for the migration', 'done', 'sd', -120, -112, 8, { labels: ['documentation'] }),
    t('Data loss prevention policies', 'done', 'sec', -40, -30, 12, { labels: ['security'] }),
    t('Decommission Exchange 2016', 'done', 'eng', -30, -22, 12, { labels: ['exchange'] }),
    t('Shut down old file servers', 'done', 'eng', -28, -22, 6, { labels: ['sharepoint'] }),
    t('Project closure report', 'done', 'lead', -24, -21, 4, { labels: ['documentation'] }),
  ],
};

/* ───────────────────────────── KHH ───────────────────────────── */

const KHH: ProjectSpec = {
  key: 'KHH',
  name: 'Kaohsiung office opening',
  description: [
    'IT for the new Kaohsiung sales and service office (25 staff, opening next quarter):',
    '',
    '- WAN circuit and SD-WAN edge, local switching and Wi-Fi',
    '- Laptops, printers and badge readers',
    '- Service desk coverage and a local IT contact',
  ].join('\n'),
  status: 'proposed',
  health: 'on_track',
  priority: 'medium',
  visibility: 'internal',
  dept: 'IT-INFRA',
  budgetHours: 800,
  start: 21,
  target: 112,
  owner: 'owner',
  members: [
    { slot: 'owner', who: { dept: 'IT', index: 0 }, role: 'manager', allocation: 20 },
    { slot: 'net', who: { dept: 'IT-INFRA', index: 2 }, role: 'member', allocation: 20 },
    { slot: 'sd', who: { username: 'helpdesk' }, role: 'member', allocation: 10 },
  ],
  milestones: [
    { name: 'Site ready', due: 60 },
    { name: 'Office open', due: 110 },
  ],
  tasks: [
    t('Confirm the floor plan with Facilities', 'todo', 'owner', 21, 28, 4, {
      milestone: 0,
      labels: ['facilities'],
    }),
    t('Order the WAN circuit (Chunghwa Telecom)', 'todo', 'owner', 22, 30, 4, {
      milestone: 0,
      priority: 'high',
      labels: ['procurement', 'wan'],
    }),
    t('Design the network for the Kaohsiung office', 'backlog', 'net', 25, 40, 24, {
      milestone: 0,
      labels: ['design', 'kaohsiung'],
    }),
    t('Plan Wi-Fi coverage', 'backlog', 'net', 35, 45, 12, { milestone: 0, labels: ['wifi', 'kaohsiung'] }),
    t('Cabling and comms rack installation', 'backlog', 'net', 45, 60, 30, {
      milestone: 0,
      labels: ['cabling', 'kaohsiung'],
    }),
    t('Order laptops for 25 staff', 'backlog', 'owner', 40, 55, 6, { milestone: 1, labels: ['procurement'] }),
    t('Printers and badge readers', 'backlog', 'net', 70, 85, 12, { milestone: 1, labels: ['facilities'] }),
    t('Register the site and devices in the CMDB', 'backlog', 'net', 80, 95, 8, {
      milestone: 1,
      labels: ['documentation'],
    }),
    t('Service desk support plan for Kaohsiung', 'backlog', 'sd', 70, 100, 12, {
      milestone: 1,
      labels: ['support'],
    }),
    t('Opening day IT support on site', 'backlog', 'sd', 108, 110, 16, {
      milestone: 1,
      labels: ['support', 'kaohsiung'],
    }),
    t('Local admin rights policy for Kaohsiung laptops', 'backlog', 'owner', 50, 58, 4, {
      milestone: 1,
      labels: ['policy'],
    }),
    t('Printer queues on print-srv-01', 'backlog', 'net', 85, 90, 4, { milestone: 1, labels: ['printing'] }),
  ],
};

/* ───────────────────────────── ITSM ───────────────────────────── */

const ITSM: ProjectSpec = {
  key: 'ITSM',
  name: 'Service desk platform rollout',
  description: [
    'Move the service desk to IS Big Platform: incidents, requests, changes, SLAs and the knowledge base.',
    '',
    'Go-live is planned after agent training; the legacy tool stays read-only for six months.',
  ].join('\n'),
  status: 'active',
  health: 'on_track',
  healthNote: 'Catalog and SLAs are configured; agent training starts this week.',
  priority: 'high',
  visibility: 'internal',
  dept: 'IT-SD',
  budgetHours: 700,
  start: -45,
  target: 42,
  owner: 'admin',
  members: [
    { slot: 'admin', who: { username: 'admin' }, role: 'manager', allocation: 30 },
    { slot: 'helpdesk', who: { username: 'helpdesk' }, role: 'member', allocation: 50 },
    { slot: 'agent1', who: { dept: 'IT-SD', index: 0 }, role: 'member', allocation: 40 },
    { slot: 'agent2', who: { dept: 'IT-SD', index: 4 }, role: 'member', allocation: 40 },
    { slot: 'app', who: { dept: 'IT-APP', index: 4 }, role: 'member', allocation: 30 },
    { slot: 'hr', who: { username: 'hr.partner' }, role: 'viewer', allocation: 0 },
  ],
  milestones: [
    { name: 'Service catalog configured', due: -14, done: true },
    { name: 'Agent training', due: 8 },
    { name: 'Go-live', due: 22 },
    { name: 'Knowledge base migrated', due: 40 },
  ],
  history: [
    ['status', 'proposed', 'active', null, 46, 'admin'],
    [
      'health',
      null,
      'on_track',
      'Catalog and SLAs are configured; agent training starts this week.',
      2,
      'admin',
    ],
  ],
  tasks: [
    t('Define incident categories and priorities', 'done', 'helpdesk', -44, -36, 12, {
      milestone: 0,
      labels: ['configuration'],
    }),
    t('Configure SLA policies and business calendars', 'done', 'helpdesk', -36, -28, 16, {
      milestone: 0,
      labels: ['sla'],
    }),
    t('Build request form: new laptop', 'done', 'agent1', -30, -22, 8, { milestone: 0, labels: ['catalog'] }),
    t('Build request form: VPN access', 'done', 'agent1', -28, -20, 6, { milestone: 0, labels: ['catalog'] }),
    t('Build request form: software installation', 'done', 'agent2', -26, -16, 6, {
      milestone: 0,
      labels: ['catalog'],
    }),
    t('Set up the CAB group and change workflow', 'done', 'admin', -24, -15, 8, {
      milestone: 0,
      labels: ['change'],
    }),
    t('Map legacy statuses to the new statuses', 'done', 'app', -20, -12, 6, {
      milestone: 0,
      labels: ['migration'],
    }),
    t('Train Tier-1 agents on the new service desk', 'in_progress', 'helpdesk', -1, 3, 16, {
      remaining: 12,
      milestone: 1,
      priority: 'high',
      labels: ['training'],
      comments: [['helpdesk', '第一梯次訓練已完成，第二梯次排在週四下午。', 1]],
    }),
    t('Record short training videos', 'todo', 'helpdesk', 0, 4, 8, { milestone: 1, labels: ['training'] }),
    t('Write knowledge articles for the top 20 issues', 'in_progress', 'helpdesk', -7, 2, 20, {
      remaining: 9,
      milestone: 3,
      labels: ['knowledge'],
    }),
    t('Train Tokyo agents (Japanese session)', 'todo', 'agent2', 2, 6, 6, {
      milestone: 1,
      labels: ['training', 'tokyo'],
    }),
    t('Import 2025 tickets from the legacy tool', 'in_progress', 'app', -6, 5, 24, {
      remaining: 14,
      milestone: 2,
      labels: ['migration'],
      comments: [
        ['app', 'First import ran on the test database: 48,213 tickets, 37 failed on missing categories.', 2],
      ],
    }),
    t('Set up the email channel (servicedesk@)', 'in_review', 'app', -5, -1, 6, {
      remaining: 1,
      milestone: 2,
      labels: ['channels'],
    }),
    t('Configure the CSAT survey', 'todo', 'helpdesk', 3, 9, 4, { milestone: 2, labels: ['configuration'] }),
    t('Define the major incident process', 'todo', 'helpdesk', -3, -1, 6, {
      milestone: 2,
      priority: 'high',
      labels: ['process'],
    }),
    t('Teams notifications for P1 incidents', 'todo', 'app', 6, 12, 6, {
      milestone: 2,
      labels: ['channels'],
    }),
    t('Service desk lead dashboard', 'backlog', 'agent1', 10, 18, 8, { milestone: 2, labels: ['reporting'] }),
    t('On-call rota for after-hours P1s', 'todo', 'agent1', 4, 10, 4, { milestone: 2, labels: ['process'] }),
    t('Migrate canned responses', 'backlog', 'agent2', 12, 18, 6, { milestone: 2, labels: ['migration'] }),
    t('Go-live communication to all staff', 'backlog', 'admin', 16, 21, 4, {
      milestone: 2,
      labels: ['communication'],
    }),
    t('Hypercare: daily triage stand-up', 'backlog', 'helpdesk', 22, 36, 10, { labels: ['hypercare'] }),
    t('Migrate legacy knowledge base articles', 'backlog', 'agent2', 24, 40, 24, {
      milestone: 3,
      labels: ['knowledge', 'migration'],
    }),
    t('Retire the legacy ticket tool', 'backlog', 'app', 180, 190, 8, { labels: ['migration'] }),
    t('Request form: new hire bundle', 'todo', 'agent1', 1, 5, 8, { labels: ['catalog'] }),
    t('Request form: printer issue', 'cancelled', 'agent2', -20, -15, 4, { labels: ['catalog'] }),
    t('Auto-assignment rules by category', 'in_progress', 'helpdesk', -2, 5, 8, {
      remaining: 6,
      milestone: 2,
      labels: ['configuration'],
    }),
    t('Approval matrix for software requests', 'todo', 'admin', 5, 12, 4, { labels: ['process'] }),
    t('SLA breach report for the CIO', 'todo', 'agent1', 7, 14, 6, { labels: ['reporting', 'sla'] }),
    t('Train change managers on the CAB workflow', 'todo', 'admin', 9, 12, 4, {
      milestone: 1,
      labels: ['training', 'change'],
    }),
  ],
};

export const PROJECT_SPECS: ProjectSpec[] = [NET, ERP, ZTA, M365, KHH, ITSM];
