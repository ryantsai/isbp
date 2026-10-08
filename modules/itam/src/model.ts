/**
 * The asset-management vocabulary and its pure rules (no I/O): lifecycle transitions, straight-line
 * depreciation, licence compliance, contract renewal dates and the disposal facts. Shared by the API,
 * the web pages, the seed and the unit tests, so the UI and the server can never disagree.
 *
 * Calendar dates (`purchase_date`, `warranty_end`, contract terms) travel as `YYYY-MM-DD` strings and
 * are compared as calendar days in the company's time zone (`Asia/Taipei`).
 */

/* ───────────────────────────── hardware ───────────────────────────── */

export const ASSET_CATEGORIES = [
  'laptop',
  'desktop',
  'monitor',
  'phone',
  'tablet',
  'server',
  'network',
  'storage',
  'printer',
  'peripheral',
  'other',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_STATUSES = [
  'ordered',
  'in_stock',
  'deployed',
  'in_repair',
  'retired',
  'disposed',
  'lost',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * Lifecycle: which status may follow which. `retired → disposed` only happens through the approved
 * disposal workflow (see {@link MANUAL_TRANSITIONS}); `disposed` is final.
 */
export const TRANSITIONS: Readonly<Record<AssetStatus, readonly AssetStatus[]>> = {
  ordered: ['in_stock', 'lost'],
  in_stock: ['deployed', 'in_repair', 'retired', 'lost'],
  deployed: ['in_stock', 'in_repair', 'lost'],
  in_repair: ['in_stock', 'deployed', 'retired'],
  retired: ['disposed', 'in_stock'],
  disposed: [],
  lost: ['in_stock'],
};

export function canTransition(from: AssetStatus, to: AssetStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Status changes people make directly ("Change status"); disposal needs the approval workflow. */
export function manualTransitions(from: AssetStatus): AssetStatus[] {
  return (TRANSITIONS[from] ?? []).filter((s) => s !== 'disposed');
}

/** Statuses in which an asset may stay assigned to a person (who has it, sent it to repair or lost it). */
export const ASSIGNABLE_STATUSES: readonly AssetStatus[] = ['deployed', 'in_repair', 'lost'];

/** An asset can be handed to someone when it is deployed already or may become deployed. */
export function canAssign(status: AssetStatus): boolean {
  return status === 'deployed' || canTransition(status, 'deployed');
}

/** Statuses an assigned asset may be returned into. */
export const RETURN_STATUSES = ['in_stock', 'in_repair'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** Devices that may hold company data: disposal needs an information-security sign-off. */
export const DATA_BEARING: readonly AssetCategory[] = [
  'laptop',
  'desktop',
  'server',
  'storage',
  'phone',
  'tablet',
];

export const isDataBearing = (category: AssetCategory) => DATA_BEARING.includes(category);

/** Useful life in months when a model doesn't say (straight-line depreciation period). */
export const DEFAULT_LIFESPAN_MONTHS: Readonly<Record<AssetCategory, number>> = {
  laptop: 36,
  desktop: 48,
  monitor: 60,
  phone: 24,
  tablet: 36,
  server: 60,
  network: 60,
  storage: 60,
  printer: 60,
  peripheral: 36,
  other: 48,
};

/** Quick tabs on the hardware list (`retired` also shows disposed assets). */
export const HARDWARE_VIEWS = {
  deployed: ['deployed'],
  in_stock: ['in_stock'],
  in_repair: ['in_repair'],
  retired: ['retired', 'disposed'],
} as const satisfies Record<string, readonly AssetStatus[]>;
export type HardwareView = keyof typeof HARDWARE_VIEWS;

/* ───────────────────────────── software ───────────────────────────── */

export const LICENSE_TYPES = ['per_user', 'per_device', 'concurrent', 'site', 'subscription'] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export const LICENSE_BILLING = ['one_time', 'monthly', 'annual'] as const;
export type LicenseBilling = (typeof LICENSE_BILLING)[number];

export const COMPLIANCE_STATES = ['compliant', 'over_deployed', 'under_used', 'expiring', 'expired'] as const;
export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

/** States that need someone to act (notified to asset managers when a licence enters them). */
export const NON_COMPLIANT: readonly ComplianceState[] = ['over_deployed', 'expired'];

export const INSTALL_SOURCES = ['manual', 'api', 'import'] as const;
export type InstallSource = (typeof INSTALL_SOURCES)[number];

/* ───────────────────────────── contracts ───────────────────────────── */

export const CONTRACT_KINDS = [
  'maintenance',
  'support',
  'lease',
  'subscription',
  'warranty',
  'service',
  'other',
] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const CONTRACT_STATUSES = ['draft', 'active', 'expiring', 'expired', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_BILLING = ['one_time', 'monthly', 'quarterly', 'annual'] as const;
export type ContractBilling = (typeof CONTRACT_BILLING)[number];

/** Quick tabs on the contract list. */
export const CONTRACT_VIEWS = ['active', 'renewing', 'expired', 'all'] as const;
export type ContractView = (typeof CONTRACT_VIEWS)[number];

/** Days before the end when the second ("final") renewal reminder goes out. */
export const FINAL_REMINDER_DAYS = 7;
export const DEFAULT_NOTICE_DAYS = 60;
/** A licence ending within this many days is `expiring`. */
export const LICENSE_EXPIRING_DAYS = 60;
export const DEFAULT_UNDER_USED_PERCENT = 60;
/** Under-use is only flagged from this many entitlements up (a 3-seat licence with 1 user is fine). */
export const UNDER_USED_MIN_QUANTITY = 10;

/* ───────────────────────────── references ───────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REF_PREFIX = { asset: 'AST', license: 'LIC', contract: 'CTR' } as const;
export type RefKind = keyof typeof REF_PREFIX;

/** `AST-00042`, `LIC-00012`, `CTR-00007`. */
export function formatRef(kind: RefKind, n: number): string {
  return `${REF_PREFIX[kind]}-${String(n).padStart(5, '0')}`;
}

export const formatAssetTag = (n: number) => formatRef('asset', n);
export const formatLicenseRef = (n: number) => formatRef('license', n);
export const formatContractRef = (n: number) => formatRef('contract', n);

/** A record reference from a URL or a person: its uuid, or its number (`AST-00042`, `ast-42`). */
export function parseRef(kind: RefKind, ref: string): { id: string } | { number: number } | null {
  const value = ref.trim();
  if (UUID_RE.test(value)) return { id: value.toLowerCase() };
  const m = new RegExp(`^${REF_PREFIX[kind]}-?(\\d{1,12})$`, 'i').exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? { number: n } : null;
}

export const isUuid = (value: string) => UUID_RE.test(value);

/* ───────────────────────────── calendar dates ───────────────────────────── */

export const COMPANY_TIME_ZONE = 'Asia/Taipei';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's calendar date (`YYYY-MM-DD`) in the given time zone. */
export function todayIn(timeZone: string = COMPANY_TIME_ZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function parts(date: string): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid calendar date "${date}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const toUtc = (date: string) => {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * 86_400_000);
}

/** Adds calendar months; the day is clamped to the target month's length (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = index - ty * 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(ty, tm, Math.min(d, last)));
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Whole months elapsed from `from` to `to` (0 when `to` is earlier). */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, months);
}

/* ───────────────────────────── depreciation ───────────────────────────── */

export interface Depreciation {
  lifespanMonths: number;
  /** Whole months since purchase. */
  ageMonths: number;
  /** Straight-line value today, rounded to cents (0 once fully depreciated). */
  bookValue: number;
  /** 0–100. */
  depreciatedPercent: number;
  /** The end of the depreciation period. */
  fullyDepreciatedOn: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Straight-line depreciation over the model's lifespan, by whole months. `null` without a purchase
 * date or cost (nothing to depreciate).
 */
export function depreciation(
  input: {
    cost: number | null;
    purchaseDate: string | null;
    lifespanMonths: number | null;
    category: AssetCategory;
  },
  today: string,
): Depreciation | null {
  if (input.cost === null || input.purchaseDate === null) return null;
  const lifespanMonths = Math.max(1, input.lifespanMonths ?? DEFAULT_LIFESPAN_MONTHS[input.category]);
  const ageMonths = monthsBetween(input.purchaseDate, today);
  const remaining = Math.max(0, 1 - ageMonths / lifespanMonths);
  return {
    lifespanMonths,
    ageMonths,
    bookValue: round2(input.cost * remaining),
    depreciatedPercent: Math.round((1 - remaining) * 1000) / 10,
    fullyDepreciatedOn: addMonths(input.purchaseDate, lifespanMonths),
  };
}

/** `retire_on` when none is given: purchase date + the model's lifespan. */
export function defaultRetireOn(
  purchaseDate: string | null,
  lifespanMonths: number | null,
  category: AssetCategory,
): string | null {
  return purchaseDate ? addMonths(purchaseDate, lifespanMonths ?? DEFAULT_LIFESPAN_MONTHS[category]) : null;
}

/* ───────────────────────────── warranty ───────────────────────────── */

export type WarrantyState = 'none' | 'active' | 'expiring' | 'expired';

export function warrantyState(warrantyEnd: string | null, today: string, windowDays = 30): WarrantyState {
  if (!warrantyEnd) return 'none';
  const days = daysBetween(today, warrantyEnd);
  if (days < 0) return 'expired';
  return days <= windowDays ? 'expiring' : 'active';
}

/* ───────────────────────────── compliance ───────────────────────────── */

export interface ComplianceInput {
  /** Entitlements; `null` = unlimited / site licence. */
  quantity: number | null;
  /** Assignments, plus unlicensed installs for per-device licences (see {@link licenseUsage}). */
  used: number;
  endDate: string | null;
}

/**
 * - `expired`: the end date has passed;
 * - `over_deployed`: more in use than entitled;
 * - `expiring`: the end date is within 60 days;
 * - `under_used`: fewer than `underUsedPercent` % in use, for 10 entitlements or more;
 * - otherwise `compliant`.
 */
export function complianceState(
  input: ComplianceInput,
  today: string,
  opts: { underUsedPercent?: number; expiringDays?: number } = {},
): ComplianceState {
  const underUsedPercent = opts.underUsedPercent ?? DEFAULT_UNDER_USED_PERCENT;
  const expiringDays = opts.expiringDays ?? LICENSE_EXPIRING_DAYS;
  if (input.endDate && daysBetween(today, input.endDate) < 0) return 'expired';
  if (input.quantity !== null && input.used > input.quantity) return 'over_deployed';
  if (input.endDate && daysBetween(today, input.endDate) <= expiringDays) return 'expiring';
  if (
    input.quantity !== null &&
    input.quantity >= UNDER_USED_MIN_QUANTITY &&
    input.used < (input.quantity * underUsedPercent) / 100
  )
    return 'under_used';
  return 'compliant';
}

/** Seats in use: assignments, plus devices running the product unlicensed for per-device licences. */
export function licenseUsage(type: LicenseType, assignments: number, unlicensedInstalls: number): number {
  return type === 'per_device' ? assignments + unlicensedInstalls : assignments;
}

/* ───────────────────────────── money ───────────────────────────── */

/**
 * Yearly cost of a recurring charge. One-time charges are spread over the term (in months) when it is
 * known, and count as no recurring cost otherwise.
 */
export function annualCost(
  cost: number | null,
  billing: ContractBilling | LicenseBilling,
  termMonths: number | null = null,
): number | null {
  if (cost === null) return null;
  switch (billing) {
    case 'monthly':
      return round2(cost * 12);
    case 'quarterly':
      return round2(cost * 4);
    case 'annual':
      return round2(cost);
    case 'one_time':
      return termMonths && termMonths > 0 ? round2((cost * 12) / Math.max(12, termMonths)) : null;
  }
}

/* ───────────────────────────── contract renewals ───────────────────────────── */

export interface ContractTerm {
  status: ContractStatus;
  startDate: string | null;
  endDate: string | null;
  noticeDays: number;
}

/** The day the renewal notice period starts (end − notice days). */
export function noticeDate(endDate: string | null, noticeDays: number): string | null {
  return endDate ? addDays(endDate, -noticeDays) : null;
}

/** Where a contract should be today: drafts and cancelled contracts stay put; the rest follow the dates. */
export function contractStatusFor(c: ContractTerm, today: string): ContractStatus {
  if (c.status === 'draft' || c.status === 'cancelled') return c.status;
  if (!c.endDate) return 'active';
  if (daysBetween(today, c.endDate) < 0) return 'expired';
  const notice = noticeDate(c.endDate, c.noticeDays)!;
  return daysBetween(notice, today) >= 0 ? 'expiring' : 'active';
}

export interface ReminderState extends ContractTerm {
  /** The end date the last reminder was about (reminders never repeat for the same term). */
  lastReminderFor: string | null;
  /** The day the last reminder went out. */
  lastRemindedOn: string | null;
}

/**
 * Which renewal reminder is due today:
 * - `notice` once the notice period has started (end − notice days ≤ today), once per end date;
 * - `final` again from 7 days before the end, unless a reminder already went out inside that week.
 * Nothing after the end date, for drafts or cancelled contracts.
 */
export function reminderDue(c: ReminderState, today: string): 'notice' | 'final' | null {
  if (!c.endDate || c.status === 'draft' || c.status === 'cancelled') return null;
  const daysLeft = daysBetween(today, c.endDate);
  if (daysLeft < 0) return null;
  if (c.lastReminderFor !== c.endDate) return daysLeft <= c.noticeDays ? 'notice' : null;
  const finalFrom = addDays(c.endDate, -FINAL_REMINDER_DAYS);
  if (daysBetween(finalFrom, today) < 0) return null;
  if (c.lastRemindedOn && daysBetween(finalFrom, c.lastRemindedOn) >= 0) return null;
  return 'final';
}

/** Term length in months (for one-time costs and auto-renewal), `null` when open-ended. */
export function termMonths(startDate: string | null, endDate: string | null): number | null {
  if (!startDate || !endDate) return null;
  return Math.max(1, Math.round(daysBetween(startDate, endDate) / 30.4375));
}

/** The next term of an auto-renewing contract: starts the day after the end, same length. */
export function nextTerm(startDate: string | null, endDate: string): { startDate: string; endDate: string } {
  const start = addDays(endDate, 1);
  const days = startDate ? Math.max(1, daysBetween(startDate, endDate)) : 364;
  return { startDate: start, endDate: addDays(start, days) };
}

/* ───────────────────────────── disposal ───────────────────────────── */

export interface DisposalFacts {
  asset: {
    category: AssetCategory;
    dataBearing: boolean;
    /** Book value today (0 when fully depreciated or the cost is unknown). */
    bookValue: number;
    ageMonths: number;
  };
}

/** Facts the `itam.disposal` workflow decides on. */
export function disposalFacts(
  asset: {
    category: AssetCategory;
    purchaseCost: number | null;
    purchaseDate: string | null;
    lifespanMonths: number | null;
  },
  today: string,
): DisposalFacts {
  const dep = depreciation(
    {
      cost: asset.purchaseCost,
      purchaseDate: asset.purchaseDate,
      lifespanMonths: asset.lifespanMonths,
      category: asset.category,
    },
    today,
  );
  return {
    asset: {
      category: asset.category,
      dataBearing: isDataBearing(asset.category),
      bookValue: dep?.bookValue ?? 0,
      ageMonths: asset.purchaseDate ? monthsBetween(asset.purchaseDate, today) : 0,
    },
  };
}

/**
 * The id of the information-security sign-off step in the default `itam.disposal` graph. The disposal dialog
 * shows its notice when the bound workflow's dry run (`ctx.workflows.preview`) would ask a step with this id.
 */
export const SECURITY_SIGN_OFF_STEP = 'security';

/* ───────────────────────────── approved software ───────────────────────────── */

/**
 * The approved-software list (allow list / block list): which software titles may be installed, by whom. A title
 * on an allowed entry for the device's department (or the whole company) is approved; a title on a blocked entry
 * must not be installed. Versions are optional (`null` = any version).
 */
export const LICENSE_MODELS = ['free', 'open_source', 'shareware', 'paid', 'subscription'] as const;
export type LicenseModel = (typeof LICENSE_MODELS)[number];

export const APPROVAL_STATUSES = ['allowed', 'blocked'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_SCOPES = ['company', 'departments'] as const;
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];

/** Where an installed title stands against the list. */
export const INSTALL_APPROVALS = ['allowed', 'unapproved', 'blocked'] as const;
export type InstallApproval = (typeof INSTALL_APPROVALS)[number];

/** An allowed entry ending within this many days is "expiring" (list badge and the reminder digest). */
export const APPROVAL_EXPIRING_DAYS = 14;

export type ApprovalEntryState = 'active' | 'expiring' | 'expired';

export function approvalEntryState(validUntil: string | null, today: string): ApprovalEntryState {
  if (!validUntil) return 'active';
  const days = daysBetween(today, validUntil);
  if (days < 0) return 'expired';
  return days <= APPROVAL_EXPIRING_DAYS ? 'expiring' : 'active';
}

/**
 * An entry's version covers an installed version: no version on the entry means any; otherwise the same version or
 * a more precise one (`23` covers `23.01`, never `230`), ignoring case.
 */
export function versionMatches(entryVersion: string | null, installVersion: string | null): boolean {
  const want = entryVersion?.trim().toLowerCase();
  if (!want) return true;
  const have = installVersion?.trim().toLowerCase();
  if (!have) return false;
  return have === want || have.startsWith(`${want}.`);
}

export interface ApprovalEntry {
  title: string;
  version: string | null;
  status: ApprovalStatus;
  scope: ApprovalScope;
  departmentIds: readonly string[];
  validUntil: string | null;
  /** The product of the linked licence: installs counted as it (title rules) match too. */
  licenseProduct?: string | null;
}

export interface InstallFacts {
  /** The product as stored (a title rule may have renamed it to a licence's product). */
  product: string;
  /** The title the inventory tool reported, when a title rule renamed it. */
  reportedAs: string | null;
  version: string | null;
  /** The device's department and its assignee's: an entry for either covers it. */
  departmentIds: readonly (string | null)[];
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/** The entry is about this install: same title (as stored or as reported, or its licence's product) and version. */
export function entryMatches(entry: ApprovalEntry, install: InstallFacts): boolean {
  const titled =
    same(entry.title, install.product) ||
    same(entry.title, install.reportedAs) ||
    same(entry.licenseProduct, install.product);
  if (!titled || !versionMatches(entry.version, install.version)) return false;
  return (
    entry.scope === 'company' ||
    install.departmentIds.some((d) => d !== null && entry.departmentIds.includes(d))
  );
}

/**
 * Where an install stands: `blocked` when a blocked entry covers it; `allowed` when an allowed entry that has not
 * ended covers it; otherwise `unapproved`. With no allowed entry at all the allow list is not in use and nothing is
 * `unapproved` (only blocked titles are flagged). The SQL twin is in `server/approved-software.ts`.
 */
export function installApproval(
  install: InstallFacts,
  entries: readonly ApprovalEntry[],
  today: string,
): InstallApproval {
  const live = entries.filter((e) => !e.validUntil || daysBetween(today, e.validUntil) >= 0);
  if (live.some((e) => e.status === 'blocked' && entryMatches(e, install))) return 'blocked';
  if (!entries.some((e) => e.status === 'allowed')) return 'allowed';
  return live.some((e) => e.status === 'allowed' && entryMatches(e, install)) ? 'allowed' : 'unapproved';
}

/* ───────────────────────────── data wipes ───────────────────────────── */

/** How a device's storage was wiped (NIST 800-88 clear, purge, destroy; phones are reset to factory settings). */
export const WIPE_METHODS = [
  'factory_reset',
  'secure_erase',
  'crypto_erase',
  'physical_destruction',
  'other',
] as const;
export type WipeMethod = (typeof WIPE_METHODS)[number];

/** Months after the data retention date by which a returned device must be wiped (ISMS: 2). */
export const DEFAULT_WIPE_MONTHS = 2;
/** Wipes due within this many days are "due" (hardware filter, reminders, attention). */
export const DEFAULT_WIPE_REMIND_DAYS = 7;

/** The date a returned device must be wiped by: the retention date (else the return day) plus the months. */
export function wipeDueDate(retainUntil: string | null, returnedOn: string, months: number): string {
  return addMonths(retainUntil ?? returnedOn, Math.max(0, Math.round(months)));
}

export type WipeState = 'none' | 'scheduled' | 'due' | 'overdue';

/** `due` from `remindDays` before the date, `overdue` after it; `none` without a pending wipe. */
export function wipeState(
  wipeDue: string | null,
  today: string,
  remindDays = DEFAULT_WIPE_REMIND_DAYS,
): WipeState {
  if (!wipeDue) return 'none';
  const days = daysBetween(today, wipeDue);
  if (days < 0) return 'overdue';
  return days <= remindDays ? 'due' : 'scheduled';
}
