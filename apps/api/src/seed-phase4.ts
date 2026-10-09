/**
 * Phase 4 demo data owned by the platform:
 *  - the demo database `isbp_demo` on the platform's own PostgreSQL (when the login may create
 *    databases, i.e. development and CI): a small ERP (`erp`), a warehouse (`dw`), group roles that can be
 *    requested (`demo_*`) and one least-privilege login per purpose;
 *  - the database connections (Administration → Database connections), including SQL Server, Oracle and
 *    MySQL ones on hosts that don't exist, so every engine and the failure states show;
 *  - who works Data APIs, Scheduled jobs and Database access.
 * The demo database is rebuilt when the platform has no connections yet (a fresh `db:reset`), so ETL
 * loads and provisioned accounts never outlive the platform data that explains them.
 */
import { randomBytes } from 'node:crypto';
import { apiClients, dbConnections, users } from '@isbp/db/schema';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { ApiClientService } from './core/services/applications';
import { runWithContext } from './kernel/context';
import { buildAuthContext } from './kernel/http/auth';
import type { Kernel } from './kernel/kernel';
import { toSessionUser } from './kernel/sessions';
import { type Grant, grantDemoRoles } from './seed-phase2';

export const DEMO_DATABASE = 'isbp_demo';
/** Requestable group roles on the demo server (Database access). */
export const DEMO_ROLES = ['demo_reporting', 'demo_finance_analyst', 'demo_app_rw', 'demo_readonly'] as const;
/** Accounts that Database access provisions on the demo server are named `demo_u_<username>`. */
export const DEMO_ACCOUNT_PATTERN = 'demo_u_{username}';

const GRANTS: Grant[] = [
  { role: 'database-admin', groups: ['dba-team'] },
  { role: 'etl-developer', groups: ['dba-team', 'dev-team'] },
  { role: 'etl-viewer', groups: ['security-team', 'service-desk'] },
  { role: 'scheduler-operator', groups: ['dba-team', 'network-team', 'dev-team'] },
  { role: 'scheduler-admin', groups: ['it-admins'] },
  { role: 'scheduler-viewer', groups: ['service-desk', 'security-team'] },
  { role: 'dbaccess-dba', groups: ['dba-team'] },
  { role: 'dbaccess-auditor', groups: ['security-team'] },
  { role: 'dbaccess-review-manager', groups: ['security-team'] },
];

const password = () => randomBytes(18).toString('base64url');

/** Builds DDL on the server from bound parameters (`format('%I', '%L')`): no client-side quoting. */
async function exec(client: pg.Client, template: string, ...args: string[]) {
  const { rows } = await client.query<{ stmt: string }>(
    `SELECT format($1, ${args.map((_, i) => `$${i + 2}::text`).join(', ')}) AS stmt`,
    [template, ...args],
  );
  await client.query(rows[0]!.stmt);
}

const ERP_SCHEMA = `
CREATE SCHEMA erp;
CREATE SCHEMA dw;

CREATE TABLE erp.customers (
  id serial PRIMARY KEY,
  code varchar(12) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  region varchar(16) NOT NULL,
  segment varchar(16) NOT NULL,
  country varchar(2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE erp.products (
  id serial PRIMARY KEY,
  sku varchar(16) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  category varchar(32) NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE erp.orders (
  id serial PRIMARY KEY,
  order_no varchar(16) NOT NULL UNIQUE,
  customer_id int NOT NULL REFERENCES erp.customers(id),
  order_date date NOT NULL,
  status varchar(16) NOT NULL,
  total numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_date_idx ON erp.orders (order_date);
CREATE INDEX orders_updated_idx ON erp.orders (updated_at);
CREATE TABLE erp.order_lines (
  order_id int NOT NULL REFERENCES erp.orders(id),
  line_no int NOT NULL,
  product_id int NOT NULL REFERENCES erp.products(id),
  quantity int NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  amount numeric(12,2) NOT NULL,
  PRIMARY KEY (order_id, line_no)
);
CREATE TABLE erp.invoices (
  id serial PRIMARY KEY,
  invoice_no varchar(16) NOT NULL UNIQUE,
  order_id int NOT NULL REFERENCES erp.orders(id),
  issued_on date NOT NULL,
  due_on date NOT NULL,
  amount numeric(12,2) NOT NULL,
  paid boolean NOT NULL DEFAULT false
);

CREATE TABLE dw.sales_daily (
  sales_date date NOT NULL,
  product_sku varchar(16) NOT NULL,
  region varchar(16) NOT NULL,
  quantity int NOT NULL,
  revenue numeric(14,2) NOT NULL,
  PRIMARY KEY (sales_date, product_sku, region)
);
CREATE TABLE dw.customer_dim (
  customer_code varchar(12) PRIMARY KEY,
  name varchar(120) NOT NULL,
  region varchar(16) NOT NULL,
  segment varchar(16) NOT NULL,
  country varchar(2) NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION erp.customer_orders(customer_code varchar)
RETURNS TABLE (order_no varchar, order_date date, status varchar, total numeric)
LANGUAGE sql STABLE AS $$
  SELECT o.order_no, o.order_date, o.status, o.total
    FROM erp.orders o JOIN erp.customers c ON c.id = o.customer_id
   WHERE c.code = customer_code
   ORDER BY o.order_date DESC
$$;

CREATE FUNCTION erp.sales_by_region(from_date date, to_date date)
RETURNS TABLE (region varchar, orders bigint, revenue numeric)
LANGUAGE sql STABLE AS $$
  SELECT c.region, count(*), sum(o.total)
    FROM erp.orders o JOIN erp.customers c ON c.id = o.customer_id
   WHERE o.order_date BETWEEN from_date AND to_date AND o.status <> 'cancelled'
   GROUP BY c.region ORDER BY 3 DESC
$$;

CREATE PROCEDURE erp.recalculate_order_totals()
LANGUAGE sql AS $$
  UPDATE erp.orders o SET total = s.amount, updated_at = now()
    FROM (SELECT order_id, sum(amount) AS amount FROM erp.order_lines GROUP BY order_id) s
   WHERE s.order_id = o.id AND o.total <> s.amount
$$;
`;

/** Deterministic demo data (setseed), generated in SQL so it takes a moment even for thousands of rows. */
const ERP_DATA = `
SELECT setseed(0.2026);
INSERT INTO erp.customers (code, name, region, segment, country, created_at, updated_at)
SELECT 'C' || lpad(g::text, 5, '0'),
       (ARRAY['Formosa','Pacific','Sakura','Harbor','Summit','Jade','Lotus','Northwind','Kestrel','Aurora'])[1 + (g % 10)]
         || ' ' || (ARRAY['Trading','Logistics','Electronics','Foods','Health','Retail','Motors','Systems'])[1 + ((g * 7) % 8)]
         || ' ' || (ARRAY['Co., Ltd.','Inc.','KK','Ltd.'])[1 + (g % 4)],
       (ARRAY['north','south','east','west','central'])[1 + (g % 5)],
       (ARRAY['enterprise','smb','smb','public'])[1 + (g % 4)],
       (ARRAY['TW','TW','TW','JP','JP','US','SG'])[1 + (g % 7)],
       now() - (random() * interval '900 days'),
       now() - (random() * interval '60 days')
  FROM generate_series(1, 400) g;

INSERT INTO erp.products (sku, name, category, unit_price, active)
SELECT 'P-' || lpad(g::text, 4, '0'),
       (ARRAY['Laptop','Monitor','Dock','Keyboard','Headset','Router','Switch','SSD','Server','Licence'])[1 + (g % 10)]
         || ' ' || (ARRAY['Pro','Plus','Lite','Max','Air','Edge'])[1 + (g % 6)] || ' ' || g,
       (ARRAY['hardware','hardware','peripherals','networking','storage','software'])[1 + (g % 6)],
       round((20 + random() * 1980)::numeric, 2),
       g % 17 <> 0
  FROM generate_series(1, 120) g;

INSERT INTO erp.orders (order_no, customer_id, order_date, status, updated_at)
SELECT 'SO-' || lpad(g::text, 6, '0'),
       1 + floor(random() * 400)::int,
       current_date - floor(random() * 540)::int,
       (ARRAY['invoiced','invoiced','invoiced','shipped','shipped','open','cancelled'])[1 + floor(random() * 7)::int],
       now() - (random() * interval '30 days')
  FROM generate_series(1, 6000) g;

INSERT INTO erp.order_lines (order_id, line_no, product_id, quantity, unit_price, amount)
SELECT o.id, l, p.id, q, p.unit_price, p.unit_price * q
  FROM erp.orders o
  CROSS JOIN LATERAL generate_series(1, 1 + (o.id % 4)) l
  CROSS JOIN LATERAL (SELECT 1 + floor(random() * 20)::int AS q) qq
  JOIN erp.products p ON p.id = 1 + ((o.id * 31 + l * 7) % 120);

UPDATE erp.orders o SET total = s.amount
  FROM (SELECT order_id, sum(amount) AS amount FROM erp.order_lines GROUP BY order_id) s
 WHERE s.order_id = o.id;

INSERT INTO erp.invoices (invoice_no, order_id, issued_on, due_on, amount, paid)
SELECT 'INV-' || lpad(o.id::text, 6, '0'), o.id, o.order_date + 3, o.order_date + 33, o.total,
       o.order_date < current_date - 45 OR random() < 0.3
  FROM erp.orders o WHERE o.status = 'invoiced';

ANALYZE;
`;

interface DemoLogins {
  reader: string;
  etl: string;
  dba: string;
}

/** Creates (or refreshes) the demo database; returns the logins' new passwords, or null when not allowed. */
async function buildDemoDatabase(kernel: Kernel, rebuild: boolean): Promise<DemoLogins | null> {
  const log = kernel.logger;
  const base = new URL(kernel.config.DATABASE_URL);
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  try {
    const { rows: exists } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      DEMO_DATABASE,
    ]);
    if (exists.length && rebuild) {
      await exec(admin, 'DROP DATABASE %I WITH (FORCE)', DEMO_DATABASE);
    }
    if (rebuild) {
      // Accounts provisioned by Database access, then the demo roles themselves.
      const { rows: roles } = await admin.query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles WHERE rolname LIKE 'demo\\_%' OR rolname LIKE 'isbp\\_demo\\_%' ORDER BY rolname LIKE 'demo\\_u\\_%' DESC`,
      );
      for (const r of roles) await exec(admin, 'DROP ROLE IF EXISTS %I', r.rolname);
    }
    if (!exists.length || rebuild) await exec(admin, 'CREATE DATABASE %I', DEMO_DATABASE);
  } catch (err) {
    log.warn({ err }, 'demo database not created (the platform login may not create databases) — skipping');
    return null;
  } finally {
    await admin.end();
  }

  const url = new URL(base.toString());
  url.pathname = `/${DEMO_DATABASE}`;
  const demo = new pg.Client({ connectionString: url.toString() });
  await demo.connect();
  const logins = { reader: password(), etl: password(), dba: password() };
  try {
    const { rows: hasErp } = await demo.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'erp'`);
    if (!hasErp.length) {
      await demo.query(ERP_SCHEMA);
      await demo.query(ERP_DATA);
    }
    const ensureRole = async (name: string, login: string | null, extra = '') => {
      const { rows } = await demo.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
      if (!rows.length) await exec(demo, `CREATE ROLE %I ${login ? 'LOGIN' : 'NOLOGIN'} ${extra}`, name);
      if (login) await exec(demo, 'ALTER ROLE %I WITH LOGIN PASSWORD %L', name, login);
    };
    for (const r of DEMO_ROLES) await ensureRole(r, null);
    await ensureRole('isbp_demo_reader', logins.reader);
    await ensureRole('isbp_demo_etl', logins.etl);
    await ensureRole('isbp_demo_dba', logins.dba, 'CREATEROLE');

    const grants = `
      GRANT USAGE ON SCHEMA erp, dw TO isbp_demo_reader, isbp_demo_etl, demo_reporting, demo_finance_analyst, demo_app_rw, demo_readonly;
      GRANT SELECT ON ALL TABLES IN SCHEMA erp, dw TO isbp_demo_reader;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA erp TO isbp_demo_reader, isbp_demo_etl;
      GRANT SELECT ON ALL TABLES IN SCHEMA erp TO isbp_demo_etl;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA dw TO isbp_demo_etl;
      GRANT SELECT ON ALL TABLES IN SCHEMA erp TO demo_reporting;
      GRANT SELECT ON erp.orders, erp.invoices, erp.customers TO demo_finance_analyst;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA erp TO demo_app_rw;
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA erp TO demo_app_rw;
      GRANT SELECT ON ALL TABLES IN SCHEMA dw TO demo_readonly;
      GRANT demo_reporting, demo_finance_analyst, demo_app_rw, demo_readonly TO isbp_demo_dba WITH ADMIN OPTION;
    `;
    await demo.query(grants);
    return logins;
  } finally {
    await demo.end();
  }
}

interface ConnectionSeed {
  key: string;
  name: string;
  description: string;
  engine: 'mssql' | 'postgres' | 'mysql' | 'oracle';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  purposes: ('data' | 'admin')[];
  readOnly: boolean;
  tls: 'off' | 'require' | 'verify';
  unreachable?: boolean;
}

export const DEMO_BI_CLIENT = 'Contoso BI gateway';

/**
 * An API client for the Data APIs demo (`etl.endpoints.invoke`), created as the admin before module seeds so
 * the ETL seed puts it on its endpoints' allow-lists. Returns the one-time key for the seed log.
 */
async function ensureBiClient(kernel: Kernel): Promise<{ clientId: string; apiKey: string } | null> {
  if (!kernel.registry.get('etl')) return null;
  const db = kernel.db;
  const [existing] = await db
    .select({ id: apiClients.id })
    .from(apiClients)
    .where(eq(apiClients.name, DEMO_BI_CLIENT));
  const [admin] = await db.select().from(users).where(eq(users.username, 'admin'));
  if (existing || !admin) return null;
  const principal = { type: 'user' as const, id: admin.id, name: admin.displayName };
  const auth = buildAuthContext(
    principal,
    toSessionUser(admin),
    null,
    await kernel.rbac.permissionsFor(admin.id),
  );
  const created = await runWithContext({ principal, requestId: 'seed' }, () =>
    new ApiClientService(kernel.registry.context('core')).create(
      {
        name: DEMO_BI_CLIENT,
        description: 'Power BI on-premises gateway: reads the published Data APIs',
        applicationIds: [],
        allApplications: false,
        permissions: ['etl.endpoints.invoke'],
        allowedCidrs: [],
        secretExpiresInDays: 365,
      },
      auth,
    ),
  );
  return { clientId: created.client.clientId, apiKey: created.secret };
}

export async function seedPhase4(kernel: Kernel): Promise<{ clientId: string; apiKey: string } | null> {
  const db = kernel.db;
  const log = kernel.logger;
  await grantDemoRoles(kernel, GRANTS, 'Phase 4 demo access');

  const [existing] = await db.select({ id: dbConnections.id }).from(dbConnections).limit(1);
  const logins = await buildDemoDatabase(kernel, !existing);
  const base = new URL(kernel.config.DATABASE_URL);
  const host = base.hostname;
  const port = Number(base.port || 5432);
  const fake = () => password();

  const seeds: ConnectionSeed[] = [];
  if (logins) {
    seeds.push(
      {
        key: 'contoso-erp',
        name: 'Contoso ERP (reporting)',
        description: 'Read-only reporting login on the ERP database. Backs the published Data APIs.',
        engine: 'postgres',
        host,
        port,
        database: DEMO_DATABASE,
        username: 'isbp_demo_reader',
        password: logins.reader,
        purposes: ['data'],
        readOnly: true,
        tls: 'off',
      },
      {
        key: 'contoso-dw',
        name: 'Contoso data warehouse',
        description: 'ETL login: reads the ERP and loads the dw schema.',
        engine: 'postgres',
        host,
        port,
        database: DEMO_DATABASE,
        username: 'isbp_demo_etl',
        password: logins.etl,
        purposes: ['data'],
        readOnly: false,
        tls: 'off',
      },
      {
        key: 'contoso-erp-admin',
        name: 'Contoso ERP – account administration',
        description: 'CREATEROLE login with admin option on the demo_* roles. Used by Database access only.',
        engine: 'postgres',
        host,
        port,
        database: DEMO_DATABASE,
        username: 'isbp_demo_dba',
        password: logins.dba,
        purposes: ['admin'],
        readOnly: false,
        tls: 'off',
      },
    );
  }
  seeds.push(
    {
      key: 'hr-sql01',
      name: 'HR (SQL Server)',
      description: 'HRIS on SQL Server 2022. Reachable only from the data-centre network.',
      engine: 'mssql',
      host: 'sql-hr-01.corp.contoso.example',
      port: 1433,
      database: 'HRIS',
      username: 'svc_isbp',
      password: fake(),
      purposes: ['data', 'admin'],
      readOnly: false,
      tls: 'require',
      unreachable: true,
    },
    {
      key: 'fin-ora01',
      name: 'Finance (Oracle)',
      description: 'Oracle 19c finance ledger (pluggable database FINPDB).',
      engine: 'oracle',
      host: 'ora-fin-01.corp.contoso.example',
      port: 1521,
      database: 'FINPDB',
      username: 'ISBP_ADMIN',
      password: fake(),
      purposes: ['admin'],
      readOnly: false,
      tls: 'off',
      unreachable: true,
    },
    {
      key: 'crm-mysql',
      name: 'CRM (MySQL)',
      description: 'Customer relationship management replica on MySQL 8.',
      engine: 'mysql',
      host: 'mysql-crm-01.corp.contoso.example',
      port: 3306,
      database: 'crm',
      username: 'isbp_reader',
      password: fake(),
      purposes: ['data'],
      readOnly: true,
      tls: 'require',
      unreachable: true,
    },
  );

  let created = 0;
  for (const s of seeds) {
    const values = {
      name: s.name,
      description: s.description,
      engine: s.engine,
      host: s.host,
      port: s.port,
      database: s.database,
      username: s.username,
      passwordSealed: kernel.box.encrypt(s.password),
      options: { tls: s.tls, ca: null, instanceName: null, domain: null },
      purposes: s.purposes,
      readOnly: s.readOnly,
      enabled: true,
      ...(s.unreachable
        ? {
            status: 'error' as const,
            lastCheckedAt: new Date(Date.now() - 25 * 60_000),
            lastError: `ENOTFOUND: getaddrinfo ENOTFOUND ${s.host}`,
          }
        : {}),
    };
    const [row] = await db
      .select({ id: dbConnections.id })
      .from(dbConnections)
      .where(eq(dbConnections.key, s.key));
    if (row) await db.update(dbConnections).set(values).where(eq(dbConnections.id, row.id));
    else {
      await db.insert(dbConnections).values({ key: s.key, ...values });
      created++;
    }
  }
  // Record a real status for the reachable ones.
  for (const r of await kernel.databases.all())
    if (r.engine === 'postgres') await kernel.databases.test(r.id).catch(() => undefined);
  log.info(
    { connections: seeds.length, created, demoDatabase: Boolean(logins) },
    'phase 4 database connections',
  );
  return ensureBiClient(kernel);
}

/**
 * After the module seeds: Scheduled jobs that run other modules' task types (ETL pipelines, database inventory
 * syncs), with two weeks of history. Skipped for any module that isn't installed.
 */
export async function seedPhase4Links(kernel: Kernel) {
  if (!kernel.registry.get('scheduler')) return;
  const { seedJob, seedRunHistory } = await import('@isbp/module-scheduler/server');
  const ctx = kernel.registry.context('scheduler');
  let created = 0;

  if (kernel.registry.get('etl')) {
    const { pipelines } = await import('@isbp/module-etl/schema');
    const rows = await kernel.db
      .select({
        id: pipelines.id,
        name: pipelines.name,
        source: dbConnections.id,
        sourceName: dbConnections.name,
      })
      .from(pipelines)
      .leftJoin(dbConnections, eq(dbConnections.id, pipelines.sourceConnectionId));
    const idOf = (name: string) => rows.find((r) => r.name === name)?.id;
    const customers = idOf('Customer dimension');
    const sales = idOf('Daily sales to warehouse');
    const crm = idOf('CRM accounts to warehouse');
    const { pipelineRuns } = await import('@isbp/module-etl/schema');
    /** The pipeline's scheduled runs came from this job (its page links to the job instead of offering "Schedule"). */
    const linkRuns = (pipelineId: string, jobId: string) =>
      kernel.db
        .update(pipelineRuns)
        .set({ taskJobId: jobId })
        .where(and(eq(pipelineRuns.pipelineId, pipelineId), eq(pipelineRuns.trigger, 'schedule')));
    const crmSource = rows.find((r) => r.id === crm);
    if (customers) {
      const id = await seedJob(ctx, {
        name: 'Customer dimension refresh',
        description: 'Loads ERP customers into dw.customer_dim every night.',
        type: 'etl.pipeline',
        config: { pipelineId: customers },
        trigger: { kind: 'cron', cron: '30 1 * * *', timezone: 'Asia/Taipei' },
        ownerGroupKey: 'dba-team',
        timeoutSeconds: 900,
        retries: { maxAttempts: 3, backoff: 'exponential', delaySeconds: 120 },
      });
      await seedRunHistory(ctx, id, {
        days: 14,
        durationMs: [8_000, 25_000],
        summary: () => 'etl.results.pipeline',
        summaryParams: (n) => ({ written: 395 + (n % 9), read: 395 + (n % 9), rejected: 0 }),
        metrics: (n) => ({ rowsRead: 395 + (n % 9), rowsWritten: 395 + (n % 9), rowsRejected: 0 }),
      });
      await linkRuns(customers, id);
      created++;
    }
    if (sales) {
      const id = await seedJob(ctx, {
        name: 'Sales to warehouse (every 4 hours)',
        description: 'Incremental load of order lines into dw.sales_daily.',
        type: 'etl.pipeline',
        config: { pipelineId: sales },
        trigger: { kind: 'cron', cron: '0 */4 * * *', timezone: 'Asia/Taipei' },
        ownerGroupKey: 'dba-team',
        timeoutSeconds: 1_800,
        retries: { maxAttempts: 3, backoff: 'exponential', delaySeconds: 300 },
      });
      await seedRunHistory(ctx, id, {
        days: 14,
        durationMs: [12_000, 90_000],
        failureRate: 0.04,
        errors: ['DATABASE_ERROR 57014: canceling statement due to statement timeout'],
        summary: () => 'etl.results.pipeline',
        summaryParams: (n) => ({ written: 40 + (n % 60), read: 40 + (n % 60), rejected: 0 }),
        metrics: (n) => ({ rowsRead: 40 + (n % 60), rowsWritten: 40 + (n % 60), rowsRejected: 0 }),
        timeouts: 1,
      });
      await linkRuns(sales, id);
      created++;
    }
    if (crm) {
      const id = await seedJob(ctx, {
        name: 'CRM accounts to warehouse',
        description: 'Copies CRM accounts after the customer dimension is refreshed.',
        type: 'etl.pipeline',
        config: { pipelineId: crm },
        trigger: { kind: 'after', upstream: ['Customer dimension refresh'], mode: 'all' },
        ownerGroupKey: 'dba-team',
        retries: { maxAttempts: 2, backoff: 'fixed', delaySeconds: 600 },
      });
      await seedRunHistory(ctx, id, {
        days: 14,
        failLast: 4,
        errors: ['DATABASE_ERROR ENOTFOUND: getaddrinfo ENOTFOUND mysql-crm-01.corp.contoso.example'],
        // The source connection can't be found: the run page names it and links to it.
        connection: crmSource?.source ? { id: crmSource.source, name: crmSource.sourceName ?? '' } : null,
        durationMs: [1_000, 4_000],
      });
      await linkRuns(crm, id);
      created++;
    }
  }

  if (kernel.registry.get('dbaccess')) {
    const { servers } = await import('@isbp/module-dbaccess/schema');
    const rows = await kernel.db
      .select({
        id: servers.id,
        name: servers.displayName,
        key: dbConnections.key,
        connectionId: dbConnections.id,
        connectionName: dbConnections.name,
      })
      .from(servers)
      .innerJoin(dbConnections, eq(dbConnections.id, servers.connectionId));
    for (const s of rows) {
      const unreachable = s.key !== 'contoso-erp-admin';
      const id = await seedJob(ctx, {
        name: `Database inventory: ${s.name}`,
        description: 'Reads accounts, roles and memberships, and flags access no grant explains.',
        type: 'dbaccess.sync',
        config: { serverId: s.id },
        trigger: { kind: 'cron', cron: '45 2 * * *', timezone: 'Asia/Taipei' },
        ownerGroupKey: 'dba-team',
        timeoutSeconds: 600,
      });
      await seedRunHistory(ctx, id, {
        days: 14,
        durationMs: [2_000, 9_000],
        ...(unreachable
          ? {
              failLast: 2,
              errors: [`DATABASE_ERROR ENOTFOUND: the server ${s.name} could not be reached`],
              connection: { id: s.connectionId, name: s.connectionName },
            }
          : {}),
        summary: (n) => `${12 + (n % 3)} accounts, ${4} roles, ${n % 2} unmanaged`,
      });
      created++;
    }
  }
  kernel.logger.info({ jobs: created }, 'phase 4 cross-module scheduled jobs');
}
