import { defineConfig } from 'drizzle-kit';

/** Each module owns one Postgres schema; drizzle-kit only diffs that schema. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/schema.ts',
  out: './migrations',
  schemaFilter: ['meetings'],
});
