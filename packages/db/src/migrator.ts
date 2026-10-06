import type { Migration } from '@isbp/sdk/server';
import type pg from 'pg';

export interface MigrationSet {
  moduleId: string;
  migrations: readonly Migration[];
}

export interface MigrationLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

/** Arbitrary but stable key for `pg_advisory_lock` so only one replica migrates at a time. */
const LOCK_KEY = 4_118_190_001;

const TRACKING_TABLE = `
  create table if not exists public.isbp_migrations (
    module_id  text        not null,
    tag        text        not null,
    hash       text        not null,
    applied_at timestamptz not null default now(),
    primary key (module_id, tag)
  )`;

/**
 * Applies embedded migrations per module, in the given order (core first, then modules by dependency).
 * - Each migration runs in its own transaction.
 * - A session-level advisory lock serialises concurrent runners (e.g. several pods starting).
 * - An applied migration whose SQL changed is a hard error: history is immutable.
 */
export async function runMigrations(
  pool: pg.Pool,
  sets: readonly MigrationSet[],
  log: MigrationLogger = console,
): Promise<{ applied: string[] }> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(TRACKING_TABLE);
    const { rows } = await client.query<{ module_id: string; tag: string; hash: string }>(
      'select module_id, tag, hash from public.isbp_migrations',
    );
    const done = new Map(rows.map((r) => [`${r.module_id}/${r.tag}`, r.hash]));

    for (const set of sets) {
      for (const m of set.migrations) {
        const key = `${set.moduleId}/${m.tag}`;
        const existing = done.get(key);
        if (existing) {
          if (existing !== m.hash) {
            throw new Error(
              `Migration ${key} was modified after being applied (hash ${existing.slice(0, 8)} → ${m.hash.slice(0, 8)}). ` +
                'Create a new migration instead of editing an applied one.',
            );
          }
          continue;
        }
        log.info(`applying migration ${key}`);
        await client.query('begin');
        try {
          for (const statement of m.sql.split('--> statement-breakpoint')) {
            if (statement.trim()) await client.query(statement);
          }
          await client.query(
            'insert into public.isbp_migrations (module_id, tag, hash) values ($1, $2, $3)',
            [set.moduleId, m.tag, m.hash],
          );
          await client.query('commit');
          applied.push(key);
        } catch (err) {
          await client.query('rollback');
          throw new Error(`Migration ${key} failed: ${(err as Error).message}`, { cause: err });
        }
      }
    }
    return { applied };
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
