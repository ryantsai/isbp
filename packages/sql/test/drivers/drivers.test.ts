import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ConnectionConfig, type DbEngine, SqlClient, SqlError } from '../../src';

/**
 * The same suite against every engine that has a URL: ISBP_TEST_PG_URL, ISBP_TEST_MSSQL_URL,
 * ISBP_TEST_MYSQL_URL, ISBP_TEST_ORACLE_URL (CI runs all four as service containers).
 */
const URLS: Record<DbEngine, string | undefined> = {
  postgres: process.env.ISBP_TEST_PG_URL,
  mssql: process.env.ISBP_TEST_MSSQL_URL,
  mysql: process.env.ISBP_TEST_MYSQL_URL,
  oracle: process.env.ISBP_TEST_ORACLE_URL,
};

function configFrom(engine: DbEngine, raw: string): ConnectionConfig {
  const url = new URL(raw);
  return {
    engine,
    host: url.hostname,
    port: url.port ? Number(url.port) : null,
    database: decodeURIComponent(url.pathname.slice(1)) || null,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    options: { tls: engine === 'mssql' ? 'require' : 'off' },
    poolMax: 3,
  };
}

interface Fixture {
  setup: string[];
  teardown: string[];
  table: { schema: string | null; name: string };
  cols: { id: string; name: string; amount: string };
  sleep: string;
  /** A procedure or function returning the rows with amount >= :min. */
  routine: string;
}

const FIXTURES: Record<DbEngine, Fixture> = {
  postgres: {
    setup: [
      'CREATE TABLE isbp_drv (id int PRIMARY KEY, name varchar(50), amount numeric(10,2))',
      `CREATE FUNCTION isbp_drv_min(min_amount numeric) RETURNS SETOF isbp_drv LANGUAGE sql AS $$ SELECT * FROM isbp_drv WHERE amount >= min_amount ORDER BY id $$`,
    ],
    teardown: ['DROP FUNCTION IF EXISTS isbp_drv_min(numeric)', 'DROP TABLE IF EXISTS isbp_drv'],
    table: { schema: null, name: 'isbp_drv' },
    cols: { id: 'id', name: 'name', amount: 'amount' },
    sleep: 'SELECT pg_sleep(5)',
    routine: 'isbp_drv_min',
  },
  mssql: {
    setup: [
      'CREATE TABLE isbp_drv (id int PRIMARY KEY, name nvarchar(50), amount decimal(10,2))',
      'CREATE PROCEDURE isbp_drv_min @min_amount decimal(10,2) AS SELECT * FROM isbp_drv WHERE amount >= @min_amount ORDER BY id',
    ],
    teardown: [
      "IF OBJECT_ID('isbp_drv_min') IS NOT NULL DROP PROCEDURE isbp_drv_min",
      "IF OBJECT_ID('isbp_drv') IS NOT NULL DROP TABLE isbp_drv",
    ],
    table: { schema: 'dbo', name: 'isbp_drv' },
    cols: { id: 'id', name: 'name', amount: 'amount' },
    sleep: "WAITFOR DELAY '00:00:05'",
    routine: 'isbp_drv_min',
  },
  mysql: {
    setup: [
      'CREATE TABLE isbp_drv (id int PRIMARY KEY, name varchar(50), amount decimal(10,2))',
      'CREATE PROCEDURE isbp_drv_min(IN min_amount decimal(10,2)) SELECT * FROM isbp_drv WHERE amount >= min_amount ORDER BY id',
    ],
    teardown: ['DROP PROCEDURE IF EXISTS isbp_drv_min', 'DROP TABLE IF EXISTS isbp_drv'],
    table: { schema: null, name: 'isbp_drv' },
    cols: { id: 'id', name: 'name', amount: 'amount' },
    sleep: 'SELECT SLEEP(5)',
    routine: 'isbp_drv_min',
  },
  oracle: {
    setup: [
      'CREATE TABLE ISBP_DRV (ID NUMBER(10) PRIMARY KEY, NAME VARCHAR2(50), AMOUNT NUMBER(10,2))',
      `CREATE OR REPLACE PROCEDURE ISBP_DRV_MIN(MIN_AMOUNT IN NUMBER, RESULTS OUT SYS_REFCURSOR) AS
       BEGIN OPEN RESULTS FOR SELECT * FROM ISBP_DRV WHERE AMOUNT >= MIN_AMOUNT ORDER BY ID; END;`,
    ],
    teardown: [
      "BEGIN EXECUTE IMMEDIATE 'DROP PROCEDURE ISBP_DRV_MIN'; EXCEPTION WHEN OTHERS THEN NULL; END;",
      "BEGIN EXECUTE IMMEDIATE 'DROP TABLE ISBP_DRV PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;",
    ],
    table: { schema: null, name: 'ISBP_DRV' },
    cols: { id: 'ID', name: 'NAME', amount: 'AMOUNT' },
    sleep: 'BEGIN DBMS_SESSION.SLEEP(5); END;',
    routine: 'ISBP_DRV_MIN',
  },
};

for (const engine of Object.keys(URLS) as DbEngine[]) {
  const url = URLS[engine];
  describe.skipIf(!url)(`${engine} driver`, () => {
    const f = FIXTURES[engine];
    const { id, name, amount } = f.cols;
    let db: SqlClient;
    const q = (sql: string) =>
      `SELECT ${id} AS "id", ${name} AS "name", ${amount} AS "amount" FROM ${f.table.name} ${sql}`.replace(
        /"/g,
        engine === 'mysql' ? '`' : '"',
      );

    beforeAll(async () => {
      db = new SqlClient(configFrom(engine, url!));
      for (const s of f.teardown) await db.query(s).catch(() => undefined);
      for (const s of f.setup) await db.query(s);
    });
    afterAll(async () => {
      for (const s of f.teardown) await db.query(s).catch(() => undefined);
      await db.close();
    });

    it('connects and reports the server version', async () => {
      const info = await db.test();
      expect(info.version.length).toBeGreaterThan(3);
    });

    it('writes rows in a transaction (insert, then upsert)', async () => {
      const w = await db.writer(f.table, { columns: [id, name, amount], mode: 'insert' });
      const rows = Array.from({ length: 30 }, (_, i) => ({
        [id]: i + 1,
        [name]: `row ${i + 1}`,
        [amount]: (i + 1) * 10,
      }));
      expect(await w.write(rows)).toBe(30);
      await w.commit();
      const up = await db.writer(f.table, { columns: [id, name, amount], mode: 'upsert', keys: [id] });
      await up.write([
        { [id]: 1, [name]: 'first (updated)', [amount]: 15 },
        { [id]: 31, [name]: "O'Brien; DROP TABLE x", [amount]: 310 },
      ]);
      await up.commit();
      const r = await db.query(q(`WHERE ${id} IN (:ids) ORDER BY ${id}`), { params: { ids: [1, 31] } });
      expect(r.rows.map((x) => [Number(x.id), x.name])).toEqual([
        [1, 'first (updated)'],
        [31, "O'Brien; DROP TABLE x"],
      ]);
    });

    it('rolls back a writer', async () => {
      const w = await db.writer(f.table, { columns: [id, name, amount], mode: 'insert' });
      await w.write([{ [id]: 99, [name]: 'ghost', [amount]: 1 }]);
      await w.rollback();
      const r = await db.query(q(`WHERE ${id} = :id`), { params: { id: 99 } });
      expect(r.rows).toEqual([]);
    });

    it('binds typed parameters and caps rows', async () => {
      const r = await db.query(q(`WHERE ${amount} >= :min ORDER BY ${id}`), {
        params: { min: '100' },
        types: { min: 'decimal' },
        maxRows: 5,
      });
      expect(r.rows).toHaveLength(5);
      expect(r.truncated).toBe(true);
      expect(r.columns.map((c) => c.name.toLowerCase())).toEqual(['id', 'name', 'amount']);
    });

    it('streams in batches', async () => {
      let total = 0;
      let batches = 0;
      for await (const b of db.stream(q(`ORDER BY ${id}`), { batchSize: 7 })) {
        total += b.rows.length;
        batches++;
      }
      expect(total).toBe(31);
      expect(batches).toBe(5);
    });

    it.skipIf(engine === 'mssql')('refuses writes in a read-only transaction', async () => {
      await expect(db.query(`DELETE FROM ${f.table.name}`, { readOnly: true })).rejects.toBeInstanceOf(
        SqlError,
      );
      const r = await db.query(q(''), { maxRows: 100 });
      expect(r.rows).toHaveLength(31);
    });

    it('times out long statements and cancels them on the server', async () => {
      const started = Date.now();
      await expect(db.query(f.sleep, { timeoutMs: 1_000 })).rejects.toMatchObject({ kind: 'timeout' });
      expect(Date.now() - started).toBeLessThan(4_500);
      // The pool is still usable afterwards.
      expect((await db.query(q(`WHERE ${id} = :id`), { params: { id: 2 } })).rows).toHaveLength(1);
    });

    it('introspects tables, keys and routines', async () => {
      const cat = await db.catalog();
      const t = cat.tables.find((x) => x.name.toLowerCase() === 'isbp_drv');
      expect(t?.columns.map((c) => [c.name.toLowerCase(), c.key])).toEqual([
        ['id', true],
        ['name', false],
        ['amount', false],
      ]);
      expect(cat.procedures.some((p) => p.name.toLowerCase() === 'isbp_drv_min')).toBe(true);
    });

    it('calls a routine from the catalog with named arguments', async () => {
      const cat = await db.catalog();
      const proc = cat.procedures.find((p) => p.name.toLowerCase() === f.routine.toLowerCase())!;
      const arg = proc.parameters.find((p) => p.direction === 'in')!.name;
      const r = await db.call(proc, { [arg]: 290 });
      expect(r.rows.map((x) => Number(x[id] ?? x.id))).toEqual([29, 30, 31]);
    });

    it('replaces the table contents', async () => {
      const w = await db.writer(f.table, { columns: [id, name, amount], mode: 'replace' });
      await w.write([{ [id]: 1, [name]: 'only', [amount]: 1 }]);
      await w.commit();
      expect((await db.query(q(''))).rows).toHaveLength(1);
    });

    it('reports database errors as SqlError with the server code', async () => {
      await expect(db.query('SELECT * FROM isbp_missing_table')).rejects.toMatchObject({
        name: 'SqlError',
      });
    });
  });
}
