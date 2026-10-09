/**
 * Creates or drops the simulator's own database (used by `stack.sh`): `tsx src/stack/db.ts ensure|drop <url>`.
 * Refuses the demo database (`isbp`) and the integration test databases (`*_test`).
 */
import pg from 'pg';
import { assertSimDatabase } from '../safety';

const [command, url] = process.argv.slice(2);
if (!url || (command !== 'ensure' && command !== 'drop')) {
  console.error('usage: db.ts ensure|drop <postgres-url>');
  process.exit(2);
}

const target = new URL(url);
const name = decodeURIComponent(target.pathname.slice(1));
assertSimDatabase(name);
const admin = new URL(url);
admin.pathname = '/postgres';

const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
  const ident = `"${name.replaceAll('"', '""')}"`;
  if (command === 'ensure') {
    if (rowCount) {
      process.stdout.write('exists\n');
    } else {
      await client.query(`create database ${ident}`);
      process.stdout.write('created\n');
    }
  } else if (rowCount) {
    await client.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name],
    );
    await client.query(`drop database ${ident}`);
    process.stdout.write('dropped\n');
  } else {
    process.stdout.write('absent\n');
  }
} finally {
  await client.end();
}
