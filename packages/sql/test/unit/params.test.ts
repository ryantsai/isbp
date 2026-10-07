import { describe, expect, it } from 'vitest';
import { bindStatement, parameterNames, SqlError, statementCount, writeKeywords } from '../../src';

describe('parameterNames', () => {
  it('finds :name placeholders in order, once each', () => {
    expect(parameterNames('SELECT * FROM t WHERE a = :a AND b IN (:ids) OR a = :a', 'postgres')).toEqual([
      'a',
      'ids',
    ]);
  });

  it('ignores colons inside strings, quoted identifiers and comments', () => {
    const sql = `SELECT ':not', "col:x", 'it''s :no' -- :comment
      /* :block */ FROM t WHERE x = :yes`;
    expect(parameterNames(sql, 'postgres')).toEqual(['yes']);
  });

  it('skips PostgreSQL casts, dollar quotes and E-strings', () => {
    const sql = `SELECT :v::int, $$ :inside $$, $tag$ :x $tag$, E'\\' :no', created_at::date FROM t WHERE id = :id`;
    expect(parameterNames(sql, 'postgres')).toEqual(['v', 'id']);
  });

  it('skips PL/SQL assignments and Oracle q-quotes', () => {
    const sql = `BEGIN v := :input; x := q'[ :not ]'; END;`;
    expect(parameterNames(sql, 'oracle')).toEqual(['input']);
  });

  it('skips SQL Server bracket identifiers and @variables', () => {
    expect(parameterNames('SELECT [a:b], @local FROM t WHERE c = :c', 'mssql')).toEqual(['c']);
  });

  it('skips MySQL backticks, # comments and backslash escapes', () => {
    const sql = "SELECT `x:y`, 'a\\' :no' # :comment\nFROM t WHERE c = :c";
    expect(parameterNames(sql, 'mysql')).toEqual(['c']);
  });

  it('does not treat array slices or time literals as parameters', () => {
    expect(parameterNames('SELECT arr[lo:hi], 10:30 FROM t', 'postgres')).toEqual([]);
  });
});

describe('bindStatement', () => {
  const sql = 'SELECT * FROM t WHERE a = :a AND b IN (:ids) AND c = :a';

  it('PostgreSQL: numbered placeholders, a repeated name binds once', () => {
    const b = bindStatement('postgres', sql, { a: 1, ids: [7, 8] });
    expect(b.text).toBe('SELECT * FROM t WHERE a = $1 AND b IN ($2, $3) AND c = $1');
    expect(b.engine === 'postgres' && b.values).toEqual([1, 7, 8]);
  });

  it('MySQL: positional ? per occurrence', () => {
    const b = bindStatement('mysql', sql, { a: 'x', ids: [1] });
    expect(b.text).toBe('SELECT * FROM t WHERE a = ? AND b IN (?) AND c = ?');
    expect(b.engine === 'mysql' && b.values).toEqual(['x', 1, 'x']);
  });

  it('SQL Server: named @p_ inputs', () => {
    const b = bindStatement('mssql', sql, { a: 1, ids: [2, 3] }, { a: 'integer' });
    expect(b.text).toBe('SELECT * FROM t WHERE a = @p_a AND b IN (@p_ids_0, @p_ids_1) AND c = @p_a');
    expect(b.engine === 'mssql' && b.binds.map((x) => [x.name, x.value, x.type])).toEqual([
      ['p_a', 1, 'integer'],
      ['p_ids_0', 2, null],
      ['p_ids_1', 3, null],
    ]);
  });

  it('Oracle: b<n> bind names (reserved words are safe)', () => {
    const b = bindStatement('oracle', 'SELECT * FROM t WHERE d = :date AND l = :level AND x = :date', {
      date: '2026-01-01',
      level: 3,
    });
    expect(b.text).toBe('SELECT * FROM t WHERE d = :b1 AND l = :b2 AND x = :b1');
    expect(b.engine === 'oracle' && Object.keys(b.binds)).toEqual(['b1', 'b2']);
  });

  it('never puts values into the text', () => {
    const evil = "'; DROP TABLE users; --";
    for (const engine of ['postgres', 'mysql', 'mssql', 'oracle'] as const) {
      const b = bindStatement(engine, 'SELECT * FROM t WHERE name = :name', { name: evil });
      expect(b.text).not.toContain('DROP');
    }
  });

  it('binds an empty list as NULL', () => {
    expect(bindStatement('postgres', 'SELECT 1 WHERE x IN (:ids)', { ids: [] }).text).toBe(
      'SELECT 1 WHERE x IN (NULL)',
    );
  });

  it('refuses a missing value', () => {
    expect(() => bindStatement('postgres', 'SELECT :a', {})).toThrow(SqlError);
  });

  it('coerces declared types', () => {
    const b = bindStatement(
      'postgres',
      'SELECT :i, :d, :b, :day, :n',
      { i: '42', d: 1.5, b: 'true', day: '2026-10-07', n: '3.25' },
      { i: 'integer', d: 'decimal', b: 'boolean', day: 'date', n: 'number' },
    );
    expect(b.engine === 'postgres' && b.values).toEqual([42, '1.5', true, '2026-10-07', 3.25]);
    expect(() => bindStatement('postgres', 'SELECT :i', { i: 'x' }, { i: 'integer' })).toThrow(/integer/);
    expect(() => bindStatement('postgres', 'SELECT :d', { d: '2026-13' }, { d: 'date' })).toThrow(/date/);
  });
});

describe('lints', () => {
  it('finds write keywords outside strings and comments', () => {
    expect(writeKeywords("SELECT 'delete me' FROM t -- update later", 'postgres')).toEqual([]);
    expect(writeKeywords('SELECT name INTO backup FROM t', 'mssql')).toEqual(['INTO']);
    expect(writeKeywords('delete from t where id = :id', 'postgres')).toEqual(['DELETE']);
  });

  it('counts statements', () => {
    expect(statementCount('SELECT 1;', 'postgres')).toBe(1);
    expect(statementCount("SELECT ';'; SELECT 2", 'postgres')).toBe(2);
  });
});
