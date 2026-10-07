/**
 * Pure project-management logic shared by the API, the web pages and the tests: vocabularies, task
 * references, board ranks (fractional indexing), status rules, key suggestions and the workload model.
 * No I/O here — everything is deterministic and unit-tested.
 */

/* ───────────────────────────── permissions ───────────────────────────── */

/**
 * Platform permission keys have three segments (`module.resource.action`), so "use Projects" is
 * `projects.projects.use` and "administer any project" is `projects.projects.admin`.
 */
export const PERMISSIONS = {
  /** See internal projects and private ones you're a member of; members work on tasks. */
  use: 'projects.projects.use',
  /** Create projects (the creator becomes their manager). */
  create: 'projects.projects.create',
  /** See every project, including private ones. */
  portfolio: 'projects.portfolio.read',
  /** Manage any project. */
  admin: 'projects.projects.admin',
} as const;

/* ───────────────────────────── vocabularies ───────────────────────────── */

export const PROJECT_STATUSES = ['proposed', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_HEALTHS = ['on_track', 'at_risk', 'off_track'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];

export const PROJECT_PRIORITIES = ['high', 'medium', 'low'] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

export const VISIBILITIES = ['internal', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MEMBER_ROLES = ['manager', 'member', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MILESTONE_STATUSES = ['open', 'done'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/** Mirrors Azure DevOps work item types (Epic / Feature / User Story / Task / Bug). */
export const TASK_TYPES = ['epic', 'feature', 'story', 'task', 'bug'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Board columns, left to right. Cancelled tasks are hidden behind a filter. */
export const BOARD_COLUMNS = ['backlog', 'todo', 'in_progress', 'in_review', 'done'] as const;

export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = ['done', 'cancelled'];
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = TASK_STATUSES.filter(
  (s) => !CLOSED_TASK_STATUSES.includes(s),
);

export const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const PROJECT_STATUS_TONE: Record<ProjectStatus, StatusTone> = {
  proposed: 'neutral',
  active: 'info',
  on_hold: 'warning',
  completed: 'success',
  cancelled: 'neutral',
};

export const TASK_STATUS_TONE: Record<TaskStatus, StatusTone> = {
  backlog: 'neutral',
  todo: 'neutral',
  in_progress: 'info',
  in_review: 'warning',
  done: 'success',
  cancelled: 'neutral',
};

export const HEALTH_TONE: Record<ProjectHealth, StatusTone> = {
  on_track: 'success',
  at_risk: 'warning',
  off_track: 'danger',
};

export const isOpenTask = (status: TaskStatus) => !CLOSED_TASK_STATUSES.includes(status);

/* ───────────────────────────── keys and references ───────────────────────────── */

/** 2–10 uppercase letters or digits, starting with a letter: `NET`, `M365`. */
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const TASK_REF_RE = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string) => UUID_RE.test(value);

export const formatTaskRef = (key: string, number: number) => `${key}-${number}`;

/** `NET-12` → `{ key: 'NET', number: 12 }`, a uuid → `{ id }`, anything else → null. */
export function parseTaskRef(value: string): { key: string; number: number } | { id: string } | null {
  const v = value.trim();
  if (isUuid(v)) return { id: v.toLowerCase() };
  const m = TASK_REF_RE.exec(v);
  if (!m) return null;
  const number = Number(m[2]);
  return number > 0 ? { key: m[1]!.toUpperCase(), number } : null;
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'with', 'by']);

/**
 * A project key suggested from its name (editable in the UI): an acronym already in the name ("ERP
 * upgrade" → `ERP`), the initials of the significant words ("Zero Trust rollout" → `ZTR`), or the start
 * of a single word ("Network" → `NETW`). Empty when the name has no Latin letters (e.g. 高雄辦公室).
 */
export function suggestProjectKey(name: string): string {
  const words = (name.normalize('NFKD').match(/[A-Za-z][A-Za-z0-9]*|\d+/g) ?? []).filter(
    (w) => !STOP_WORDS.has(w.toLowerCase()),
  );
  const lettered = words.filter((w) => /^[A-Za-z]/.test(w));
  if (!lettered.length) return '';
  const acronym = lettered.find((w) => /^[A-Z][A-Z0-9]{1,5}$/.test(w));
  if (acronym) return acronym.slice(0, 10);
  let key: string;
  if (lettered.length === 1) key = lettered[0]!.slice(0, 4).toUpperCase();
  else
    key = lettered
      .slice(0, 4)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  if (key.length < 2) key = (key + lettered[0]!.slice(1).toUpperCase()).slice(0, 3);
  if (key.length < 2) key = `${key}P`;
  return key.replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

/* ───────────────────────────── board ranks ───────────────────────────── */

/**
 * Fractional indexing over base-36 digits (`0-9a-z`): a rank is the fraction digits of a number in
 * (0, 1), so there is always room between two ranks. Ranks never end in `0` (the smallest digit), so
 * something can always be placed before them. Compare with byte order (the column is `COLLATE "C"`).
 */
export const RANK_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
/** Ranks longer than this are rebalanced (re-spaced) for their column. */
export const RANK_MAX_LENGTH = 48;
const ZERO = RANK_DIGITS[0]!;

export function isValidRank(rank: string): boolean {
  return rank.length > 0 && /^[0-9a-z]+$/.test(rank) && !rank.endsWith(ZERO);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`rank ${a} is not before ${b}`);
  if (b !== null) {
    // Shared prefix (with `a` padded by zeros): keep it and recurse on the rest.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? RANK_DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? RANK_DIGITS.indexOf(b[0]!) : RANK_DIGITS.length;
  if (digitB - digitA > 1) return RANK_DIGITS[Math.round((digitA + digitB) / 2)]!;
  // Consecutive first digits.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return RANK_DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/** A rank strictly between `before` and `after` (either may be null for the open end). */
export function rankBetween(before: string | null, after: string | null): string {
  if (before !== null && !isValidRank(before)) throw new Error(`invalid rank "${before}"`);
  if (after !== null && !isValidRank(after)) throw new Error(`invalid rank "${after}"`);
  return midpoint(before ?? '', after);
}

/** `count` evenly spaced ranks in ascending order (seeding, rebalancing a column). */
export function rankSequence(count: number): string[] {
  if (count <= 0) return [];
  const base = RANK_DIGITS.length;
  let width = 1;
  while (base ** width - 1 < count * 4) width++;
  const space = base ** width;
  const step = space / (count + 1);
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    let n = Math.round(step * i);
    let digits = '';
    for (let w = 0; w < width; w++) {
      digits = RANK_DIGITS[n % base]! + digits;
      n = Math.floor(n / base);
    }
    out.push(digits.replace(/0+$/, '') || RANK_DIGITS[1]!);
  }
  return out;
}

/* ───────────────────────────── status rules ───────────────────────────── */

const PROJECT_FLOW: Record<ProjectStatus, readonly ProjectStatus[]> = {
  // `active` is reached through the approval (POST /start), never directly.
  proposed: ['cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** Statuses a project may move to with `POST /status` (starting a proposal goes through `/start`). */
export function projectTransitions(status: ProjectStatus): readonly ProjectStatus[] {
  return PROJECT_FLOW[status];
}

/**
 * Completing a project needs every task done or cancelled — or `force` with a comment. Returns the
 * problem, or null when it may complete.
 */
export function completionProblem(input: {
  openTasks: number;
  force?: boolean;
  comment?: string | null;
}): 'open_tasks' | 'comment_required' | null {
  if (input.openTasks === 0) return null;
  if (!input.force) return 'open_tasks';
  return input.comment?.trim() ? null : 'comment_required';
}

/** Moving into `done` stamps `completed_at`; moving out of it clears it. */
export function completedAtFor(
  from: TaskStatus,
  to: TaskStatus,
  current: Date | null,
  now: Date = new Date(),
): Date | null {
  if (to === 'done') return from === 'done' && current ? current : now;
  return null;
}

/** Dependencies that keep a task from starting: anything not done (cancelled ones no longer block). */
export function blockingDependencies<T extends { status: TaskStatus }>(dependencies: readonly T[]): T[] {
  return dependencies.filter((d) => d.status !== 'done' && d.status !== 'cancelled');
}

/** Only `in_progress` needs the dependencies done (finish-to-start). */
export const needsDependenciesDone = (to: TaskStatus) => to === 'in_progress';

/**
 * Would the edge `taskId depends on dependsOnId` close a loop? True when `dependsOnId` already
 * (transitively) depends on `taskId`. The API asks the same question with a recursive CTE.
 */
export function wouldCreateCycle(
  edges: readonly { taskId: string; dependsOnId: string }[],
  taskId: string,
  dependsOnId: string,
): boolean {
  if (taskId === dependsOnId) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.taskId, [...(next.get(e.taskId) ?? []), e.dependsOnId]);
  const seen = new Set<string>();
  const stack = [dependsOnId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(next.get(cur) ?? []));
  }
  return false;
}

/* ───────────────────────────── dates ───────────────────────────── */

/** Calendar dates travel as `YYYY-MM-DD`; arithmetic runs on UTC midnights so time zones never shift them. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const d = parseDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/** Days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(value: string): number {
  return (parseDate(value).getUTCDay() + 6) % 7;
}

export const isWorkingDay = (value: string) => weekday(value) < 5;

/** Monday of the ISO week containing the date. */
export function weekStart(value: string): string {
  return addDays(value, -weekday(value));
}

/** The calendar date "now" in a time zone (default Asia/Taipei, the company's head office). */
export function todayIn(timeZone = 'Asia/Taipei', now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return formatDate(now);
  }
}

export type DueBucket = 'overdue' | 'today' | 'thisWeek' | 'later' | 'noDate';
export const DUE_BUCKETS: readonly DueBucket[] = ['overdue', 'today', 'thisWeek', 'later', 'noDate'];

/** Where an open task sits in "My tasks": overdue, today, the rest of this ISO week, later or undated. */
export function dueBucket(dueDate: string | null, today: string): DueBucket {
  if (!dueDate) return 'noDate';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return dueDate <= addDays(weekStart(today), 6) ? 'thisWeek' : 'later';
}

/* ───────────────────────────── workload ───────────────────────────── */

export interface PlannedTask {
  startDate: string | null;
  dueDate: string | null;
  estimateHours: number | null;
  remainingHours: number | null;
}

/** Hours still to plan: remaining work, else the estimate. */
export const plannedHours = (t: PlannedTask) => Math.max(0, t.remainingHours ?? t.estimateHours ?? 0);

/**
 * Spreads a task's hours evenly over its working days (Mon–Fri), from its start (or today) to its due
 * date. Work is planned from today on: a start in the past counts from today, and an overdue task's
 * hours all land today. Tasks without a due date or hours are not planned. Returns hours per date.
 */
export function spreadTask(task: PlannedTask, today: string): Map<string, number> {
  const out = new Map<string, number>();
  const hours = plannedHours(task);
  if (!task.dueDate || hours <= 0) return out;
  const start = task.startDate && task.startDate > today ? task.startDate : today;
  const end = task.dueDate >= start ? task.dueDate : start;
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkingDay(d)) days.push(d);
  if (!days.length) {
    // A weekend-only window: plan it on the next working day.
    let d = start;
    while (!isWorkingDay(d)) d = addDays(d, 1);
    days.push(d);
  }
  const share = hours / days.length;
  for (const d of days) out.set(d, share);
  return out;
}

/** Hours per ISO week (keyed by Monday) for the weeks starting at `from` (a Monday). */
export function weeklyHours(task: PlannedTask, today: string, from: string, weeks: number): number[] {
  const out = Array.from({ length: weeks }, () => 0);
  for (const [day, hours] of spreadTask(task, today)) {
    const index = Math.floor(daysBetween(from, day) / 7);
    if (index >= 0 && index < weeks) out[index]! += hours;
  }
  return out;
}

/** Weekly capacity: the share of the week planned for each project × hours per week, summed. */
export function weeklyCapacity(allocations: readonly number[], hoursPerWeek: number): number {
  return allocations.reduce((sum, pct) => sum + (Math.max(0, Math.min(100, pct)) / 100) * hoursPerWeek, 0);
}

/** Planned ÷ capacity (null when there is no capacity to measure against). */
export function utilisation(planned: number, capacity: number): number | null {
  return capacity > 0 ? planned / capacity : null;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Over-allocated: planned beyond capacity (or planned work for someone with no capacity at all). */
export function overBy(planned: number, capacity: number): number {
  const over = round1(planned - capacity);
  return over > 0.05 ? over : 0;
}
