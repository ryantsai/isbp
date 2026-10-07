import { describe, expect, it } from 'vitest';
import { batchRows, dialectFor, SqlError, toSqlError } from '../../src';

describe('dialects', () => {
  it('quotes identifiers per engine and escapes the quote character', () => {
    expect(dialectFor('postgres').qualified('dw', 'sales "daily"')).toBe('"dw"."sales ""daily"""');
    expect(dialectFor('mssql').qualified('dbo', 'a]b')).toBe('[dbo].[a]]b]');
    expect(dialectFor('mysql').quote('a`b')).toBe('`a``b`');
    expect(() => dialectFor('oracle').quote('A"B')).toThrow(SqlError);
    expect(() => dialectFor('postgres').quote('bad\u0000name')).toThrow(SqlError);
  });

  it('builds multi-row inserts and upserts with placeholders only', () => {
    const pg = dialectFor('postgres').writeStatement('"dw"."t"', ['id', 'name'], 2, 'upsert', ['id']);
    expect(pg).toBe(
      'INSERT INTO "dw"."t" ("id", "name") VALUES (:c0_0, :c1_0), (:c0_1, :c1_1) ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name"',
    );
    const my = dialectFor('mysql').writeStatement('`t`', ['id', 'name'], 1, 'upsert', ['id']);
    expect(my).toBe(
      'INSERT INTO `t` (`id`, `name`) VALUES (:c0_0, :c1_0) AS new_row ON DUPLICATE KEY UPDATE `name` = new_row.`name`',
    );
    const ms = dialectFor('mssql').writeStatement('[dbo].[t]', ['id', 'name'], 1, 'upsert', ['id']);
    expect(ms).toContain(
      'MERGE INTO [dbo].[t] WITH (HOLDLOCK) AS tgt USING (VALUES (:c0_0, :c1_0)) AS src ([id], [name])',
    );
    expect(ms).toContain('WHEN MATCHED THEN UPDATE SET tgt.[name] = src.[name]');
    const ora = dialectFor('oracle').writeStatement('"T"', ['ID', 'NAME'], 1, 'upsert', ['ID']);
    expect(ora).toBe(
      'MERGE INTO "T" tgt USING (SELECT :c0_0 AS "ID", :c1_0 AS "NAME" FROM dual) src ON (tgt."ID" = src."ID") WHEN MATCHED THEN UPDATE SET tgt."NAME" = src."NAME" WHEN NOT MATCHED THEN INSERT ("ID", "NAME") VALUES (src."ID", src."NAME")',
    );
  });

  it('keys-only upserts do nothing on conflict', () => {
    expect(dialectFor('postgres').writeStatement('t', ['id'], 1, 'upsert', ['id'])).toMatch(/DO NOTHING$/);
  });

  it('batches within parameter limits', () => {
    expect(batchRows(dialectFor('mssql'), 10)).toBe(200);
    expect(batchRows(dialectFor('mssql'), 1)).toBe(500);
    expect(batchRows(dialectFor('oracle'), 5)).toBe(1);
    expect(batchRows(dialectFor('postgres'), 3, 10_000)).toBe(5_000);
  });
});

describe('errors', () => {
  it('classifies driver errors by code and keeps the server message', () => {
    expect(toSqlError({ code: '28P01', message: 'password authentication failed' }).kind).toBe('auth');
    expect(toSqlError({ code: 'ETIMEOUT', message: 'timed out' }).kind).toBe('timeout');
    expect(toSqlError({ errorNum: 942, message: 'ORA-00942: table or view does not exist' })).toMatchObject({
      kind: 'permission',
      dbCode: 'ORA-00942',
    });
    expect(
      toSqlError({
        code: 'EREQUEST',
        originalError: { info: { number: 2627, message: 'Violation of PRIMARY KEY' } },
      }),
    ).toMatchObject({
      kind: 'constraint',
      dbCode: '2627',
    });
    expect(toSqlError(new Error('boom')).kind).toBe('other');
  });
});
