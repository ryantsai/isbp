/**
 * Demo data (idempotent: skipped once any endpoint exists). Runs after the platform's Phase 4 seed, which
 * creates the demo database `isbp_demo` and the connections; they are looked up by key and anything that
 * needs a missing one is skipped (production installs have no demo database). Nothing connects to a
 * database here: versions carry the columns a test would have captured, and the execution log and run
 * history are synthetic (deterministic, two weeks, a few failures).
 */
import { apiClients, groupMembers, groups, users } from '@isbp/db/schema';
import type { DbConnectionInfo, ModuleContext } from '@isbp/sdk/server';
import { asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { endpointDefinitionSchema, type EndpointDefinitionInput, type ParamDefInput } from '../contracts';
import type { ColumnInfo, EndpointDefinition, RunStatus, RunTrigger } from '../model';
import { definitionHash, sha256 } from './access';
import { calls, endpoints, endpointVersions, pipelineRuns, pipelines, type RunLogEntry } from './schema';

/** Small deterministic PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!,
    chance: (p: number) => next() < p,
  };
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const REGIONS = ['north', 'south', 'east', 'west', 'central'];
const SEGMENTS = ['enterprise', 'smb', 'public'];
const CATEGORIES = ['hardware', 'peripherals', 'networking', 'storage', 'software'];

const param = (p: ParamDefInput): ParamDefInput => ({ required: false, ...p });
const def = (d: EndpointDefinitionInput) => endpointDefinitionSchema.parse(d) as EndpointDefinition;
const cols = (...pairs: [string, string][]): ColumnInfo[] => pairs.map(([name, type]) => ({ name, type }));

interface SeedEndpoint {
  slug: string;
  name: string;
  description: string;
  connection: DbConnectionInfo;
  /** Oldest first; the last one is the draft unless `draft` is given. */
  versions: {
    def: EndpointDefinition;
    columns: ColumnInfo[];
    note: string;
    daysAgo: number;
    status: 'published' | 'deprecated';
  }[];
  draft?: EndpointDefinition;
  rateLimitPerMinute?: number;
}

/** Customers by region: v1 without the segment filter (deprecated), v2 with it. */
function customersByRegion(erp: DbConnectionInfo): SeedEndpoint {
  const region = param({
    name: 'region',
    type: 'string',
    required: true,
    enum: REGIONS,
    description: 'Sales region of the customer',
    example: 'north',
  });
  const limit = param({
    name: 'limit',
    type: 'integer',
    default: '50',
    min: 1,
    max: 500,
    description: 'Maximum number of customers',
  });
  const v1 = def({
    connectionId: erp.id,
    sql: `SELECT code, name, region, segment, country
  FROM erp.customers
 WHERE region = :region
 ORDER BY code
 LIMIT :limit`,
    params: [region, limit],
    maxRows: 500,
  });
  const v2 = def({
    connectionId: erp.id,
    sql: `SELECT code, name, region, segment, country, created_at
  FROM erp.customers
 WHERE region = :region
   AND (:segment::text IS NULL OR segment = :segment)
 ORDER BY code
 LIMIT :limit`,
    params: [
      region,
      param({
        name: 'segment',
        type: 'string',
        enum: SEGMENTS,
        description: 'Customer segment (optional)',
        example: 'enterprise',
      }),
      limit,
    ],
    maxRows: 500,
    cacheTtlSeconds: 60,
  });
  const base: [string, string][] = [
    ['code', 'varchar'],
    ['name', 'varchar'],
    ['region', 'varchar'],
    ['segment', 'varchar'],
    ['country', 'varchar'],
  ];
  return {
    slug: 'customers-by-region',
    name: 'Customers by region',
    description:
      'Customers of one sales region, optionally of one segment. Used by the regional sales dashboards.',
    connection: erp,
    versions: [
      {
        def: v1,
        columns: cols(...base),
        note: 'First version for the regional dashboards.',
        daysAgo: 41,
        status: 'deprecated',
      },
      {
        def: v2,
        columns: cols(...base, ['created_at', 'timestamptz']),
        note: 'Adds the optional segment filter and the customer creation date. v1 is deprecated.',
        daysAgo: 9,
        status: 'published',
      },
    ],
  };
}

function customerOrders(erp: DbConnectionInfo): SeedEndpoint {
  const d = def({
    connectionId: erp.id,
    kind: 'procedure',
    procedure: {
      schema: 'erp',
      name: 'customer_orders',
      kind: 'function',
      returns: 'record',
      parameters: [
        { name: 'customer_code', type: 'character varying', direction: 'in' },
        { name: 'order_no', type: 'character varying', direction: 'out' },
        { name: 'order_date', type: 'date', direction: 'out' },
        { name: 'status', type: 'character varying', direction: 'out' },
        { name: 'total', type: 'numeric', direction: 'out' },
      ],
    },
    params: [
      param({
        name: 'customer_code',
        type: 'string',
        required: true,
        pattern: '^C\\d{5}$',
        description: 'Customer code, e.g. C00042',
        example: 'C00042',
        target: 'customer_code',
      }),
    ],
    maxRows: 1_000,
  });
  return {
    slug: 'customer-orders',
    name: 'Orders of a customer',
    description: 'Every order of one customer, newest first (function erp.customer_orders).',
    connection: erp,
    versions: [
      {
        def: d,
        columns: cols(
          ['order_no', 'varchar'],
          ['order_date', 'date'],
          ['status', 'varchar'],
          ['total', 'numeric'],
        ),
        note: 'Backs the customer page of the service portal.',
        daysAgo: 33,
        status: 'published',
      },
    ],
  };
}

function salesByRegion(erp: DbConnectionInfo): SeedEndpoint {
  const d = def({
    method: 'POST',
    connectionId: erp.id,
    kind: 'procedure',
    procedure: {
      schema: 'erp',
      name: 'sales_by_region',
      kind: 'function',
      returns: 'record',
      parameters: [
        { name: 'from_date', type: 'date', direction: 'in' },
        { name: 'to_date', type: 'date', direction: 'in' },
        { name: 'region', type: 'character varying', direction: 'out' },
        { name: 'orders', type: 'bigint', direction: 'out' },
        { name: 'revenue', type: 'numeric', direction: 'out' },
      ],
    },
    params: [
      param({
        name: 'from',
        type: 'date',
        required: true,
        target: 'from_date',
        description: 'First order date',
        example: '2026-01-01',
      }),
      param({
        name: 'to',
        type: 'date',
        required: true,
        target: 'to_date',
        description: 'Last order date',
        example: '2026-03-31',
      }),
    ],
    maxRows: 100,
    cacheTtlSeconds: 600,
  });
  return {
    slug: 'sales-by-region',
    name: 'Sales by region',
    description:
      'Orders and revenue per region between two dates (function erp.sales_by_region). Cancelled orders are excluded.',
    connection: erp,
    versions: [
      {
        def: d,
        columns: cols(['region', 'varchar'], ['orders', 'int8'], ['revenue', 'numeric']),
        note: 'Quarterly business review figures.',
        daysAgo: 27,
        status: 'published',
      },
    ],
  };
}

function productSearch(erp: DbConnectionInfo): SeedEndpoint {
  const d = def({
    connectionId: erp.id,
    sql: `SELECT sku, name, category, unit_price
  FROM erp.products
 WHERE active
   AND (:q::text IS NULL OR name ILIKE '%' || :q || '%' OR sku ILIKE :q || '%')
   AND category IN (:categories)
 ORDER BY sku
 LIMIT 100`,
    params: [
      param({
        name: 'q',
        type: 'string',
        maxLength: 100,
        description: 'Part of the name or the start of the SKU',
        example: 'Dock',
      }),
      param({
        name: 'categories',
        type: 'string',
        list: true,
        enum: CATEGORIES,
        default: CATEGORIES.join(','),
        description: 'Product categories (repeat the parameter or separate with commas)',
        example: 'hardware,peripherals',
      }),
    ],
    maxRows: 100,
    cacheTtlSeconds: 300,
  });
  return {
    slug: 'product-search',
    name: 'Product search',
    description: 'Active products by name or SKU, cached for five minutes. Used by the ordering portal.',
    connection: erp,
    rateLimitPerMinute: 600,
    versions: [
      {
        def: d,
        columns: cols(
          ['sku', 'varchar'],
          ['name', 'varchar'],
          ['category', 'varchar'],
          ['unit_price', 'numeric'],
        ),
        note: 'Search for the ordering portal.',
        daysAgo: 21,
        status: 'published',
      },
    ],
  };
}

function openInvoices(erp: DbConnectionInfo): SeedEndpoint {
  return {
    slug: 'open-invoices',
    name: 'Open invoices',
    description: 'Unpaid invoices due before a date — work in progress for the collections team.',
    connection: erp,
    versions: [],
    draft: def({
      connectionId: erp.id,
      sql: `SELECT i.invoice_no, c.code AS customer_code, c.name AS customer, i.issued_on, i.due_on, i.amount
  FROM erp.invoices i
  JOIN erp.orders o ON o.id = i.order_id
  JOIN erp.customers c ON c.id = o.customer_id
 WHERE NOT i.paid
   AND i.due_on < :as_of
 ORDER BY i.due_on
 LIMIT :limit`,
      params: [
        param({
          name: 'as_of',
          type: 'date',
          required: true,
          description: 'Invoices due before this date',
          example: '2026-10-01',
        }),
        param({ name: 'limit', type: 'integer', default: '100', min: 1, max: 1000 }),
      ],
      maxRows: 1_000,
    }),
  };
}

function hrHeadcount(hr: DbConnectionInfo): SeedEndpoint {
  const d = def({
    connectionId: hr.id,
    sql: `SELECT d.DepartmentName AS department, COUNT(*) AS headcount
  FROM dbo.Employees e
  JOIN dbo.Departments d ON d.DepartmentId = e.DepartmentId
 WHERE e.Status = 'Active'
   AND (:department IS NULL OR d.DepartmentName = :department)
 GROUP BY d.DepartmentName
 ORDER BY d.DepartmentName`,
    params: [
      param({
        name: 'department',
        type: 'string',
        maxLength: 100,
        description: 'One department (optional)',
        example: 'Finance',
      }),
    ],
    maxRows: Math.min(500, hr.maxRows),
    timeoutMs: Math.min(15_000, hr.timeoutMs),
  });
  return {
    slug: 'hr-headcount',
    name: 'HR headcount',
    description: 'Active employees per department from the HRIS (SQL Server).',
    connection: hr,
    versions: [
      {
        def: d,
        columns: cols(['department', 'nvarchar'], ['headcount', 'int']),
        note: 'Headcount for the monthly management report.',
        daysAgo: 24,
        status: 'published',
      },
    ],
  };
}

interface Caller {
  type: 'user' | 'client';
  id: string;
  name: string;
}

/** Plausible parameters, duration and outcome of one synthetic call. */
function syntheticCall(
  slug: string,
  r: ReturnType<typeof prng>,
): {
  params: Record<string, unknown>;
  ms: number;
  status: number;
  error: string | null;
  message: string | null;
  rows: number | null;
  cached: boolean;
} {
  const ok = (params: Record<string, unknown>, ms: number, rows: number, cached = false) => ({
    params,
    ms,
    status: 200,
    error: null,
    message: null,
    rows,
    cached,
  });
  const jitter = (base: number) =>
    Math.round(base * (0.6 + r.next() * 0.9) + (r.chance(0.04) ? base * 4 : 0));
  switch (slug) {
    case 'customers-by-region': {
      if (r.chance(0.01))
        return {
          params: { region: 'emea' },
          ms: jitter(4),
          status: 400,
          error: 'VALIDATION_FAILED',
          message: 'region: Must be one of: north, south, east, west, central',
          rows: null,
          cached: false,
        };
      const params: Record<string, unknown> = {
        region: r.pick(REGIONS),
        segment: r.chance(0.4) ? r.pick(SEGMENTS) : null,
        limit: r.pick([50, 50, 100, 200]),
      };
      const cached = r.chance(0.25);
      return ok(params, cached ? r.int(2, 5) : jitter(28), r.int(12, 80), cached);
    }
    case 'customer-orders': {
      if (r.chance(0.015))
        return {
          params: { customer_code: 'C42' },
          ms: jitter(3),
          status: 400,
          error: 'VALIDATION_FAILED',
          message: 'customer_code: Must match ^C\\d{5}$',
          rows: null,
          cached: false,
        };
      return ok({ customer_code: `C${String(r.int(1, 400)).padStart(5, '0')}` }, jitter(19), r.int(6, 24));
    }
    case 'sales-by-region': {
      const month = r.int(1, 9);
      const from = `2026-${String(month).padStart(2, '0')}-01`;
      const to = `2026-${String(Math.min(12, month + 2)).padStart(2, '0')}-28`;
      const cached = r.chance(0.35);
      return ok({ from, to }, cached ? r.int(2, 6) : jitter(140), 5, cached);
    }
    case 'product-search': {
      if (r.chance(0.006))
        return {
          params: { q: 'dock' },
          ms: 1,
          status: 429,
          error: 'RATE_LIMITED',
          message: 'Rate limit of 600 calls per minute reached',
          rows: null,
          cached: false,
        };
      const params = {
        q: r.chance(0.8)
          ? r.pick(['Laptop', 'Dock', 'Monitor', 'SSD', 'Router', 'P-00', 'Headset', 'Switch'])
          : null,
        categories: r.chance(0.3) ? [r.pick(CATEGORIES)] : CATEGORIES,
      };
      const cached = r.chance(0.62);
      return ok(params, cached ? r.int(1, 4) : jitter(16), r.int(0, 24), cached);
    }
    case 'hr-headcount':
      return {
        params: { department: r.chance(0.5) ? r.pick(['Finance', 'Human Resources', 'IT', 'Sales']) : null },
        ms: jitter(45),
        status: 422,
        error: 'DATABASE_ERROR',
        message: 'connect ENOTFOUND: getaddrinfo ENOTFOUND sql-hr-01.corp.contoso.example',
        rows: null,
        cached: false,
      };
    default:
      return ok({}, jitter(20), 1);
  }
}

/** Business-hours weighted instants over the last `days` days (Taipei office hours, UTC+8). */
function businessInstant(r: ReturnType<typeof prng>, now: number, days: number): Date {
  for (;;) {
    const t = now - r.next() * days * DAY;
    const hourTpe = (new Date(t).getUTCHours() + 8) % 24;
    const dow = new Date(t + 8 * HOUR).getUTCDay();
    const weight = (hourTpe >= 8 && hourTpe <= 19 ? 1 : 0.12) * (dow === 0 || dow === 6 ? 0.25 : 1);
    if (r.next() < weight) return new Date(t);
  }
}

async function seedEndpoints(
  ctx: ModuleContext,
  list: SeedEndpoint[],
  authorId: string | null,
  clientId: string | null,
) {
  const now = Date.now();
  const ids = new Map<string, { id: string; versions: { version: number; at: number; status: string }[] }>();
  for (const e of list) {
    const versions = e.versions.map((v, i) => ({ ...v, version: i + 1 }));
    const latest = versions[versions.length - 1];
    const draft = e.draft ?? latest!.def;
    const createdAt = new Date(now - ((versions[0]?.daysAgo ?? 6) + 2) * DAY);
    const [row] = await ctx.db
      .insert(endpoints)
      .values({
        slug: e.slug,
        name: e.name,
        description: e.description,
        connectionId: draft.connectionId,
        draft,
        draftTestedHash: latest && !e.draft ? definitionHash(draft) : null,
        draftTestedAt: latest && !e.draft ? new Date(now - latest.daysAgo * DAY - HOUR) : null,
        draftColumns: latest && !e.draft ? latest.columns : null,
        allowUsers: true,
        allowedClients: clientId && versions.length ? [clientId] : [],
        rateLimitPerMinute: e.rateLimitPerMinute ?? null,
        latestVersion: latest?.version ?? null,
        createdBy: authorId,
        createdAt,
        updatedAt: new Date(now - (latest?.daysAgo ?? 1) * DAY),
      })
      .returning({ id: endpoints.id });
    if (versions.length)
      await ctx.db.insert(endpointVersions).values(
        versions.map((v, i) => {
          const next = versions[i + 1];
          return {
            endpointId: row!.id,
            version: v.version,
            definition: v.def,
            connectionId: v.def.connectionId,
            columns: v.columns,
            note: v.note,
            status: v.status,
            publishedBy: authorId,
            publishedAt: new Date(now - v.daysAgo * DAY),
            deprecatedAt: v.status === 'deprecated' && next ? new Date(now - next.daysAgo * DAY) : null,
          };
        }),
      );
    ids.set(e.slug, {
      id: row!.id,
      versions: versions.map((v) => ({ version: v.version, at: now - v.daysAgo * DAY, status: v.status })),
    });
  }
  return ids;
}

async function seedCalls(
  ctx: ModuleContext,
  endpointsBySlug: Map<string, { id: string; versions: { version: number; at: number; status: string }[] }>,
  callers: { client: Caller | null; people: Caller[] },
) {
  const r = prng(4242);
  const now = Date.now();
  const weights: [string, number][] = [
    ['customers-by-region', 900],
    ['customer-orders', 640],
    ['sales-by-region', 330],
    ['product-search', 1_020],
    ['hr-headcount', 70],
  ];
  const rows: (typeof calls.$inferInsert)[] = [];
  for (const [slug, n] of weights) {
    const ep = endpointsBySlug.get(slug);
    if (!ep || !ep.versions.length) continue;
    for (let i = 0; i < n; i++) {
      const at = businessInstant(r, now, 14);
      const live = ep.versions.filter((v) => v.at <= at.getTime());
      if (!live.length) continue;
      // After v2 most callers moved; a few kept calling the deprecated v1 by its pinned URL.
      const v = live.length > 1 && r.chance(0.12) ? live[0]! : live[live.length - 1]!;
      const caller =
        callers.client &&
        (slug === 'product-search' || slug === 'customers-by-region' ? r.chance(0.8) : r.chance(0.55))
          ? callers.client
          : r.pick(callers.people);
      const c = syntheticCall(slug, r);
      rows.push({
        endpointId: ep.id,
        version: v.version,
        callerType: caller.type,
        userId: caller.type === 'user' ? caller.id : null,
        clientId: caller.type === 'client' ? caller.id : null,
        callerName: caller.name,
        status: c.status,
        errorCode: c.error,
        errorMessage: c.message,
        durationMs: c.ms,
        rows: c.rows,
        cached: c.cached,
        params: c.params,
        requestId: `req-${sha256(`${slug}${i}${at.getTime()}`).slice(0, 12)}`,
        createdAt: at,
      });
    }
  }
  for (let i = 0; i < rows.length; i += 500) await ctx.db.insert(calls).values(rows.slice(i, i + 500));
  return rows.length;
}

interface SeedPipeline {
  name: string;
  description: string;
  source: DbConnectionInfo;
  target: DbConnectionInfo;
  sql: string;
  params?: Record<string, string | number | boolean | null>;
  incremental?: { column: string; initial: string };
  table: { schema: string; name: string };
  mode: 'insert' | 'upsert' | 'replace';
  keys: string[];
  mappings: { source: string; target: string; transform: string }[];
  /** Synthetic history: a run every `everyHours`, with this shape of outcome. */
  history: {
    everyHours: number;
    atHourUtc: number;
    rows: () => number;
    outcome: (daysAgo: number) => RunStatus;
    error?: string;
  };
}

function lines(at: Date, entries: [RunLogEntry['level'], string][]): RunLogEntry[] {
  return entries.map(([level, message], i) => ({
    at: new Date(at.getTime() + i * 700).toISOString(),
    level,
    message,
  }));
}

async function seedPipelines(ctx: ModuleContext, list: SeedPipeline[], ownerId: string | null) {
  const r = prng(77);
  const now = Date.now();
  let runCount = 0;
  for (const p of list) {
    const [row] = await ctx.db
      .insert(pipelines)
      .values({
        name: p.name,
        description: p.description,
        ownerId,
        enabled: true,
        sourceConnectionId: p.source.id,
        sourceSql: p.sql,
        sourceParams: p.params ?? {},
        watermarkColumn: p.incremental?.column ?? null,
        watermarkInitial: p.incremental?.initial ?? null,
        // Synthetic history loaded nothing: the first real run starts from the initial watermark.
        watermark: null,
        targetConnectionId: p.target.id,
        targetSchema: p.table.schema,
        targetTable: p.table.name,
        mode: p.mode,
        keyColumns: p.keys,
        mappings: p.mappings,
        batchSize: 500,
        createdBy: ownerId,
        createdAt: new Date(now - 20 * DAY),
        updatedAt: new Date(now - 15 * DAY),
      })
      .returning({ id: pipelines.id });
    const runs: (typeof pipelineRuns.$inferInsert)[] = [];
    const start = now - 14 * DAY;
    const first = new Date(start);
    first.setUTCHours(p.history.atHourUtc, 0, 0, 0);
    let watermark = p.incremental?.initial ?? null;
    for (let t = first.getTime(); t < now - HOUR; t += p.history.everyHours * HOUR) {
      const daysAgo = Math.floor((now - t) / DAY);
      const status = p.history.outcome(daysAgo);
      const manual = r.chance(0.05);
      const startedAt = new Date(t + r.int(2, 40) * 1000);
      const read = status === 'succeeded' ? p.history.rows() : status === 'failed' ? 0 : r.int(100, 400);
      const rejected = status === 'succeeded' && r.chance(0.08) ? r.int(1, 3) : 0;
      const durationMs =
        status === 'failed' ? r.int(80, 10_500) : Math.round(400 + read * (2 + r.next() * 2));
      const finishedAt = new Date(startedAt.getTime() + durationMs);
      const watermarkTo =
        status === 'succeeded' && p.incremental ? new Date(t - r.int(1, 50) * 60_000).toISOString() : null;
      const target = `${p.table.schema}.${p.table.name}`;
      const log: RunLogEntry[] =
        status === 'succeeded'
          ? lines(startedAt, [
              [
                'info',
                `Run started (${manual ? 'manual' : 'schedule'}): ${p.mode} into ${target}, batches of 500`,
              ],
              ...(p.incremental
                ? ([['info', `Incremental: rows after watermark ${watermark}`]] as [
                    RunLogEntry['level'],
                    string,
                  ][])
                : []),
              ...(rejected
                ? ([
                    [
                      'warn',
                      `Row ${r.int(1, Math.max(1, read))} rejected (customer_code): Key column customer_code is empty`,
                    ],
                  ] as [RunLogEntry['level'], string][])
                : []),
              ['info', `Batch 1: ${Math.min(500, read)} read, ${Math.min(500, read) - rejected} written`],
              [
                'info',
                `Committed: ${read} read, ${read - rejected} written, ${rejected} rejected${p.incremental ? `; watermark ${watermarkTo}` : ''}`,
              ],
            ])
          : lines(startedAt, [
              [
                'info',
                `Run started (${manual ? 'manual' : 'schedule'}): ${p.mode} into ${target}, batches of 500`,
              ],
              [
                'error',
                `Failed: ${p.history.error ?? 'DATABASE_ERROR 57014: canceling statement due to statement timeout'}`,
              ],
            ]);
      runs.push({
        pipelineId: row!.id,
        trigger: (manual ? 'manual' : 'schedule') as RunTrigger,
        status,
        triggeredBy: manual ? ownerId : null,
        taskRunId: manual ? null : `seed-${sha256(`${p.name}${t}`).slice(0, 10)}`,
        rowsRead: read,
        rowsWritten: status === 'succeeded' ? read - rejected : 0,
        rowsRejected: rejected,
        watermarkFrom: p.incremental ? watermark : null,
        watermarkTo,
        startedAt,
        finishedAt,
        durationMs,
        heartbeatAt: finishedAt,
        error:
          status === 'failed'
            ? (p.history.error ?? 'DATABASE_ERROR 57014: canceling statement due to statement timeout')
            : null,
        log,
        createdAt: new Date(t),
      });
      if (watermarkTo) watermark = watermarkTo;
    }
    for (let i = 0; i < runs.length; i += 200)
      await ctx.db.insert(pipelineRuns).values(runs.slice(i, i + 200));
    runCount += runs.length;
  }
  return runCount;
}

export async function seed(ctx: ModuleContext) {
  const [existing] = await ctx.db.select({ id: endpoints.id }).from(endpoints).limit(1);
  if (existing) return;
  const byKey = new Map((await ctx.databases.list()).map((c) => [c.key, c]));
  const erp = byKey.get('contoso-erp');
  const dw = byKey.get('contoso-dw');
  const hr = byKey.get('hr-sql01');
  const crm = byKey.get('crm-mysql');
  if (!erp && !hr) {
    ctx.logger.info('etl seed: no demo connections (contoso-erp, hr-sql01) — skipped');
    return;
  }

  // People: the admin builds; developers and a few colleagues call the APIs from scripts and reports.
  const [admin] = await ctx.db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(eq(users.username, 'admin'));
  const devs = await ctx.db
    .select({ id: users.id, name: users.displayName })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(inArray(groups.key, ['dev-team', 'dba-team']))
    .orderBy(asc(users.username))
    .limit(4);
  const named = await ctx.db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.username, ['admin', 'helpdesk', 'auditor']));
  const people: Caller[] = [...named, ...devs]
    .filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i)
    .map((p) => ({ type: 'user', id: p.id, name: p.name }));
  // The demo API client: preferably one granted Data API calls, else the oldest active client.
  const clients = await ctx.db
    .select({ id: apiClients.id, name: apiClients.name, permissions: apiClients.permissions })
    .from(apiClients)
    .where(isNull(apiClients.revokedAt))
    .orderBy(asc(apiClients.createdAt));
  const invokes = (patterns: string[]) =>
    patterns.some((p) => ['*', 'etl.*', 'etl.endpoints.*', 'etl.endpoints.invoke'].includes(p));
  const client = clients.find((c) => invokes(c.permissions)) ?? clients[0];
  const author = devs[0]?.id ?? admin?.id ?? null;

  const list: SeedEndpoint[] = [];
  if (erp)
    list.push(
      customersByRegion(erp),
      customerOrders(erp),
      salesByRegion(erp),
      productSearch(erp),
      openInvoices(erp),
    );
  if (hr) list.push(hrHeadcount(hr));
  const ids = await seedEndpoints(ctx, list, author, client?.id ?? null);
  const callCount = people.length
    ? await seedCalls(ctx, ids, {
        client: client ? { type: 'client', id: client.id, name: client.name } : null,
        people,
      })
    : 0;

  const r = prng(9);
  const pipelinesToSeed: SeedPipeline[] = [];
  if (erp && dw) {
    pipelinesToSeed.push(
      {
        name: 'Customer dimension',
        description:
          'Loads ERP customers into the warehouse customer dimension (upsert on the customer code).',
        source: erp,
        target: dw,
        sql: `SELECT code, name, region, segment, country, now() AS loaded_at
  FROM erp.customers
 ORDER BY code`,
        table: { schema: 'dw', name: 'customer_dim' },
        mode: 'upsert',
        keys: ['customer_code'],
        mappings: [
          { source: 'code', target: 'customer_code', transform: 'upper' },
          { source: 'name', target: 'name', transform: 'trim' },
          { source: 'region', target: 'region', transform: 'lower' },
          { source: 'segment', target: 'segment', transform: 'default:smb' },
          { source: 'country', target: 'country', transform: 'upper' },
          { source: 'loaded_at', target: 'loaded_at', transform: 'none' },
        ],
        history: {
          everyHours: 24,
          atHourUtc: 18,
          rows: () => 400,
          outcome: () => 'succeeded',
        },
      },
      {
        name: 'Daily sales to warehouse',
        description:
          'Aggregates orders by day, product and region into dw.sales_daily. Incremental: days with orders changed since the last run are recomputed.',
        source: erp,
        target: dw,
        sql: `SELECT o.order_date AS sales_date, p.sku AS product_sku, c.region,
       sum(l.quantity)::int AS quantity, sum(l.amount) AS revenue,
       max(date_trunc('milliseconds', o.updated_at)) AS last_updated
  FROM erp.orders o
  JOIN erp.order_lines l ON l.order_id = o.id
  JOIN erp.products p ON p.id = l.product_id
  JOIN erp.customers c ON c.id = o.customer_id
 WHERE o.status <> 'cancelled'
   AND o.order_date IN (SELECT order_date FROM erp.orders
                         WHERE date_trunc('milliseconds', updated_at) > :watermark::timestamptz)
 GROUP BY o.order_date, p.sku, c.region
 ORDER BY 1, 2, 3`,
        incremental: { column: 'last_updated', initial: '2000-01-01T00:00:00.000Z' },
        table: { schema: 'dw', name: 'sales_daily' },
        mode: 'upsert',
        keys: ['sales_date', 'product_sku', 'region'],
        mappings: [
          { source: 'sales_date', target: 'sales_date', transform: 'cast:date' },
          { source: 'product_sku', target: 'product_sku', transform: 'none' },
          { source: 'region', target: 'region', transform: 'none' },
          { source: 'quantity', target: 'quantity', transform: 'cast:integer' },
          { source: 'revenue', target: 'revenue', transform: 'cast:decimal' },
        ],
        history: {
          everyHours: 4,
          atHourUtc: 0,
          rows: () => r.int(30, 420),
          outcome: (daysAgo) =>
            daysAgo === 6 && r.chance(0.5) ? 'failed' : r.chance(0.03) ? 'failed' : 'succeeded',
          error: 'DATABASE_ERROR 57014: canceling statement due to statement timeout',
        },
      },
    );
  }
  if (crm && dw)
    pipelinesToSeed.push({
      name: 'CRM accounts to warehouse',
      description:
        'Copies active CRM accounts into the customer dimension. The CRM replica has been unreachable since its move.',
      source: crm,
      target: dw,
      sql: `SELECT account_code, account_name, territory, tier, country_code
  FROM accounts
 WHERE is_active = 1`,
      table: { schema: 'dw', name: 'customer_dim' },
      mode: 'upsert',
      keys: ['customer_code'],
      mappings: [
        { source: 'account_code', target: 'customer_code', transform: 'upper' },
        { source: 'account_name', target: 'name', transform: 'trim' },
        { source: 'territory', target: 'region', transform: 'lower' },
        { source: 'tier', target: 'segment', transform: 'default:smb' },
        { source: 'country_code', target: 'country', transform: 'upper' },
      ],
      history: {
        everyHours: 24,
        atHourUtc: 19,
        rows: () => r.int(380, 420),
        outcome: (daysAgo) => (daysAgo <= 5 ? 'failed' : 'succeeded'),
        error: 'DATABASE_ERROR ENOTFOUND: getaddrinfo ENOTFOUND mysql-crm-01.corp.contoso.example',
      },
    });
  const runCount = await seedPipelines(ctx, pipelinesToSeed, devs[0]?.id ?? admin?.id ?? null);
  ctx.logger.info(
    {
      endpoints: list.length,
      calls: callCount,
      pipelines: pipelinesToSeed.length,
      runs: runCount,
      client: client?.name ?? null,
    },
    'etl demo data',
  );
}

/**
 * Lets an API client call every published Data API (for a platform seed that creates the demo client after
 * the module seeds ran; the seed itself allows the client that exists when it runs).
 */
export async function allowDemoClient(ctx: ModuleContext, clientId: string) {
  const rows = await ctx.db
    .select({ id: endpoints.id, allowed: endpoints.allowedClients })
    .from(endpoints)
    .where(isNotNull(endpoints.latestVersion));
  for (const row of rows)
    if (!row.allowed.includes(clientId))
      await ctx.db
        .update(endpoints)
        .set({ allowedClients: [...row.allowed, clientId] })
        .where(eq(endpoints.id, row.id));
}
