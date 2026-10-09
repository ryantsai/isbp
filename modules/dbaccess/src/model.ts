/**
 * Pure rules of Database access (no I/O): account naming, identifier validation, durations, grant and review
 * states, drift and review policy. Shared by the API, the web pages and the unit tests, so the UI and the
 * server can never disagree.
 */

/* ───────────────────────────── vocabularies ───────────────────────────── */

/** Engines whose accounts and roles the module manages (MySQL is out of scope). */
export const MANAGED_ENGINES = ['mssql', 'postgres', 'oracle'] as const;
export type ManagedEngine = (typeof MANAGED_ENGINES)[number];
export const isManagedEngine = (engine: string): engine is ManagedEngine =>
  (MANAGED_ENGINES as readonly string[]).includes(engine);

export const ENVIRONMENTS = ['production', 'staging', 'test', 'development'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** How new accounts authenticate: a generated password, Windows/AD (SQL Server) or an external directory. */
export const AUTH_MODES = ['password', 'windows', 'external'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const RISKS = ['low', 'medium', 'high'] as const;
export type Risk = (typeof RISKS)[number];
export const RISK_RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2 };
export const riskAtLeast = (risk: Risk, min: Risk) => RISK_RANK[risk] >= RISK_RANK[min];

/** Stored grant states. `expiring` is derived (active and ending within {@link EXPIRING_DAYS}). */
export const GRANT_STATUSES = ['provisioning', 'active', 'revoking', 'revoked', 'expired', 'failed'] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];
export const GRANT_VIEW_STATUSES = [
  'provisioning',
  'active',
  'expiring',
  'revoking',
  'revoked',
  'expired',
  'failed',
] as const;
export type GrantViewStatus = (typeof GRANT_VIEW_STATUSES)[number];
/** Grants that hold (or are about to hold, or still hold) the role on the server. */
export const LIVE_GRANT_STATUSES = ['provisioning', 'active', 'revoking', 'failed'] as const;

/** What the worker does (or did, when `failed`) for a grant. */
export const GRANT_OPERATIONS = ['grant', 'revoke'] as const;
export type GrantOperation = (typeof GRANT_OPERATIONS)[number];

/** Where a grant came from. */
export const GRANT_SOURCES = ['request', 'adopted', 'unmanaged'] as const;
export type GrantSource = (typeof GRANT_SOURCES)[number];

/** Why a grant ended. */
export const END_REASONS = ['expired', 'revoked', 'relinquished', 'offboarded', 'review'] as const;
export type EndReason = (typeof END_REASONS)[number];

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REVIEW_STATUSES = ['scheduled', 'active', 'closed'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_DECISIONS = ['keep', 'revoke'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const REVIEWER_RULES = ['owner', 'manager'] as const;
export type ReviewerRule = (typeof REVIEWER_RULES)[number];
export const REVIEW_POLICIES = ['revoke', 'keep'] as const;
export type ReviewPolicy = (typeof REVIEW_POLICIES)[number];
export const RECURRENCES = ['none', 'quarterly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/** Grants ending within this many days show as "expiring" and get a reminder. */
export const EXPIRING_DAYS = 3;
/** A generated password can be revealed once, within this many days. */
export const REVEAL_DAYS = 7;
/** Provisioning and revocation attempts before a grant is marked failed. */
export const MAX_ATTEMPTS = 3;
/** Review reminders go out this many days before the due date. */
export const REVIEW_REMIND_DAYS = 3;

export const DEFAULT_PATTERN = '{username}';
export const PASSWORD_LENGTH = { min: 16, max: 64, default: 24 } as const;
/** Oracle passwords are at most 30 bytes. */
export const ORACLE_PASSWORD_MAX = 30;

/* ───────────────────────────── references ───────────────────────────── */

const pad = (n: number, width = 5) => String(n).padStart(width, '0');
export const formatRequestRef = (n: number) => `DBR-${pad(n)}`;
export const formatReviewRef = (n: number) => `REV-${pad(n, 4)}`;
export const REQUEST_REF_RE = /^DBR-(\d{1,9})$/i;
export const REVIEW_REF_RE = /^REV-(\d{1,9})$/i;

/* ───────────────────────────── naming ───────────────────────────── */

export const NAME_TOKENS = ['username', 'email_local'] as const;
export type NameToken = (typeof NAME_TOKENS)[number];

/** Longest account (and role) name per engine (Oracle 30 keeps older clients and tools happy). */
export const MAX_NAME_LENGTH: Record<ManagedEngine, number> = { postgres: 63, mssql: 128, oracle: 30 };

/** Account names the platform creates: lower-case letters, digits and `_`, starting with a letter. */
export const ACCOUNT_NAME_RE = /^[a-z][a-z0-9_]*$/;
/** Oracle names are stored upper-case. */
export const ORACLE_ACCOUNT_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
/** Role names as servers report them (letters, digits, `_`, `$`, `#`; no spaces or quotes). */
export const ROLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_$#]*$/;
/** SQL Server database names the module works in. */
export const DATABASE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_$#@-]{0,127}$/;
/** NetBIOS domain for Windows logins (`CONTOSO\user`). */
export const DOMAIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,14}$/;
/** Names that appear in the inventory (logins, users, roles) — what drift and adoption accept. */
export const INVENTORY_NAME_RE = /^[A-Za-z0-9_$#@.\\-]{1,128}$/;

const PATTERN_RE = /^(?:[A-Za-z0-9_]|\{(?:username|email_local)\})+$/;

/** `null` when the pattern is usable; otherwise why not. */
export function patternProblem(pattern: string): 'empty' | 'invalid' | 'no_token' | 'too_long' | null {
  const p = pattern.trim();
  if (!p) return 'empty';
  if (p.length > 60) return 'too_long';
  if (!PATTERN_RE.test(p)) return 'invalid';
  if (!/\{(?:username|email_local)\}/.test(p)) return 'no_token';
  return null;
}

export interface NamedPerson {
  username: string;
  email: string | null;
}

/**
 * The account name a person gets on a server: the pattern's tokens replaced, lower-cased, everything but
 * `[a-z0-9_]` turned into `_`, prefixed with `u` when it would start with a digit, cut to the engine's
 * limit; Oracle names are upper-case. `null` when nothing usable remains.
 */
export function accountNameFor(pattern: string, person: NamedPerson, engine: ManagedEngine): string | null {
  if (patternProblem(pattern)) return null;
  const emailLocal = (person.email ?? '').split('@')[0] ?? '';
  let name = pattern
    .replaceAll('{username}', person.username)
    .replaceAll('{email_local}', emailLocal || person.username)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!name) return null;
  if (!/^[a-z]/.test(name)) name = `u${name}`;
  name = name.slice(0, MAX_NAME_LENGTH[engine]).replace(/_+$/, '');
  if (!ACCOUNT_NAME_RE.test(name)) return null;
  return engine === 'oracle' ? name.toUpperCase() : name;
}

/** Strict check of an account name before it reaches a statement (server-side quoting does the rest). */
export function isValidAccountName(name: string, engine: ManagedEngine): boolean {
  if (!name || name.length > MAX_NAME_LENGTH[engine]) return false;
  return engine === 'oracle' ? ORACLE_ACCOUNT_NAME_RE.test(name) : ACCOUNT_NAME_RE.test(name);
}

export function isValidRoleName(name: string, engine: ManagedEngine): boolean {
  return (
    Boolean(name) &&
    name.length <= MAX_NAME_LENGTH[engine === 'oracle' ? 'mssql' : engine] &&
    ROLE_NAME_RE.test(name)
  );
}

export const isValidDatabaseName = (name: string) => DATABASE_NAME_RE.test(name);

/** The login a server knows the account by: `CONTOSO\jdoe` for Windows logins on SQL Server. */
export function loginNameFor(
  account: string,
  engine: ManagedEngine,
  authMode: AuthMode,
  domain: string | null,
): string {
  return engine === 'mssql' && authMode === 'windows' && domain
    ? `${domain.toUpperCase()}\\${account}`
    : account;
}

/** Auth modes each engine supports (Windows logins exist on SQL Server only). */
export function authModesFor(engine: ManagedEngine): readonly AuthMode[] {
  return engine === 'mssql' ? AUTH_MODES : (['password', 'external'] as const);
}

/** Names compare case-sensitively on PostgreSQL, case-insensitively on SQL Server and Oracle. */
export const nameKey = (engine: string, name: string) => (engine === 'postgres' ? name : name.toLowerCase());

/* ───────────────────────────── dates & durations ───────────────────────────── */

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && ISO_DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (calendar dates). */
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Today's calendar date in a time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Minutes the zone is ahead of UTC at `instant`. */
function zoneOffsetMinutes(timeZone: string, instant: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instant));
    const v = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
    return Math.round((local - Math.floor(instant / 1000) * 1000) / 60_000);
  } catch {
    return 0;
  }
}

/** The last moment of a calendar date in a time zone (access "until 31 Dec" lasts the whole day). */
export function endOfDayIn(iso: string, timeZone: string): Date {
  const nextMidnightUtc = Date.parse(`${addDays(iso, 1)}T00:00:00Z`);
  let instant = nextMidnightUtc - zoneOffsetMinutes(timeZone, nextMidnightUtc) * 60_000;
  instant = nextMidnightUtc - zoneOffsetMinutes(timeZone, instant) * 60_000;
  return new Date(instant - 1_000);
}

export interface DurationPolicy {
  /** Days proposed in the request form (`null` = permanent by default, only with `allowPermanent`). */
  defaultDays: number | null;
  /** Longest grant in days (`null` = no limit, only with `allowPermanent`). */
  maxDays: number | null;
  allowPermanent: boolean;
}

/** The latest end date a request may ask for today (`null`: no limit). */
export const maxDateFor = (policy: DurationPolicy, today: string): string | null =>
  policy.maxDays === null ? null : addDays(today, policy.maxDays);

/** The end date the request form proposes (`null`: permanent). */
export function defaultDateFor(policy: DurationPolicy, today: string): string | null {
  if (policy.defaultDays === null) return policy.allowPermanent ? null : maxDateFor(policy, today);
  const days = policy.maxDays === null ? policy.defaultDays : Math.min(policy.defaultDays, policy.maxDays);
  return addDays(today, days);
}

export type DurationCheck = 'ok' | 'past' | 'too_long' | 'permanent_not_allowed';

export function checkDuration(
  policy: DurationPolicy,
  expiresOn: string | null,
  today: string,
): DurationCheck {
  if (expiresOn === null) return policy.allowPermanent ? 'ok' : 'permanent_not_allowed';
  if (expiresOn <= today) return 'past';
  const max = maxDateFor(policy, today);
  if (max !== null && expiresOn > max) return 'too_long';
  return 'ok';
}

/** Problems with a role's duration settings (DBA form), or `null`. */
export function durationPolicyProblem(policy: DurationPolicy): 'max_required' | 'default_over_max' | null {
  if (policy.maxDays === null && !policy.allowPermanent) return 'max_required';
  if (policy.defaultDays === null && !policy.allowPermanent && policy.maxDays === null) return 'max_required';
  if (policy.defaultDays !== null && policy.maxDays !== null && policy.defaultDays > policy.maxDays)
    return 'default_over_max';
  return null;
}

/**
 * When an approved grant ends: the end of the requested day in the requester's zone, at least a day
 * from now (approvals can take longer than asked for) and never beyond the role's maximum.
 */
export function grantExpiry(
  expiresOn: string | null,
  policy: DurationPolicy,
  timeZone: string,
  now: Date = new Date(),
): Date | null {
  if (expiresOn === null)
    return policy.allowPermanent ? null : new Date(now.getTime() + (policy.maxDays ?? 1) * DAY_MS);
  let at = endOfDayIn(expiresOn, timeZone).getTime();
  at = Math.max(at, now.getTime() + DAY_MS);
  if (policy.maxDays !== null) at = Math.min(at, now.getTime() + policy.maxDays * DAY_MS);
  return new Date(at);
}

/* ───────────────────────────── grants ───────────────────────────── */

export function viewStatus(
  status: GrantStatus,
  expiresAt: Date | null,
  now: Date = new Date(),
): GrantViewStatus {
  if (status === 'active' && expiresAt && expiresAt.getTime() - now.getTime() <= EXPIRING_DAYS * DAY_MS)
    return 'expiring';
  return status;
}

/** Backoff before attempt `n + 1` (seconds): base, 4×base, 16×base… */
export const retryDelaySeconds = (base: number, attemptsMade: number) =>
  Math.max(1, base) * 4 ** Math.max(0, attemptsMade - 1);

/* ───────────────────────────── drift ───────────────────────────── */

export interface Membership {
  /** `''` for server-level roles (PostgreSQL, Oracle, SQL Server server roles). */
  database: string;
  roleName: string;
  memberName: string;
}

export interface RequestableRoleKey {
  id: string;
  database: string;
  roleName: string;
}

export interface GrantKey {
  roleId: string;
  accountName: string | null;
  status: GrantStatus;
}

export interface UnmanagedMembership extends Membership {
  roleId: string;
}

/**
 * Memberships of requestable roles that no live grant explains: "unmanaged access" a DBA should adopt
 * or revoke. Names compare per engine ({@link nameKey}).
 */
export function unmanagedMemberships(
  engine: string,
  memberships: readonly Membership[],
  roles: readonly RequestableRoleKey[],
  grants: readonly GrantKey[],
): UnmanagedMembership[] {
  const live = new Set<string>(LIVE_GRANT_STATUSES);
  const roleByKey = new Map(
    roles.map((r) => [`${nameKey(engine, r.database)}\u0000${nameKey(engine, r.roleName)}`, r.id]),
  );
  const explained = new Set(
    grants
      .filter((g) => live.has(g.status) && g.accountName)
      .map((g) => `${g.roleId}\u0000${nameKey(engine, g.accountName!)}`),
  );
  const out: UnmanagedMembership[] = [];
  for (const m of memberships) {
    const roleId = roleByKey.get(`${nameKey(engine, m.database)}\u0000${nameKey(engine, m.roleName)}`);
    if (!roleId) continue;
    // A SQL Server Windows login `CONTOSO\jdoe` explains the database user of the same name.
    if (explained.has(`${roleId}\u0000${nameKey(engine, m.memberName)}`)) continue;
    out.push({ ...m, roleId });
  }
  return out;
}

export interface PersonMatch {
  userId: string;
  active: boolean;
}

/**
 * Account name → person, from the server's naming pattern (and the platform's own account records,
 * which win). Accounts that match nobody, or someone who is no longer active, are orphans.
 */
export function personIndex(
  engine: ManagedEngine,
  pattern: string,
  people: readonly (NamedPerson & { id: string; active: boolean })[],
  known: readonly { accountName: string; userId: string | null }[] = [],
): Map<string, PersonMatch> {
  const index = new Map<string, PersonMatch>();
  const activeById = new Map(people.map((p) => [p.id, p.active]));
  for (const p of people) {
    const name = accountNameFor(pattern, p, engine);
    if (!name) continue;
    const key = nameKey(engine, name);
    const existing = index.get(key);
    // Two people mapping to one name: prefer the active one.
    if (!existing || (!existing.active && p.active)) index.set(key, { userId: p.id, active: p.active });
  }
  for (const k of known) {
    if (!k.userId) continue;
    index.set(nameKey(engine, k.accountName), {
      userId: k.userId,
      active: activeById.get(k.userId) ?? false,
    });
  }
  return index;
}

/** Strips a Windows domain (`CONTOSO\jdoe` → `jdoe`) before matching people. */
export const bareAccountName = (name: string) => name.slice(name.lastIndexOf('\\') + 1);

/* ───────────────────────────── reviews ───────────────────────────── */

export interface ReviewOwner {
  ownerUserId: string | null;
  ownerGroupId: string | null;
  granteeId: string | null;
  granteeManagerId: string | null;
}

export type Reviewer = { kind: 'user'; id: string } | { kind: 'group'; id: string } | null;

/**
 * Who reviews a grant: its role owner (person or group) or the grantee's manager. Nobody reviews their
 * own access: the other rule is tried, then the item is left to review managers.
 */
export function reviewerFor(rule: ReviewerRule, g: ReviewOwner): Reviewer {
  const owner: Reviewer = g.ownerUserId
    ? { kind: 'user', id: g.ownerUserId }
    : g.ownerGroupId
      ? { kind: 'group', id: g.ownerGroupId }
      : null;
  const manager: Reviewer = g.granteeManagerId ? { kind: 'user', id: g.granteeManagerId } : null;
  const order = rule === 'owner' ? [owner, manager] : [manager, owner];
  for (const r of order) {
    if (!r) continue;
    if (r.kind === 'user' && r.id === g.granteeId) continue;
    return r;
  }
  return null;
}

export interface ReviewItemState {
  id: string;
  grantId: string;
  decision: ReviewDecision | null;
}

/** Applies the campaign's policy to undecided items when it closes. */
export function closeOutcome(items: readonly ReviewItemState[], policy: ReviewPolicy) {
  const revoke: string[] = [];
  const keep: string[] = [];
  const defaulted: string[] = [];
  for (const item of items) {
    const decision = item.decision ?? policy;
    if (!item.decision) defaulted.push(item.id);
    (decision === 'revoke' ? revoke : keep).push(item.grantId);
  }
  return { revoke, keep, defaulted };
}

export interface ReviewTotals {
  items: number;
  kept: number;
  revoked: number;
  pending: number;
}

export function reviewTotals(items: readonly { decision: ReviewDecision | null }[]): ReviewTotals {
  let kept = 0;
  let revoked = 0;
  for (const i of items) {
    if (i.decision === 'keep') kept++;
    else if (i.decision === 'revoke') revoked++;
  }
  return { items: items.length, kept, revoked, pending: items.length - kept - revoked };
}

/** The next campaign of a recurring review: same length, starting three months later. */
export function nextCampaignDates(startedOn: string, dueOn: string): { startOn: string; dueOn: string } {
  return { startOn: addMonths(startedOn, 3), dueOn: addMonths(dueOn, 3) };
}

/* ───────────────────────────── CSV ───────────────────────────── */

/** RFC 4180 CSV; cells that start like a formula are prefixed with `'` (CSV injection). */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return `${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
