import { departments, groups, users } from '@isbp/db/schema';
import type { ModuleContext } from '@isbp/sdk/server';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { CiCriticality, CiEnvironment, CiStatus, RelationshipType } from '../model';
import { ciRelationships, cis } from './schema';

type Dept = 'IS' | 'IS-INFRA' | 'IS-SD' | 'IS-APP' | 'IS-SEC' | 'IS-DATA' | 'HR' | 'FIN';
type Group = 'it-admins' | 'service-desk' | 'network-team' | 'security-team' | 'dba-team' | 'app-owners';

interface SeedCi {
  name: string;
  classKey: string;
  criticality: CiCriticality;
  environment?: CiEnvironment | null;
  status?: CiStatus;
  /** Owner: the n-th active person of a department (stable order), e.g. `['IS-INFRA', 0]`. */
  owner?: [Dept, number];
  group?: Group;
  department?: Dept;
  description: string;
  tags?: string[];
}

/**
 * A mid-size company's IS estate: business services on applications, on VMs, on hosts, in a rack —
 * linked so impact analysis tells a story (lose `tpe-sw-core-01` and most services go with it).
 * ITSM's seed looks CIs up **by name**: keep the names stable.
 */
export const ESTATE: SeedCi[] = [
  // Business services — what people notice
  {
    name: 'Email & Calendar',
    classKey: 'business-service',
    criticality: 'critical',
    owner: ['IS-APP', 0],
    group: 'service-desk',
    department: 'IS',
    description:
      'Company email, calendars and shared mailboxes on Microsoft 365, with on-premises relay for scanners and applications.',
    tags: ['m365', 'collaboration'],
  },
  {
    name: 'Remote Access (VPN)',
    classKey: 'business-service',
    criticality: 'high',
    owner: ['IS-INFRA', 0],
    group: 'network-team',
    department: 'IS',
    description:
      'Secure remote access to the corporate network for staff working from home or travelling. Requires MFA.',
    tags: ['vpn', 'remote-work'],
  },
  {
    name: 'Finance ERP',
    classKey: 'business-service',
    criticality: 'critical',
    owner: ['FIN', 0],
    group: 'app-owners',
    department: 'FIN',
    description: 'General ledger, accounts payable and receivable, purchasing and month-end close.',
    tags: ['erp', 'finance', 'sox'],
  },
  {
    name: 'HR Portal',
    classKey: 'business-service',
    criticality: 'high',
    owner: ['HR', 0],
    group: 'app-owners',
    department: 'HR',
    description: 'Self-service leave requests, payslips, personal data and onboarding tasks.',
    tags: ['hr', 'self-service'],
  },
  {
    name: 'Corporate Website',
    classKey: 'business-service',
    criticality: 'high',
    owner: ['IS-APP', 1],
    group: 'app-owners',
    department: 'IS',
    description: 'Public website, product pages and the careers site.',
    tags: ['web', 'public'],
  },
  {
    name: 'Wi-Fi',
    classKey: 'business-service',
    criticality: 'high',
    owner: ['IS-INFRA', 1],
    group: 'network-team',
    department: 'IS',
    description: 'Corporate (802.1X) and guest wireless networks in the Taipei office.',
    tags: ['network', 'wireless'],
  },
  {
    name: 'Printing',
    classKey: 'business-service',
    criticality: 'medium',
    owner: ['IS-SD', 0],
    group: 'service-desk',
    department: 'IS',
    description: 'Follow-me printing, scanning to email and the floor multifunction printers.',
    tags: ['printing'],
  },
  {
    name: 'Single Sign-On',
    classKey: 'business-service',
    criticality: 'critical',
    owner: ['IS-SEC', 0],
    group: 'security-team',
    department: 'IS',
    description:
      'One sign-in with MFA for every company application, backed by Entra ID and Active Directory.',
    tags: ['identity', 'mfa'],
  },
  {
    name: 'File Sharing',
    classKey: 'business-service',
    criticality: 'medium',
    owner: ['IS-INFRA', 2],
    group: 'service-desk',
    department: 'IS',
    description: 'Department shares and the S: drive, with snapshots for self-service restores.',
    tags: ['files'],
  },
  {
    name: 'Service Desk',
    classKey: 'business-service',
    criticality: 'high',
    owner: ['IS-SD', 1],
    group: 'service-desk',
    department: 'IS',
    description: 'IS support: report issues, request services and follow your requests in IS Big Platform.',
    tags: ['itsm'],
  },

  // Applications
  {
    name: 'Exchange Online',
    classKey: 'application',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-APP', 0],
    group: 'it-admins',
    department: 'IS',
    description: 'Mailboxes, calendars and transport rules in Microsoft 365.',
    tags: ['m365', 'saas'],
  },
  {
    name: 'VPN Gateway Service',
    classKey: 'application',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-INFRA', 0],
    group: 'network-team',
    description: 'SSL VPN portal and gateway software with SAML sign-in.',
    tags: ['vpn'],
  },
  {
    name: 'ERP Application',
    classKey: 'application',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-APP', 2],
    group: 'app-owners',
    department: 'FIN',
    description: 'ERP application tier (Java) serving the finance modules.',
    tags: ['erp', 'java'],
  },
  {
    name: 'HR Portal Application',
    classKey: 'application',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-APP', 1],
    group: 'app-owners',
    department: 'HR',
    description: 'ASP.NET HR self-service portal.',
    tags: ['hr', 'dotnet'],
  },
  {
    name: 'Website CMS',
    classKey: 'application',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-APP', 1],
    group: 'app-owners',
    description: 'Headless CMS and static site generator for the corporate website.',
    tags: ['web', 'cms'],
  },
  {
    name: 'Active Directory Domain Services',
    classKey: 'application',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-SEC', 1],
    group: 'it-admins',
    description: 'corp.example.com forest: authentication, group policy, DNS and RADIUS for 802.1X.',
    tags: ['identity', 'windows'],
  },
  {
    name: 'IS Big Platform',
    classKey: 'application',
    criticality: 'high',
    environment: 'production',
    owner: ['IS', 0],
    group: 'it-admins',
    description: 'The internal IS platform: service desk, approvals, CMDB and knowledge base.',
    tags: ['itsm', 'node'],
  },

  // Servers (VMs on the ESXi hosts unless noted)
  {
    name: 'tpe-app-01',
    classKey: 'server',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-INFRA', 1],
    group: 'it-admins',
    description: 'Ubuntu 24.04 LTS application server (8 vCPU, 32 GB).',
    tags: ['linux', 'ubuntu', 'vm'],
  },
  {
    name: 'tpe-app-02',
    classKey: 'server',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-INFRA', 1],
    group: 'it-admins',
    description: 'Ubuntu 24.04 LTS web server for the website CMS.',
    tags: ['linux', 'ubuntu', 'vm'],
  },
  {
    name: 'erp-app-01',
    classKey: 'server',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-INFRA', 2],
    group: 'it-admins',
    department: 'FIN',
    description: 'RHEL 9 ERP application server (16 vCPU, 64 GB).',
    tags: ['linux', 'rhel', 'vm'],
  },
  {
    name: 'erp-app-test-01',
    classKey: 'server',
    criticality: 'low',
    environment: 'test',
    owner: ['IS-APP', 2],
    group: 'app-owners',
    department: 'FIN',
    description: 'RHEL 9 ERP test server, refreshed from production monthly.',
    tags: ['linux', 'rhel', 'vm'],
  },
  {
    name: 'hr-app-01',
    classKey: 'server',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-INFRA', 2],
    group: 'it-admins',
    department: 'HR',
    description: 'Windows Server 2022 with IIS for the HR portal.',
    tags: ['windows', 'iis', 'vm'],
  },
  {
    name: 'dc-01',
    classKey: 'server',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-SEC', 1],
    group: 'it-admins',
    description: 'Windows Server 2022 domain controller (PDC emulator), DNS and NPS.',
    tags: ['windows', 'ad', 'vm'],
  },
  {
    name: 'dc-02',
    classKey: 'server',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-SEC', 1],
    group: 'it-admins',
    description:
      'Physical Windows Server 2022 domain controller, so sign-in survives a virtualization outage.',
    tags: ['windows', 'ad', 'physical'],
  },
  {
    name: 'fs-01',
    classKey: 'server',
    criticality: 'medium',
    environment: 'production',
    owner: ['IS-INFRA', 2],
    group: 'it-admins',
    description: 'Windows file server (DFS namespace) publishing the department shares stored on nas-01.',
    tags: ['windows', 'files', 'vm'],
  },
  {
    name: 'print-srv-01',
    classKey: 'server',
    criticality: 'medium',
    environment: 'production',
    status: 'maintenance',
    owner: ['IS-SD', 0],
    group: 'service-desk',
    description: 'Windows print server with follow-me printing. In maintenance: driver package upgrade.',
    tags: ['windows', 'printing', 'vm'],
  },
  {
    name: 'mail-relay-01',
    classKey: 'server',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-INFRA', 0],
    group: 'it-admins',
    description: 'Postfix SMTP relay for scanners and applications sending through Exchange Online.',
    tags: ['linux', 'smtp', 'vm'],
  },
  {
    name: 'bkp-01',
    classKey: 'server',
    criticality: 'medium',
    environment: 'production',
    owner: ['IS-DATA', 0],
    group: 'it-admins',
    description: 'Physical backup server: nightly image and database backups, 30-day retention.',
    tags: ['windows', 'backup', 'physical'],
  },
  {
    name: 'tpe-esx-01',
    classKey: 'server',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-INFRA', 0],
    group: 'it-admins',
    description: 'VMware ESXi 8 host (2 × 32 cores, 768 GB) in the Taipei data center.',
    tags: ['vmware', 'hypervisor', 'physical'],
  },
  {
    name: 'tpe-esx-02',
    classKey: 'server',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-INFRA', 0],
    group: 'it-admins',
    description: 'VMware ESXi 8 host (2 × 32 cores, 768 GB) in the Taipei data center.',
    tags: ['vmware', 'hypervisor', 'physical'],
  },
  {
    name: 'old-intranet-01',
    classKey: 'server',
    criticality: 'low',
    environment: 'production',
    status: 'retired',
    owner: ['IS-INFRA', 1],
    group: 'it-admins',
    description: 'Windows Server 2012 R2 legacy intranet. Decommissioned after the move to the new portal.',
    tags: ['windows', 'legacy'],
  },

  // Databases
  {
    name: 'erp-db-01',
    classKey: 'database',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-DATA', 0],
    group: 'dba-team',
    department: 'FIN',
    description: 'PostgreSQL 16 primary for the ERP, streaming replication to the DR site.',
    tags: ['postgresql'],
  },
  {
    name: 'erp-db-test-01',
    classKey: 'database',
    criticality: 'low',
    environment: 'test',
    owner: ['IS-DATA', 1],
    group: 'dba-team',
    department: 'FIN',
    description: 'PostgreSQL 16 test database for the ERP (masked copy of production).',
    tags: ['postgresql'],
  },
  {
    name: 'hr-db',
    classKey: 'database',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-DATA', 1],
    group: 'dba-team',
    department: 'HR',
    description: 'Microsoft SQL Server 2022 database of the HR portal (contains personal data).',
    tags: ['mssql', 'pii'],
  },
  {
    name: 'isbp-db-01',
    classKey: 'database',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-DATA', 0],
    group: 'dba-team',
    description: 'PostgreSQL 18 with pgvector for IS Big Platform.',
    tags: ['postgresql'],
  },

  // Network
  {
    name: 'tpe-sw-core-01',
    classKey: 'network-device',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-INFRA', 3],
    group: 'network-team',
    description:
      'Data-center core switch (L3, 48 × 25G). Uplinks for hosts, storage, firewall and floor switches.',
    tags: ['switch', 'core'],
  },
  {
    name: 'tpe-sw-core-02',
    classKey: 'network-device',
    criticality: 'critical',
    environment: 'production',
    status: 'planned',
    owner: ['IS-INFRA', 3],
    group: 'network-team',
    description: 'Second core switch for a redundant pair — delivery and installation planned next quarter.',
    tags: ['switch', 'core'],
  },
  {
    name: 'tpe-fw-01',
    classKey: 'network-device',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-SEC', 0],
    group: 'security-team',
    description: 'Perimeter next-generation firewall (internet edge, DMZ and VPN termination).',
    tags: ['firewall', 'perimeter'],
  },
  {
    name: 'vpn-gw-01',
    classKey: 'network-device',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-INFRA', 3],
    group: 'network-team',
    description: 'VPN concentrator appliance (up to 1,000 concurrent users).',
    tags: ['vpn'],
  },
  {
    name: 'wlc-01',
    classKey: 'network-device',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-INFRA', 3],
    group: 'network-team',
    description: 'Wireless LAN controller managing the 64 access points in the Taipei office.',
    tags: ['wireless'],
  },
  {
    name: 'tpe-sw-3f-01',
    classKey: 'network-device',
    criticality: 'medium',
    environment: 'production',
    owner: ['IS-INFRA', 3],
    group: 'network-team',
    description: '3rd-floor access switch (PoE) for desks, printers and access points.',
    tags: ['switch', 'access'],
  },
  {
    name: 'tpe-isp-link-01',
    classKey: 'network-device',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-INFRA', 3],
    group: 'network-team',
    description: 'Primary 1 Gbps internet uplink (fibre) terminating on the perimeter firewall.',
    tags: ['wan', 'isp'],
  },

  // Storage
  {
    name: 'nas-01',
    classKey: 'storage',
    criticality: 'high',
    environment: 'production',
    owner: ['IS-INFRA', 2],
    group: 'it-admins',
    description: 'NAS (120 TB usable) holding department shares and snapshots.',
    tags: ['nas', 'files'],
  },
  {
    name: 'tpe-san-01',
    classKey: 'storage',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-INFRA', 0],
    group: 'it-admins',
    description: 'All-flash SAN providing the VMware datastores.',
    tags: ['san', 'flash'],
  },

  // Cloud
  {
    name: 'Microsoft 365 tenant',
    classKey: 'cloud-resource',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-APP', 0],
    group: 'it-admins',
    description: 'Production Microsoft 365 tenant (Exchange Online, Teams, SharePoint).',
    tags: ['m365', 'saas'],
  },
  {
    name: 'Entra ID tenant',
    classKey: 'cloud-resource',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-SEC', 0],
    group: 'security-team',
    description: 'Cloud identity: SAML/OIDC single sign-on, conditional access and MFA.',
    tags: ['identity', 'saas'],
  },

  // End-user devices
  {
    name: 'TPE-3F-MFP-01',
    classKey: 'end-user-device',
    criticality: 'low',
    environment: 'production',
    owner: ['IS-SD', 0],
    group: 'service-desk',
    description: '3rd-floor multifunction printer (A3 colour, scan to email).',
    tags: ['printer'],
  },

  // Facilities
  {
    name: 'Taipei Data Center',
    classKey: 'other',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS', 0],
    group: 'it-admins',
    description: 'Co-located data-center cage, Neihu: power, cooling and physical access.',
    tags: ['facility'],
  },
  {
    name: 'TPE-DC Rack A1',
    classKey: 'other',
    criticality: 'critical',
    environment: 'production',
    owner: ['IS-INFRA', 0],
    group: 'it-admins',
    description: '42U rack with redundant PDUs.',
    tags: ['facility', 'rack'],
  },
];

/** `[source, type, target]` by name. */
export const LINKS: [string, RelationshipType, string, string?][] = [
  // Services on applications and infrastructure
  ['Email & Calendar', 'depends_on', 'Exchange Online'],
  ['Email & Calendar', 'depends_on', 'mail-relay-01', 'Scan-to-email and application mail'],
  ['Email & Calendar', 'depends_on', 'Single Sign-On'],
  ['Remote Access (VPN)', 'depends_on', 'VPN Gateway Service'],
  ['Remote Access (VPN)', 'depends_on', 'Single Sign-On', 'SAML sign-in with MFA'],
  ['Finance ERP', 'depends_on', 'ERP Application'],
  ['Finance ERP', 'depends_on', 'Single Sign-On'],
  ['HR Portal', 'depends_on', 'HR Portal Application'],
  ['HR Portal', 'depends_on', 'Single Sign-On'],
  ['Corporate Website', 'depends_on', 'Website CMS'],
  ['Corporate Website', 'depends_on', 'tpe-fw-01', 'Published through the DMZ'],
  ['Wi-Fi', 'depends_on', 'wlc-01'],
  ['Wi-Fi', 'depends_on', 'Active Directory Domain Services', '802.1X authentication (RADIUS)'],
  ['Printing', 'depends_on', 'print-srv-01'],
  ['Printing', 'depends_on', 'TPE-3F-MFP-01'],
  ['Single Sign-On', 'depends_on', 'Entra ID tenant'],
  ['Single Sign-On', 'depends_on', 'Active Directory Domain Services'],
  ['File Sharing', 'depends_on', 'fs-01'],
  ['File Sharing', 'depends_on', 'Active Directory Domain Services'],
  ['Service Desk', 'depends_on', 'IS Big Platform'],
  ['Service Desk', 'depends_on', 'Email & Calendar', 'Notifications and email replies'],
  // Applications
  ['Exchange Online', 'runs_on', 'Microsoft 365 tenant'],
  ['VPN Gateway Service', 'runs_on', 'vpn-gw-01'],
  ['ERP Application', 'runs_on', 'erp-app-01'],
  ['ERP Application', 'depends_on', 'erp-db-01'],
  ['HR Portal Application', 'runs_on', 'hr-app-01'],
  ['HR Portal Application', 'depends_on', 'hr-db'],
  ['Website CMS', 'runs_on', 'tpe-app-02'],
  ['Active Directory Domain Services', 'runs_on', 'dc-01'],
  ['Active Directory Domain Services', 'runs_on', 'dc-02'],
  ['IS Big Platform', 'runs_on', 'tpe-app-01'],
  ['IS Big Platform', 'depends_on', 'isbp-db-01'],
  // Virtual machines and databases on the hosts
  ['tpe-app-01', 'runs_on', 'tpe-esx-01'],
  ['tpe-app-02', 'runs_on', 'tpe-esx-02'],
  ['erp-app-01', 'runs_on', 'tpe-esx-01'],
  ['erp-app-test-01', 'runs_on', 'tpe-esx-02'],
  ['hr-app-01', 'runs_on', 'tpe-esx-02'],
  ['dc-01', 'runs_on', 'tpe-esx-01'],
  ['fs-01', 'runs_on', 'tpe-esx-01'],
  ['print-srv-01', 'runs_on', 'tpe-esx-02'],
  ['mail-relay-01', 'runs_on', 'tpe-esx-02'],
  ['erp-db-01', 'runs_on', 'tpe-esx-01'],
  ['erp-db-test-01', 'runs_on', 'tpe-esx-02'],
  ['hr-db', 'runs_on', 'tpe-esx-02'],
  ['isbp-db-01', 'runs_on', 'tpe-esx-01'],
  // Hosts, storage and network
  ['tpe-esx-01', 'depends_on', 'tpe-san-01', 'VMFS datastores'],
  ['tpe-esx-02', 'depends_on', 'tpe-san-01', 'VMFS datastores'],
  ['tpe-esx-01', 'depends_on', 'tpe-sw-core-01'],
  ['tpe-esx-02', 'depends_on', 'tpe-sw-core-01'],
  ['dc-02', 'depends_on', 'tpe-sw-core-01'],
  ['nas-01', 'depends_on', 'tpe-sw-core-01'],
  ['fs-01', 'depends_on', 'nas-01', 'Shares are stored on the NAS'],
  ['wlc-01', 'depends_on', 'tpe-sw-core-01'],
  ['tpe-sw-3f-01', 'depends_on', 'tpe-sw-core-01', 'Fibre uplink'],
  ['TPE-3F-MFP-01', 'depends_on', 'tpe-sw-3f-01'],
  ['vpn-gw-01', 'depends_on', 'tpe-fw-01'],
  ['mail-relay-01', 'depends_on', 'tpe-fw-01', 'Outbound SMTP to Exchange Online'],
  ['tpe-fw-01', 'depends_on', 'tpe-isp-link-01'],
  ['tpe-fw-01', 'connects_to', 'tpe-sw-core-01', 'Inside interface'],
  ['tpe-sw-core-02', 'connects_to', 'tpe-sw-core-01', 'Planned stack link'],
  // Backups
  ['bkp-01', 'backs_up', 'erp-db-01', 'Nightly full, hourly WAL'],
  ['bkp-01', 'backs_up', 'hr-db', 'Nightly full'],
  ['bkp-01', 'backs_up', 'fs-01'],
  // Facilities
  ['Taipei Data Center', 'contains', 'TPE-DC Rack A1'],
  ['TPE-DC Rack A1', 'contains', 'tpe-sw-core-01'],
  ['TPE-DC Rack A1', 'contains', 'tpe-esx-01'],
  ['TPE-DC Rack A1', 'contains', 'tpe-esx-02'],
  ['TPE-DC Rack A1', 'contains', 'tpe-san-01'],
  ['TPE-DC Rack A1', 'contains', 'tpe-fw-01'],
];

/** Demo estate (idempotent: skipped once any CI exists). */
export async function seedCmdb(ctx: ModuleContext) {
  const [existing] = await ctx.db.select({ n: count() }).from(cis);
  if (existing!.n > 0) return;

  // People per department in a stable order, so owners are the same on every fresh seed.
  const codes = [...new Set(ESTATE.flatMap((c) => [c.owner?.[0], c.department]).filter(Boolean))] as Dept[];
  const deptRows = await ctx.db
    .select({ id: departments.id, code: departments.code })
    .from(departments)
    .where(inArray(departments.code, codes));
  const deptIds = new Map(deptRows.map((d) => [d.code, d.id]));
  const people = await ctx.db
    .select({ id: users.id, code: departments.code })
    .from(users)
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(and(inArray(departments.code, codes), eq(users.status, 'active')))
    .orderBy(asc(users.username));
  const byDept = new Map<string, string[]>();
  for (const p of people) byDept.set(p.code, [...(byDept.get(p.code) ?? []), p.id]);
  const [admin] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.username, 'admin'));
  const ownerOf = (o: SeedCi['owner']) => {
    if (!o) return null;
    const list = byDept.get(o[0]) ?? [];
    return list.length ? list[o[1] % list.length]! : (admin?.id ?? null);
  };
  const groupRows = await ctx.db.select({ id: groups.id, key: groups.key }).from(groups);
  const groupIds = new Map(groupRows.map((g) => [g.key, g.id]));

  const rows = await ctx.db
    .insert(cis)
    .values(
      ESTATE.map((c) => ({
        name: c.name,
        classKey: c.classKey,
        status: c.status ?? 'in_use',
        environment: c.environment ?? (c.classKey === 'business-service' ? 'production' : null),
        criticality: c.criticality,
        ownerId: ownerOf(c.owner),
        supportGroupId: (c.group && groupIds.get(c.group)) ?? null,
        departmentId: (c.department && deptIds.get(c.department)) ?? deptIds.get('IS') ?? null,
        description: c.description,
        tags: c.tags ?? [],
      })),
    )
    .returning({ id: cis.id, name: cis.name });
  const idOf = new Map(rows.map((r) => [r.name, r.id]));
  const id = (name: string) => {
    const value = idOf.get(name);
    if (!value) throw new Error(`cmdb seed: unknown CI "${name}"`);
    return value;
  };
  await ctx.db.insert(ciRelationships).values(
    LINKS.map(([source, type, target, note]) => ({
      sourceId: id(source),
      targetId: id(target),
      type,
      note: note ?? null,
      createdBy: admin?.id ?? null,
    })),
  );
  ctx.logger.info({ cis: rows.length, relationships: LINKS.length }, 'cmdb demo estate created');
}
