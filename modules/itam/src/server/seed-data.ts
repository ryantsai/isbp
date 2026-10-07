/**
 * Demo catalogue for a mid-size Taiwanese company (Taipei HQ, Hsinchu R&D, Kaohsiung operations and a
 * Tokyo sales office). Vendor, model, licence and contract names are **stable**: the platform's
 * cross-module seed links records by them.
 */
import type { AssetCategory, ContractBilling, ContractKind, LicenseBilling, LicenseType } from '../model';

export interface SeedVendor {
  name: string;
  website: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  notes?: string;
}

export const VENDORS: SeedVendor[] = [
  {
    name: 'Dell Technologies',
    website: 'https://www.dell.com/zh-tw',
    contactName: 'Jason Lin',
    contactEmail: 'jason.lin@dell.example',
    phone: '+886 2-2722-9500',
    notes: 'Laptops, desktops, monitors and PowerEdge servers. ProSupport Plus on all servers.',
  },
  {
    name: 'Lenovo',
    website: 'https://www.lenovo.com/tw/zh/',
    contactName: 'Amy Chou',
    contactEmail: 'amy.chou@lenovo.example',
    phone: '+886 2-8722-3888',
  },
  {
    name: 'Apple',
    website: 'https://www.apple.com/tw/business/',
    contactName: 'Apple Business Team',
    contactEmail: 'business-tw@apple.example',
    phone: '+886 0800-020-021',
  },
  {
    name: 'HP Inc.',
    website: 'https://www.hp.com/tw-zh/',
    contactName: 'Kelly Wang',
    contactEmail: 'kelly.wang@hp.example',
    phone: '+886 2-3789-5000',
    notes: 'Managed print service: printers are leased, toner included.',
  },
  {
    name: 'Cisco Systems',
    website: 'https://www.cisco.com/c/zh_tw/',
    contactName: 'Eric Huang',
    contactEmail: 'eric.huang@cisco.example',
    phone: '+886 2-8758-0000',
  },
  {
    name: 'Microsoft',
    website: 'https://www.microsoft.com/zh-tw/licensing/',
    contactName: 'EA desk (via LSP)',
    contactEmail: 'ea-taiwan@microsoft.example',
    phone: '+886 2-3725-3888',
    notes: 'Enterprise Agreement through our licensing solution partner; true-up every June.',
  },
  {
    name: 'Adobe',
    website: 'https://www.adobe.com/tw/',
    contactName: 'VIP reseller desk',
    contactEmail: 'vip@adobe-reseller.example',
    phone: '+886 2-2381-5566',
  },
  {
    name: 'Atlassian',
    website: 'https://www.atlassian.com',
    contactName: 'Atlassian Sales',
    contactEmail: 'sales@atlassian.example',
    phone: '+61 2-9262-1443',
  },
  {
    name: 'Synology',
    website: 'https://www.synology.com/zh-tw',
    contactName: 'Synology Business Support',
    contactEmail: 'business@synology.example',
    phone: '+886 2-2552-1814',
  },
  {
    name: 'Chunghwa Telecom (中華電信)',
    website: 'https://www.cht.com.tw',
    contactName: '陳先生 (企業客戶部)',
    contactEmail: 'enterprise@cht.example',
    phone: '+886 0800-080-123',
    notes: 'Leased line, mobile plans and phones for staff.',
  },
  {
    name: 'Fortinet',
    website: 'https://www.fortinet.com/tw',
    contactName: 'Vincent Wu',
    contactEmail: 'vincent.wu@fortinet.example',
    phone: '+886 2-2796-1666',
  },
  {
    name: 'Zoom Video Communications',
    website: 'https://zoom.us',
    contactName: 'Zoom Account Team',
    contactEmail: 'accounts@zoom.example',
    phone: '+1 888-799-9666',
  },
];

export interface SeedModel {
  key: string;
  category: AssetCategory;
  manufacturer: string;
  name: string;
  partNumber: string;
  lifespanMonths?: number;
  vendor: string;
  /** Typical purchase price (TWD). */
  cost: number;
  warrantyMonths: number;
}

export const MODELS: SeedModel[] = [
  {
    key: 'latitude',
    category: 'laptop',
    manufacturer: 'Dell',
    name: 'Latitude 7450',
    partNumber: 'LAT7450-i7-32',
    vendor: 'Dell Technologies',
    cost: 52_000,
    warrantyMonths: 36,
  },
  {
    key: 't14',
    category: 'laptop',
    manufacturer: 'Lenovo',
    name: 'ThinkPad T14 Gen 5',
    partNumber: '21ML-CTO1WW',
    vendor: 'Lenovo',
    cost: 45_000,
    warrantyMonths: 36,
  },
  {
    key: 'x1',
    category: 'laptop',
    manufacturer: 'Lenovo',
    name: 'ThinkPad X1 Carbon Gen 12',
    partNumber: '21KC-CTO1WW',
    vendor: 'Lenovo',
    cost: 62_000,
    warrantyMonths: 36,
  },
  {
    key: 'mbp',
    category: 'laptop',
    manufacturer: 'Apple',
    name: 'MacBook Pro 14 (M4)',
    partNumber: 'MX2E3TA/A',
    vendor: 'Apple',
    cost: 69_900,
    warrantyMonths: 36,
  },
  {
    key: 'optiplex',
    category: 'desktop',
    manufacturer: 'Dell',
    name: 'OptiPlex 7020',
    partNumber: 'OPT7020-SFF',
    vendor: 'Dell Technologies',
    cost: 28_000,
    warrantyMonths: 36,
  },
  {
    key: 'u2724d',
    category: 'monitor',
    manufacturer: 'Dell',
    name: 'U2724D',
    partNumber: 'U2724D',
    vendor: 'Dell Technologies',
    cost: 12_500,
    warrantyMonths: 36,
  },
  {
    key: 'iphone',
    category: 'phone',
    manufacturer: 'Apple',
    name: 'iPhone 16',
    partNumber: 'MYE73ZP/A',
    vendor: 'Chunghwa Telecom (中華電信)',
    cost: 29_900,
    warrantyMonths: 12,
  },
  {
    key: 'galaxy',
    category: 'phone',
    manufacturer: 'Samsung',
    name: 'Galaxy S24',
    partNumber: 'SM-S9210',
    vendor: 'Chunghwa Telecom (中華電信)',
    cost: 27_900,
    warrantyMonths: 12,
  },
  {
    key: 'ipad',
    category: 'tablet',
    manufacturer: 'Apple',
    name: 'iPad Air 11 (M2)',
    partNumber: 'MUWD3TA/A',
    vendor: 'Apple',
    cost: 21_900,
    warrantyMonths: 12,
  },
  {
    key: 'r760',
    category: 'server',
    manufacturer: 'Dell',
    name: 'PowerEdge R760',
    partNumber: 'PER760-2U',
    vendor: 'Dell Technologies',
    cost: 480_000,
    warrantyMonths: 36,
  },
  {
    key: 'c9300',
    category: 'network',
    manufacturer: 'Cisco',
    name: 'Catalyst 9300',
    partNumber: 'C9300-48P-A',
    vendor: 'Cisco Systems',
    cost: 260_000,
    warrantyMonths: 60,
  },
  {
    key: 'c9800',
    category: 'network',
    manufacturer: 'Cisco',
    name: 'Catalyst 9800-L Wireless Controller',
    partNumber: 'C9800-L-F-K9',
    vendor: 'Cisco Systems',
    cost: 210_000,
    warrantyMonths: 60,
  },
  {
    key: 'fg200f',
    category: 'network',
    manufacturer: 'Fortinet',
    name: 'FortiGate 200F',
    partNumber: 'FG-200F',
    vendor: 'Fortinet',
    cost: 380_000,
    warrantyMonths: 36,
  },
  {
    key: 'rs3621',
    category: 'storage',
    manufacturer: 'Synology',
    name: 'RS3621xs+',
    partNumber: 'RS3621xs+',
    vendor: 'Synology',
    cost: 165_000,
    warrantyMonths: 60,
  },
  {
    key: 'laserjet',
    category: 'printer',
    manufacturer: 'HP',
    name: 'LaserJet Pro 4003dn',
    partNumber: '2Z609A',
    vendor: 'HP Inc.',
    cost: 14_800,
    warrantyMonths: 12,
  },
  {
    key: 'dock',
    category: 'peripheral',
    manufacturer: 'Dell',
    name: 'Thunderbolt Dock WD22TB4',
    partNumber: 'WD22TB4',
    vendor: 'Dell Technologies',
    cost: 9_800,
    warrantyMonths: 36,
  },
];

/** Servers and network gear, each the hardware of a CMDB configuration item (linked by name). */
export const INFRASTRUCTURE: {
  name: string;
  model: string;
  serial: string;
  location: string;
  ageMonths: number;
}[] = [
  {
    name: 'tpe-esx-01',
    model: 'r760',
    serial: 'DLRS7601',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    ageMonths: 30,
  },
  {
    name: 'tpe-esx-02',
    model: 'r760',
    serial: 'DLRS7602',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    ageMonths: 30,
  },
  {
    name: 'erp-app-01',
    model: 'r760',
    serial: 'DLRS7603',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    ageMonths: 33,
  },
  {
    name: 'erp-db-01',
    model: 'r760',
    serial: 'DLRS7604',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    ageMonths: 33,
  },
  {
    name: 'hr-app-01',
    model: 'r760',
    serial: 'DLRS7605',
    location: 'Taipei HQ B1 Data Center, Rack A2',
    ageMonths: 20,
  },
  {
    name: 'print-srv-01',
    model: 'r760',
    serial: 'DLRS7606',
    location: 'Taipei HQ B1 Data Center, Rack A2',
    ageMonths: 20,
  },
  {
    name: 'mail-relay-01',
    model: 'r760',
    serial: 'DLRS7607',
    location: 'Taipei HQ B1 Data Center, Rack A2',
    ageMonths: 14,
  },
  {
    name: 'bkp-01',
    model: 'r760',
    serial: 'DLRS7608',
    location: 'Taipei HQ B1 Data Center, Rack A2',
    ageMonths: 14,
  },
  {
    name: 'tpe-sw-core-01',
    model: 'c9300',
    serial: 'FOC2741X0A1',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    ageMonths: 40,
  },
  {
    name: 'tpe-sw-core-02',
    model: 'c9300',
    serial: 'FOC2741X0A2',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    ageMonths: 4,
  },
  {
    name: 'tpe-sw-3f-01',
    model: 'c9300',
    serial: 'FOC2741X0B7',
    location: 'Taipei HQ 3F IDF',
    ageMonths: 40,
  },
  {
    name: 'wlc-01',
    model: 'c9800',
    serial: 'FCW2733L0C2',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    ageMonths: 26,
  },
  {
    name: 'tpe-fw-01',
    model: 'fg200f',
    serial: 'FG200FT923900131',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    ageMonths: 22,
  },
  {
    name: 'vpn-gw-01',
    model: 'fg200f',
    serial: 'FG200FT923900188',
    location: 'Taipei HQ B1 Data Center, Rack A1',
    ageMonths: 22,
  },
  {
    name: 'nas-01',
    model: 'rs3621',
    serial: '2350SQRN71C2',
    location: 'Taipei HQ B1 Data Center, Rack A2',
    ageMonths: 34,
  },
];

/** Office per department code (where its people's devices live). */
export const OFFICE: Record<string, string> = {
  RND: 'Hsinchu R&D Center',
  OPS: 'Kaohsiung Office',
  'SALES-TYO': 'Tokyo Office',
};

/** Taipei floors per department. */
export const TAIPEI_FLOOR: Record<string, number> = {
  HQ: 15,
  IT: 12,
  'IT-INFRA': 12,
  'IT-SD': 12,
  'IT-APP': 11,
  'IT-SEC': 11,
  'IT-DATA': 11,
  HR: 9,
  FIN: 10,
  SALES: 8,
  'SALES-TPE': 8,
  'SALES-GLB': 8,
};

export function locationOf(deptCode: string | null): string {
  if (deptCode && OFFICE[deptCode]) return OFFICE[deptCode]!;
  return `Taipei HQ ${TAIPEI_FLOOR[deptCode ?? 'HQ'] ?? 12}F`;
}

export interface SeedLicense {
  product: string;
  publisher: string;
  vendor: string | null;
  type: LicenseType;
  quantity: number | null;
  /** Seats to hand out (people, or devices for per-device licences). */
  seats: number;
  cost: number;
  billing: LicenseBilling;
  /** Start / end in months relative to today (end `null` = perpetual). */
  startMonths: number;
  endDays: number | null;
  contract?: string;
  key?: string;
  /** Departments whose people get the seats first. */
  departments?: string[];
  notes?: string;
}

export const LICENSES: SeedLicense[] = [
  {
    product: 'Microsoft 365 E3',
    publisher: 'Microsoft',
    vendor: 'Microsoft',
    type: 'per_user',
    quantity: 250,
    seats: 9999,
    cost: 3_450_000,
    billing: 'annual',
    startMonths: -15,
    endDays: 266,
    contract: 'Microsoft Enterprise Agreement',
    notes: 'Every employee gets a seat at onboarding. True-up each June under the EA.',
  },
  {
    product: 'Adobe Acrobat Pro',
    publisher: 'Adobe',
    vendor: 'Adobe',
    type: 'per_user',
    quantity: 40,
    seats: 46,
    cost: 316_000,
    billing: 'annual',
    startMonths: -10,
    endDays: 69,
    contract: 'Adobe VIP',
    departments: ['FIN', 'HR', 'SALES-TPE', 'SALES-GLB', 'HQ', 'OPS'],
    notes: 'Over-deployed after the Finance hiring wave: buy 10 more seats at the next VIP anniversary.',
  },
  {
    product: 'Adobe Creative Cloud',
    publisher: 'Adobe',
    vendor: 'Adobe',
    type: 'per_user',
    quantity: 12,
    seats: 9,
    cost: 324_000,
    billing: 'annual',
    startMonths: -10,
    endDays: 69,
    contract: 'Adobe VIP',
    departments: ['SALES-GLB', 'SALES-TPE', 'RND'],
  },
  {
    product: 'Atlassian Jira Software',
    publisher: 'Atlassian',
    vendor: 'Atlassian',
    type: 'subscription',
    quantity: 150,
    seats: 120,
    cost: 1_050_000,
    billing: 'annual',
    startMonths: -7,
    endDays: 144,
    contract: 'Atlassian subscription',
    departments: ['RND', 'IT-APP', 'IT-INFRA', 'IT-SD', 'IT-DATA', 'IT-SEC', 'IT', 'OPS'],
  },
  {
    product: 'Windows Server 2025 Datacenter',
    publisher: 'Microsoft',
    vendor: 'Microsoft',
    type: 'per_device',
    quantity: 8,
    seats: 8,
    cost: 1_680_000,
    billing: 'one_time',
    startMonths: -11,
    endDays: null,
    contract: 'Microsoft Enterprise Agreement',
    key: 'WX4NM-KYWYW-QJJR4-XV3QB-6VM33',
    notes: 'Licensed per physical host (16 cores each); covers unlimited VMs on the ESXi hosts.',
  },
  {
    product: 'AutoCAD',
    publisher: 'Autodesk',
    vendor: null,
    type: 'per_user',
    quantity: 20,
    seats: 6,
    cost: 1_340_000,
    billing: 'annual',
    startMonths: -9,
    endDays: 95,
    departments: ['RND'],
    notes: 'Bought for the factory layout project; only the mechanical team still uses it.',
  },
  {
    product: 'Zoom Workplace',
    publisher: 'Zoom Video Communications',
    vendor: 'Zoom Video Communications',
    type: 'per_user',
    quantity: 60,
    seats: 48,
    cost: 432_000,
    billing: 'annual',
    startMonths: -11,
    endDays: 38,
    contract: 'Zoom Workplace Business',
    departments: ['SALES-TPE', 'SALES-TYO', 'SALES-GLB', 'HQ', 'HR'],
  },
  {
    product: 'Visual Studio Enterprise',
    publisher: 'Microsoft',
    vendor: 'Microsoft',
    type: 'per_user',
    quantity: 15,
    seats: 13,
    cost: 1_020_000,
    billing: 'annual',
    startMonths: -15,
    endDays: 266,
    contract: 'Microsoft Enterprise Agreement',
    departments: ['IT-APP', 'RND'],
  },
  {
    product: 'Veeam Backup',
    publisher: 'Veeam',
    vendor: null,
    type: 'per_device',
    quantity: 10,
    seats: 7,
    cost: 268_000,
    billing: 'annual',
    startMonths: -11,
    endDays: 24,
    key: 'VBR-UL-10-7F3A-22C9-81D0',
    notes: 'Universal licence, 10 instances. Renewal quote requested from the reseller.',
  },
  {
    product: 'TeamViewer Business',
    publisher: 'TeamViewer',
    vendor: null,
    type: 'per_user',
    quantity: 5,
    seats: 5,
    cost: 98_000,
    billing: 'annual',
    startMonths: -13,
    endDays: -31,
    departments: ['IT-SD'],
    notes: 'Replaced by the platform remote-assistance tool; seats still assigned — clean up.',
  },
  {
    product: 'FortiGate UTP Bundle',
    publisher: 'Fortinet',
    vendor: 'Fortinet',
    type: 'site',
    quantity: null,
    seats: 0,
    cost: 186_000,
    billing: 'annual',
    startMonths: -4,
    endDays: 243,
    contract: 'Fortinet FortiCare & UTP',
  },
  {
    product: 'Microsoft Visio Plan 2',
    publisher: 'Microsoft',
    vendor: 'Microsoft',
    type: 'per_user',
    quantity: 20,
    seats: 14,
    cost: 132_000,
    billing: 'annual',
    startMonths: -15,
    endDays: 266,
    contract: 'Microsoft Enterprise Agreement',
    departments: ['IT-INFRA', 'IT-APP', 'IT-SEC', 'OPS'],
  },
  {
    product: 'Microsoft Project Plan 3',
    publisher: 'Microsoft',
    vendor: 'Microsoft',
    type: 'per_user',
    quantity: 10,
    seats: 7,
    cost: 112_000,
    billing: 'annual',
    startMonths: -15,
    endDays: 266,
    contract: 'Microsoft Enterprise Agreement',
    departments: ['IT', 'RND', 'OPS'],
  },
  {
    product: 'JetBrains All Products Pack',
    publisher: 'JetBrains',
    vendor: null,
    type: 'per_user',
    quantity: 25,
    seats: 22,
    cost: 545_000,
    billing: 'annual',
    startMonths: -5,
    endDays: 214,
    departments: ['RND', 'IT-APP'],
  },
  {
    product: 'Synology Active Backup for Business',
    publisher: 'Synology',
    vendor: 'Synology',
    type: 'site',
    quantity: null,
    seats: 0,
    cost: 0,
    billing: 'one_time',
    startMonths: -34,
    endDays: null,
    notes: 'Included with the RS3621xs+; backs up the laptops of the Tokyo office.',
  },
];

export interface SeedContract {
  title: string;
  vendor: string | null;
  kind: ContractKind;
  /** Term relative to today: start in months, end in days. */
  startMonths: number;
  endDays: number;
  cost: number;
  billing: ContractBilling;
  autoRenew?: boolean;
  noticeDays?: number;
  /** Owner: `[department code, n-th active person]`. */
  owner: [string, number];
  draft?: boolean;
  covers?: { models?: string[]; assets?: string[]; licenses?: string[] };
  notes: string;
}

export const CONTRACTS: SeedContract[] = [
  {
    title: 'Dell ProSupport',
    vendor: 'Dell Technologies',
    kind: 'support',
    startMonths: -36,
    endDays: 21,
    cost: 420_000,
    billing: 'annual',
    noticeDays: 60,
    owner: ['IT-INFRA', 0],
    covers: { models: ['r760'] },
    notes:
      '**4-hour onsite response**, 24×7, for the eight PowerEdge R760 servers in the Taipei data center.\n\n- Renewal quote: DELL-Q-2026-118 (3 years, +6%)\n- Keep the hard drives (*Keep Your Hard Drive* option) — required by Information Security.',
  },
  {
    title: 'Cisco SmartNet',
    vendor: 'Cisco Systems',
    kind: 'maintenance',
    startMonths: -7,
    endDays: 152,
    cost: 380_000,
    billing: 'annual',
    owner: ['IT-INFRA', 1],
    covers: { models: ['c9300', 'c9800'] },
    notes: '8×5×NBD hardware replacement and TAC access for the core, floor and wireless network gear.',
  },
  {
    title: 'Microsoft Enterprise Agreement',
    vendor: 'Microsoft',
    kind: 'subscription',
    startMonths: -27,
    endDays: 266,
    cost: 4_200_000,
    billing: 'annual',
    noticeDays: 120,
    owner: ['FIN', 0],
    covers: {
      licenses: [
        'Microsoft 365 E3',
        'Windows Server 2025 Datacenter',
        'Visual Studio Enterprise',
        'Microsoft Visio Plan 2',
        'Microsoft Project Plan 3',
      ],
    },
    notes:
      'Three-year EA (Level B). **True-up due every June.** Price protection on M365 E3 until the end of the term.',
  },
  {
    title: 'Chunghwa Telecom leased line',
    vendor: 'Chunghwa Telecom (中華電信)',
    kind: 'service',
    startMonths: -20,
    endDays: 175,
    cost: 68_000,
    billing: 'monthly',
    autoRenew: true,
    noticeDays: 30,
    owner: ['IT-INFRA', 2],
    notes: 'HiNet 企業專線 1G/1G with 8 static IPs. Renews monthly unless cancelled 30 days ahead.',
  },
  {
    title: 'Synology support',
    vendor: 'Synology',
    kind: 'support',
    startMonths: -34,
    endDays: 72,
    cost: 18_000,
    billing: 'annual',
    owner: ['IT-INFRA', 0],
    covers: { assets: ['nas-01'], licenses: ['Synology Active Backup for Business'] },
    notes: 'Extended warranty (EW201) and advance replacement for nas-01.',
  },
  {
    title: 'Adobe VIP',
    vendor: 'Adobe',
    kind: 'subscription',
    startMonths: -10,
    endDays: 69,
    cost: 640_000,
    billing: 'annual',
    owner: ['FIN', 1],
    covers: { licenses: ['Adobe Acrobat Pro', 'Adobe Creative Cloud'] },
    notes:
      'Value Incentive Plan, anniversary date aligned for all Adobe products. Add Acrobat seats before renewal.',
  },
  {
    title: 'Atlassian subscription',
    vendor: 'Atlassian',
    kind: 'subscription',
    startMonths: -7,
    endDays: 144,
    cost: 1_050_000,
    billing: 'annual',
    autoRenew: true,
    owner: ['IT-APP', 0],
    covers: { licenses: ['Atlassian Jira Software'] },
    notes: 'Jira Software Cloud Premium, 150 users. Auto-renews on the card on file unless changed.',
  },
  {
    title: 'Office printer lease (HP)',
    vendor: 'HP Inc.',
    kind: 'lease',
    startMonths: -22,
    endDays: 480,
    cost: 12_500,
    billing: 'monthly',
    owner: ['OPS', 0],
    covers: { models: ['laserjet'] },
    notes: 'Managed print service: six LaserJet Pro 4003dn, toner and onsite service included.',
  },
  {
    title: 'Fortinet FortiCare & UTP',
    vendor: 'Fortinet',
    kind: 'support',
    startMonths: -4,
    endDays: 243,
    cost: 296_000,
    billing: 'annual',
    owner: ['IT-SEC', 0],
    covers: { models: ['fg200f'], licenses: ['FortiGate UTP Bundle'] },
    notes: '24×7 FortiCare and the Unified Threat Protection bundle for tpe-fw-01 and vpn-gw-01.',
  },
  {
    title: 'Zoom Workplace Business',
    vendor: 'Zoom Video Communications',
    kind: 'subscription',
    startMonths: -11,
    endDays: 38,
    cost: 432_000,
    billing: 'annual',
    owner: ['IT-SD', 0],
    covers: { licenses: ['Zoom Workplace'] },
    notes: '60 licensed users. Consider moving to Teams-only meetings at renewal.',
  },
  {
    title: 'Symantec Endpoint Protection',
    vendor: null,
    kind: 'subscription',
    startMonths: -26,
    endDays: -95,
    cost: 360_000,
    billing: 'annual',
    owner: ['IT-SEC', 1],
    notes: 'Replaced by Microsoft Defender for Endpoint (included in E3/E5). Kept for the audit trail.',
  },
  {
    title: 'Lenovo Premier Support for ThinkPads',
    vendor: 'Lenovo',
    kind: 'support',
    startMonths: 1,
    endDays: 1125,
    cost: 1_150_000,
    billing: 'one_time',
    owner: ['IT-SD', 1],
    draft: true,
    covers: { models: ['t14', 'x1'] },
    notes:
      'Draft — waiting for the signed quotation. 3 years Premier Support with accidental damage protection.',
  },
];
