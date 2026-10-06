import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['core'],
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://isbp:isbp@localhost:5432/isbp' },
});
