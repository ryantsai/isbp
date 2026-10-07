/**
 * State of the ServiceDesk Plus (on-premises) stand-in and its deterministic "Contoso" demo data. Records are kept in
 * ServiceDesk Plus' own JSON shapes (`{ "status": { "id", "name" } }`, `{ "value", "display_value" }` times),
 * so the API routes can return them as they are.
 *
 * People use the e-mail addresses of a fresh ISBP seed (`<username>@isbp.example`), so the hub matches them,
 * plus two people of Contoso's managed-service provider (`@contoso-msp.example`) who have no ISBP account.
 * Nine assets carry the serial numbers of ISBP's seeded servers and network gear, so a first sync links them.
 * Two solutions have the titles of seeded Knowledge Base articles.
 */

export type Rec = Record<string, unknown>;

export interface SdpUser {
  id: string;
  name: string;
  email_id: string;
  is_technician: boolean;
}

export interface Named {
  id: string;
  name: string;
  /** Products belong to a product type. */
  product_type?: { id: string; name: string };
}

/** Setup lists (picklists), keyed as their API paths (`/api/v3/<key>`). */
export const PICKLISTS = {
  statuses: ['Open', 'Assigned', 'In Progress', 'On Hold', 'Resolved', 'Closed', 'Canceled'],
  problem_statuses: ['Open', 'In Progress', 'On Hold', 'Resolved', 'Closed'],
  priorities: ['Low', 'Normal', 'Medium', 'High'],
  impacts: ['Affects User', 'Affects Group', 'Affects Department', 'Affects Business'],
  urgencies: ['Low', 'Normal', 'High', 'Urgent'],
  categories: ['Access', 'Email', 'Hardware', 'Network', 'Security', 'Software', 'Other'],
  subcategories: ['VPN', 'Wi-Fi', 'Laptop', 'Monitor', 'Printer', 'Mailbox', 'Installation', 'Permissions'],
  groups: ['Service Desk', 'Desktop Support', 'Network', 'Security', 'Database'],
  request_types: ['Incident', 'Service Request'],
  modes: ['E-Mail', 'Phone Call', 'Web Form'],
  levels: ['Tier 1', 'Tier 2', 'Tier 3'],
  change_types: ['Minor', 'Standard', 'Major', 'Significant', 'Emergency'],
  change_risks: ['Low', 'Medium', 'High', 'Very High'],
  reasons_for_change: ['Upgrade', 'Maintenance', 'Compliance', 'Bug Fix', 'New Requirement'],
  change_stages: ['Submission', 'Planning', 'CAB Evaluation', 'Implementation', 'Review', 'Close'],
  change_statuses: [
    'Requested',
    'Planning In Progress',
    'Pending Approval',
    'Approved',
    'Rejected',
    'In Progress',
    'Completed',
    'On Hold',
    'Canceled',
  ],
  asset_states: ['In Use', 'In Store', 'In Repair', 'Expired', 'Disposed'],
  product_types: [
    'Laptop',
    'Workstation',
    'Monitor',
    'Server',
    'Switch',
    'Router',
    'Firewall',
    'Access Point',
    'Storage',
    'Printer',
    'Smart Phone',
    'Tablet',
  ],
  vendors: ['Dell Technologies', 'Cisco Systems', 'Fortinet', 'Synology', 'Lenovo', 'Apple', 'HP Inc.'],
  topics: [
    'Accounts & Passwords',
    'Network & VPN',
    'Email & Calendar',
    'Printers',
    'Hardware',
    'Software',
    'Security',
  ],
  solution_statuses: ['UnApproved', 'Approved', 'Approval Pending', 'Rejected', 'Expired'],
} as const;

export type PicklistKey = keyof typeof PICKLISTS | 'products';

/** Setup lists the API serves at `/api/v3/<key>` (the others exist only as record values). */
export const PUBLIC_PICKLISTS: readonly PicklistKey[] = [
  'statuses',
  'priorities',
  'impacts',
  'urgencies',
  'categories',
  'subcategories',
  'groups',
  'request_types',
  'modes',
  'levels',
  'change_types',
  'change_risks',
  'reasons_for_change',
  'product_types',
  'products',
  'vendors',
  'topics',
];

export interface SdpState {
  version: 1;
  /** Next record id (ServiceDesk Plus ids are long numbers, sent as strings). */
  nextId: number;
  /** Next display id per module. */
  seq: { request: number; problem: number; change: number; solution: number; asset: number };
  users: SdpUser[];
  picklists: Record<string, Named[]>;
  requests: Rec[];
  problems: Rec[];
  changes: Rec[];
  assets: Rec[];
  solutions: Rec[];
  /** Request id → its notes. */
  notes: Record<string, Rec[]>;
}

export const ID_BASE = 100_000_000_000_000;

export function newId(state: SdpState): string {
  return String(ID_BASE + state.nextId++);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `{ value: "<ms>", display_value: "Oct 7, 2026 09:30 AM" }` (UTC). */
export function timeValue(ms: number): { value: string; display_value: string } {
  const d = new Date(ms);
  const h = d.getUTCHours();
  const hh = String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return {
    value: String(ms),
    display_value: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${hh}:${mm} ${h < 12 ? 'AM' : 'PM'}`,
  };
}

/** A date as ServiceDesk Plus stores it: midnight of the day (the mock's server runs in UTC). */
export function dateValue(day: string): { value: string; display_value: string } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  return { value: String(ms), display_value: `${MONTHS[m - 1]} ${d}, ${y}` };
}

/* ───────────────────────────── seed ───────────────────────────── */

const DAY = 86_400_000;
const HOUR = 3_600_000;

const USERS: Omit<SdpUser, 'id'>[] = [
  { name: 'Platform Admin', email_id: 'admin@isbp.example', is_technician: true },
  { name: '林雅婷', email_id: 'helpdesk@isbp.example', is_technician: true },
  { name: '佐藤 美咲', email_id: 'hr.partner@isbp.example', is_technician: false },
  { name: 'Olivia Bennett', email_id: 'auditor@isbp.example', is_technician: false },
  { name: 'Kenji Mori', email_id: 'kenji.mori@contoso-msp.example', is_technician: true },
  { name: 'Dana Whitfield', email_id: 'dana.whitfield@contoso-msp.example', is_technician: false },
  /** The technician the demo API key belongs to (writes through the API are made as this person). */
  { name: 'ISBP Integration', email_id: 'svc-isbp@isbp.example', is_technician: true },
];

type Who = 'admin' | 'helpdesk' | 'hr' | 'auditor' | 'kenji' | 'dana';
const WHO: Record<Who, string> = {
  admin: 'admin@isbp.example',
  helpdesk: 'helpdesk@isbp.example',
  hr: 'hr.partner@isbp.example',
  auditor: 'auditor@isbp.example',
  kenji: 'kenji.mori@contoso-msp.example',
  dana: 'dana.whitfield@contoso-msp.example',
};

/** How bad a seeded record is, and the priority, impact and urgency a fresh installation names for it. */
type Prio = 'Low' | 'Normal' | 'Medium' | 'High' | 'Urgent';
const LEVELS: Record<Prio, { priority: string; impact: string; urgency: string }> = {
  Urgent: { priority: 'High', impact: 'Affects Business', urgency: 'Urgent' },
  High: { priority: 'High', impact: 'Affects Department', urgency: 'High' },
  Medium: { priority: 'Medium', impact: 'Affects Group', urgency: 'Normal' },
  Normal: { priority: 'Normal', impact: 'Affects User', urgency: 'Normal' },
  Low: { priority: 'Low', impact: 'Affects User', urgency: 'Low' },
};

interface RequestSeed {
  subject: string;
  type: 'Incident' | 'Service Request';
  status: string;
  priority: Prio;
  category: string;
  subcategory?: string;
  group: string;
  technician?: Who;
  requester: Who;
  /** Days since created. */
  created: number;
  /** Hours since last updated. */
  updated: number;
  description: string;
  resolution?: string;
}

const REQUESTS: RequestSeed[] = [
  {
    subject: 'VPN disconnects every few minutes when working from home',
    type: 'Incident',
    status: 'In Progress',
    priority: 'High',
    category: 'Network',
    subcategory: 'VPN',
    group: 'Network',
    technician: 'helpdesk',
    requester: 'hr',
    created: 3,
    updated: 2,
    description:
      '<p>Since Monday my VPN connection drops every <b>5–10 minutes</b>. I have to reconnect and lose my Teams calls.</p><p>Home Wi-Fi works fine otherwise.</p>',
  },
  {
    subject: 'Laptop battery drains within an hour',
    type: 'Incident',
    status: 'Open',
    priority: 'Medium',
    category: 'Hardware',
    subcategory: 'Laptop',
    group: 'Desktop Support',
    requester: 'auditor',
    created: 1,
    updated: 20,
    description:
      '<p>My Latitude battery goes from 100% to 10% in about an hour, even with only Outlook open.</p>',
  },
  {
    subject: 'New starter laptop for Finance analyst',
    type: 'Service Request',
    status: 'In Progress',
    priority: 'Medium',
    category: 'Hardware',
    subcategory: 'Laptop',
    group: 'Desktop Support',
    technician: 'helpdesk',
    requester: 'admin',
    created: 6,
    updated: 30,
    description:
      '<p>Please prepare a standard Finance laptop for a new analyst starting on the 1st.</p><ul><li>Standard image</li><li>ERP client</li><li>Docking station</li></ul>',
  },
  {
    subject: 'Cannot access the Finance shared drive',
    type: 'Incident',
    status: 'Resolved',
    priority: 'Medium',
    category: 'Access',
    subcategory: 'Permissions',
    group: 'Service Desk',
    technician: 'helpdesk',
    requester: 'hr',
    created: 9,
    updated: 70,
    description: '<p>Access denied when opening the Finance share since this morning.</p>',
    resolution:
      '<p>Re-added the user to the <b>FIN-Share-Read</b> group and asked them to sign out and in again.</p>',
  },
  {
    subject: 'Outlook keeps asking for my password',
    type: 'Incident',
    status: 'Closed',
    priority: 'Low',
    category: 'Email',
    subcategory: 'Mailbox',
    group: 'Service Desk',
    technician: 'kenji',
    requester: 'auditor',
    created: 21,
    updated: 400,
    description: '<p>Outlook prompts for credentials every time it starts.</p>',
    resolution: '<p>Cleared cached credentials in Credential Manager and recreated the Outlook profile.</p>',
  },
  {
    subject: 'Install Visio Professional',
    type: 'Service Request',
    status: 'Open',
    priority: 'Normal',
    category: 'Software',
    subcategory: 'Installation',
    group: 'Service Desk',
    requester: 'hr',
    created: 2,
    updated: 40,
    description: '<p>I need Visio to update the org charts for the next reorganisation.</p>',
  },
  {
    subject: 'Wi-Fi drops in meeting room 12A',
    type: 'Incident',
    status: 'On Hold',
    priority: 'Medium',
    category: 'Network',
    subcategory: 'Wi-Fi',
    group: 'Network',
    technician: 'kenji',
    requester: 'admin',
    created: 5,
    updated: 26,
    description:
      '<p>Laptops lose Wi-Fi in room 12A during video calls. Other rooms on the floor are fine.</p>',
  },
  {
    subject: 'Access to the ERP reporting module',
    type: 'Service Request',
    status: 'Open',
    priority: 'Medium',
    category: 'Access',
    subcategory: 'Permissions',
    group: 'Security',
    requester: 'dana',
    created: 1,
    updated: 9,
    description: '<p>Our MSP analysts need read access to ERP reports for the monthly service review.</p>',
  },
  {
    subject: 'Printer on 3F prints blank pages',
    type: 'Incident',
    status: 'Resolved',
    priority: 'Low',
    category: 'Hardware',
    subcategory: 'Printer',
    group: 'Desktop Support',
    technician: 'helpdesk',
    requester: 'hr',
    created: 12,
    updated: 150,
    description: '<p>Every job on the 3F printer comes out blank.</p>',
    resolution: '<p>Rolled back the printer firmware to 2.1.4 (see the related problem).</p>',
  },
  {
    subject: 'Phishing e-mail reported: invoice overdue',
    type: 'Incident',
    status: 'Closed',
    priority: 'High',
    category: 'Security',
    group: 'Security',
    technician: 'admin',
    requester: 'auditor',
    created: 15,
    updated: 300,
    description:
      '<p>Received an e-mail asking to pay an overdue invoice through an unknown link. Not clicked.</p>',
    resolution: '<p>Message purged from all mailboxes; sender domain blocked.</p>',
  },
  {
    subject: 'Monitor flickers after docking',
    type: 'Incident',
    status: 'Open',
    priority: 'Low',
    category: 'Hardware',
    subcategory: 'Monitor',
    group: 'Desktop Support',
    requester: 'dana',
    created: 2,
    updated: 44,
    description: '<p>The external monitor flickers for a minute every time I dock the laptop.</p>',
  },
  {
    subject: 'Reset MFA for travelling sales manager',
    type: 'Service Request',
    status: 'Resolved',
    priority: 'High',
    category: 'Access',
    group: 'Service Desk',
    technician: 'helpdesk',
    requester: 'admin',
    created: 4,
    updated: 60,
    description: '<p>Our sales manager lost his phone in Osaka and cannot approve sign-ins.</p>',
    resolution: '<p>Identity verified by phone with the manager; MFA methods reset and re-registered.</p>',
  },
  {
    subject: 'Teams camera not detected',
    type: 'Incident',
    status: 'In Progress',
    priority: 'Normal',
    category: 'Software',
    group: 'Service Desk',
    technician: 'helpdesk',
    requester: 'hr',
    created: 2,
    updated: 5,
    description: '<p>Teams says no camera is available, but the camera works in the Camera app.</p>',
  },
  {
    subject: 'Increase mailbox quota',
    type: 'Service Request',
    status: 'Closed',
    priority: 'Low',
    category: 'Email',
    subcategory: 'Mailbox',
    group: 'Service Desk',
    technician: 'kenji',
    requester: 'auditor',
    created: 30,
    updated: 600,
    description: '<p>My mailbox is at 98%. Please increase the quota.</p>',
    resolution: '<p>Archive policy enabled and quota raised to 100 GB.</p>',
  },
  {
    subject: 'Slow file transfers between Taipei and Tokyo',
    type: 'Incident',
    status: 'In Progress',
    priority: 'High',
    category: 'Network',
    group: 'Network',
    technician: 'admin',
    requester: 'admin',
    created: 7,
    updated: 12,
    description: '<p>Copying files from the Taipei file server to Tokyo runs at under 1 MB/s.</p>',
  },
  {
    subject: 'Install Adobe Acrobat Pro',
    type: 'Service Request',
    status: 'Canceled',
    priority: 'Low',
    category: 'Software',
    subcategory: 'Installation',
    group: 'Service Desk',
    requester: 'hr',
    created: 18,
    updated: 380,
    description: '<p>Needed to edit contract PDFs. No longer needed.</p>',
  },
  {
    subject: 'Docking station does not charge the laptop',
    type: 'Incident',
    status: 'Open',
    priority: 'Medium',
    category: 'Hardware',
    group: 'Desktop Support',
    requester: 'auditor',
    created: 1,
    updated: 18,
    description: '<p>The laptop shows "plugged in, not charging" on the dock.</p>',
  },
  {
    subject: 'Guest Wi-Fi access for external auditors',
    type: 'Service Request',
    status: 'Resolved',
    priority: 'Low',
    category: 'Network',
    subcategory: 'Wi-Fi',
    group: 'Network',
    technician: 'kenji',
    requester: 'auditor',
    created: 10,
    updated: 200,
    description: '<p>Three external auditors need guest Wi-Fi for two weeks.</p>',
    resolution: '<p>Sponsored guest accounts created, valid for 14 days.</p>',
  },
  {
    subject: 'Password expired, cannot sign in',
    type: 'Incident',
    status: 'Closed',
    priority: 'Urgent',
    category: 'Access',
    group: 'Service Desk',
    technician: 'helpdesk',
    requester: 'dana',
    created: 8,
    // #1019–#1021 were bulk-edited together: they share one last-updated millisecond.
    updated: 100,
    description: '<p>My password expired while travelling and the self-service reset does not work.</p>',
    resolution: '<p>Temporary password issued after identity verification.</p>',
  },
  {
    subject: 'ERP shows "session expired" right after sign-in',
    type: 'Incident',
    status: 'Open',
    priority: 'High',
    category: 'Software',
    group: 'Database',
    technician: 'admin',
    requester: 'hr',
    created: 5,
    updated: 100,
    description: '<p>The ERP client signs me out immediately with "session expired".</p>',
  },
  {
    subject: 'Second monitor for the HR desk',
    type: 'Service Request',
    status: 'In Progress',
    priority: 'Low',
    category: 'Hardware',
    subcategory: 'Monitor',
    group: 'Desktop Support',
    technician: 'helpdesk',
    requester: 'hr',
    created: 5,
    updated: 100,
    description: '<p>Please add a second 27" monitor to desk HR-09.</p>',
  },
  {
    subject: 'Suspicious sign-in alert from overseas',
    type: 'Incident',
    status: 'In Progress',
    priority: 'Urgent',
    category: 'Security',
    group: 'Security',
    technician: 'admin',
    requester: 'auditor',
    created: 1,
    updated: 1,
    description: '<p>I received an alert about a sign-in from a country I have never visited.</p>',
  },
  {
    subject: 'Shared mailbox for the Recruitment team',
    type: 'Service Request',
    status: 'Open',
    priority: 'Normal',
    category: 'Email',
    subcategory: 'Mailbox',
    group: 'Service Desk',
    requester: 'hr',
    created: 3,
    updated: 50,
    description: '<p>Please create recruitment@ with access for the four recruiters.</p>',
  },
  {
    subject: 'Print queue stuck on the HR printer',
    type: 'Incident',
    status: 'Open',
    priority: 'Medium',
    category: 'Hardware',
    subcategory: 'Printer',
    group: 'Desktop Support',
    requester: 'hr',
    created: 1,
    updated: 3,
    description: '<p>Jobs stay "printing" and nothing comes out.</p>',
  },
  {
    subject: 'Tableau licence for the analytics team',
    type: 'Service Request',
    status: 'Open',
    priority: 'Medium',
    category: 'Software',
    group: 'Service Desk',
    requester: 'auditor',
    created: 2,
    updated: 7,
    description: '<p>Two Tableau Creator licences for the audit analytics work.</p>',
  },
];

const NOTES: { request: number; by: Who; hours: number; public: boolean; html: string }[] = [
  {
    request: 0,
    by: 'helpdesk',
    hours: 50,
    public: true,
    html: '<p>Thanks for reporting. Could you send us the VPN client log (Help → Export logs)?</p>',
  },
  {
    request: 0,
    by: 'helpdesk',
    hours: 3,
    public: false,
    html: '<p>Same pattern as PB-1: client 5.2 on home routers with SIP ALG. Escalated to Network.</p>',
  },
  {
    request: 6,
    by: 'kenji',
    hours: 26,
    public: true,
    html: '<p>Waiting for the access point replacement scheduled in CH-4.</p>',
  },
  {
    request: 12,
    by: 'helpdesk',
    hours: 5,
    public: false,
    html: '<p>Camera privacy setting was reset by the last feature update. Checking other devices.</p>',
  },
  {
    request: 21,
    by: 'admin',
    hours: 1,
    public: false,
    html: '<p>Session revoked and password reset forced. Reviewing sign-in logs with Security.</p>',
  },
];

const PROBLEMS: {
  title: string;
  status: string;
  priority: Prio;
  category: string;
  group: string;
  technician: Who;
  reported_by: Who;
  created: number;
  updated: number;
  description: string;
  root_cause?: string;
  workaround?: string;
  resolution?: string;
  known_error?: boolean;
}[] = [
  {
    title: 'Recurring VPN drops with client 5.2',
    status: 'In Progress',
    priority: 'High',
    category: 'Network',
    group: 'Network',
    technician: 'admin',
    reported_by: 'helpdesk',
    created: 20,
    updated: 4,
    description:
      '<p>Several users on VPN client 5.2 lose the tunnel every few minutes from home networks.</p>',
    root_cause: '<p>Client 5.2 keep-alives are dropped by consumer routers with SIP ALG enabled.</p>',
    workaround: '<p>Switch the client to TCP mode (Settings → Advanced → Transport).</p>',
    known_error: true,
  },
  {
    title: 'ERP session timeouts under load',
    status: 'In Progress',
    priority: 'High',
    category: 'Software',
    group: 'Database',
    technician: 'admin',
    reported_by: 'helpdesk',
    created: 14,
    updated: 30,
    description: '<p>The ERP signs users out at peak times with "session expired".</p>',
  },
  {
    title: 'Printer firmware 2.2 prints blank pages',
    status: 'Resolved',
    priority: 'Medium',
    category: 'Hardware',
    group: 'Desktop Support',
    technician: 'helpdesk',
    reported_by: 'helpdesk',
    created: 25,
    updated: 140,
    description: '<p>Printers updated to firmware 2.2 print blank pages for PCL jobs.</p>',
    root_cause: '<p>Regression in the PCL interpreter of firmware 2.2.</p>',
    resolution: '<p>Firmware rolled back to 2.1.4 on all floors; vendor fix expected in 2.3.</p>',
  },
  {
    title: 'Wi-Fi roaming failures on the 12th floor',
    status: 'Open',
    priority: 'Medium',
    category: 'Network',
    group: 'Network',
    technician: 'kenji',
    reported_by: 'kenji',
    created: 6,
    updated: 24,
    description: '<p>Clients fail to roam between the two access points serving rooms 12A–12C.</p>',
  },
  {
    title: 'Outlook credential prompts after a password change',
    status: 'Closed',
    priority: 'Low',
    category: 'Email',
    group: 'Service Desk',
    technician: 'helpdesk',
    reported_by: 'helpdesk',
    created: 60,
    updated: 900,
    description: '<p>Outlook keeps prompting for credentials after users change their password.</p>',
    resolution: '<p>Modern authentication enforced for all clients.</p>',
  },
];

const CHANGES: {
  title: string;
  change_type: string;
  risk: string;
  stage: string;
  status: string;
  priority: Prio;
  group: string;
  owner: Who;
  requester: Who;
  reason: string;
  created: number;
  updated: number;
  /** Days from now (negative: past). */
  start: number;
  hours: number;
  description: string;
  rollOut: string;
  backOut: string;
}[] = [
  {
    title: 'Upgrade the VPN client to 5.3',
    change_type: 'Minor',
    risk: 'Medium',
    stage: 'Planning',
    status: 'Planning In Progress',
    priority: 'High',
    group: 'Network',
    owner: 'admin',
    requester: 'helpdesk',
    reason: 'Bug Fix',
    created: 5,
    updated: 6,
    start: 7,
    hours: 4,
    description: '<p>Roll out VPN client 5.3, which fixes the keep-alive problem (PB-1).</p>',
    rollOut:
      '<ol><li>Pilot with IT (20 devices)</li><li>Deploy to all laptops through Intune in waves</li></ol>',
    backOut: '<p>Redeploy client 5.1 from the Intune catalogue.</p>',
  },
  {
    title: 'Replace core switch tpe-sw-core-01',
    change_type: 'Major',
    risk: 'High',
    stage: 'CAB Evaluation',
    status: 'Pending Approval',
    priority: 'High',
    group: 'Network',
    owner: 'kenji',
    requester: 'admin',
    reason: 'Upgrade',
    created: 12,
    updated: 28,
    start: 14,
    hours: 6,
    description: '<p>Replace the end-of-support core switch with the new Catalyst 9300 stack.</p>',
    rollOut: '<p>Migrate uplinks port by port during the Saturday maintenance window.</p>',
    backOut: '<p>Move uplinks back to the old switch; it stays racked until the following week.</p>',
  },
  {
    title: 'Apply the ERP database patch',
    change_type: 'Significant',
    risk: 'Medium',
    stage: 'Implementation',
    status: 'In Progress',
    priority: 'Medium',
    group: 'Database',
    owner: 'admin',
    requester: 'admin',
    reason: 'Maintenance',
    created: 9,
    updated: 8,
    start: 0,
    hours: 3,
    description: '<p>Apply the vendor patch for the session-timeout defect (PB-2).</p>',
    rollOut: '<p>Patch erp-db-01 after a full backup; restart the application tier.</p>',
    backOut: '<p>Restore from the pre-patch backup.</p>',
  },
  {
    title: 'Add Wi-Fi access points on 12F',
    change_type: 'Minor',
    risk: 'Low',
    stage: 'Close',
    status: 'Completed',
    priority: 'Medium',
    group: 'Network',
    owner: 'kenji',
    requester: 'kenji',
    reason: 'New Requirement',
    created: 20,
    updated: 72,
    start: -4,
    hours: 2,
    description: '<p>Two additional access points for meeting rooms 12A–12C.</p>',
    rollOut: '<p>Mount and adopt the access points; update the RF plan.</p>',
    backOut: '<p>Disable the new access points in the controller.</p>',
  },
  {
    title: 'Rotate the firewall certificates',
    change_type: 'Standard',
    risk: 'Low',
    stage: 'Submission',
    status: 'Requested',
    priority: 'Low',
    group: 'Security',
    owner: 'admin',
    requester: 'auditor',
    reason: 'Compliance',
    created: 1,
    updated: 10,
    start: 21,
    hours: 1,
    description: '<p>Yearly rotation of the TLS inspection and VPN certificates.</p>',
    rollOut: '<p>Import the new certificates and switch the profiles.</p>',
    backOut: '<p>Switch the profiles back to the current certificates.</p>',
  },
];

interface AssetSeed {
  name: string;
  tag: string;
  product: string;
  type: string;
  vendor: string;
  serial: string;
  state: string;
  user?: Who;
  location: string;
  cost: number;
  /** Months since acquired. */
  age: number;
  warrantyMonths: number;
  ip?: string;
  updated: number;
}

/** ISBP's seeded infrastructure (`modules/itam/src/server/seed-data.ts`), same names and serials. */
const INFRA: AssetSeed[] = [
  ['tpe-esx-01', 'CTS-SRV-001', 'DLRS7601', 30, 'Rack A1', '10.10.1.11'],
  ['tpe-esx-02', 'CTS-SRV-002', 'DLRS7602', 30, 'Rack A1', '10.10.1.12'],
  ['erp-app-01', 'CTS-SRV-003', 'DLRS7603', 33, 'Rack A1', '10.10.2.21'],
  ['erp-db-01', 'CTS-SRV-004', 'DLRS7604', 33, 'Rack A1', '10.10.2.22'],
].map(([name, tag, serial, age, rack, ip], i) => ({
  name: name as string,
  tag: tag as string,
  product: 'Dell PowerEdge R760',
  type: 'Server',
  vendor: 'Dell Technologies',
  serial: serial as string,
  state: 'In Use',
  location: `Taipei HQ B1 Data Center, ${rack as string}`,
  cost: 480_000,
  age: age as number,
  warrantyMonths: 36,
  ip: ip as string,
  updated: 200 + i * 7,
}));

const NETWORK: AssetSeed[] = [
  {
    name: 'tpe-sw-core-01',
    tag: 'CTS-NET-001',
    product: 'Cisco Catalyst 9300',
    type: 'Switch',
    vendor: 'Cisco Systems',
    serial: 'FOC2741X0A1',
    state: 'In Use',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    cost: 260_000,
    age: 40,
    warrantyMonths: 60,
    ip: '10.10.0.2',
    updated: 28,
  },
  {
    name: 'tpe-sw-core-02',
    tag: 'CTS-NET-002',
    product: 'Cisco Catalyst 9300',
    type: 'Switch',
    vendor: 'Cisco Systems',
    serial: 'FOC2741X0A2',
    state: 'In Store',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    cost: 260_000,
    age: 4,
    warrantyMonths: 60,
    updated: 120,
  },
  {
    name: 'tpe-fw-01',
    tag: 'CTS-NET-003',
    product: 'Fortinet FortiGate 200F',
    type: 'Firewall',
    vendor: 'Fortinet',
    serial: 'FG200FT923900131',
    state: 'In Use',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    cost: 380_000,
    age: 22,
    warrantyMonths: 36,
    ip: '10.10.0.1',
    updated: 340,
  },
  {
    name: 'vpn-gw-01',
    tag: 'CTS-NET-004',
    product: 'Fortinet FortiGate 200F',
    type: 'Firewall',
    vendor: 'Fortinet',
    serial: 'FG200FT923900188',
    state: 'In Use',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    cost: 380_000,
    age: 22,
    warrantyMonths: 36,
    ip: '10.10.0.5',
    updated: 6,
  },
  {
    name: 'nas-01',
    tag: 'CTS-STO-001',
    product: 'Synology RS3621xs+',
    type: 'Storage',
    vendor: 'Synology',
    serial: '2350SQRN71C2',
    state: 'In Use',
    location: 'Taipei HQ B1 Data Center, Rack A2',
    cost: 165_000,
    age: 34,
    warrantyMonths: 60,
    ip: '10.10.3.40',
    updated: 500,
  },
];

/** Contoso's end-user devices: only in ServiceDesk Plus, so a first sync creates them in ISBP. */
const DEVICES: AssetSeed[] = (
  [
    [
      'CTS-LT-0101',
      'Dell Latitude 7450',
      'Laptop',
      'Dell Technologies',
      '7H2KQ53',
      'In Use',
      'admin',
      52_000,
      10,
    ],
    [
      'CTS-LT-0102',
      'Dell Latitude 7450',
      'Laptop',
      'Dell Technologies',
      '9F4LM63',
      'In Use',
      'helpdesk',
      52_000,
      10,
    ],
    ['CTS-LT-0103', 'Lenovo ThinkPad T14 Gen 5', 'Laptop', 'Lenovo', 'PF4XK9QA', 'In Use', 'hr', 46_000, 6],
    [
      'CTS-LT-0104',
      'Lenovo ThinkPad T14 Gen 5',
      'Laptop',
      'Lenovo',
      'PF4XK9QB',
      'In Use',
      'auditor',
      46_000,
      6,
    ],
    ['CTS-LT-0105', 'Apple MacBook Pro 14', 'Laptop', 'Apple', 'C02FK1QXMD6T', 'In Use', 'dana', 68_000, 14],
    [
      'CTS-LT-0106',
      'Dell Latitude 7450',
      'Laptop',
      'Dell Technologies',
      '3J7NR73',
      'In Store',
      null,
      52_000,
      2,
    ],
    [
      'CTS-LT-0107',
      'Dell Latitude 7450',
      'Laptop',
      'Dell Technologies',
      '5K8PS83',
      'In Store',
      null,
      52_000,
      2,
    ],
    [
      'CTS-LT-0108',
      'Lenovo ThinkPad T14 Gen 5',
      'Laptop',
      'Lenovo',
      'PF4XK9QC',
      'In Repair',
      null,
      46_000,
      18,
    ],
    ['CTS-LT-0109', 'Apple MacBook Pro 14', 'Laptop', 'Apple', 'C02FK1QXMD7V', 'In Store', null, 68_000, 1],
    [
      'CTS-LT-0110',
      'Dell Latitude 5440',
      'Laptop',
      'Dell Technologies',
      '1B3CD93',
      'Expired',
      null,
      38_000,
      50,
    ],
    [
      'CTS-DT-0201',
      'HP EliteDesk 800 G9',
      'Workstation',
      'HP Inc.',
      'MXL3290ABC',
      'In Use',
      'hr',
      32_000,
      20,
    ],
    [
      'CTS-DT-0202',
      'HP EliteDesk 800 G9',
      'Workstation',
      'HP Inc.',
      'MXL3290ABD',
      'In Use',
      null,
      32_000,
      20,
    ],
    [
      'CTS-DT-0203',
      'HP EliteDesk 800 G9',
      'Workstation',
      'HP Inc.',
      'MXL3290ABE',
      'In Store',
      null,
      32_000,
      8,
    ],
    [
      'CTS-DT-0204',
      'HP EliteDesk 800 G6',
      'Workstation',
      'HP Inc.',
      'MXL1180XYZ',
      'Disposed',
      null,
      28_000,
      62,
    ],
    [
      'CTS-MN-0301',
      'Dell UltraSharp U2724D',
      'Monitor',
      'Dell Technologies',
      'CN0K2V7D1001',
      'In Use',
      'admin',
      12_000,
      10,
    ],
    [
      'CTS-MN-0302',
      'Dell UltraSharp U2724D',
      'Monitor',
      'Dell Technologies',
      'CN0K2V7D1002',
      'In Use',
      'helpdesk',
      12_000,
      10,
    ],
    [
      'CTS-MN-0303',
      'Dell UltraSharp U2724D',
      'Monitor',
      'Dell Technologies',
      'CN0K2V7D1003',
      'In Use',
      'hr',
      12_000,
      6,
    ],
    [
      'CTS-MN-0304',
      'Dell UltraSharp U2724D',
      'Monitor',
      'Dell Technologies',
      'CN0K2V7D1004',
      'In Store',
      null,
      12_000,
      3,
    ],
    [
      'CTS-MN-0305',
      'Dell UltraSharp U2724D',
      'Monitor',
      'Dell Technologies',
      'CN0K2V7D1005',
      'In Repair',
      null,
      12_000,
      12,
    ],
    [
      'CTS-PR-0401',
      'HP LaserJet Enterprise M611',
      'Printer',
      'HP Inc.',
      'PHBQK12345',
      'In Use',
      null,
      41_000,
      26,
    ],
    ['CTS-PH-0501', 'Apple iPhone 15', 'Smart Phone', 'Apple', 'F2LXK9P1QW', 'In Use', 'admin', 33_000, 9],
  ] as const
).map(([tag, product, type, vendor, serial, state, user, cost, age], i) => ({
  name: tag,
  tag,
  product,
  type,
  vendor,
  serial,
  state,
  ...(user ? { user } : {}),
  location: type === 'Printer' ? 'Taipei HQ 3F' : user === 'dana' ? 'Remote (MSP)' : 'Taipei HQ 12F',
  cost,
  age,
  warrantyMonths: 36,
  updated: 10 + i * 13,
}));

const SOLUTIONS: {
  title: string;
  topic: string;
  status: string;
  public: boolean;
  keywords: string;
  created: number;
  updated: number;
  by: Who;
  html: string;
}[] = [
  {
    // Same title as a seeded ISBP Knowledge Base article: a first sync links them.
    title: 'Connect to the VPN from home',
    topic: 'Network & VPN',
    status: 'Approved',
    public: true,
    keywords: 'vpn,remote,home',
    created: 200,
    updated: 900,
    by: 'helpdesk',
    html: '<p>Open the VPN client, choose <b>Contoso-HQ</b> and sign in with your work account.</p><ol><li>Approve the MFA prompt.</li><li>Wait for "Connected".</li></ol>',
  },
  {
    title: 'Clear a stuck print queue',
    topic: 'Printers',
    status: 'Approved',
    public: true,
    keywords: 'printer,queue,spooler',
    created: 180,
    updated: 700,
    by: 'helpdesk',
    html: '<p>Open <b>Settings → Printers</b>, select the printer, choose <b>Open queue</b> and cancel all documents. Then turn the printer off and on.</p>',
  },
  {
    title: 'Fix Outlook password prompts after a password change',
    topic: 'Email & Calendar',
    status: 'Approved',
    public: true,
    keywords: 'outlook,password,credentials',
    created: 90,
    updated: 600,
    by: 'kenji',
    html: '<p>Remove the saved Office credentials in <b>Credential Manager</b>, then restart Outlook and sign in again.</p>',
  },
  {
    title: 'Request access to a shared folder',
    topic: 'Accounts & Passwords',
    status: 'Approved',
    public: true,
    keywords: 'share,folder,access',
    created: 120,
    updated: 500,
    by: 'helpdesk',
    html: '<p>Raise a service request with the folder path and the access you need. The folder owner approves it.</p>',
  },
  {
    title: 'Reset MFA when you get a new phone',
    topic: 'Accounts & Passwords',
    status: 'Approved',
    public: true,
    keywords: 'mfa,phone,authenticator',
    created: 60,
    updated: 300,
    by: 'admin',
    html: '<p>Before you hand in your old phone, add the new one under <b>Security info</b>. Lost the old phone? Call the Service Desk.</p>',
  },
  {
    title: 'Docking station: monitors stay black',
    topic: 'Hardware',
    status: 'Approved',
    public: true,
    keywords: 'dock,monitor,display',
    created: 45,
    updated: 200,
    by: 'helpdesk',
    html: '<p>Unplug the dock power for 30 seconds, update the dock firmware from Company Portal and reconnect.</p>',
  },
  {
    title: 'ERP signs users out immediately (technician notes)',
    topic: 'Software',
    status: 'Approved',
    public: false,
    keywords: 'erp,session,timeout',
    created: 14,
    updated: 30,
    by: 'admin',
    html: '<p>Check the application tier session store first. Workaround until CH-3: recycle the ERP app pool.</p>',
  },
  {
    title: 'Report a suspicious sign-in alert',
    topic: 'Security',
    status: 'Approval Pending',
    public: false,
    keywords: 'security,sign-in,alert',
    created: 3,
    updated: 20,
    by: 'admin',
    html: '<p>Do not approve unexpected MFA prompts. Forward the alert to the Service Desk and change your password.</p>',
  },
  {
    title: 'Install Tableau Desktop',
    topic: 'Software',
    status: 'UnApproved',
    public: false,
    keywords: 'tableau,install',
    created: 2,
    updated: 8,
    by: 'kenji',
    html: '<p>Tableau Desktop is installed from Company Portal once a licence is assigned.</p>',
  },
  {
    title: 'Set up the legacy VPN client 4.x',
    topic: 'Network & VPN',
    status: 'Expired',
    public: false,
    keywords: 'vpn,legacy',
    created: 700,
    updated: 2000,
    by: 'helpdesk',
    html: '<p>The 4.x client is no longer supported. Use the current VPN client.</p>',
  },
];

const monthsAgoDay = (now: number, months: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};
const plusMonths = (day: string, months: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** Fresh demo data, with times relative to `now` (rounded to the minute). */
export function seedSdp(nowMs: number = Date.now()): SdpState {
  const now = Math.floor(nowMs / 60_000) * 60_000;
  const state: SdpState = {
    version: 1,
    nextId: 1,
    seq: { request: 1001, problem: 1, change: 1, solution: 1, asset: 1 },
    users: [],
    picklists: {},
    requests: [],
    problems: [],
    changes: [],
    assets: [],
    solutions: [],
    notes: {},
  };
  for (const u of USERS) state.users.push({ id: newId(state), ...u });
  for (const [key, names] of Object.entries(PICKLISTS))
    state.picklists[key] = names.map((name) => ({ id: newId(state), name }));
  const pick = (key: string, name: string) => {
    const found = state.picklists[key]!.find((p) => p.name === name);
    if (!found) throw new Error(`seed: ${key} has no "${name}"`);
    return { id: found.id, name: found.name };
  };
  const user = (who: Who) => {
    const u = state.users.find((x) => x.email_id === WHO[who])!;
    return { id: u.id, name: u.name, email_id: u.email_id };
  };
  const products = new Map<string, Named>();
  for (const a of [...INFRA, ...NETWORK, ...DEVICES])
    if (!products.has(a.product))
      products.set(a.product, {
        id: newId(state),
        name: a.product,
        product_type: pick('product_types', a.type),
      });
  state.picklists.products = [...products.values()];

  REQUESTS.forEach((r, i) => {
    const created = now - r.created * DAY - (i % 7) * 37 * 60_000;
    const updated = now - r.updated * HOUR;
    const id = newId(state);
    state.requests.push({
      id,
      display_id: String(state.seq.request++),
      subject: r.subject,
      description: r.description,
      request_type: pick('request_types', r.type),
      status: pick('statuses', r.status),
      priority: pick('priorities', LEVELS[r.priority].priority),
      impact: pick('impacts', LEVELS[r.priority].impact),
      urgency: pick('urgencies', LEVELS[r.priority].urgency),
      category: pick('categories', r.category),
      subcategory: r.subcategory ? pick('subcategories', r.subcategory) : null,
      group: pick('groups', r.group),
      technician: r.technician ? user(r.technician) : null,
      requester: user(r.requester),
      mode: pick('modes', i % 3 === 0 ? 'E-Mail' : i % 3 === 1 ? 'Web Form' : 'Phone Call'),
      resolution: r.resolution ? { content: r.resolution } : null,
      due_by_time: timeValue(created + (r.priority === 'Urgent' ? 4 : r.priority === 'High' ? 8 : 72) * HOUR),
      created_time: timeValue(created),
      last_updated_time: timeValue(Math.max(updated, created)),
      is_service_request: r.type === 'Service Request',
      has_notes: false,
    });
  });
  for (const n of NOTES) {
    const req = state.requests[n.request]!;
    const list = (state.notes[String(req.id)] ??= []);
    list.push({
      id: newId(state),
      description: n.html,
      show_to_requester: n.public,
      notify_technician: false,
      mark_first_response: false,
      add_to_linked_requests: false,
      created_time: timeValue(now - n.hours * HOUR),
      created_by: user(n.by),
    });
    req.has_notes = true;
  }

  PROBLEMS.forEach((p) => {
    const created = now - p.created * DAY;
    state.problems.push({
      id: newId(state),
      display_id: displayId('PB-', state.seq.problem++),
      title: p.title,
      description: p.description,
      status: pick('problem_statuses', p.status),
      priority: pick('priorities', LEVELS[p.priority].priority),
      impact: pick('impacts', LEVELS[p.priority].impact),
      urgency: pick('urgencies', LEVELS[p.priority].urgency),
      category: pick('categories', p.category),
      subcategory: null,
      group: pick('groups', p.group),
      technician: user(p.technician),
      reported_by: user(p.reported_by),
      is_known_error: Boolean(p.known_error),
      symptoms: { symptoms_description: '' },
      root_cause: { root_cause_description: p.root_cause ?? '' },
      workaround_details: { workaround_details_description: p.workaround ?? '' },
      resolution_details: { resolution_details_description: p.resolution ?? '' },
      due_by_time: timeValue(created + 30 * DAY),
      reported_time: timeValue(created),
      updated_time: timeValue(now - p.updated * HOUR),
    });
  });

  CHANGES.forEach((c) => {
    const created = now - c.created * DAY;
    const start = Math.floor((now + c.start * DAY) / HOUR) * HOUR;
    state.changes.push({
      id: newId(state),
      display_id: displayId('CH-', state.seq.change++),
      title: c.title,
      description: c.description,
      change_type: pick('change_types', c.change_type),
      risk: pick('change_risks', c.risk),
      reason_for_change: pick('reasons_for_change', c.reason),
      stage: pick('change_stages', c.stage),
      status: pick('change_statuses', c.status),
      emergency: false,
      priority: pick('priorities', LEVELS[c.priority].priority),
      impact: pick('impacts', LEVELS[c.priority].impact),
      urgency: pick('urgencies', LEVELS[c.priority].urgency),
      category: pick(
        'categories',
        c.group === 'Database' ? 'Software' : c.group === 'Security' ? 'Security' : 'Network',
      ),
      group: pick('groups', c.group),
      change_owner: user(c.owner),
      change_manager: user('admin'),
      change_requester: user(c.requester),
      scheduled_start_time: timeValue(start),
      scheduled_end_time: timeValue(start + c.hours * HOUR),
      roll_out_plan: { roll_out_plan_description: c.rollOut },
      back_out_plan: { back_out_plan_description: c.backOut },
      // No last-update time: the change API documents none.
      created_time: timeValue(created),
    });
  });

  [...INFRA, ...NETWORK, ...DEVICES].forEach((a) => {
    const acquired = monthsAgoDay(now, a.age);
    state.assets.push({
      id: newId(state),
      name: a.name,
      asset_tag: a.tag,
      product: { id: products.get(a.product)!.id, name: a.product },
      product_type: pick('product_types', a.type),
      org_serial_number: a.serial,
      state: pick('asset_states', a.state),
      user: a.user ? user(a.user) : null,
      location: a.location,
      vendor: pick('vendors', a.vendor),
      purchase_cost: a.cost,
      acquisition_date: dateValue(acquired),
      warranty_expiry: dateValue(plusMonths(acquired, a.warrantyMonths)),
      department: null,
      ip_address: a.ip ?? null,
      created_time: timeValue(Date.parse(`${acquired}T02:00:00Z`)),
      last_updated_time: timeValue(now - a.updated * HOUR),
    });
    state.seq.asset++;
  });

  SOLUTIONS.forEach((s) => {
    state.solutions.push({
      id: newId(state),
      display_id: displayId('SOL-', state.seq.solution++),
      title: s.title,
      description: s.html,
      topic: pick('topics', s.topic),
      keywords: s.keywords,
      approval_status: pick('solution_statuses', s.status),
      is_public: s.public,
      review_date: dateValue(new Date(now + 90 * DAY).toISOString().slice(0, 10)),
      expiry_date: null,
      created_by: user(s.by),
      created_time: timeValue(now - s.created * DAY),
      last_updated_time: timeValue(now - s.updated * HOUR),
    });
  });
  return state;
}

/** `{ display_value: "PB-3", value: "3" }`. */
export function displayId(prefix: string, n: number): { display_value: string; value: string } {
  return { display_value: `${prefix}${n}`, value: String(n) };
}
