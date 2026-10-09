/**
 * Records every request the flows make: latency per route template, 5xx responses, slow requests and transport
 * errors, plus how long `eventually` waited for background work. Everything here ends up in the report.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ANY_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const REFERENCE_RE = /^[A-Z]{2,6}-\d+$/;
const SECRET_KEY_RE = /pass(word)?|secret|token|csrf|api[-_]?key|authorization|cookie|credential/i;

/** `/api/v1/itsm/tickets/INC-00042/comments` → `/api/v1/itsm/tickets/:ref/comments` (ids, numbers, refs). */
export function routeTemplate(path: string): string {
  const bare = path.split('?')[0]!;
  return bare
    .split('/')
    .map((raw) => {
      let seg = raw;
      try {
        seg = decodeURIComponent(raw);
      } catch {
        // keep it as it is
      }
      if (UUID_RE.test(seg)) return ':id';
      if (REFERENCE_RE.test(seg)) return ':ref';
      if (/^\d+$/.test(seg)) return ':n';
      if (seg.includes(':') && UUID_ANY_RE.test(seg)) return ':record';
      return raw;
    })
    .join('/');
}

/** Drops values of keys that look secret (passwords, tokens, CSRF, API keys, cookies), recursively. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value))
    out[k] = SECRET_KEY_RE.test(k) ? '[redacted]' : redact(v, depth + 1);
  return out;
}

/** A JSON excerpt of a body, secrets removed, at most `max` characters. */
export function excerpt(body: unknown, max = 600): string {
  let text: string;
  try {
    text = typeof body === 'string' ? body : JSON.stringify(redact(body));
  } catch {
    text = String(body);
  }
  if (text === undefined) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export interface RequestRecord {
  /** Milliseconds since the run started. */
  at: number;
  method: string;
  path: string;
  template: string;
  /** 0 = no response (connection refused, reset, timed out). */
  status: number;
  ms: number;
  persona: string;
  flow: string | null;
  iteration: number | null;
  step: string | null;
  body?: string;
  error?: string;
}

interface RouteStats {
  count: number;
  statuses: Record<string, number>;
  durations: number[];
}

export interface WaitRecord {
  flow: string;
  label: string;
  ms: number;
  ok: boolean;
}

const KEEP = 300;

export class Recorder {
  readonly startedAt = Date.now();
  private readonly routes = new Map<string, RouteStats>();
  readonly serverErrors: RequestRecord[] = [];
  serverErrorCount = 0;
  readonly slow: RequestRecord[] = [];
  slowCount = 0;
  readonly transportErrors: RequestRecord[] = [];
  transportErrorCount = 0;
  requestCount = 0;
  /** Sessions that had to sign in again mid-run (an unexpected 401). */
  reauthentications = 0;
  private readonly waits = new Map<
    string,
    { flow: string; label: string; ok: number; timedOut: number; ms: number[] }
  >();

  constructor(readonly slowMs = 3_000) {}

  record(r: Omit<RequestRecord, 'at' | 'template'> & { at?: number }) {
    const rec: RequestRecord = {
      ...r,
      at: r.at ?? Date.now() - this.startedAt,
      template: routeTemplate(r.path),
    };
    this.requestCount++;
    const key = `${rec.method} ${rec.template}`;
    let stats = this.routes.get(key);
    if (!stats) {
      stats = { count: 0, statuses: {}, durations: [] };
      this.routes.set(key, stats);
    }
    stats.count++;
    stats.statuses[String(rec.status)] = (stats.statuses[String(rec.status)] ?? 0) + 1;
    stats.durations.push(rec.ms);
    if (rec.status >= 500) {
      this.serverErrorCount++;
      if (this.serverErrors.length < KEEP) this.serverErrors.push(rec);
    }
    if (rec.status === 0) {
      this.transportErrorCount++;
      if (this.transportErrors.length < KEEP) this.transportErrors.push(rec);
    }
    if (rec.ms > this.slowMs) {
      this.slowCount++;
      if (this.slow.length < KEEP) this.slow.push(rec);
    }
  }

  recordWait(w: WaitRecord) {
    const key = `${w.flow} · ${w.label}`;
    let s = this.waits.get(key);
    if (!s) {
      s = { flow: w.flow, label: w.label, ok: 0, timedOut: 0, ms: [] };
      this.waits.set(key, s);
    }
    if (w.ok) s.ok++;
    else s.timedOut++;
    s.ms.push(w.ms);
  }

  routeSummary() {
    return [...this.routes.entries()]
      .map(([route, s]) => ({
        route,
        count: s.count,
        statuses: s.statuses,
        ...percentiles(s.durations),
      }))
      .sort((a, b) => b.p95 - a.p95);
  }

  waitSummary() {
    return [...this.waits.values()]
      .map((s) => ({ flow: s.flow, label: s.label, ok: s.ok, timedOut: s.timedOut, ...percentiles(s.ms) }))
      .sort((a, b) => b.p95 - a.p95);
  }
}

/** p50/p95/p99/max of durations (nearest rank), in milliseconds. */
export function percentiles(values: number[]) {
  if (!values.length) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1)! };
}
