/**
 * Application lifecycle vocabulary and its pure rules (no I/O): shared by the API, the web pages, AI
 * tools, a future sync adapter and the unit tests. The change policy and release readiness live here so
 * the "Record deployment" dialog, the CI/CD API and the AI tool can never disagree.
 */

/* ───────────────────────────── enums ───────────────────────────── */

export const APP_STAGES = ['planned', 'development', 'production', 'sunsetting', 'retired'] as const;
export type AppStage = (typeof APP_STAGES)[number];

/** Highest first — sorting by criticality follows this order. */
export const CRITICALITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Criticality = (typeof CRITICALITIES)[number];

/** Gartner TIME: what to do with the application. */
export const DISPOSITIONS = ['tolerate', 'invest', 'migrate', 'eliminate'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const HOSTINGS = ['on_prem', 'cloud', 'saas', 'hybrid'] as const;
export type Hosting = (typeof HOSTINGS)[number];

export const DATA_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export const REPO_PROVIDERS = ['azure_devops', 'github', 'gitlab', 'bitbucket', 'other'] as const;
export type RepoProvider = (typeof REPO_PROVIDERS)[number];

/** In pipeline order (Development → Test → Staging → Production, then disaster recovery). */
export const ENVIRONMENT_KINDS = ['development', 'test', 'staging', 'production', 'dr'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const RELEASE_STATUSES = ['planned', 'in_progress', 'ready', 'released', 'cancelled'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const DEPLOYMENT_STATUSES = ['in_progress', 'succeeded', 'failed', 'rolled_back'] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const DEPLOYMENT_SOURCES = ['manual', 'api'] as const;
export type DeploymentSource = (typeof DEPLOYMENT_SOURCES)[number];

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const STAGE_TONE: Record<AppStage, Tone> = {
  planned: 'neutral',
  development: 'info',
  production: 'success',
  sunsetting: 'warning',
  retired: 'neutral',
};

export const RELEASE_TONE: Record<ReleaseStatus, Tone> = {
  planned: 'neutral',
  in_progress: 'info',
  ready: 'success',
  released: 'success',
  cancelled: 'neutral',
};

export const DEPLOYMENT_TONE: Record<DeploymentStatus, Tone> = {
  in_progress: 'info',
  succeeded: 'success',
  failed: 'danger',
  rolled_back: 'warning',
};

/** Releases that are still going somewhere (the calendar, upcoming lists). */
export const OPEN_RELEASE_STATUSES: readonly ReleaseStatus[] = ['planned', 'in_progress', 'ready'];
/** Deployments that count as a failure for change failure rate and time to restore. */
export const FAILED_STATUSES: readonly DeploymentStatus[] = ['failed', 'rolled_back'];
export const FINISHED_STATUSES: readonly DeploymentStatus[] = ['succeeded', 'failed', 'rolled_back'];

export const environmentRank = (kind: EnvironmentKind) => ENVIRONMENT_KINDS.indexOf(kind);
export const isProduction = (kind: EnvironmentKind) => kind === 'production';
/** Test and staging: where a version proves itself before production. */
export const isPreProduction = (kind: EnvironmentKind) => kind === 'test' || kind === 'staging';

/* ───────────────────────────── codes and versions ───────────────────────────── */

/** `erp`, `hr-portal`: 2–32 lowercase letters, digits and single dashes, starting with a letter. */
export const APP_CODE_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const APP_CODE_MIN = 2;
export const APP_CODE_MAX = 32;
/** Codes that collide with the module's own pages (`/alm/releases`). */
export const RESERVED_CODES: ReadonlySet<string> = new Set(['releases', 'new', 'settings']);

export function isValidCode(code: string): boolean {
  return (
    code.length >= APP_CODE_MIN &&
    code.length <= APP_CODE_MAX &&
    APP_CODE_RE.test(code) &&
    !RESERVED_CODES.has(code)
  );
}

/**
 * Suggests a code from an application name ("Field Service Mobile App" → `field-service-mobile-app`,
 * "Café Ordering" → `cafe-ordering`). Words are dropped from the end to fit 32 characters; names without
 * Latin letters or digits give `''` (the person types one). `taken` codes get a numeric suffix.
 */
export function suggestCode(name: string, taken: ReadonlySet<string> = new Set()): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  while (words.length && !/^[a-z]/.test(words[0]!)) words.shift();
  let code = '';
  for (const w of words) {
    const next = code ? `${code}-${w}` : w;
    if (next.length > APP_CODE_MAX) break;
    code = next;
  }
  if (!code && words[0]) code = words[0].slice(0, APP_CODE_MAX);
  if (code.length < APP_CODE_MIN) return '';
  if (RESERVED_CODES.has(code)) code = `${code}-app`;
  if (!taken.has(code)) return code;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const candidate = `${code.slice(0, APP_CODE_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return '';
}

/** `12.1.0`, `2026.10`, `v3.0.0-rc.1`, `1.2.3+build.7`: no spaces or slashes (it is part of a URL). */
export const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;

/** Web paths. */
export const appHref = (code: string) => `/alm/${code}`;
export const releaseHref = (code: string, version: string) =>
  `/alm/${code}/releases/${encodeURIComponent(version)}`;

/* ───────────────────────────── lifecycles ───────────────────────────── */

/** Release statuses a person may set by hand. A successful production deployment also releases it. */
export const RELEASE_TRANSITIONS: Record<ReleaseStatus, readonly ReleaseStatus[]> = {
  planned: ['in_progress', 'ready', 'released', 'cancelled'],
  in_progress: ['planned', 'ready', 'released', 'cancelled'],
  ready: ['in_progress', 'released', 'cancelled'],
  released: [],
  cancelled: ['planned'],
};

export function canMoveRelease(from: ReleaseStatus, to: ReleaseStatus): boolean {
  return RELEASE_TRANSITIONS[from].includes(to);
}

/** Finishing a recorded deployment (`PATCH /deployments/:id`); a success can still be rolled back. */
export const DEPLOYMENT_TRANSITIONS: Record<DeploymentStatus, readonly DeploymentStatus[]> = {
  in_progress: ['succeeded', 'failed', 'rolled_back'],
  succeeded: ['rolled_back'],
  failed: [],
  rolled_back: [],
};

/* ───────────────────────────── change policy ───────────────────────────── */

/** ITSM change statuses that mean "approved by the CAB workflow". */
export const AUTHORIZED_CHANGE_STATUSES: readonly string[] = ['scheduled', 'implementing'];
export const isAuthorizedChange = (status: string) => AUTHORIZED_CHANGE_STATUSES.includes(status);

export type PolicyReason = 'no_change' | 'change_not_approved' | 'outside_window';
export type PolicyWarning = 'outside_window';

/** An ITSM change as the policy sees it (read from `itsm.tickets` + `itsm.changes`). */
export interface PolicyChange {
  id: string;
  reference: string;
  status: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  /** The caller named this change (rather than it being linked to the release). */
  named?: boolean;
}

export interface PolicySettings {
  /** `alm.policy.requireChange` (default on). */
  requireChange: boolean;
  /** `alm.policy.enforceWindow` (default off). */
  enforceWindow: boolean;
}

export interface PolicyInput {
  environmentKind: EnvironmentKind;
  settings: PolicySettings;
  /** The named change (if any) and the changes linked to the release. */
  changes: readonly PolicyChange[];
  now: Date;
  /** The caller asked to override (and holds `alm.deployments.override` — checked before). */
  override?: boolean;
}

export interface PolicyDecision {
  /** `allow`, `warn` (allowed, outside the change window), `deny`, or `override` (denied, let through). */
  outcome: 'allow' | 'warn' | 'deny' | 'override';
  /** The rule applies: a production environment while `requireChange` is on. */
  applies: boolean;
  /** Why it is (or would have been) refused. */
  reason: PolicyReason | null;
  warning: PolicyWarning | null;
  /** The change that authorizes the deployment, or the best candidate when it is refused. */
  change: PolicyChange | null;
}

export function inWindow(change: Pick<PolicyChange, 'plannedStart' | 'plannedEnd'>, now: Date): boolean {
  const { plannedStart: start, plannedEnd: end } = change;
  return Boolean(start && end && start.getTime() <= now.getTime() && now.getTime() <= end.getTime());
}

/**
 * Best candidate first: authorized and in its window, then authorized, then anything else; the change the
 * caller named wins ties, then the one whose window starts closest to now.
 */
export function rankChanges(changes: readonly PolicyChange[], now: Date): PolicyChange[] {
  const score = (c: PolicyChange) =>
    (isAuthorizedChange(c.status) ? (inWindow(c, now) ? 0 : 1) : 2) * 2 + (c.named ? 0 : 1);
  const distance = (c: PolicyChange) =>
    c.plannedStart ? Math.abs(c.plannedStart.getTime() - now.getTime()) : Number.MAX_SAFE_INTEGER;
  return [...changes].sort((a, b) => score(a) - score(b) || distance(a) - distance(b));
}

/**
 * The change policy for one deployment. A production deployment is authorized when the named change or a
 * change linked to the release is `scheduled` or `implementing`; with `enforceWindow` it must also be
 * inside the change's planned window (otherwise being outside it only warns). Anything else is refused
 * (`no_change`, `change_not_approved`, `outside_window`) unless the caller overrides.
 */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const ranked = rankChanges(input.changes, input.now);
  const best = ranked[0] ?? null;
  const applies = isProduction(input.environmentKind) && input.settings.requireChange;
  if (!applies) return { outcome: 'allow', applies, reason: null, warning: null, change: best };

  let reason: PolicyReason | null = null;
  let warning: PolicyWarning | null = null;
  if (!best) reason = 'no_change';
  else if (!isAuthorizedChange(best.status)) reason = 'change_not_approved';
  else if (!inWindow(best, input.now)) {
    if (input.settings.enforceWindow) reason = 'outside_window';
    else warning = 'outside_window';
  }
  if (!reason) return { outcome: warning ? 'warn' : 'allow', applies, reason: null, warning, change: best };
  return { outcome: input.override ? 'override' : 'deny', applies, reason, warning: null, change: best };
}

/* ───────────────────────────── release readiness ───────────────────────────── */

export const READINESS_CHECKS = ['change', 'tested', 'notes', 'production'] as const;
export type ReadinessCheckKey = (typeof READINESS_CHECKS)[number];

export interface ReadinessFacts {
  /** Changes linked to the release. */
  changes: readonly PolicyChange[];
  /** This version succeeded in a test or staging environment. */
  testedIn: string[];
  notes: string | null;
  /** Failed or rolled-back production deployments of this version. */
  failedInProduction: number;
}

export interface Readiness {
  /** All four checks pass. */
  ready: boolean;
  passed: number;
  total: number;
  checks: { key: ReadinessCheckKey; ok: boolean }[];
  /** The linked change the "authorized change" check is about (the best candidate). */
  change: PolicyChange | null;
}

/**
 * Release readiness: an authorized change is linked; the version succeeded in test or staging; release
 * notes are written; no production deployment of this version failed.
 */
export function evaluateReadiness(facts: ReadinessFacts, now: Date): Readiness {
  const change = rankChanges(facts.changes, now)[0] ?? null;
  const checks: Readiness['checks'] = [
    { key: 'change', ok: Boolean(change && isAuthorizedChange(change.status)) },
    { key: 'tested', ok: facts.testedIn.length > 0 },
    { key: 'notes', ok: Boolean(facts.notes?.trim()) },
    { key: 'production', ok: facts.failedInProduction === 0 },
  ];
  const passed = checks.filter((c) => c.ok).length;
  return { ready: passed === checks.length, passed, total: checks.length, checks, change };
}

/* ───────────────────────────── DORA metrics ───────────────────────────── */

/** What the database aggregates for one application's production deployments in a window. */
export interface DoraFacts {
  succeeded: number;
  failed: number;
  rolledBack: number;
  /** Median minutes from release created to its first successful production deployment. */
  leadTimeMinutes: number | null;
  leadTimeSamples: number;
  /** Median minutes from a failed production deployment to the next success on that environment. */
  restoreMinutes: number | null;
  restoreSamples: number;
  /** Per week (Monday, `YYYY-MM-DD`, UTC); weeks without deployments may be missing. */
  weeks: { week: string; succeeded: number; failed: number }[];
}

export interface DoraMetrics {
  days: number;
  from: Date;
  to: Date;
  deploymentFrequency: { perWeek: number; total: number };
  changeFailureRate: { rate: number | null; failures: number; finished: number };
  leadTime: { medianHours: number | null; samples: number };
  timeToRestore: { medianHours: number | null; samples: number };
  weekly: { week: string; succeeded: number; failed: number }[];
}

const DAY_MS = 86_400_000;
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** `YYYY-MM-DD` of the Monday (UTC) of the week containing `d`. */
export function weekStart(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(day.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

/** Every week (Monday, UTC) from the one containing `from` to the one containing `to`. */
export function weekStarts(from: Date, to: Date): string[] {
  const out: string[] = [];
  const last = weekStart(to);
  for (let w = new Date(`${weekStart(from)}T00:00:00Z`); ; w = new Date(w.getTime() + 7 * DAY_MS)) {
    const key = w.toISOString().slice(0, 10);
    out.push(key);
    if (key >= last || out.length > 600) break;
  }
  return out;
}

/** Turns aggregated facts into the four DORA-style metrics plus a complete weekly series. */
export function assembleDora(facts: DoraFacts, from: Date, to: Date): DoraMetrics {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  const failures = facts.failed + facts.rolledBack;
  const finished = facts.succeeded + failures;
  const byWeek = new Map(facts.weeks.map((w) => [w.week, w]));
  const hours = (m: number | null) => (m === null ? null : round(m / 60, 1));
  return {
    days,
    from,
    to,
    deploymentFrequency: { perWeek: round(facts.succeeded / (days / 7), 1), total: facts.succeeded },
    changeFailureRate: { rate: finished ? round(failures / finished, 3) : null, failures, finished },
    leadTime: { medianHours: hours(facts.leadTimeMinutes), samples: facts.leadTimeSamples },
    timeToRestore: { medianHours: hours(facts.restoreMinutes), samples: facts.restoreSamples },
    weekly: weekStarts(from, to).map((week) => ({
      week,
      succeeded: byWeek.get(week)?.succeeded ?? 0,
      failed: byWeek.get(week)?.failed ?? 0,
    })),
  };
}

/** Median of a list (for tests and small in-memory sets; the API computes it in SQL). */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
